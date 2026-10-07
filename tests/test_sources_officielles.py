import csv
import io
import json
import re
import sys
import tempfile
import unittest
import urllib.error
import urllib.parse
from pathlib import Path
from unittest import mock

RACINE = Path(__file__).resolve().parent.parent
DONNEES = RACINE / "tests" / "donnees"
sys.path.insert(0, str(RACINE / "scripts"))
import actualiser_contexte as ac
import construire_identite as ci


class Normalisation(unittest.TestCase):
    def test_cle_societe_vecteurs_communs(self):
        for nom, attendu in json.loads((DONNEES / "noms_societes.json").read_text(encoding="utf-8")):
            self.assertEqual(ci.cle_societe(nom), attendu, nom)

    def test_cle_societe_none(self):
        self.assertEqual(ci.cle_societe(None), "")


class Commercialisation(unittest.TestCase):
    def setUp(self):
        self.brut = (DONNEES / "esma_cbdif.json").read_bytes()

    def test_notifies_france(self):
        docs = json.loads(self.brut)["response"]["docs"]
        self.assertEqual(ci.notifies_france(docs), {"5493003BFED2MWDBYH64"})   # OPCVM actif notifié FR : gardé

    def test_notifies_france_sans_pays(self):
        self.assertEqual(ci.notifies_france([{"funds_lei": "X"}]), set())

    def doc_reel(self, lei, **changements):
        """Document de l'extrait réel, modifié pour les cas absents de l'extrait."""
        doc = next(d for d in json.loads(self.brut)["response"]["docs"] if d["funds_lei"] == lei)
        return {**doc, **changements}

    def test_notifies_france_fia_exclu(self):
        # FIA (directive AIFM) notifié pour la France : réservé aux investisseurs professionnels, pas retenu
        fia = self.doc_reel("529900APEXTPT6RN1778", funds_host_country_codes=["DE", "FR"])
        self.assertEqual(fia["funds_legal_framework_name"], "AIF")
        self.assertEqual(ci.notifies_france([fia]), set())
        for cadre in ["ELTIF", "EuVECA", "EuSEF", None]:
            self.assertEqual(ci.notifies_france([self.doc_reel("5493003BFED2MWDBYH64", funds_legal_framework_name=cadre)]), set(), cadre)

    def test_notifies_france_opcvm_inactif_exclu(self):
        for statut in ["INAC", None]:
            self.assertEqual(ci.notifies_france([self.doc_reel("5493003BFED2MWDBYH64", funds_status_code=statut)]), set(), statut)

    def test_notifies_france_opcvm_actif_garde(self):
        doc = {"funds_lei": "LEI-TEST", "funds_host_country_codes": ["FR"], "funds_legal_framework_name": "UCITS", "funds_status_code": "ACTV"}
        self.assertEqual(ci.notifies_france([doc]), {"LEI-TEST"})
        self.assertEqual(ci.notifies_france([{**doc, "funds_host_country_codes": ["DE"]}]), set())

    def test_commercialisation_par_lots_de_100(self):
        leis = {f"LEI{i:017d}" for i in range(250)} | {"5493003BFED2MWDBYH64"}
        liste = sorted(leis)
        notifies = {liste[0], liste[-1]}   # un dans le 1er lot, un dans le dernier
        lots = []

        def registre(url):
            """Fausse réponse ESMA : note les LEI demandés et ne renvoie « FR » que pour les deux notifiés."""
            requete = urllib.parse.urlparse(url)
            self.assertEqual(f"{requete.scheme}://{requete.netloc}{requete.path}", ci.ESMA_CBDIF)
            params = urllib.parse.parse_qs(requete.query)
            self.assertEqual(params["wt"], ["json"])
            self.assertEqual(params["rows"], ["1000"])
            self.assertEqual(params["fl"], ["funds_lei,funds_host_country_codes,funds_legal_framework_name,funds_status_code"])
            q = params["q"][0]
            self.assertTrue(q.startswith("funds_lei:(") and q.endswith(")"), q)
            lot = q[len("funds_lei:("):-1].split(" OR ")
            lots.append(lot)
            docs = [{"funds_lei": lei, "funds_host_country_codes": ["DE", "FR"] if lei in notifies else ["DE"],
                     "funds_legal_framework_name": "UCITS", "funds_status_code": "ACTV"} for lei in lot]
            return json.dumps({"response": {"docs": docs}}).encode()

        with mock.patch.object(ci, "telecharger", side_effect=registre) as t, mock.patch.object(ci.time, "sleep"):
            resultat = ci.commercialisation(leis)
        self.assertEqual(t.call_count, 3)
        self.assertEqual([len(lot) for lot in lots], [100, 100, 51])
        self.assertEqual(sorted(lei for lot in lots for lei in lot), liste)   # les 251 LEI, chacun une seule fois
        self.assertIn(liste[0], lots[0])
        self.assertIn(liste[-1], lots[-1])
        self.assertEqual(resultat, notifies)   # union des lots : le notifié du 1er lot et celui du dernier


