#!/usr/bin/env python3
"""
Tests des sources de données : chaque test appelle la VRAIE API et vérifie que les champs utilisés existent toujours
(y compris les sources officielles ajoutées le 06/10/2026 : ESMA, liste AMF, taux des livrets, et les fichiers de la SEC pour les fonds
américains : classe EtatsUnis, lançable seule avec « python3 scripts/tests_sources.py EtatsUnis -v »).
    python3 scripts/tests_sources.py
Une source à clé est ignorée (et signalée) quand sa clé n'est pas définie (variable d'environnement ou fichier .env).
Le dernier test vérifie, sans réseau, le repli : secours, puis dernière valeur connue.
"""
import json
import unittest
import urllib.error
from datetime import date

from sources import actus_newsdata, change_bce, change_currencyapi, change_frankfurter, marches_amf
from sources.commun import DEVISES, SourceIndisponible, cle_api
from sources.entreprises import ENTREPRISES


def cle_definie(nom):
    try:
        cle_api(nom)
        return True
    except SourceIndisponible:
        return False


class Change(unittest.TestCase):
    def verifier(self, module):
        r = module.recuperer()
        self.assertEqual(set(r["taux"]), set(DEVISES), "toutes les devises suivies doivent être présentes")
        for dev, t in r["taux"].items():
            self.assertIsInstance(t["valeur"], float, dev)
            self.assertIsInstance(t["unAn"], float, f"{dev} : taux d'il y a un an")
            self.assertGreater(t["valeur"], 0, dev)
            self.assertLess(abs(t["valeur"] / t["unAn"] - 1), 0.5, f"{dev} : variation sur un an invraisemblable")
        self.assertLess((date.today() - date.fromisoformat(r["date"])).days, 7, "taux de plus d'une semaine")

    def test_bce(self):
        self.verifier(change_bce)

    def test_frankfurter(self):
        self.verifier(change_frankfurter)

    def test_currencyapi(self):
        self.verifier(change_currencyapi)


class Marches(unittest.TestCase):
    def verifier(self, module, devise):
        r = module.recuperer()
        self.assertEqual(r["devise"], devise)
        self.assertGreaterEqual(len(r["indices"]), 5)
        for cle, m in r["indices"].items():
            for champ in ("nom", "indice", "date", "valeur", "j1", "m1", "debutAnnee", "a1", "ref"):
                self.assertIn(champ, m, f"{cle}.{champ}")
            self.assertIsNotNone(m["a1"], f"{cle} : variation sur un an manquante")
            self.assertLess((date.today() - date.fromisoformat(m["date"])).days, 10, f"{cle} : cours de plus de 10 jours")

    def test_amf(self):
        self.verifier(marches_amf, "EUR")


