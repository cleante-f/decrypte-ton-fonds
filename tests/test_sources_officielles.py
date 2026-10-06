import json
import re
import sys
import tempfile
import unittest
import urllib.parse
from pathlib import Path
from unittest import mock

RACINE = Path(__file__).resolve().parent.parent
DONNEES = RACINE / "tests" / "donnees"
sys.path.insert(0, str(RACINE / "scripts"))
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
        self.assertEqual(ci.notifies_france(docs), {"5493003BFED2MWDBYH64"})

    def test_notifies_france_sans_pays(self):
        self.assertEqual(ci.notifies_france([{"funds_lei": "X"}]), set())

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
            self.assertEqual(params["fl"], ["funds_lei,funds_host_country_codes"])
            q = params["q"][0]
            self.assertTrue(q.startswith("funds_lei:(") and q.endswith(")"), q)
            lot = q[len("funds_lei:("):-1].split(" OR ")
            lots.append(lot)
            docs = [{"funds_lei": lei, "funds_host_country_codes": ["DE", "FR"] if lei in notifies else ["DE"]} for lei in lot]
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
        for mauvais in ["NA", "N/A", "info@gutenbergfinance.com", "Under%20construction", "En%20cours%20de%20création", ""]:
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

    def test_ecrire_societes(self):
        with tempfile.TemporaryDirectory() as d:
            f = Path(d) / "societes.js"
            ci.ecrire_societes({"A": ["GP-1", "2000-01-01", "", "Vivant"]}, "2026-10-05", f)
            contenu = json.loads(re.search(r"const SOCIETES = (.*?);\n", f.read_text(encoding="utf-8"), re.S).group(1))
        self.assertEqual(contenu["publication"], "2026-10-05")
        self.assertEqual(contenu["societes"], {"A": ["GP-1", "2000-01-01", "", "Vivant"]})
        self.assertRegex(contenu["maj"], r"^\d{4}-\d{2}-\d{2}$")


if __name__ == "__main__":
    unittest.main()