class SocietesAmf(unittest.TestCase):
    def test_lire_sgp_extrait_reel(self):
        societes, publication = ci.lire_sgp((DONNEES / "amf_sgp.csv").read_text(encoding="utf-8-sig"))
        self.assertEqual(publication, "2026-10-05")
        self.assertEqual(societes, {
            "CARMIGNACGESTION": ["GP97008", "1997-03-13", "www.carmignac.com", "Vivant"],
            "AMUNDIASSETMANAGEMENT": ["GP-04000036", "2004-06-08", "", "Vivant"],
            "123INVESTMENTMANAGERS": ["GP01021", "2001-06-28", "http://www.123-im.com", "Vivant"],
            "OTOKTONE3I": ["GP-14000025", "2014-07-16", "", "Vivant"]})

    def test_site_propre_valeurs_reelles(self):
        for mauvais in ["NA", "N/A", "info@gutenbergfinance.com", "Under%20construction", "En%20cours%20de%20création", "",
                        "www.access_capital_partners.com"]:
            self.assertEqual(ci.site_propre(mauvais), "", mauvais)
        for bon in ["www.carmignac.com", "http://am.oddo-bhf.com", "https://investmentsolutions.societegenerale.fr", "jeito.life"]:
            self.assertEqual(ci.site_propre(" " + bon + " "), bon)

    def test_lire_sgp_refuse_un_autre_format(self):
        with self.assertRaises(ValueError):
            ci.lire_sgp("nom;site\nX;Y\n")

    def test_lire_sgp_meme_nom_vivant_prioritaire(self):
        entete = (DONNEES / "amf_sgp.csv").read_text(encoding="utf-8-sig").splitlines()[0]
        texte = entete + '\n"GP-1";"Même Nom";"";"";"";"";"";"";"";"2000-01-01";"";"Retiré";"";"";"";"2026-10-05"' \
                         '\n"GP-2";"MEME NOM";"";"";"";"";"";"";"";"2010-01-01";"";"Vivant";"";"";"";"2026-10-05"\n'
        self.assertEqual(ci.lire_sgp(texte)[0]["MEMENOM"][0], "GP-2")

    def test_lire_sgp_sans_lien_vers_hsbc(self):
        # ligne synthétique : seul le site change, le n° d'agrément (donnée AMF) reste
        entete = (DONNEES / "amf_sgp.csv").read_text(encoding="utf-8-sig").splitlines()[0]
        ligne = '"GP-{}";"Société Test {}";"";"FR";"{}";"";"";"";"";"2000-01-01";"";"Vivant";"";"";"";"2026-10-05"'
        sites = ["www.hsbc-reim.fr", "https://WWW.HSBC.FR/gestion"]
        texte = "\n".join([entete] + [ligne.format(i, i, site) for i, site in enumerate(sites)]) + "\n"
        societes = ci.lire_sgp(texte)[0]
        self.assertEqual(societes["SOCIETETEST0"], ["GP-0", "2000-01-01", "", "Vivant"])
        self.assertEqual(societes["SOCIETETEST1"], ["GP-1", "2000-01-01", "", "Vivant"])

    def test_ecrire_societes(self):
        with tempfile.TemporaryDirectory() as d:
            f = Path(d) / "societes.js"
            ci.ecrire_societes({"A": ["GP-1", "2000-01-01", "", "Vivant"]}, "2026-10-05", f)
            contenu = json.loads(re.search(r"const SOCIETES = (.*?);\n", f.read_text(encoding="utf-8"), re.S).group(1))
        self.assertEqual(contenu["publication"], "2026-10-05")
        self.assertEqual(contenu["societes"], {"A": ["GP-1", "2000-01-01", "", "Vivant"]})
        self.assertRegex(contenu["maj"], r"^\d{4}-\d{2}-\d{2}$")

    def test_societes_amf_prend_la_ressource_csv(self):
        fiche = {"resources": [{"format": "pdf", "url": "https://exemple.test/notice.pdf"},
                               {"format": "csv", "url": "https://exemple.test/sgp.csv"}]}
        brut = (DONNEES / "amf_sgp.csv").read_text(encoding="utf-8-sig").encode("utf-8-sig")
        with mock.patch.object(ci, "telecharger", side_effect=[json.dumps(fiche).encode(), brut]) as t:
            societes, publication = ci.societes_amf()
        self.assertEqual([c.args[0] for c in t.call_args_list], [ci.SGP_FICHE, "https://exemple.test/sgp.csv"])
        self.assertEqual(sorted(societes), ["123INVESTMENTMANAGERS", "AMUNDIASSETMANAGEMENT", "CARMIGNACGESTION", "OTOKTONE3I"])
        self.assertEqual(publication, "2026-10-05")

    def test_societes_amf_sans_ressource_csv(self):
        fiche = {"resources": [{"format": "pdf", "url": "https://exemple.test/notice.pdf"}]}
        with mock.patch.object(ci, "telecharger", return_value=json.dumps(fiche).encode()) as t:
            with self.assertRaisesRegex(ValueError, "aucune ressource CSV"):
                ci.societes_amf()
        self.assertEqual(t.call_count, 1)   # le CSV n'est pas demandé

    def lire_societes(self, fichier):
        return json.loads(re.search(r"const SOCIETES = (.*?);\n", fichier.read_text(encoding="utf-8"), re.S).group(1))

    def mettre_a_jour(self, fichier, **simulation):
        """Lance mettre_a_jour_societes avec une fausse liste AMF ; renvoie (ce qui est écrit sur stdout, sur stderr)."""
        with mock.patch.object(ci, "societes_amf", **simulation), \
                mock.patch("sys.stdout", new_callable=io.StringIO) as sortie, mock.patch("sys.stderr", new_callable=io.StringIO) as erreurs:
            ci.mettre_a_jour_societes(fichier)
        return sortie.getvalue(), erreurs.getvalue()

    def test_mettre_a_jour_societes_garde_l_ancien_fichier_si_erreur(self):
        pannes = [csv.Error("ligne illisible"), TypeError("'NoneType' object is not iterable"), AttributeError("x"),
                  OSError("réseau coupé"), ValueError("format inattendu"), KeyError("resources"), RuntimeError("pas de réponse")]
        for panne in pannes:
            with self.subTest(panne=type(panne).__name__), tempfile.TemporaryDirectory() as d:
                f = Path(d) / "societes.js"
                f.write_text("ancien contenu\n", encoding="utf-8")
                _, erreurs = self.mettre_a_jour(f, side_effect=panne)
                self.assertEqual(f.read_text(encoding="utf-8"), "ancien contenu\n")
                self.assertIn("liste AMF non mise à jour", erreurs)
                self.assertIn("ancien fichier gardé", erreurs)

    def test_mettre_a_jour_societes_fiche_sans_ressources(self):
        # une fiche dont « resources » vaut null fait lever TypeError dans societes_amf : rattrapé quand même
        with tempfile.TemporaryDirectory() as d:
            f = Path(d) / "societes.js"
            f.write_text("ancien contenu\n", encoding="utf-8")
            with mock.patch.object(ci, "telecharger", return_value=b'{"resources": null}'), \
                    mock.patch("sys.stderr", new_callable=io.StringIO) as erreurs:
                ci.mettre_a_jour_societes(f)
            self.assertEqual(f.read_text(encoding="utf-8"), "ancien contenu\n")
            self.assertIn("liste AMF non mise à jour", erreurs.getvalue())

    def test_mettre_a_jour_societes_seuil_de_300(self):
        def liste(n):
            return {f"S{i}": [f"GP-{i}", "2000-01-01", "", "Vivant"] for i in range(n)}
        with tempfile.TemporaryDirectory() as d:
            f = Path(d) / "societes.js"
            f.write_text("ancien contenu\n", encoding="utf-8")
            sortie, erreurs = self.mettre_a_jour(f, return_value=(liste(299), "2026-10-05"))
            self.assertEqual(f.read_text(encoding="utf-8"), "ancien contenu\n")   # 299 : trop peu, ancien fichier gardé
            self.assertIn("liste AMF non mise à jour", erreurs)
            self.assertIn("299", erreurs)
            self.assertEqual(sortie, "")
            sortie, erreurs = self.mettre_a_jour(f, return_value=(liste(300), "2026-10-06"))
            contenu = self.lire_societes(f)   # 300 : fichier réécrit
            self.assertEqual(contenu["societes"], liste(300))
            self.assertEqual(contenu["publication"], "2026-10-06")
            self.assertEqual(erreurs, "")
            self.assertIn("300 sociétés", sortie)