class Actualites(unittest.TestCase):
    """Deux entreprises seulement, pour ménager les quotas gratuits (la liste complète tourne chaque jour)."""

    def verifier(self, module):
        tout = dict(ENTREPRISES)
        ENTREPRISES.clear()                      # la liste est partagée par les modules : on la réduit le temps du test
        ENTREPRISES.update({k: tout[k] for k in ("asml", "nvidia")})
        try:
            r = module.recuperer()
        finally:
            ENTREPRISES.clear()
            ENTREPRISES.update(tout)
        self.assertEqual(set(r["entreprises"]), {"asml", "nvidia"})
        articles = [a for e in r["entreprises"].values() for a in e["articles"]]
        self.assertTrue(articles, "aucun article")
        for a in articles:
            for champ in ("titre", "lien", "source", "date", "langue"):
                self.assertTrue(a[champ], f"champ {champ} vide")
            self.assertTrue(a["lien"].startswith("http"))
            self.assertRegex(a["date"], r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z$")

    @unittest.skipUnless(cle_definie("NEWSDATA_KEY"), "clé NEWSDATA_KEY absente")
    def test_newsdata(self):
        self.verifier(actus_newsdata)


class SourcesOfficielles(unittest.TestCase):
    """Sources ajoutées le 06/10/2026 (sans clé) : registre ESMA de la commercialisation, liste AMF des sociétés de gestion,
    taux moyen des livrets (BCE). Chaque test passe par les fonctions qu'utilisent les scripts, donc par les mêmes champs."""

    def test_esma_commercialisation(self):
        import construire_identite as ci
        # Amundi MSCI World Swap (LU1681043599) : OPCVM actif notifié pour la France
        self.assertEqual(ci.commercialisation({"5493003BFED2MWDBYH64"}), {"5493003BFED2MWDBYH64"},
                         "le registre ne renvoie plus FR, UCITS ou ACTV pour ce fonds : champs ou valeurs changés ?")

    def test_esma_registre(self):
        import construire_identite as ci
        # une page de 100 fiches (une seule requête). Toujours présents : id, nom, cadre, société de gestion, pays de l'autorité,
        # pays de commercialisation, statut. Facultatifs (absents de certaines fiches, 12 061 sans LEI le 11/10/2026) : le LEI du fonds
        # et de sa société, le nom de l'autorité, le pays de domicile : au moins une fiche de la page doit les avoir.
        docs = ci.registre_esma(par_page=100, pages=1)
        self.assertEqual(len(docs), 100, "le registre ne renvoie plus 100 fiches actives : requête ou champs changés ?")
        facultatifs = {"funds_lei", "funds_manager_lei", "funds_manager_comp_cou_code", "funds_domicile_cou_code"}
        for d in docs:
            manquants = set(ci.CHAMPS_ESMA) - facultatifs - set(d)
            self.assertFalse(manquants, f"champs absents de la fiche {d.get('id')} du registre ESMA : {sorted(manquants)}")
            self.assertEqual(d["funds_status_code"], "ACTV")
            self.assertIsInstance(d["funds_host_country_codes"], list)
        for champ in sorted(facultatifs):
            self.assertTrue(any(d.get(champ) for d in docs), f"{champ} absent de toutes les fiches de la page : champ renommé ?")

    def test_amf_societes_de_gestion(self):
        import construire_identite as ci
        societes, publication = ci.societes_amf()
        self.assertGreaterEqual(len(societes), 300)
        self.assertEqual(societes["CARMIGNACGESTION"][0], "GP97008")
        self.assertLess((date.today() - date.fromisoformat(publication)).days, 120, "liste AMF de plus de 4 mois")

    def test_bce_livrets(self):
        import actualiser_contexte as ac
        points = ac.serie_bce("MIR/M.FR.B.L23.D.R.A.2250.EUR.N", f"{date.today().year - 1}-01-01")
        self.assertTrue(points, "série des livrets vide")
        periode, taux = points[-1]
        self.assertRegex(periode, r"^\d{4}-\d{2}$")
        self.assertTrue(0 < taux < 10, taux)
        annee, mois = map(int, periode.split("-"))
        retard = (date.today().year - annee) * 12 + date.today().month - mois
        self.assertLessEqual(retard, 4, f"dernier taux publié en {periode} : série interrompue ?")


class EtatsUnis(unittest.TestCase):
    """Fichiers de la SEC lus par scripts/construire_etats_unis.py (fonds américains) : chaque test vérifie que les colonnes utilisées par le script
    existent toujours. Quelques requêtes seulement, avec le User-Agent et la pause du script (au plus 5 par seconde) ; les archives de plusieurs
    centaines de Mo sont lues par plages d'octets, seuls les débuts des fichiers sont demandés."""

    archives = {}   # adresse modèle → (trimestre, archive) : chaque archive n'est ouverte qu'une fois

    @classmethod
    def setUpClass(cls):
        import construire_etats_unis as cu
        cls.cu = cu

    def archive(self, modele):
        if modele not in self.archives:
            trimestre = self.cu.dernier_trimestre(modele)
            self.assertIsNotNone(trimestre, f"aucun fichier trouvé pour {modele} (adresse changée ?)")
            self.archives[modele] = (trimestre, self.cu.ouvrir_zip(modele.format(t=trimestre)))
        return self.archives[modele]

    def colonnes(self, archive, fichier, attendues):
        """Première ligne de données du fichier (lue comme le fait le script) : les colonnes utilisées par le script doivent exister."""
        lecteur = self.cu.lire_tsv(archive, fichier)
        try:
            ligne = next(lecteur, None)
        finally:
            lecteur.close()
        self.assertIsNotNone(ligne, f"{fichier} : aucune ligne de données")
        manquantes = [c for c in attendues if c not in ligne]
        self.assertFalse(manquantes, f"{fichier} : colonnes absentes {manquantes} (colonnes vues : {list(ligne)[:15]}…)")
        return ligne

    def test_tickers_des_fonds(self):
        fiches = json.loads(self.cu.telecharger(self.cu.TICKERS))
        self.assertTrue({"cik", "seriesId", "classId", "symbol"} <= set(fiches["fields"]), fiches["fields"])
        self.assertGreater(len(fiches["data"]), 20000)
        champs = {c: i for i, c in enumerate(fiches["fields"])}
        for ligne in fiches["data"][:200]:
            self.assertRegex(ligne[champs["seriesId"]] or "", r"^S\d{9}$")
            self.assertRegex(ligne[champs["classId"]] or "", r"^C\d{9}$")

    def test_liste_des_series(self):
        annee = date.today().year
        try:
            debut = self.cu.telecharger(self.cu.LISTE.format(annee=annee), (0, 20000))   # première page seulement
        except urllib.error.HTTPError as e:
            self.assertEqual(e.code, 404, e)
            debut = self.cu.telecharger(self.cu.LISTE.format(annee=annee - 1), (0, 20000))
        texte = debut.decode("utf-8-sig", errors="replace").rsplit("\n", 1)[0] + "\n"   # sans la dernière ligne, coupée
        series = self.cu.lire_liste(texte)   # ValueError si une colonne utilisée a disparu
        self.assertTrue(series)
        for serie, fiche in series.items():
            self.assertRegex(serie, r"^S\d{9}$")
            self.assertTrue(fiche["nom"] and fiche["entite"], (serie, fiche))
            for classe in fiche["classes"]:
                self.assertRegex(classe[0], r"^C\d{9}$")

    def test_nport_soumissions(self):
        trimestre, archive = self.archive(self.cu.NPORT)
        ligne = self.colonnes(archive, "SUBMISSION.tsv", ["ACCESSION_NUMBER", "FILING_DATE", "REPORT_DATE"])
        self.assertRegex(ligne["ACCESSION_NUMBER"], r"^\d{10}-\d{2}-\d{6}$")
        self.assertRegex(self.cu.date_sec(ligne["FILING_DATE"]), r"^\d{4}-\d{2}-\d{2}$")   # format « 31-JUL-2026 » toujours en vigueur
        self.assertRegex(self.cu.date_sec(ligne["REPORT_DATE"]), r"^\d{4}-\d{2}-\d{2}$")
        retard = (date.today().year - int(trimestre[:4])) * 4 + (date.today().month - 1) // 3 + 1 - int(trimestre[-1])
        self.assertLessEqual(retard, 2, f"dernier jeu N-PORT : {trimestre} (la SEC a cessé de publier ?)")

    def test_nport_fonds(self):
        _, archive = self.archive(self.cu.NPORT)
        ligne = self.colonnes(archive, "FUND_REPORTED_INFO.tsv", ["ACCESSION_NUMBER", "SERIES_NAME", "SERIES_ID", "SERIES_LEI", "NET_ASSETS"])
        self.assertRegex(ligne["SERIES_ID"], r"^S\d{9}$")
        self.assertTrue(ligne["SERIES_NAME"])
        self.assertIsNotNone(self.cu._decimal(ligne["NET_ASSETS"]), ligne["NET_ASSETS"])

    def test_nport_rendements(self):
        _, archive = self.archive(self.cu.NPORT)
        ligne = self.colonnes(archive, "MONTHLY_TOTAL_RETURN.tsv", ["ACCESSION_NUMBER", "CLASS_ID", "MONTHLY_TOTAL_RETURN1", "MONTHLY_TOTAL_RETURN2",
                                                                      "MONTHLY_TOTAL_RETURN3"])
        self.assertRegex(ligne["CLASS_ID"], r"^C\d{9}$")
        self.assertTrue(any(self.cu._decimal(ligne[f"MONTHLY_TOTAL_RETURN{i}"]) is not None for i in (1, 2, 3)), ligne)

    def test_nport_positions(self):
        _, archive = self.archive(self.cu.NPORT)
        ligne = self.colonnes(archive, "FUND_REPORTED_HOLDING.tsv", ["ACCESSION_NUMBER", "HOLDING_ID", "ISSUER_NAME", "ASSET_CAT", "ISSUER_TYPE",
                                                                     "INVESTMENT_COUNTRY", "CURRENCY_CODE", "PERCENTAGE", "PAYOFF_PROFILE"])
        self.assertTrue(ligne["HOLDING_ID"].isdigit(), ligne["HOLDING_ID"])
        self.assertIsNotNone(self.cu._decimal(ligne["PERCENTAGE"]), ligne["PERCENTAGE"])

    def test_nport_identifiants(self):
        _, archive = self.archive(self.cu.NPORT)
        ligne = self.colonnes(archive, "IDENTIFIERS.tsv", ["HOLDING_ID", "IDENTIFIER_ISIN"])
        self.assertTrue(ligne["HOLDING_ID"].isdigit(), ligne["HOLDING_ID"])

    def test_prospectus_frais(self):
        trimestre, archive = self.archive(self.cu.RR)
        ligne = self.colonnes(archive, "num.tsv", ["adsh", "tag", "series", "otherdims", "value"])
        self.assertRegex(ligne["adsh"], r"^\d{10}-\d{2}-\d{6}$")
        ligne = self.colonnes(archive, "sub.tsv", ["adsh", "filed"])
        self.assertRegex(self.cu._date_compacte(ligne["filed"]), r"^\d{4}-\d{2}-\d{2}$")   # format « 20250924 » toujours en vigueur
        retard = (date.today().year - int(trimestre[:4])) * 4 + (date.today().month - 1) // 3 + 1 - int(trimestre[-1])
        self.assertLessEqual(retard, 4, f"dernier jeu de prospectus : {trimestre} (la SEC a cessé de publier ?)")


class Repli(unittest.TestCase):
    """Sans réseau : la principale tombe → secours ; tout tombe → dernière valeur connue ; rien de connu → message."""

    def test_repli(self):
        import actualiser_marches as am

        class Source:
            def __init__(self, nom, donnees=None):
                self.NOM, self.LIEN, self.MENTION, self.donnees = nom, "https://exemple", f"Données : {nom}", donnees

            def recuperer(self):
                if self.donnees is None:
                    raise SourceIndisponible("panne simulée")
                return self.donnees

        complet = lambda d: "USD" in d["taux"]
        ok = {"date": "2026-01-02", "taux": {"USD": {"valeur": 1.1}}}
        b = am.mettre_a_jour("change", [Source("principale"), Source("secours", ok)], 20, complet, None, True)
        self.assertEqual((b["etat"], b["source"], b["taux"]["USD"]["valeur"]), ("secours", "secours", 1.1))
        b2 = am.mettre_a_jour("change", [Source("principale"), Source("secours")], 20, complet, b, True)
        self.assertEqual((b2["etat"], b2["maj"], b2["taux"]), ("ancien", b["maj"], b["taux"]))
        self.assertIn("dernières valeurs connues", b2["message"])
        b3 = am.mettre_a_jour("change", [Source("principale")], 20, complet, None, True)
        self.assertEqual(b3["etat"], "indisponible")

    def test_attente_apres_429(self):
        """Une réponse « trop de requêtes » : on attend le délai demandé une fois, puis on réessaie."""
        from sources.commun import actualites_par_entreprise
        appels = []

        def articles_de(cle):
            appels.append(cle)
            if len(appels) == 1:
                e = SourceIndisponible("erreur HTTP 429")
                e.attente = 0.01
                raise e
            return [{"titre": f"Nouvelle sur {ENTREPRISES[cle][0]}", "lien": "https://exemple.org/a", "source": "Exemple", "date": "2026-09-30T10:00Z", "langue": "fr"}]

        r = actualites_par_entreprise(articles_de, pause=0)
        premiere = next(iter(ENTREPRISES))
        self.assertEqual(appels[:2], [premiere, premiere], "la première entreprise doit être redemandée après l'attente")
        self.assertTrue(all(e["articles"] for e in r["entreprises"].values()))


if __name__ == "__main__":
    unittest.main(verbosity=2)