class Livrets(unittest.TestCase):
    def test_lire_serie_bce_mensuelle(self):
        pts = ac.lire_serie_bce((DONNEES / "bce_livrets.csv").read_text(encoding="utf-8"))
        self.assertEqual(pts, [("2026-06", 1.4), ("2026-07", 1.4), ("2026-08", 1.55)])
        ind = ac.indicateur("Livrets", pts, "BCE", "lien", "mensuelle")
        self.assertEqual((ind["valeur"], ind["date"], ind["unAn"]), (1.55, "2026-08", None))

    def test_indicateur_livrets_declare(self):
        self.assertIn(("livrets_fr", "Taux moyen des livrets d'épargne (France, ménages)", "MIR/M.FR.B.L23.D.R.A.2250.EUR.N",
                       "mensuelle", False, "France"), ac.INDICATEURS_BCE)


class Telechargement(unittest.TestCase):
    """Erreurs passagères (408 du GLEIF le 07/10/2026, 429, 5xx) : nouvel essai ; autres erreurs : arrêt immédiat."""

    def ouvrir(self, *effets):
        return mock.patch.object(ci.urllib.request, "urlopen", side_effect=list(effets))

    def reponse(self, contenu):
        r = mock.MagicMock()
        r.__enter__.return_value.read.return_value = contenu
        return r

    def erreur(self, code):
        return urllib.error.HTTPError("https://exemple.test", code, "erreur", {}, None)

    def test_reessaie_sur_408(self):
        with self.ouvrir(self.erreur(408), self.reponse(b"ok")) as u, mock.patch.object(ci.time, "sleep"), \
                mock.patch("sys.stdout", new_callable=io.StringIO) as sortie:
            self.assertEqual(ci.telecharger("https://exemple.test"), b"ok")
        self.assertEqual(u.call_count, 2)
        self.assertIn("408", sortie.getvalue())

    def test_arret_immediat_sur_404(self):
        with self.ouvrir(self.erreur(404)) as u, mock.patch.object(ci.time, "sleep"):
            with self.assertRaises(urllib.error.HTTPError):
                ci.telecharger("https://exemple.test")
        self.assertEqual(u.call_count, 1)


if __name__ == "__main__":
    unittest.main()
