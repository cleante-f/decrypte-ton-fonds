"""Tests de scripts/construire_etats_unis.py, sans réseau, sur de vrais extraits des fichiers de la SEC (tests/donnees/sec/).

    python3 tests/test_etats_unis.py -v
"""
import contextlib
import http.client
import io
import json
import math
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
import urllib.error
import zipfile
from datetime import date
from pathlib import Path
from unittest import mock

RACINE = Path(__file__).resolve().parent.parent
SEC = RACINE / "tests" / "donnees" / "sec"
sys.path.insert(0, str(RACINE / "scripts"))
import construire_etats_unis as cu

VANGUARD = "0000036405-26-000473"   # Vanguard 500 Index Fund (S000002839), rapport du 30/06/2026
ASHMORE = "0002066578-26-003500"    # Ashmore Emerging Markets Total Return Fund (S000030390), rapport du 31/07/2026
ASHMORE_AVRIL = "0002066578-26-002478"   # amendement du rapport du 30/04/2026 du même fonds
LEI_VANGUARD = "12WZ1W76P8QD4VJ6OB47"
LEI_ASHMORE = "5493003R6Z966WCNR691"
SPY = "0001410368-26-089410"   # State Street SPDR S&P 500 ETF Trust (CIK 884394), rapport du 30/06/2026, sans numéro de série
MDY = "0000940400-26-035209"   # State Street SPDR S&P MidCap 400 ETF Trust (CIK 936958), même trimestre, sans numéro de série
FICHIERS_NPORT = ["SUBMISSION.tsv", "REGISTRANT.tsv", "FUND_REPORTED_INFO.tsv", "MONTHLY_TOTAL_RETURN.tsv", "FUND_REPORTED_HOLDING.tsv",
                  "IDENTIFIERS.tsv", "SECURITIES_LENDING.tsv"]


class Npor(unittest.TestCase):
    def tsv(self, nom):
        return cu.lire_tsv(SEC / "sec_nport", nom)

    def setUp(self):
        self.depots = cu.depots_retenus(self.tsv("SUBMISSION.tsv"), self.tsv("FUND_REPORTED_INFO.tsv"))
        self.resumes = cu.resumer_positions(self.tsv("FUND_REPORTED_HOLDING.tsv"), set(self.depots.values()))

    def test_date_sec(self):
        self.assertEqual(cu.date_sec("31-JUL-2026"), "2026-07-31")
        self.assertEqual(cu.date_sec("01-JAN-2020"), "2020-01-01")
        self.assertEqual(cu.date_sec(""), "")
        for texte in ("2026-07-31", "31-JUIL-2026", "31/07/2026"):
            with self.assertRaises(ValueError, msg=texte):
                cu.date_sec(texte)

    def test_lire_tsv_dossier(self):
        lignes = list(self.tsv("SUBMISSION.tsv"))
        self.assertEqual([l["ACCESSION_NUMBER"] for l in lignes], [VANGUARD, ASHMORE_AVRIL, ASHMORE])
        self.assertEqual(lignes[1]["SUB_TYPE"], "NPORT-P/A")

    def test_depots_retenus(self):   # le dépôt de juillet l'emporte sur l'amendement (plus tardif) du rapport d'avril
        self.assertEqual(cu.depots_retenus(self.tsv("SUBMISSION.tsv"), self.tsv("FUND_REPORTED_INFO.tsv")),
                         {"S000002839": VANGUARD, "S000030390": ASHMORE})

    def test_depots_retenus_amendement(self):   # même REPORT_DATE : le FILING_DATE le plus récent l'emporte
        soumissions = [dict(l) for l in self.tsv("SUBMISSION.tsv")]
        for l in soumissions:
            if l["ACCESSION_NUMBER"] == ASHMORE:
                l["REPORT_DATE"] = "30-APR-2026"   # même rapport que l'amendement d'avril (déposé le 25-AUG-2026)
                l["FILING_DATE"] = "05-SEP-2026"   # « 05-SEP » précède « 25-AUG » par ordre alphabétique : seule la date compte
        infos = list(self.tsv("FUND_REPORTED_INFO.tsv"))
        self.assertEqual(cu.depots_retenus(soumissions, infos)["S000030390"], ASHMORE)
        for l in soumissions:
            if l["ACCESSION_NUMBER"] == ASHMORE:
                l["FILING_DATE"] = "20-AUG-2026"   # plus ancien que l'amendement d'avril
        self.assertEqual(cu.depots_retenus(soumissions, infos)["S000030390"], ASHMORE_AVRIL)

    def test_depots_retenus_ignore_serie_vide_et_depot_inconnu(self):
        infos = [{"ACCESSION_NUMBER": VANGUARD, "SERIES_ID": ""}, {"ACCESSION_NUMBER": "0000000000-26-000001", "SERIES_ID": "S1"}]
        self.assertEqual(cu.depots_retenus(self.tsv("SUBMISSION.tsv"), infos), {})

    def test_classe_actif(self):
        attendu = {("EC", ""): "Actions", ("EP", ""): "Actions",
                   ("DBT", ""): "Obligations", ("LON", ""): "Obligations", ("SN", ""): "Obligations", ("ABS-MBS", ""): "Obligations",
                   ("STIV", ""): "Monétaire", ("RA", ""): "Monétaire",
                   ("EC", "RF"): "Fonds (OPC)", ("EP", "PF"): "Fonds (OPC)", ("STIV", "RF"): "Monétaire",
                   ("DFE", ""): None, ("DIR", ""): None, ("DE", ""): None, ("DCO", ""): None, ("DCR", ""): None, ("DO", ""): None,
                   ("DFE", "RF"): None,
                   ("COMM", ""): "Autres", ("RE", ""): "Autres", ("OTHER", ""): "Autres"}
        for (cat, emetteur), classe in attendu.items():
            self.assertEqual(cu.classe_actif(cat, emetteur), classe, (cat, emetteur))

    def test_resumer_vanguard(self):
        r = self.resumes[VANGUARD]
        self.assertEqual((r["lignes"], r["exclu"]), (508, 0.01))
        self.assertEqual(r["classes"], [["Actions", 99.75], ["Monétaire", 0.35]])
        self.assertEqual((r["pays"], r["devises"]), ([["US", 100.1]], [["USD", 100.1]]))
        self.assertEqual([t[:2] for t in r["top"][:2]], [["NVIDIA Corp", 7.51], ["Apple Inc", 6.59]])
        self.assertEqual(len(r["top"]), 10)

    def test_resumer_ashmore(self):
        r = self.resumes[ASHMORE]
        self.assertEqual((r["lignes"], r["exclu"]), (187, 0.67))
        self.assertEqual(r["classes"][0], ["Obligations", 95.22])
        self.assertEqual(r["pays"][:2], [["VE", 14.34], ["MY", 6.53]])
        self.assertEqual(r["devises"][0], ["USD", 61.29])
        self.assertEqual(r["top"][0][:2], ["PETROLEOS DE VENEZUELA SA", 12.24])

    def test_resumer_ne_garde_que_les_depots_demandes(self):
        self.assertEqual(set(self.resumes), {VANGUARD, ASHMORE})   # l'amendement d'avril (autre dépôt) est écarté

    def test_listes_triees_et_arrondies(self):
        for r in self.resumes.values():
            for liste in (r["pays"], r["classes"], r["devises"]):
                self.assertEqual(liste, sorted(liste, key=lambda c: (-c[1], c[0])))
                self.assertTrue(all(c[1] == round(c[1], 2) for c in liste))
            poids = [t[1] for t in r["top"]]
            self.assertEqual(poids, sorted(poids, reverse=True))

    def test_egalites(self):   # poids égaux : clé alphabétique pour les listes, ordre de lecture pour le top
        def ligne(nom, pays, devise, poids):
            return {"ACCESSION_NUMBER": "A", "HOLDING_ID": nom, "ISSUER_NAME": nom, "ASSET_CAT": "EC", "ISSUER_TYPE": "CORP",
                    "INVESTMENT_COUNTRY": pays, "CURRENCY_CODE": devise, "PERCENTAGE": poids, "PAYOFF_PROFILE": "Long"}

        positions = [ligne(f"titre {i}", "US" if i % 2 == 0 else "FR", "USD" if i % 2 == 0 else "EUR", "5") for i in range(12)]
        positions.append(ligne("sans pays", "", "", "1"))
        r = cu.resumer_positions(positions, {"A"})["A"]
        self.assertEqual((r["lignes"], r["exclu"]), (13, 0))
        self.assertEqual(r["pays"], [["FR", 30.0], ["US", 30.0]])   # le poids de la ligne sans pays n'est dans aucun pays
        self.assertEqual(r["devises"], [["EUR", 30.0], ["USD", 30.0]])
        self.assertEqual(r["classes"], [["Actions", 61.0]])
        self.assertEqual([t[0] for t in r["top"]], [f"titre {i}" for i in range(10)])

    def test_position_courte_exclue(self):   # une ligne Vanguard recopiée en position courte
        lignes = list(self.tsv("FUND_REPORTED_HOLDING.tsv"))
        modele = next(l for l in lignes if l["ACCESSION_NUMBER"] == VANGUARD)
        courte = dict(modele, PAYOFF_PROFILE="Short", PERCENTAGE="-1.5")
        r = cu.resumer_positions(lignes + [courte], {VANGUARD})[VANGUARD]
        self.assertEqual((r["lignes"], r["exclu"]), (508, 1.51))
        self.assertEqual(r["classes"], [["Actions", 99.75], ["Monétaire", 0.35]])   # la position courte ne compte nulle part

    def test_isins(self):   # ISIN des deux plus grosses positions Vanguard (NVIDIA, Apple)
        top = self.resumes[VANGUARD]["top"]
        ids = {top[0][2], top[1][2]}
        self.assertEqual(len(ids), 2)
        isins = cu.isins_des_lignes(self.tsv("IDENTIFIERS.tsv"), ids)
        self.assertEqual(isins, {top[0][2]: "US67066G1040", top[1][2]: "US0378331005"})

    def test_isins_premier_non_vide(self):
        lignes = [{"HOLDING_ID": "1", "IDENTIFIER_ISIN": ""}, {"HOLDING_ID": "1", "IDENTIFIER_ISIN": "US1"},
                  {"HOLDING_ID": "1", "IDENTIFIER_ISIN": "US2"}, {"HOLDING_ID": "2", "IDENTIFIER_ISIN": "US3"},
                  {"HOLDING_ID": "3", "IDENTIFIER_ISIN": ""}]
        self.assertEqual(cu.isins_des_lignes(lignes, {"1", "3"}), {"1": "US1"})

    def archive_en_memoire(self):
        tampon = io.BytesIO()
        with zipfile.ZipFile(tampon, "w", zipfile.ZIP_DEFLATED) as z:
            for nom in FICHIERS_NPORT:
                z.write(SEC / "sec_nport" / nom, nom)
        return tampon.getvalue()

    def test_zip_distant(self):   # archive lue par plages : seuls les octets utiles sont demandés
        donnees = self.archive_en_memoire()
        appels = []

        def lire_plage(url, debut, fin):
            appels.append((url, debut, fin))
            return donnees[debut:fin + 1]

        archive = cu.ouvrir_zip("x", lire_plage, len(donnees))
        self.assertEqual(sorted(archive.namelist()), sorted(FICHIERS_NPORT))
        soumissions = list(cu.lire_tsv(archive, "SUBMISSION.tsv"))
        self.assertEqual(len(soumissions), 3)
        self.assertEqual(soumissions[0]["ACCESSION_NUMBER"], VANGUARD)
        self.assertLess(len(appels), 20)
        self.assertTrue(all(0 <= d <= f < len(donnees) for _, d, f in appels))

    def test_zip_distant_positions(self):   # le résultat est le même que pour le dossier de fichiers
        donnees = self.archive_en_memoire()
        archive = cu.ouvrir_zip("x", lambda url, d, f: donnees[d:f + 1], len(donnees))
        resumes = cu.resumer_positions(cu.lire_tsv(archive, "FUND_REPORTED_HOLDING.tsv"), {VANGUARD, ASHMORE})
        self.assertEqual(resumes, self.resumes)

    def test_zip_distant_seek(self):
        donnees = b"0123456789"
        brut = cu.ZipDistant("x", lambda url, d, f: donnees[d:f + 1], len(donnees))
        self.assertTrue(brut.seekable() and brut.readable())
        self.assertEqual(brut.seek(-3, io.SEEK_END), 7)
        self.assertEqual(brut.read(), b"789")
        self.assertEqual((brut.seek(2), brut.seek(3, io.SEEK_CUR), brut.tell()), (2, 5, 5))
        self.assertEqual(brut.read(2), b"56")
        self.assertEqual(brut.read(100), b"789")   # demande plus grande que la fin : tronquée à la taille
        self.assertEqual(brut.read(5), b"")
        with self.assertRaises(ValueError):
            brut.seek(-1)


class Garanties(unittest.TestCase):
    """Réinvestissement des garanties en espèces reçues contre des titres prêtés (SECURITIES_LENDING.tsv, IS_CASH_COLLATERAL = « Y »).
    Extraits réels du jeu 2026q3 : un fonds d'actions Invesco (27 positions, dont deux fonds monétaires qui réinvestissent des garanties,
    soit 22,98 % de l'actif net) et un fonds de 7 positions dont un fonds monétaire ne réinvestit des garanties que pour 2,75 % de sa valeur."""
    INVESCO = "0001378872-26-001343"
    DREYFUS = "0001193125-26-404536"
    COLONNES = ["HOLDING_ID", "IS_CASH_COLLATERAL", "CASH_COLLATERAL_AMOUNT", "IS_NON_CASH_COLLATERAL", "NON_CASH_COLLATERAL_VALUE",
                "IS_LOAN_BY_FUND", "LOAN_VALUE"]   # en-tête réel de SECURITIES_LENDING.tsv
    ATTENDU = {"174107151": 3492259.3122, "174107164": 1347501.1, "178936531": 6231941.09}

    def tsv(self, nom):
        return cu.lire_tsv(SEC / "sec_garanties", nom)

    def garanties(self):
        return cu.garanties_en_especes(self.tsv("SECURITIES_LENDING.tsv"))

    def resume(self, depot, avec=True):
        return cu.resumer_positions(self.tsv("FUND_REPORTED_HOLDING.tsv"), {depot}, self.garanties() if avec else None)[depot]

    def test_entete_reel(self):
        self.assertEqual(list(next(iter(self.tsv("SECURITIES_LENDING.tsv")))), self.COLONNES)

    def test_garanties_en_especes(self):   # seules les lignes IS_CASH_COLLATERAL = Y comptent (les titres prêtés par le fonds restent des positions)
        self.assertEqual(self.garanties(), self.ATTENDU)
        prets = [l for l in self.tsv("SECURITIES_LENDING.tsv") if l["IS_LOAN_BY_FUND"] == "Y"]
        self.assertTrue(prets)
        self.assertFalse({l["HOLDING_ID"] for l in prets} & set(self.garanties()))

    def test_garanties_montant_vide_ou_illisible(self):
        lignes = [dict(zip(self.COLONNES, ["1", "Y", "", "N", "", "N", ""])), dict(zip(self.COLONNES, ["2", "Y", "N/A", "N", "", "N", ""])),
                  dict(zip(self.COLONNES, ["3", "N", "500", "N", "", "N", ""])), dict(zip(self.COLONNES, ["4", "", "", "", "", "", ""])),
                  dict(zip(self.COLONNES, ["5", "Y", "12.5", "N", "", "N", ""]))]
        self.assertEqual(cu.garanties_en_especes(lignes), {"1": None, "2": None, "5": 12.5})

    def test_sans_garanties_rien_ne_change(self):   # appel sans le tableau de prêt de titres : comportement d'avant
        r = self.resume(self.INVESCO, avec=False)
        self.assertEqual(r["lignes"], 27)
        self.assertEqual(r["classes"], [["Actions", 99.68], ["Monétaire", 23.08]])
        self.assertEqual(r["top"][0][:2], ["Invesco Private Prime Fund", 16.58])
        self.assertEqual((r["garanties"], r["garanties_lignes"]), (0, 0))

    def test_garanties_entieres_retirees(self):
        r = self.resume(self.INVESCO)
        self.assertEqual(r["lignes"], 25)
        self.assertEqual(r["classes"], [["Actions", 99.68], ["Monétaire", 0.1]])   # la somme est de nouveau proche de 100
        self.assertEqual((r["pays"], r["devises"]), ([["US", 99.78]], [["USD", 99.78]]))
        self.assertEqual(r["exclu"], 0)   # ce ne sont pas des dérivés
        self.assertEqual((r["garanties"], r["garanties_lignes"]), (22.98, 2))
        self.assertEqual(r["top"][0][:2], ["Element Solutions Inc.", 12.14])
        self.assertNotIn("Invesco Private Prime Fund", [t[0] for t in r["top"]])
        self.assertEqual(len(r["top"]), 10)

    def test_titres_pretes_restent_des_positions(self):   # IS_LOAN_BY_FUND = Y : le fonds possède toujours ces titres
        r = self.resume(self.INVESCO)
        self.assertEqual(r["classes"][0], ["Actions", 99.68])
        self.assertEqual(r["lignes"], 27 - 2)

    def test_garantie_partielle(self):   # DREYFUS : 63,94 % de l'actif net, dont 2,75 % réinvestit des garanties (6 231 941 sur 226 553 090)
        r = self.resume(self.DREYFUS)
        avant = self.resume(self.DREYFUS, avec=False)
        self.assertEqual((avant["lignes"], avant["exclu"]), (3, 28.68))
        self.assertEqual((r["lignes"], r["exclu"]), (3, 28.68))   # la position reste (en partie) ; les dérivés sont ailleurs
        retire = round(63.94264 * 6231941.09 / 226553090.01, 2)
        self.assertEqual(retire, 1.76)
        self.assertEqual((r["garanties"], r["garanties_lignes"]), (retire, 1))
        classes_avant, classes = dict(avant["classes"]), dict(r["classes"])
        self.assertAlmostEqual(classes["Monétaire"], classes_avant["Monétaire"] - retire, places=2)
        self.assertEqual(classes["Fonds (OPC)"], classes_avant["Fonds (OPC)"])
        self.assertEqual(r["top"][0][:2], ["DREYFUS", round(63.94264 - retire, 2)])   # toujours la première position, avec le reste de son poids

    def ligne(self, identifiant, poids, valeur, **champs):
        base = {"ACCESSION_NUMBER": "A", "HOLDING_ID": identifiant, "ISSUER_NAME": f"titre {identifiant}", "ASSET_CAT": "STIV", "ISSUER_TYPE": "RF",
                "INVESTMENT_COUNTRY": "US", "CURRENCY_CODE": "USD", "CURRENCY_VALUE": valeur, "PERCENTAGE": poids, "PAYOFF_PROFILE": "Long"}
        return dict(base, **champs)

    def test_cas_limites(self):
        positions = [self.ligne("1", "10", "1000"), self.ligne("2", "10", "1000"), self.ligne("3", "10", "1000"), self.ligne("4", "10", "1000"),
                     self.ligne("5", "10", "0"), self.ligne("6", "10", "1000"), self.ligne("7", "10", "1000", PAYOFF_PROFILE="Short")]
        garanties = {"1": 1000.0,   # toute la valeur : retirée
                     "2": 990.0,    # à 2 % près : retirée en entier (arrondis de valorisation)
                     "3": 500.0,    # la moitié : la moitié du poids est retirée
                     "4": 4000.0,   # plus que la valeur : retirée en entier, jamais plus
                     "5": 5.0,      # valeur nulle : retirée en entier
                     "7": 1000.0}   # position courte : déjà exclue
        r = cu.resumer_positions(positions, {"A"}, garanties)["A"]
        self.assertEqual(r["lignes"], 2)   # restent la moitié de « 3 » et « 6 » (sans garantie)
        self.assertEqual(r["classes"], [["Monétaire", 15.0]])
        self.assertEqual((r["garanties"], r["garanties_lignes"]), (45.0, 5))
        self.assertEqual(r["exclu"], 10.0)
        r = cu.resumer_positions(positions, {"A"}, {"6": None})["A"]   # montant inconnu : toute la position
        self.assertEqual(r["lignes"], 5)
        self.assertEqual((r["garanties"], r["garanties_lignes"]), (10.0, 1))

    def test_positions_d_une_autre_serie_non_touchees(self):   # le HOLDING_ID est propre à une position : un autre dépôt n'est pas concerné
        r = cu.resumer_positions([self.ligne("9", "5", "1000")], {"A"}, {"1": 1000.0})["A"]
        self.assertEqual((r["lignes"], r["garanties"], r["garanties_lignes"]), (1, 0, 0))

    def test_position_sans_poids_retiree_aussi(self):   # valeur et poids nuls : la position réinvestissant des garanties ne devient pas une ligne vide
        r = cu.resumer_positions([self.ligne("1", "0", "0"), self.ligne("2", "5", "1000")], {"A"}, {"1": 3.0})["A"]
        self.assertEqual((r["lignes"], r["garanties_lignes"], r["classes"]), (1, 1, [["Monétaire", 5.0]]))


class Reponse:
    """Réponse HTTP minimale (urlopen est remplacé dans les tests : aucun accès au réseau)."""
    def __init__(self, corps=b"", entetes=None):
        self.corps, self.headers = corps, entetes or {}

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def read(self):
        return self.corps


def erreur_http(code, entetes=None):
    return urllib.error.HTTPError("https://www.sec.gov/x", code, "erreur", entetes or {}, None)


class Telechargement(unittest.TestCase):
    def setUp(self):
        patch_sleep = mock.patch.object(cu.time, "sleep")
        self.sleep = patch_sleep.start()
        self.addCleanup(patch_sleep.stop)
        patch_urlopen = mock.patch.object(cu.urllib.request, "urlopen")
        self.urlopen = patch_urlopen.start()
        self.addCleanup(patch_urlopen.stop)
        patch_print = mock.patch("builtins.print")
        patch_print.start()
        self.addCleanup(patch_print.stop)

    def test_agent_plage_et_pause(self):
        self.urlopen.return_value = Reponse(b"abc")
        self.assertEqual(cu.telecharger("https://www.sec.gov/x", (10, 19)), b"abc")
        requete = self.urlopen.call_args[0][0]
        self.assertEqual(requete.get_header("User-agent"), "Decrypte ton fonds contact@decrypte-ton-fonds.fr")
        self.assertEqual(requete.get_header("Range"), "bytes=10-19")
        self.sleep.assert_called_once_with(0.2)   # pause avant la requête

    def test_sans_plage(self):
        self.urlopen.return_value = Reponse(b"abc")
        cu.telecharger("https://www.sec.gov/x")
        self.assertIsNone(self.urlopen.call_args[0][0].get_header("Range"))

    def test_nouvel_essai_sur_429_et_5xx(self):
        self.urlopen.side_effect = [erreur_http(429, {"Retry-After": "7"}), erreur_http(503), Reponse(b"ok")]
        self.assertEqual(cu.telecharger("https://www.sec.gov/x"), b"ok")
        self.assertEqual(self.urlopen.call_count, 3)
        attentes = [a[0][0] for a in self.sleep.call_args_list if a[0][0] != 0.2]
        self.assertEqual(attentes[0], 7)             # Retry-After respecté
        self.assertGreater(attentes[1], 0)
        self.assertEqual(self.sleep.call_args_list.count(mock.call(0.2)), 3)   # une pause avant chaque requête

    def test_attente_croissante(self):
        self.urlopen.side_effect = [erreur_http(500), erreur_http(500), erreur_http(500), Reponse(b"ok")]
        cu.telecharger("https://www.sec.gov/x")
        attentes = [a[0][0] for a in self.sleep.call_args_list if a[0][0] != 0.2]
        self.assertEqual(attentes, sorted(attentes))
        self.assertEqual(len(set(attentes)), 3)

    def test_quatre_essais_puis_erreur(self):
        self.urlopen.side_effect = [erreur_http(500)] * 10
        with self.assertRaises(RuntimeError):
            cu.telecharger("https://www.sec.gov/x")
        self.assertEqual(self.urlopen.call_count, 4)

    def test_nouvel_essai_sur_lecture_incomplete(self):   # IncompleteRead n'est pas une OSError : il doit être retenté aussi
        self.urlopen.side_effect = [http.client.IncompleteRead(b"ab", 10), http.client.RemoteDisconnected("coupée"), Reponse(b"ok")]
        self.assertEqual(cu.telecharger("https://www.sec.gov/x", (0, 9)), b"ok")
        self.assertEqual(self.urlopen.call_count, 3)

    def test_lecture_incomplete_en_boucle(self):
        self.urlopen.side_effect = http.client.IncompleteRead(b"ab", 10)
        with self.assertRaises(RuntimeError):
            cu.telecharger("https://www.sec.gov/x")
        self.assertEqual(self.urlopen.call_count, 4)

    def test_url_existe(self):   # requête HEAD avec le User-Agent et la pause ; 404 → False
        self.urlopen.return_value = Reponse(b"")
        self.assertTrue(cu.url_existe("https://www.sec.gov/x"))
        requete = self.urlopen.call_args[0][0]
        self.assertEqual(requete.get_method(), "HEAD")
        self.assertEqual(requete.get_header("User-agent"), "Decrypte ton fonds contact@decrypte-ton-fonds.fr")
        self.sleep.assert_called_once_with(0.2)
        self.urlopen.side_effect = [erreur_http(404)]
        self.assertFalse(cu.url_existe("https://www.sec.gov/y"))

    def test_url_existe_autre_erreur(self):
        self.urlopen.side_effect = [erreur_http(403)]
        with self.assertRaises(urllib.error.HTTPError):
            cu.url_existe("https://www.sec.gov/x")
        self.urlopen.side_effect = [erreur_http(503), Reponse(b"")]
        self.assertTrue(cu.url_existe("https://www.sec.gov/x"))   # erreur passagère : nouvel essai

    def test_get_par_defaut(self):
        self.urlopen.return_value = Reponse(b"abc")
        cu.telecharger("https://www.sec.gov/x")
        self.assertEqual(self.urlopen.call_args[0][0].get_method(), "GET")

    def test_404_sans_nouvel_essai(self):
        self.urlopen.side_effect = [erreur_http(404), Reponse(b"ok")]
        with self.assertRaises(urllib.error.HTTPError):
            cu.telecharger("https://www.sec.gov/x")
        self.assertEqual(self.urlopen.call_count, 1)

    def test_taille_dans_content_range(self):   # sans « taille », ZipDistant la lit dans la réponse à « bytes=0-0 »
        self.urlopen.return_value = Reponse(b"P", {"Content-Range": "bytes 0-0/464009823"})
        brut = cu.ZipDistant("https://www.sec.gov/x")
        self.assertEqual(brut.seek(0, io.SEEK_END), 464009823)
        self.assertEqual(self.urlopen.call_args[0][0].get_header("Range"), "bytes=0-0")

    def test_taille_sans_content_range(self):
        self.urlopen.return_value = Reponse(b"P", {})
        with self.assertRaises(RuntimeError):
            cu.ZipDistant("https://www.sec.gov/x")


class SansNumeroDeSerie(unittest.TestCase):
    """Fonds qui déposent leurs rapports N-PORT sans numéro de série (ETF « unit investment trust », fonds fermés) : vrais extraits
    du jeu 2026q3 de la SEC pour SPY et MDY (tests/donnees/sec/sec_nport_cik) et de company_tickers.json."""
    def tsv(self, nom):
        return list(cu.lire_tsv(SEC / "sec_nport_cik", nom))

    def infos(self):
        return cu.completer_series(self.tsv("FUND_REPORTED_INFO.tsv"), self.tsv("REGISTRANT.tsv"))

    def test_pseudo_serie_du_cik(self):
        self.assertEqual(cu.serie_de_cik("0000884394"), "S900884394")
        self.assertEqual(cu.serie_de_cik("0001735964"), "S901735964")
        self.assertEqual(cu.cik_de_serie("S900884394"), 884394)
        self.assertIsNone(cu.cik_de_serie("S000002839"))

    def test_completer_series(self):
        infos = {i["ACCESSION_NUMBER"]: i for i in self.infos()}
        # SPY : SERIES_NAME vaut « N/A » : nom du déposant, sans les marques « (R) »
        self.assertEqual((infos[SPY]["SERIES_ID"], infos[SPY]["SERIES_NAME"]), ("S900884394", "State Street SPDR S&P 500 ETF Trust"))
        self.assertEqual((infos[MDY]["SERIES_ID"], infos[MDY]["SERIES_NAME"]), ("S900936958", "State Street SPDR S&P MidCap 400SM ETF Trust"))
        self.assertEqual((infos[SPY]["SERIES_LEI"], infos[SPY]["NET_ASSETS"]), ("549300NZAMSJ8FXPQQ63", "781188872106.76"))   # le reste ne change pas

    def test_completer_series_garde_les_vraies_series(self):
        infos = list(cu.lire_tsv(SEC / "sec_nport", "FUND_REPORTED_INFO.tsv"))
        self.assertEqual(cu.completer_series(infos, list(cu.lire_tsv(SEC / "sec_nport", "REGISTRANT.tsv"))), infos)

    def test_completer_series_numero_factice(self):   # « S000000000 » : vu une fois dans le jeu 2026q3
        info = dict(self.tsv("FUND_REPORTED_INFO.tsv")[0], SERIES_ID="S000000000")
        self.assertEqual(cu.completer_series([info], self.tsv("REGISTRANT.tsv"))[0]["SERIES_ID"], "S900884394")

    def test_completer_series_declarant_inconnu(self):   # sans ligne REGISTRANT, la ligne reste sans série (ignorée plus loin)
        self.assertEqual([i["SERIES_ID"] for i in cu.completer_series(self.tsv("FUND_REPORTED_INFO.tsv"), [])], ["", ""])

    def test_rendements_part_factice(self):   # MDY déclare la part « C000000000 » (98 lignes en 2026q3) : rangée sous sa série
        cumul, serie_de = {}, {}
        cu.ajouter_rendements(cumul, serie_de, self.tsv("SUBMISSION.tsv"), self.infos(), self.tsv("MONTHLY_TOTAL_RETURN.tsv"))
        self.assertEqual(set(cumul), {"S900884394", "S900936958"})
        self.assertEqual({m: v[0] for m, v in cumul["S900884394"].items()}, {"2026-04": 10.48, "2026-05": 5.25, "2026-06": -0.96})
        self.assertEqual({m: v[0] for m, v in cumul["S900936958"].items()}, {"2026-04": 7.79, "2026-05": 2.42, "2026-06": 3.6})

    def test_tickers_par_cik(self):
        tickers = cu.tickers_par_cik(json.loads(lire_fichier("sec_company_tickers.json")))
        self.assertEqual((tickers[884394], tickers[1041130], tickers[936958], tickers[1510599]), ("SPY", "DIA", "MDY", "PDI"))
        self.assertNotIn(1735964, tickers)   # fonds à intervalles Cliffwater : pas coté

    def test_fiches_cik(self):
        noms = {"S900884394": "State Street SPDR S&P 500 ETF Trust", "S000002839": "Vanguard 500 Index Fund",
                "S901735964": "Cliffwater Corporate Lending Fund", "S901510599": ""}
        self.assertEqual(cu.fiches_cik(noms, {884394: "SPY"}), {
            "S900884394": {"nom": "State Street SPDR S&P 500 ETF Trust", "entite": "", "classes": [["S900884394", "", "SPY"]]},
            "S901735964": {"nom": "Cliffwater Corporate Lending Fund", "entite": "", "classes": [["S901735964", "", ""]]}})   # sans nom : ignorée


class Rendements(unittest.TestCase):
    def tsv(self, nom):
        return cu.lire_tsv(SEC / "sec_nport", nom)

    def lire_tout(self):
        cumul, serie_de = {}, {}
        cu.ajouter_rendements(cumul, serie_de, self.tsv("SUBMISSION.tsv"), self.tsv("FUND_REPORTED_INFO.tsv"),
                              self.tsv("MONTHLY_TOTAL_RETURN.tsv"))
        return cumul, serie_de

    def depot_ashmore(self, accession, depose, valeurs, report="31-JUL-2026"):
        """Dépôt supplémentaire de la part C000093386 : (soumissions, infos, retours)."""
        v1, v2, v3 = valeurs
        return ([{"ACCESSION_NUMBER": accession, "FILING_DATE": depose, "REPORT_DATE": report}],
                [{"ACCESSION_NUMBER": accession, "SERIES_ID": "S000030390"}],
                [{"ACCESSION_NUMBER": accession, "CLASS_ID": "C000093386", "MONTHLY_TOTAL_RETURN1": v1,
                  "MONTHLY_TOTAL_RETURN2": v2, "MONTHLY_TOTAL_RETURN3": v3}])

    def test_mois_du_rapport(self):
        self.assertEqual(cu.mois_du_rapport("2026-06-30"), ["2026-04", "2026-05", "2026-06"])
        self.assertEqual(cu.mois_du_rapport("2026-02-28"), ["2025-12", "2026-01", "2026-02"])
        self.assertEqual(cu.mois_du_rapport("2026-01-31"), ["2025-11", "2025-12", "2026-01"])
        for texte in ("", "30-JUN-2026", "2026-13-01", "2026-06"):
            with self.assertRaises(ValueError, msg=texte):
                cu.mois_du_rapport(texte)

    def test_rendements_vanguard(self):   # Admiral : avril, mai, juin 2026 (rapport du 30/06/2026, déposé le 28/08/2026)
        cumul, serie_de = self.lire_tout()
        self.assertEqual({m: v[0] for m, v in cumul["C000007774"].items()},
                         {"2026-04": 10.49014889, "2026-05": 5.25936275, "2026-06": -0.95490903})
        self.assertEqual({v[1] for v in cumul["C000007774"].values()}, {"2026-08-28"})
        self.assertEqual(serie_de["C000007774"], "S000002839")
        self.assertEqual(len(cumul), 7)   # 4 parts Vanguard et 3 parts Ashmore
        self.assertEqual(serie_de["C000098150"], "S000030390")

    def test_rendements_ashmore_deux_depots(self):   # l'amendement d'avril (févr. à avr.) et le dépôt de juillet (mai à juil.)
        cumul, _ = self.lire_tout()
        self.assertEqual({m: v[0] for m, v in sorted(cumul["C000093386"].items())},
                         {"2026-02": 1.46, "2026-03": -4.24, "2026-04": 3.92, "2026-05": 0.27, "2026-06": -0.32, "2026-07": -0.52})
        self.assertEqual(cumul["C000093386"]["2026-02"][1], "2026-08-25")
        self.assertEqual(cumul["C000093386"]["2026-07"][1], "2026-09-28")

    def test_doublon_depot_plus_recent(self):   # même part et même mois dans un dépôt plus tardif : sa valeur remplace l'ancienne
        plus_tard = self.depot_ashmore("0002066578-26-009999", "05-OCT-2026", ("9.5", "", "-9.5"))
        cumul, serie_de = {}, {}
        cu.ajouter_rendements(cumul, serie_de, *plus_tard)   # lu avant l'autre : l'ordre de lecture ne compte pas
        cu.ajouter_rendements(cumul, serie_de, self.tsv("SUBMISSION.tsv"), self.tsv("FUND_REPORTED_INFO.tsv"),
                              self.tsv("MONTHLY_TOTAL_RETURN.tsv"))
        c = cumul["C000093386"]
        self.assertEqual(c["2026-05"], (9.5, "2026-10-05"))
        self.assertEqual(c["2026-06"], (-0.32, "2026-09-28"))   # valeur vide du dépôt tardif : ignorée
        self.assertEqual(c["2026-07"], (-9.5, "2026-10-05"))
        self.assertEqual(c["2026-04"], (3.92, "2026-08-25"))
        # dans l'autre sens (dépôt tardif lu après), même résultat
        cumul2, serie_de2 = self.lire_tout()
        cu.ajouter_rendements(cumul2, serie_de2, *plus_tard)
        self.assertEqual(cumul2["C000093386"], c)

    def test_doublon_depot_plus_ancien_ignore(self):
        cumul, serie_de = self.lire_tout()
        cu.ajouter_rendements(cumul, serie_de, *self.depot_ashmore("0002066578-26-000001", "01-SEP-2026", ("7", "7", "7")))
        self.assertEqual(cumul["C000093386"]["2026-05"], (0.27, "2026-09-28"))   # déposé le 28/09 : plus récent que le 01/09
        self.assertEqual(cumul["C000093386"]["2026-03"], (-4.24, "2026-08-25"))

    def test_doublon_meme_date_derniere_lecture(self):
        cumul, serie_de = self.lire_tout()
        cu.ajouter_rendements(cumul, serie_de, *self.depot_ashmore("0002066578-26-000002", "28-SEP-2026", ("1", "2", "3")))
        self.assertEqual(cumul["C000093386"]["2026-06"], (2.0, "2026-09-28"))

    def test_classe_vide(self):   # CLASS_ID vide : clé = SERIES_ID ; SERIES_ID et CLASS_ID vides : ligne ignorée
        soumissions = [{"ACCESSION_NUMBER": "A", "REPORT_DATE": "31-MAR-2026", "FILING_DATE": "20-MAY-2026"},
                       {"ACCESSION_NUMBER": "B", "REPORT_DATE": "31-MAR-2026", "FILING_DATE": "20-MAY-2026"},
                       {"ACCESSION_NUMBER": "C", "REPORT_DATE": "", "FILING_DATE": "20-MAY-2026"}]
        infos = [{"ACCESSION_NUMBER": "A", "SERIES_ID": "S1"}, {"ACCESSION_NUMBER": "B", "SERIES_ID": ""},
                 {"ACCESSION_NUMBER": "C", "SERIES_ID": "S3"}]
        retours = [{"ACCESSION_NUMBER": "A", "CLASS_ID": "", "MONTHLY_TOTAL_RETURN1": "1.5", "MONTHLY_TOTAL_RETURN2": "",
                    "MONTHLY_TOTAL_RETURN3": "-2"},
                   {"ACCESSION_NUMBER": "B", "CLASS_ID": "", "MONTHLY_TOTAL_RETURN1": "9", "MONTHLY_TOTAL_RETURN2": "9",
                    "MONTHLY_TOTAL_RETURN3": "9"},
                   {"ACCESSION_NUMBER": "C", "CLASS_ID": "C3", "MONTHLY_TOTAL_RETURN1": "9", "MONTHLY_TOTAL_RETURN2": "9",
                    "MONTHLY_TOTAL_RETURN3": "9"},   # rapport sans date : ignoré
                   {"ACCESSION_NUMBER": "inconnu", "CLASS_ID": "C4", "MONTHLY_TOTAL_RETURN1": "9", "MONTHLY_TOTAL_RETURN2": "9",
                    "MONTHLY_TOTAL_RETURN3": "9"}]   # dépôt absent de SUBMISSION : ignoré
        cumul, serie_de = {}, {}
        cu.ajouter_rendements(cumul, serie_de, soumissions, infos, retours)
        self.assertEqual(cumul, {"S1": {"2026-01": (1.5, "2026-05-20"), "2026-03": (-2.0, "2026-05-20")}})
        self.assertEqual(serie_de, {"S1": "S1"})

    def test_accepte_des_iterateurs(self):   # les lignes viennent de fichiers lus une seule fois
        cumul, serie_de = {}, {}
        cu.ajouter_rendements(cumul, serie_de, iter(list(self.tsv("SUBMISSION.tsv"))), iter(list(self.tsv("FUND_REPORTED_INFO.tsv"))),
                              iter(list(self.tsv("MONTHLY_TOTAL_RETURN.tsv"))))
        self.assertEqual(cumul, self.lire_tout()[0])

    def test_taux_mensuels(self):
        taux = cu.taux_mensuels((SEC / "bce_usd_mensuel.csv").read_text(encoding="utf-8"))
        self.assertEqual(len(taux), 9)
        self.assertEqual(taux["2026-06"], 1.1394)
        self.assertEqual(min(taux), "2026-01")
        self.assertEqual(max(taux), "2026-09")

    def test_en_euros(self):
        t = cu.taux_mensuels((SEC / "bce_usd_mensuel.csv").read_text(encoding="utf-8"))
        self.assertEqual(cu.en_euros(10.49014889, "2026-04", t), 8.56)
        self.assertEqual(cu.en_euros(-0.95490903, "2026-06", t), 1.22)
        self.assertEqual(cu.en_euros(1.46, "2026-02", t), 2.44)
        self.assertIsNone(cu.en_euros(1.0, "2026-01", t))   # taux de décembre 2025 absent
        self.assertIsNone(cu.en_euros(1.0, "2026-12", t))   # taux de décembre 2026 absent
        self.assertIsNone(cu.en_euros(1.0, "2027-01", t))

    def test_en_euros_pas_de_zero_negatif(self):
        r = cu.en_euros(-0.001, "2026-02", {"2026-01": 1.0, "2026-02": 1.0})
        self.assertEqual(r, 0.0)
        self.assertEqual(math.copysign(1, r), 1.0)


class Frais(unittest.TestCase):
    def rr(self, nom):
        return list(cu.lire_tsv(SEC / "sec_rr", nom))

    def test_frais_classe(self):   # le prospectus de septembre remplace celui de juillet
        frais = cu.frais_prospectus(self.rr("num.tsv"), self.rr("sub.tsv"), {})
        self.assertEqual(frais["C000242771"], [0.53, 0.45, 0.15, 0.0, 0.0, "2025-09-24"])

    def test_frais_serie(self):   # série sans part : les frais vont à toutes les parts de la série
        frais = cu.frais_prospectus(self.rr("num.tsv"), self.rr("sub.tsv"), {"S000089799": ["C000256579"]})
        self.assertEqual(frais["C000256579"], [1.29, None, 1.29, None, None, "2025-08-26"])
        self.assertEqual(set(frais), {"C000242771", "C000256579"})

    def test_frais_serie_a_plusieurs_classes(self):
        frais = cu.frais_prospectus(self.rr("num.tsv"), self.rr("sub.tsv"), {"S000089799": ["C1", "C2"]})
        self.assertEqual(frais["C1"], frais["C2"])
        self.assertEqual(frais["C1"], [1.29, None, 1.29, None, None, "2025-08-26"])

    def test_frais_serie_inconnue_ou_vide(self):   # série absente de classes_par_serie : rien ; ni série ni part : ignorée
        lignes = [dict(l, otherdims="", series="S999") for l in self.rr("num.tsv") if "S000089799" in l["series"]]
        lignes += [dict(l, otherdims="", series="") for l in self.rr("num.tsv") if "S000089799" in l["series"]]
        self.assertEqual(cu.frais_prospectus(lignes, self.rr("sub.tsv"), {"S000089799": ["C000256579"]}), {})

    def test_frais_colonne_serie_est_une_classe(self):   # la colonne series contient parfois une part (C…)
        lignes = [dict(l, series="C000263192", otherdims="") for l in self.rr("num.tsv") if "S000089799" in l["series"]]
        frais = cu.frais_prospectus(lignes, self.rr("sub.tsv"), {"S000089799": ["C000256579"]})
        self.assertEqual(frais, {"C000263192": [1.29, None, 1.29, None, None, "2025-08-26"]})

    def test_frais_date_la_plus_recente_des_valeurs_retenues(self):
        # juillet : toutes les étiquettes ; septembre : seulement le net → date de septembre, autres valeurs de juillet
        septembre = {"adsh": "0001623632-25-001296", "tag": "NetExpensesOverAssets", "series": "S000009578",
                     "otherdims": "Class=C000242771;", "value": "0.0040"}
        juillet = [l for l in self.rr("num.tsv") if l["adsh"] == "0001623632-25-000915"]
        for num in ([septembre] + juillet, juillet + [septembre]):   # quel que soit l'ordre de lecture
            self.assertEqual(cu.frais_prospectus(num, self.rr("sub.tsv"), {})["C000242771"], [0.55, 0.4, 0.15, 0.0, 0.0, "2025-09-24"])

    def test_frais_plus_ancien_lu_apres_ne_remplace_pas(self):
        num = [l for l in self.rr("num.tsv") if "C000242771" in l["otherdims"]]
        num.sort(key=lambda l: l["adsh"] == "0001623632-25-001296")   # juillet d'abord, septembre ensuite
        sub = self.rr("sub.tsv")
        attendu = {"C000242771": [0.53, 0.45, 0.15, 0.0, 0.0, "2025-09-24"]}
        self.assertEqual(cu.frais_prospectus(num, sub, {}), attendu)
        self.assertEqual(cu.frais_prospectus(list(reversed(num)), sub, {}), attendu)   # septembre d'abord, juillet ensuite

    def test_frais_meme_date_derniere_lecture(self):
        sub = [{"adsh": "A", "filed": "20250101"}, {"adsh": "B", "filed": "20250101"}]
        num = [{"adsh": "A", "tag": "ExpensesOverAssets", "series": "S1", "otherdims": "Class=C1;", "value": "0.0100"},
               {"adsh": "B", "tag": "ExpensesOverAssets", "series": "S1", "otherdims": "Class=C1;", "value": "0.0200"}]
        self.assertEqual(cu.frais_prospectus(num, sub, {})["C1"], [2.0, None, None, None, None, "2025-01-01"])
        self.assertEqual(cu.frais_prospectus(num[::-1], sub, {})["C1"], [1.0, None, None, None, None, "2025-01-01"])

    def test_frais_ignore_valeur_vide_etiquette_inconnue_depot_inconnu(self):
        sub = [{"adsh": "A", "filed": "20250101"}]
        num = [{"adsh": "A", "tag": "ExpensesOverAssets", "series": "S1", "otherdims": "Class=C1;", "value": ""},
               {"adsh": "A", "tag": "AutreEtiquette", "series": "S1", "otherdims": "Class=C1;", "value": "0.01"},
               {"adsh": "Z", "tag": "ExpensesOverAssets", "series": "S1", "otherdims": "Class=C1;", "value": "0.01"}]
        self.assertEqual(cu.frais_prospectus(num, sub, {}), {})

    def test_frais_date_depot_inattendue(self):
        with self.assertRaises(ValueError):
            cu.frais_prospectus([], [{"adsh": "A", "filed": "2025-01-01"}], {})


# ---------- Annuaire, assemblage, écriture, programme principal ----------
def lire_fichier(nom):
    return (SEC / nom).read_text(encoding="utf-8")   # le BOM de la liste est conservé : lire_liste doit l'ignorer


class Annuaire(unittest.TestCase):
    def setUp(self):
        self.liste = cu.lire_liste(lire_fichier("sec_series.csv"))
        self.mf = json.loads(lire_fichier("sec_tickers_mf.json"))

    def test_lire_liste(self):
        self.assertTrue(lire_fichier("sec_series.csv").startswith("﻿"))
        self.assertEqual(set(self.liste), {"S000002839", "S000030390", "S000089799"})
        v = self.liste["S000002839"]
        self.assertEqual((v["nom"], v["entite"]), ("Vanguard 500 Index Fund", "VANGUARD INDEX FUNDS"))
        self.assertEqual(len(v["classes"]), 4)
        self.assertIn(["C000092055", "ETF Shares", "VOO"], v["classes"])
        self.assertEqual([c[2] for c in v["classes"]], ["VFINX", "VFIAX", "VOO", "VFFSX"])   # ordre du fichier
        self.assertEqual(self.liste["S000030390"]["entite"], "Ashmore Funds")   # champ entre guillemets dans le CSV d'origine

    def test_lire_liste_lignes_a_ignorer_et_doublons(self):
        texte = ("Reporting File Number,CIK Number,Entity Name,Entity Org Type,Series ID,Series Name,Class ID,Class Name,Class Ticker\r\n"
                 "811-1,1,UN FONDS,30,,,,,\r\n"                                   # entité sans série
                 "811-1,1,UN FONDS,30,S000000001,Alpha,C000000001,Class A,AAAAX\r\n"
                 "811-1,1,UN FONDS,30,S000000001,Alpha,C000000001,Class A,AAAAX\r\n"   # doublon
                 "811-1,1,UN FONDS,30,S000000001,Alpha,C000000002,Class I,\r\n"        # part sans ticker
                 "811-1,1,UN FONDS,30,S000000002,Beta,,,\r\n")                         # série sans part
        self.assertEqual(cu.lire_liste(texte), {
            "S000000001": {"nom": "Alpha", "entite": "UN FONDS", "classes": [["C000000001", "Class A", "AAAAX"], ["C000000002", "Class I", ""]]},
            "S000000002": {"nom": "Beta", "entite": "UN FONDS", "classes": []}})

    def test_lire_liste_colonnes_changees(self):   # la SEC renomme une colonne : erreur franche plutôt qu'une liste vide
        with self.assertRaises(ValueError):
            cu.lire_liste("Series,Name\r\nS000000001,Alpha\r\n")
        with self.assertRaises(ValueError):   # sans le type d'entité, on ne saurait plus écarter les contrats d'assurance
            cu.lire_liste("Series ID,Series Name,Entity Name,Class ID,Class Name,Class Ticker\r\nS000000001,Alpha,UN FONDS,,,\r\n")

    def test_lire_liste_contrats_d_assurance_ecartes(self):   # types 32 et 33 : comptes séparés de contrats d'assurance (noms réels de 2026)
        texte = ("Reporting File Number,CIK Number,Entity Name,Entity Org Type,Series ID,Series Name,Class ID,Class Name,Class Ticker\r\n"
                 "811-1,1,VARIABLE ANNUITY ACCOUNT B,32,S000010140,Variable Annuity Account B,,,\r\n"
                 "811-2,2,PRESTIGE VARIABLE LIFE ACCOUNT,33,S000000680,PRESTIGE VARIABLE LIFE ACCOUNT,,,\r\n"
                 "811-3,3,TIAA SEPARATE ACCOUNT VA 1,31,S000005098,Stock Index Account,,,\r\n"
                 "811-4,4,AMERICAN FUNDS INSURANCE SERIES,30,S000008790,SMALLCAP World Fund,,,\r\n")
        self.assertEqual(set(cu.lire_liste(texte)), {"S000005098", "S000008790"})

    def test_lignes_annuaire(self):
        l = {x[1]: x for x in cu.lignes_annuaire(self.mf, self.liste, {})}
        self.assertEqual(l[2839], ["S", 2839, 2839, "Vanguard 500 Index Fund", "VANGUARD INDEX FUNDS", "", "", "", "", "US",
                                   "VFINX VFIAX VOO VFFSX", "", "USD", 1, 1])
        self.assertEqual((l[30390][13], l[89799][13]), (0, 1))
        self.assertEqual(l[30390][10], "EMKIX EMKCX EMKAX")
        self.assertEqual(set(l), {2839, 30390, 89799})

    def test_lignes_annuaire_triees_par_nom(self):
        noms = [x[3] for x in cu.lignes_annuaire(self.mf, self.liste, {})]
        self.assertEqual(noms, ["Ashmore Emerging Markets Total Return Fund", "Defiance Daily Target 2X Long AMAT ETF",
                                "Vanguard 500 Index Fund"])
        liste = {"S000000002": {"nom": "bravo", "entite": "", "classes": []}, "S000000001": {"nom": "Alpha", "entite": "", "classes": []},
                 "S000000003": {"nom": "Charlie", "entite": "", "classes": []}}
        mf = {"fields": ["cik", "seriesId", "classId", "symbol"],
              "data": [[1, s, "C" + s[1:], "T" + s[-1]] for s in ("S000000003", "S000000002", "S000000001")]}
        self.assertEqual([x[3] for x in cu.lignes_annuaire(mf, liste, {})], ["Alpha", "bravo", "Charlie"])   # sans tenir compte de la casse

    def test_lignes_annuaire_nom_nport_et_series_ignorees(self):
        liste = {k: v for k, v in self.liste.items() if k != "S000030390"}   # Ashmore absente de la liste
        l = {x[1]: x for x in cu.lignes_annuaire(self.mf, liste, {"S000030390": "ASHMORE EMERGING MARKETS TOTAL RETURN FUND"})}
        self.assertEqual(l[30390][3:5], ["ASHMORE EMERGING MARKETS TOTAL RETURN FUND", ""])   # nom de N-PORT, société inconnue
        self.assertEqual(l[30390][10], "EMKIX EMKCX EMKAX")
        self.assertNotIn(30390, {x[1] for x in cu.lignes_annuaire(self.mf, liste, {})})      # nom nulle part : ignorée
        self.assertEqual(cu.lignes_annuaire(self.mf, self.liste, {"S000002839": "AUTRE NOM"})[2][3], "Vanguard 500 Index Fund")   # la liste d'abord

    def test_lignes_annuaire_series_en_plus(self):
        liste = dict(self.liste, S000009999={"nom": "Fonds en plus", "entite": "UNE SOCIÉTÉ",
                                              "classes": [["C000009991", "Class A", "AAAAX"], ["C000009992", "Class I", ""]]})
        l = {x[1]: x for x in cu.lignes_annuaire(self.mf, liste, {}, {"S000009999", "S000002839", "S000000042"})}
        self.assertEqual(l[9999][3:5], ["Fonds en plus", "UNE SOCIÉTÉ"])
        self.assertEqual(l[9999][10], "AAAAX")   # absente de company_tickers_mf.json : tickers de la liste
        self.assertEqual(l[9999][13], 0)
        self.assertNotIn(42, l)                    # série sans nom connu : ignorée
        self.assertEqual(len(l), 4)
        sans = {x[1] for x in cu.lignes_annuaire(self.mf, liste, {})}
        self.assertIn(9999, sans)                  # toute série de la liste entre dans la zone, même sans symbole boursier

    def test_lignes_annuaire_etf_dans_un_nom_de_classe_seulement(self):
        liste = {"S000000001": {"nom": "Alpha Fund", "entite": "", "classes": [["C000000001", "Class A", "A"], ["C000000002", "etf shares", "B"]]},
                 "S000000002": {"nom": "Betaetf Fund", "entite": "", "classes": [["C000000003", "Class A", "C"]]},
                 "S000000003": {"nom": "Gamma Fund", "entite": "", "classes": [["C000000004", "Class A", "D"]]}}
        mf = {"fields": ["cik", "seriesId", "classId", "symbol"],
              "data": [[1, "S000000001", "C000000001", "A"], [1, "S000000002", "C000000003", "C"], [1, "S000000003", "C000000004", "D"],
                       [1, "S000000003", "C000000004", "D"], [1, "S000000003", "C000000005", ""]]}
        l = {x[1]: x for x in cu.lignes_annuaire(mf, liste, {})}
        self.assertEqual((l[1][13], l[2][13], l[3][13]), (1, 0, 0))   # « etf » seul mot ; « Betaetf » n'en est pas un
        self.assertEqual(l[3][10], "D")   # symbole en double et symbole vide écartés

    def test_correspondance_isin(self):
        firds = 'const FIRDS = {"maj":"2026-10-01","fonds":{"US9229083632":["12WZ1W76P8QD4VJ6OB47","USD",[],6],"LU1681043599":["5493003BFED2MWDBYH64","EUR",[],0]},"places":{},"parNom":[]};'
        self.assertEqual(cu.correspondance_isin(firds, {"S000002839": "12WZ1W76P8QD4VJ6OB47"}), {"US9229083632": "S000002839"})

    def test_correspondance_isin_plusieurs_isin_et_lei_ambigu(self):
        firds = ('/* Généré par scripts/construire_annuaire.py — ne pas modifier à la main.\n * fonds : ISIN → [LEI, devise] */\n'
                 'const FIRDS = {"maj":"2026-10-01","fonds":{"US1":["AAA","USD",[],1],"US2":["AAA","USD",[],1],"US3":["BBB","USD",[],1],'
                 '"US4":["CCC","USD",[],1]},"places":{},"parNom":[]};\n')
        lei = {"S000000001": "AAA", "S000000002": "BBB", "S000000003": "BBB", "S000000004": ""}
        self.assertEqual(cu.correspondance_isin(firds, lei), {"US1": "S000000001", "US2": "S000000001"})   # BBB partagé : douteux, écarté

    ANNUAIRE_TEST = ('/* Généré automatiquement par scripts/construire_annuaire.py — ne pas modifier à la main. */\n'
                     'const ANNUAIRE_DATE = "2026-10-01";\n'
                     'const ANNUAIRE = [["E",0,0,"Vanguard 500 Index Fund ETF","","","","US9229083632","","US","","","USD",1,1],'
                     '["U",0,0,"Federated Hermes SDG Engagement Equity Fund","","","","IE00BN77D508","","IE","","","JPY",0,1],'
                     '["N",118829,0,"WisdomTree Quantum Computing UCITS ETF","WISDOMTREE MANAGEMENT LIMITED","","","US97717Y2954","2025-07-29","IE","","","",0,1],'
                     '["G",1,1,"Sans ISIN","","","","","","FR","","","EUR",0,1],'
                     '["E",0,0,"Vanguard 500 Index Fund ETF (bis)","","","","US9229083632","","US","","","USD",1,1]];\n')

    def test_pays_des_isin(self):   # pays des lignes de data/annuaire.js qui ont cet ISIN
        self.assertEqual(cu.pays_des_isin(self.ANNUAIRE_TEST), {"US9229083632": {"US"}, "IE00BN77D508": {"IE"}, "US97717Y2954": {"IE"}})

    def test_correspondance_isin_seulement_les_fonds_americains_de_l_annuaire(self):
        firds = ('const FIRDS = {"maj":"2026-10-01","fonds":{"US9229083632":["AAA","USD",[],6],"IE00BN77D508":["AAA","JPY",[],0],'
                 '"US97717Y2954":["AAA","USD",[],0],"US25461A1714":["AAA","USD",[],0]},"places":{},"parNom":[]};')
        lei = {"S000002839": "AAA"}
        pays = cu.pays_des_isin(self.ANNUAIRE_TEST)
        # IE00BN77D508 (ligne irlandaise) et US97717Y2954 (ligne N d'un fonds irlandais) ne sont pas des fonds américains ;
        # US25461A1714 n'a pas de ligne d'annuaire : rien ne le contredit
        self.assertEqual(cu.correspondance_isin(firds, lei, pays), {"US9229083632": "S000002839", "US25461A1714": "S000002839"})
        self.assertEqual(len(cu.correspondance_isin(firds, lei)), 4)   # sans annuaire : pas de tri

    def test_lire_js(self):
        self.assertEqual(cu.lire_js('const X = {"a":[1,2]};\n'), {"a": [1, 2]})
        self.assertEqual(cu.lire_js('ANNUAIRE_ZONES["etats-unis"] = {"lignes":[]};\n'), {"lignes": []})
        self.assertEqual(cu.lire_js('/* Généré = non ; */\nETATS_UNIS_DETAILS[5] = {};\n'), {})   # en-tête ignoré
        self.assertEqual(cu.lire_js('const X = {"t":"a = b; c"};\n'), {"t": "a = b; c"})
        with self.assertRaises(ValueError):
            cu.lire_js("rien à lire")


class Assemblage(unittest.TestCase):
    def setUp(self):
        tsv = lambda nom: list(cu.lire_tsv(SEC / "sec_nport", nom))
        self.liste = cu.lire_liste(lire_fichier("sec_series.csv"))
        self.taux = cu.taux_mensuels(lire_fichier("bce_usd_mensuel.csv"))
        soumissions, infos = tsv("SUBMISSION.tsv"), tsv("FUND_REPORTED_INFO.tsv")
        self.retenus = cu.depots_retenus(soumissions, infos)
        self.resumes = cu.resumer_positions(tsv("FUND_REPORTED_HOLDING.tsv"), set(self.retenus.values()))
        self.infos = cu.infos_retenues(soumissions, infos, self.retenus)
        self.isins = cu.isins_des_lignes(tsv("IDENTIFIERS.tsv"), {t[2] for r in self.resumes.values() for t in r["top"]})
        cumul, serie_de = {}, {}
        cu.ajouter_rendements(cumul, serie_de, soumissions, infos, tsv("MONTHLY_TOTAL_RETURN.tsv"))
        self.cumul = cumul
        self.rendements = cu.rendements_en_euros(cumul, self.taux)

    def detail(self, serie="S000002839", **remplacements):
        depot = self.retenus.get(serie)
        arguments = dict(serie=serie, classes=self.liste[serie]["classes"], resume=self.resumes.get(depot), isins=self.isins,
                         info=self.infos.get(serie), rendements_eur=self.rendements, frais={}, taux=self.taux, ancien=None)
        arguments.update(remplacements)
        return cu.detail_serie(**arguments)

    def test_infos_retenues(self):   # ligne FUND_REPORTED_INFO du dépôt retenu, avec la date du rapport en ISO
        self.assertEqual(set(self.infos), {"S000002839", "S000030390"})
        self.assertEqual(self.infos["S000030390"]["ACCESSION_NUMBER"], ASHMORE)   # pas l'amendement d'avril
        self.assertEqual(self.infos["S000030390"]["REPORT_DATE"], "2026-07-31")
        self.assertEqual(self.infos["S000002839"]["REPORT_DATE"], "2026-06-30")
        self.assertEqual(self.infos["S000002839"]["SERIES_LEI"], LEI_VANGUARD)

    def test_rendements_en_euros(self):
        self.assertEqual(self.rendements["C000007774"], {"2026-04": 8.56, "2026-05": 5.78, "2026-06": 1.22})
        self.assertEqual(len(self.rendements), 7)
        mois = {"2026-01": (1.0, "2026-05-01"), "2026-02": (1.0, "2026-05-01")}   # janvier : taux de décembre absent
        self.assertEqual(cu.rendements_en_euros({"A": mois, "B": {"2026-01": (1.0, "2026-05-01")}}, self.taux),
                         {"A": {"2026-02": cu.en_euros(1.0, "2026-02", self.taux)}})   # rien de convertible : pas de clé

    def test_fusionner_rendements(self):
        self.assertEqual(cu.fusionner_rendements(["2026-01", [1.0, None]], {"2026-03": 2.0, "2026-02": 0.5}), ["2026-01", [1.0, 0.5, 2.0]])
        self.assertEqual(cu.fusionner_rendements(None, {}), [None, None])

    def test_fusionner_rendements_cas_limites(self):
        self.assertEqual(cu.fusionner_rendements(None, {"2025-11": 1.0, "2026-02": 2.0}), ["2025-11", [1.0, None, None, 2.0]])   # trous, passage d'année
        self.assertEqual(cu.fusionner_rendements(["2026-01", [1.0, 2.0]], {"2026-02": 9.0}), ["2026-01", [1.0, 9.0]])   # le nouveau remplace
        self.assertEqual(cu.fusionner_rendements(["2026-01", [1.0, 2.0]], {}), ["2026-01", [1.0, 2.0]])
        self.assertEqual(cu.fusionner_rendements(["2026-01", [1.0, 2.0]], {"2026-05": 5.0}), ["2026-01", [1.0, 2.0, None, None, 5.0]])
        self.assertEqual(cu.fusionner_rendements([None, None], {}), [None, None])
        self.assertEqual(cu.fusionner_rendements(["2026-01", [None, None]], {}), [None, None])
        self.assertEqual(cu.fusionner_rendements(["2026-01", [None, 1.0, None]], {}), ["2026-02", [1.0]])   # pas de None aux extrémités
        self.assertEqual(cu.fusionner_rendements(["2026-03", [1.0]], {"2026-01": 7.0}), ["2026-01", [7.0, None, 1.0]])   # avant l'ancien début

    def test_detail_vanguard(self):
        d = self.detail()
        self.assertEqual(list(d), ["nom", "lei", "date", "actif", "lignes", "exclu", "top", "pays", "classes", "devises", "parts"])
        self.assertEqual((d["date"], d["lei"], d["actif"]), ("2026-06-30", LEI_VANGUARD, 1466764579568))
        self.assertIsInstance(d["actif"], int)
        self.assertEqual(d["nom"], "VANGUARD 500 INDEX FUND")   # nom du dépôt N-PORT
        self.assertEqual((d["lignes"], d["exclu"]), (508, 0.01))
        self.assertEqual(d["top"][0], ["NVIDIA Corp", 7.51, "US67066G1040"])
        self.assertEqual(d["top"][1], ["Apple Inc", 6.59, "US0378331005"])
        self.assertEqual(len(d["top"]), 10)
        self.assertTrue(all(len(t) == 3 for t in d["top"]))
        self.assertEqual(d["classes"], [["Actions", 99.75], ["Monétaire", 0.35]])
        self.assertEqual((d["pays"], d["devises"]), ([["US", 100.1]], [["USD", 100.1]]))
        self.assertEqual([p[0] for p in d["parts"]], ["C000007773", "C000007774", "C000092055", "C000170274"])   # ordre de la liste
        self.assertEqual(d["parts"][1], ["C000007774", "Admiral Shares", "VFIAX", "2026-04", [8.56, 5.78, 1.22], None])
        self.assertEqual(json.loads(json.dumps(d)), d)

    def test_detail_ashmore(self):
        d = self.detail("S000030390")
        self.assertEqual((d["date"], d["lei"], d["actif"]), ("2026-07-31", LEI_ASHMORE, round(26398818.45 / self.taux["2026-07"])
                                                              if "2026-07" in self.taux else None))
        self.assertEqual(d["nom"], "Ashmore Emerging Markets Total Return Fund")
        self.assertEqual([p[:3] for p in d["parts"]], [["C000093386", "Institutional Class Shares", "EMKIX"],
                                                       ["C000098150", "Class C", "EMKCX"], ["C000098151", "Class A", "EMKAX"]])
        # EMKIX : de février à juillet 2026 (un amendement d'avril et le dépôt de juillet)
        self.assertEqual(d["parts"][0][3], "2026-02")
        self.assertEqual(len(d["parts"][0][4]), 6)

    def test_detail_part_sans_rendements_ni_frais(self):
        classes = self.liste["S000002839"]["classes"] + [["C000999999", "Nouvelle part", ""]]
        d = self.detail(classes=classes)
        self.assertEqual(d["parts"][4], ["C000999999", "Nouvelle part", "", None, None, None])
        self.assertEqual(d["parts"][1][3], "2026-04")

    def test_detail_frais(self):
        frais = {"C000007774": [0.04, 0.04, 0.03, 0.0, 0.0, "2025-09-24"]}
        d = self.detail(frais=frais)
        self.assertEqual(d["parts"][1][5], [0.04, 0.04, 0.03, 0.0, 0.0, "2025-09-24"])
        self.assertIsNone(d["parts"][0][5])

    def test_detail_frais_seuls(self):   # série sans dépôt N-PORT ni rendements, mais avec un prospectus : fiche réduite aux frais
        num = list(cu.lire_tsv(SEC / "sec_rr", "num.tsv"))
        sub = list(cu.lire_tsv(SEC / "sec_rr", "sub.tsv"))
        frais = cu.frais_prospectus(num, sub, {"S000089799": ["C000256579"]})
        d = self.detail("S000089799", frais=frais)
        self.assertEqual(d["parts"], [["C000256579", "Defiance Daily Target 2X Long AMAT ETF", "AMA", None, None,
                                       [1.29, None, 1.29, None, None, "2025-08-26"]]])
        self.assertEqual((d["date"], d["actif"], d["lignes"], d["exclu"], d["top"], d["pays"], d["classes"], d["devises"]),
                         (None, None, 0, 0, [], [], [], []))
        self.assertEqual((d["nom"], d["lei"]), ("", ""))

    def test_detail_sans_aucune_donnee(self):
        self.assertIsNone(self.detail("S000089799"))

    def test_detail_rendements_de_la_serie(self):   # N-PORT sans part : rendements rangés sous la série ; une seule part → elle les prend
        self.rendements["S000089799"] = {"2026-02": 1.5, "2026-03": 2.5}
        d = self.detail("S000089799")
        self.assertEqual(d["parts"][0][3:5], ["2026-02", [1.5, 2.5]])
        classes = [["C1", "A", "A"], ["C2", "B", "B"]]   # deux parts : on ne sait pas laquelle, rien n'est attribué
        self.assertIsNone(self.detail("S000089799", classes=classes))

    def test_detail_nom_et_lei_de_secours(self):
        self.assertEqual(self.detail(nom_liste="Vanguard 500 Index Fund")["nom"], "VANGUARD 500 INDEX FUND")   # N-PORT d'abord
        d = self.detail(info=dict(self.infos["S000002839"], SERIES_NAME="", SERIES_LEI="N/A"), nom_liste="Nom de la liste")
        self.assertEqual((d["nom"], d["lei"]), ("Nom de la liste", ""))   # « N/A » n'est pas un LEI
        ancien = {"nom": "Ancien nom", "lei": LEI_VANGUARD}
        d = self.detail(info=dict(self.infos["S000002839"], SERIES_NAME="", SERIES_LEI=""), ancien=ancien)
        self.assertEqual((d["nom"], d["lei"]), ("Ancien nom", LEI_VANGUARD))
        d = self.detail(resume=None, info=None, ancien=ancien, nom_liste="Nom de la liste")   # pas de dépôt ce trimestre : le nom ne change pas
        self.assertEqual((d["nom"], d["lei"]), ("Ancien nom", LEI_VANGUARD))

    def test_detail_actif_sans_taux(self):
        taux = {m: v for m, v in self.taux.items() if m != "2026-06"}
        d = self.detail(taux=taux)
        self.assertIsNone(d["actif"])
        self.assertEqual(d["date"], "2026-06-30")
        d = self.detail(info=dict(self.infos["S000002839"], NET_ASSETS=""))
        self.assertIsNone(d["actif"])

    def test_detail_ancien_garde_sa_composition(self):   # nouveaux rendements seulement : la composition de l'ancien détail est reprise
        ancien = self.detail()
        d = self.detail(resume=None, info=None, ancien=ancien, rendements_eur={"C000007774": {"2026-07": 1.5}, "C000092055": {"2026-08": 2.5}})
        for champ in ("nom", "lei", "date", "actif", "lignes", "exclu", "top", "pays", "classes", "devises"):
            self.assertEqual(d[champ], ancien[champ], champ)
        self.assertEqual(d["parts"][1][3:5], ["2026-04", [8.56, 5.78, 1.22, 1.5]])
        self.assertEqual(d["parts"][2][3:5], ["2026-04", [self.rendements["C000092055"]["2026-04"], self.rendements["C000092055"]["2026-05"],
                                                         self.rendements["C000092055"]["2026-06"], None, 2.5]])
        self.assertEqual(d["parts"][0][3:5], ancien["parts"][0][3:5])   # part sans nouveau rendement : inchangée
        self.assertEqual(d["parts"][3][3:5], ancien["parts"][3][3:5])

    def test_detail_nouvelle_composition_remplace_l_ancienne(self):
        ancien = dict(self.detail(), date="2025-12-31", actif=1, lignes=1, top=[["Vieux", 1.0, None]])
        d = self.detail(ancien=ancien)
        self.assertEqual((d["date"], d["lignes"], d["top"][0][0]), ("2026-06-30", 508, "NVIDIA Corp"))
        self.assertEqual(d["parts"][1][4], [8.56, 5.78, 1.22])   # mêmes mois : pas de doublon

    def test_detail_depot_sans_position(self):   # dépôt sans aucune position (pas de résumé) : on garde la composition de l'ancien détail
        ancien = self.detail()
        d = self.detail(resume=None, ancien=ancien)
        self.assertEqual((d["date"], d["actif"], d["lignes"]), (ancien["date"], ancien["actif"], ancien["lignes"]))
        self.assertEqual(self.detail(resume=None)["parts"][1][3], "2026-04")   # rendements seuls, sans composition
        self.assertIsNone(self.detail(resume=None)["date"])


class Trimestres(unittest.TestCase):
    def test_trimestres(self):
        self.assertEqual(cu.trimestres("2025q3", "2026q2"), ["2025q3", "2025q4", "2026q1", "2026q2"])
        self.assertEqual(cu.trimestres("2026q2", "2026q2"), ["2026q2"])
        self.assertEqual(cu.trimestres("2026q3", "2026q2"), [])
        self.assertEqual(len(cu.trimestres(cu.PREMIER_TRIMESTRE, "2026q3")), 28)
        self.assertEqual(cu.trimestre_suivant("2025q4"), "2026q1")
        self.assertEqual(cu.trimestre_suivant("2026q1"), "2026q2")
        with self.assertRaises(ValueError):
            cu.trimestre_suivant("2026-Q1")

    def test_dernier_trimestre(self):   # le 09/10/2026 : trimestre en cours = 2026q4 (pas encore publié)
        publies = {"2026q3", "2026q2"}
        existe = lambda url: any(f"/{t}_" in url for t in publies)
        self.assertEqual(cu.dernier_trimestre(cu.NPORT, existe, date(2026, 10, 9)), "2026q3")
        publies = {"2026q2"}
        self.assertEqual(cu.dernier_trimestre(cu.NPORT, existe, date(2026, 10, 9)), "2026q2")

    def test_dernier_trimestre_essais(self):
        appels = []

        def existe(url):
            appels.append(url)
            return False

        self.assertIsNone(cu.dernier_trimestre(cu.RR, existe, date(2026, 10, 9)))
        self.assertEqual([re.search(r"/(\d{4}q\d)_", u).group(1) for u in appels], ["2026q4", "2026q3", "2026q2", "2026q1", "2025q4"])
        self.assertTrue(all(u.endswith("_rr1.zip") for u in appels))
        appels.clear()
        cu.dernier_trimestre(cu.NPORT, existe, date(2027, 1, 5))   # passage d'année
        self.assertEqual(re.search(r"/(\d{4}q\d)_", appels[0]).group(1), "2027q1")
        self.assertEqual(re.search(r"/(\d{4}q\d)_", appels[-1]).group(1), "2026q1")


def morceau(serie):
    return f"{int(serie[1:]) % 64:02d}.js"


DETAILS_ECRITURE = {
    "S000002839": {"nom": "Vanguard « 500 » Index Fund", "lei": LEI_VANGUARD, "date": "2026-06-30", "actif": 1466764579568, "lignes": 508,
                   "exclu": 0.01, "top": [["NVIDIA Corp", 7.51, "US67066G1040"]], "pays": [["US", 100.1]], "classes": [["Actions", 99.75]],
                   "devises": [["USD", 100.1]], "parts": [["C000007774", "Admiral Shares", "VFIAX", "2026-04", [8.56, None, 1.22], None]]},
    "S000030390": {"nom": "Ashmore", "lei": LEI_ASHMORE, "date": None, "actif": None, "lignes": 0, "exclu": 0, "top": [], "pays": [],
                   "classes": [], "devises": [], "parts": [["C000093386", "Institutional", "EMKIX", None, None,
                                                           [0.9, None, 0.7, 0.0, 0.0, "2025-08-26"]]]}}
LIGNES_ECRITURE = [["S", 2839, 2839, "Vanguard 500 Index Fund", "VANGUARD INDEX FUNDS", "", "", "", "", "US", "VFINX VFIAX", "", "USD", 1, 1],
                   ["S", 30390, 30390, "Ashmore Fund", "Ashmore Funds", "", "", "", "", "US", "EMKIX", "", "USD", 0, 1]]


class Ecriture(unittest.TestCase):
    def setUp(self):
        self.dossier = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.dossier, True)

    def ecrire(self, dossier=None, **remplacements):
        arguments = dict(dossier=dossier or self.dossier, lignes=LIGNES_ECRITURE, details=DETAILS_ECRITURE,
                         isin_serie={"US9229083632": "S000002839", "IE0000000001": "S000030390"}, maj="2026-10-12", trimestre="2026q3")
        arguments.update(remplacements)
        cu.ecrire_sorties(**arguments)

    def test_ecrire_et_relire(self):
        self.ecrire()
        fichiers = sorted(p.name for p in (self.dossier / "etats-unis").iterdir())
        self.assertEqual(fichiers, [f"{i:02d}.js" for i in range(64)])
        self.assertEqual(sorted(p.name for p in self.dossier.iterdir()), ["annuaire-etats-unis.js", "etats-unis", "etats-unis-isin.js"])
        self.assertEqual(morceau("S000002839"), "23.js")
        self.assertEqual(morceau("S000030390"), "54.js")
        self.assertIn('"S000002839"', (self.dossier / "etats-unis" / "23.js").read_text(encoding="utf-8"))
        self.assertIn('"S000030390"', (self.dossier / "etats-unis" / "54.js").read_text(encoding="utf-8"))
        self.assertEqual(cu.lire_details_existants(self.dossier), DETAILS_ECRITURE)
        zone = cu.lire_zone_existante(self.dossier)
        self.assertEqual(zone, {"maj": "2026-10-12", "trimestre": "2026q3", "lignes": LIGNES_ECRITURE})
        self.assertEqual(cu.lire_js((self.dossier / "etats-unis-isin.js").read_text(encoding="utf-8")),
                         {"IE0000000001": "S000030390", "US9229083632": "S000002839"})

    def test_forme_des_fichiers(self):   # ce que les scripts du navigateur attendent
        self.ecrire()
        zone = (self.dossier / "annuaire-etats-unis.js").read_text(encoding="utf-8")
        self.assertIn('\nANNUAIRE_ZONES["etats-unis"] = {"maj":"2026-10-12","trimestre":"2026q3","lignes":[["S",2839,2839,', zone)
        self.assertTrue(zone.endswith("]]};\n"))
        self.assertTrue((self.dossier / "etats-unis-isin.js").read_text(encoding="utf-8").split("*/\n")[1].startswith("const ETATS_UNIS_ISIN = {"))
        vide = (self.dossier / "etats-unis" / "00.js").read_text(encoding="utf-8")
        self.assertTrue(vide.endswith("\nETATS_UNIS_DETAILS[0] = {};\n"), vide)
        plein = (self.dossier / "etats-unis" / "23.js").read_text(encoding="utf-8")
        self.assertIn("\nETATS_UNIS_DETAILS[23] = {\"S000002839\":{\"nom\":\"Vanguard « 500 » Index Fund\"", plein)   # compact, accents conservés
        self.assertNotIn(", ", plein.split("\n", 3)[-1])

    def test_en_tetes(self):
        self.ecrire()
        chemins = [self.dossier / "annuaire-etats-unis.js", self.dossier / "etats-unis-isin.js"] + sorted((self.dossier / "etats-unis").iterdir())
        for chemin in chemins:
            texte = chemin.read_text(encoding="utf-8")
            entete = texte[:texte.index("*/")]
            self.assertTrue(texte.startswith("/*"), chemin.name)
            self.assertIn("Généré par scripts/construire_etats_unis.py — ne pas modifier à la main", entete, chemin.name)
            self.assertIn("Données publiques de la SEC (EDGAR), réutilisables sans autorisation", entete, chemin.name)
            self.assertNotIn("= ", entete, chemin.name)   # lire_js cherche la première affectation

    @unittest.skipUnless(shutil.which("node"), "node absent")
    def test_syntaxe_javascript(self):
        self.ecrire()
        fichiers = [self.dossier / "annuaire-etats-unis.js", self.dossier / "etats-unis-isin.js"] + sorted((self.dossier / "etats-unis").iterdir())
        self.assertEqual(len(fichiers), 66)
        for chemin in fichiers:
            r = subprocess.run(["node", "--check", str(chemin)], capture_output=True, text=True)
            self.assertEqual(r.returncode, 0, f"{chemin.name} : {r.stderr}")

    @unittest.skipUnless(shutil.which("node"), "node absent")
    def test_lu_comme_dans_le_navigateur(self):   # les fichiers exécutés l'un après l'autre donnent les structures attendues
        self.ecrire()
        script = ("const ANNUAIRE_ZONES = {}; const ETATS_UNIS_DETAILS = {}; const fs = require('fs'); const vm = require('vm');\n"
                  "const lire = (f) => fs.readFileSync(process.argv[1] + '/' + f, 'utf8');\n"
                  "const ctx = vm.createContext({ ANNUAIRE_ZONES, ETATS_UNIS_DETAILS });\n"
                  "vm.runInContext(lire('annuaire-etats-unis.js'), ctx);\n"
                  "vm.runInContext(lire('etats-unis/23.js'), ctx);\n"
                  "vm.runInContext(lire('etats-unis-isin.js') + '; this.ISIN = ETATS_UNIS_ISIN;', ctx);\n"
                  "console.log(JSON.stringify([ANNUAIRE_ZONES['etats-unis'].trimestre, ETATS_UNIS_DETAILS[23].S000002839.parts[0][4], ctx.ISIN.US9229083632]));\n")
        r = subprocess.run(["node", "-e", script, str(self.dossier)], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(json.loads(r.stdout), ["2026q3", [8.56, None, 1.22], "S000002839"])

    def test_valeur_non_finie_refusee(self):
        with self.assertRaises(ValueError):
            self.ecrire(details={"S000002839": dict(DETAILS_ECRITURE["S000002839"], actif=float("nan"))})

    def test_lectures_sans_fichiers(self):
        self.assertIsNone(cu.lire_zone_existante(self.dossier))
        self.assertEqual(cu.lire_details_existants(self.dossier), {})

    def test_ecriture_deterministe(self):   # même entrée → mêmes octets (pas de différence inutile dans Git)
        autre = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, autre, True)
        self.ecrire()
        self.ecrire(autre, details=dict(reversed(list(DETAILS_ECRITURE.items()))), isin_serie={"IE0000000001": "S000030390", "US9229083632": "S000002839"})
        for chemin in sorted(self.dossier.rglob("*.js")):
            self.assertEqual(chemin.read_bytes(), (autre / chemin.relative_to(self.dossier)).read_bytes(), chemin.name)

    def test_zone_ecrite_en_dernier(self):   # une écriture interrompue ne doit pas avancer le trimestre de la zone
        with mock.patch.object(Path, "write_text", autospec=True, side_effect=Path.write_text) as ecriture:
            self.ecrire()
        noms = [a[0][0].name for a in ecriture.call_args_list]
        self.assertEqual(noms[-1], "annuaire-etats-unis.js")
        self.assertEqual(len(noms), 66)


def zip_en_memoire(fichiers):
    tampon = io.BytesIO()
    with zipfile.ZipFile(tampon, "w", zipfile.ZIP_DEFLATED) as z:
        for nom, contenu in fichiers.items():
            z.writestr(nom, contenu)
    return zipfile.ZipFile(io.BytesIO(tampon.getvalue()))


def texte_tsv(lignes):
    entetes = list(lignes[0])
    return "\n".join(["\t".join(entetes)] + ["\t".join(l[h] for h in entetes) for l in lignes]) + "\n"


FIRDS_TEST = ('/* Généré automatiquement par scripts/construire_annuaire.py — ne pas modifier à la main. */\n'
              'const FIRDS = {"maj":"2026-10-01","fonds":{"US9229083632":["12WZ1W76P8QD4VJ6OB47","USD",[],6],'
              '"IE0000000001":["5493003R6Z966WCNR691","USD",[],2],"LU1681043599":["5493003BFED2MWDBYH64","EUR",[],0]},"places":{},"parNom":[]};\n')
NOUVEAU_DEPOT = "0000036405-26-000999"   # dépôt Vanguard du 4e trimestre (rapport du 30/09/2026)


class Principal(unittest.TestCase):
    """main() de bout en bout, sans réseau : les archives, les fichiers de la SEC et de la BCE sont remplacés par les extraits réels."""

    def setUp(self):
        self.dossier = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.dossier, True)
        (self.dossier / "firds.js").write_text(FIRDS_TEST, encoding="utf-8")
        self.sortie = io.StringIO()
        self.ouvertures, self.telechargements = [], []
        self.publie = {"nport": "2026q3", "rr": "2025q3"}
        self.archives = {}   # (N-PORT ? sinon prospectus, trimestre) → archive de remplacement (sinon : les extraits réels)
        self.liste_publiee = 2025   # dernière année dont la liste annuelle existe sur le site
        for cible, remplacant in (("ouvrir_zip", self.fausse_ouverture), ("telecharger", self.faux_telechargement),
                                  ("telecharger_bce", lambda url: lire_fichier("bce_usd_mensuel.csv").encode()),
                                  ("dernier_trimestre", self.faux_dernier)):
            patch = mock.patch.object(cu, cible, side_effect=remplacant)
            patch.start()
            self.addCleanup(patch.stop)
        patch = mock.patch.object(cu.urllib.request, "urlopen", side_effect=AssertionError("accès au réseau"))
        patch.start()
        self.addCleanup(patch.stop)

    def lancer(self, *options, aujourd_hui=date(2026, 10, 12)):
        with contextlib.redirect_stdout(self.sortie):
            return cu.main(list(options), self.dossier, aujourd_hui)

    def faux_dernier(self, modele, existe=None, aujourd_hui=None):
        return self.publie["nport" if modele == cu.NPORT else "rr"]

    def fausse_ouverture(self, url, *args, **kwargs):
        self.ouvertures.append(url)
        trimestre = re.search(r"/(\d{4}q\d)_", url).group(1)
        if (url.endswith("_nport.zip"), trimestre) in self.archives:
            return self.archives[(url.endswith("_nport.zip"), trimestre)]
        if url.endswith("_nport.zip"):
            return zip_en_memoire({n: (SEC / "sec_nport" / n).read_text(encoding="utf-8") for n in FICHIERS_NPORT})
        return zip_en_memoire({n: (SEC / "sec_rr" / n).read_text(encoding="utf-8") for n in ("num.tsv", "sub.tsv")})

    def faux_telechargement(self, url, plage=None):
        self.telechargements.append(url)
        if url == cu.TICKERS:
            return lire_fichier("sec_tickers_mf.json").encode()
        if url == cu.TICKERS_SOCIETES:
            return lire_fichier("sec_company_tickers.json").encode()
        annee = re.search(r"series-class-(\d{4})\.csv$", url)
        if annee:
            if int(annee.group(1)) > self.liste_publiee:
                raise erreur_http(404)
            return lire_fichier("sec_series.csv").encode()
        raise AssertionError(f"adresse inattendue : {url}")

    def archive_4e_trimestre(self):
        """Nouveau dépôt Vanguard (rapport du 30/09/2026, rendements de juillet à septembre) ; rien pour Ashmore."""
        def lignes(nom, **champs):
            return [dict(l, **champs) for l in cu.lire_tsv(SEC / "sec_nport", nom) if l.get("ACCESSION_NUMBER", VANGUARD) == VANGUARD]

        retours = lignes("MONTHLY_TOTAL_RETURN.tsv", ACCESSION_NUMBER=NOUVEAU_DEPOT, MONTHLY_TOTAL_RETURN1="1.0", MONTHLY_TOTAL_RETURN2="2.0",
                         MONTHLY_TOTAL_RETURN3="3.0")
        return zip_en_memoire({
            "SUBMISSION.tsv": texte_tsv(lignes("SUBMISSION.tsv", ACCESSION_NUMBER=NOUVEAU_DEPOT, REPORT_DATE="30-SEP-2026", FILING_DATE="20-OCT-2026")),
            "REGISTRANT.tsv": texte_tsv(lignes("REGISTRANT.tsv", ACCESSION_NUMBER=NOUVEAU_DEPOT)),
            "FUND_REPORTED_INFO.tsv": texte_tsv(lignes("FUND_REPORTED_INFO.tsv", ACCESSION_NUMBER=NOUVEAU_DEPOT, NET_ASSETS="1000000000.00")),
            "MONTHLY_TOTAL_RETURN.tsv": texte_tsv(retours),
            "FUND_REPORTED_HOLDING.tsv": texte_tsv(lignes("FUND_REPORTED_HOLDING.tsv", ACCESSION_NUMBER=NOUVEAU_DEPOT)),
            "IDENTIFIERS.tsv": (SEC / "sec_nport" / "IDENTIFIERS.tsv").read_text(encoding="utf-8"),
            "SECURITIES_LENDING.tsv": (SEC / "sec_nport" / "SECURITIES_LENDING.tsv").read_text(encoding="utf-8")})

    def test_main_rien_de_nouveau(self):
        cu.ecrire_sorties(self.dossier, LIGNES_ECRITURE, DETAILS_ECRITURE, {}, "2026-10-01", "2026q3")
        avant = {p: (p.stat().st_mtime_ns, p.read_bytes()) for p in sorted(self.dossier.rglob("*.js"))}
        self.assertEqual(self.lancer(), 0)
        self.assertIn("Rien de nouveau", self.sortie.getvalue())
        self.assertEqual({p: (p.stat().st_mtime_ns, p.read_bytes()) for p in sorted(self.dossier.rglob("*.js"))}, avant)
        self.assertEqual((self.ouvertures, self.telechargements), ([], []))

    def test_main_trimestre_introuvable(self):
        self.publie["nport"] = None
        self.assertEqual(self.lancer(), 1)
        self.assertFalse(list(self.dossier.glob("annuaire*")))

    def test_main_premiere_construction(self):
        with mock.patch.object(cu, "frais_prospectus", wraps=cu.frais_prospectus) as frais:
            self.assertEqual(self.lancer(), 0)
        frais.assert_called_once()   # un seul appel pour les 8 trimestres de prospectus
        nport = [u for u in self.ouvertures if u.endswith("_nport.zip")]
        self.assertEqual([re.search(r"/(\d{4}q\d)_", u).group(1) for u in nport], cu.trimestres("2019q4", "2026q3"))   # sans zone : tout
        rr = [re.search(r"/(\d{4}q\d)_", u).group(1) for u in self.ouvertures if u.endswith("_rr1.zip")]
        self.assertEqual(rr, ["2023q4", "2024q1", "2024q2", "2024q3", "2024q4", "2025q1", "2025q2", "2025q3"])   # les 8 derniers trimestres
        self.assertIn(cu.LISTE.format(annee=2025), self.telechargements)   # liste 2026 absente (404) : année précédente
        zone = cu.lire_zone_existante(self.dossier)
        self.assertEqual((zone["maj"], zone["trimestre"]), ("2026-10-12", "2026q3"))
        self.assertEqual([l[1] for l in zone["lignes"]], [30390, 89799, 2839])   # par nom
        details = cu.lire_details_existants(self.dossier)
        self.assertEqual(set(details), {"S000002839", "S000030390", "S000089799"})
        v = details["S000002839"]
        # 508 positions dans le fichier, dont un fonds monétaire de réinvestissement de garanties (prêt de titres) retiré de la composition
        self.assertEqual((v["date"], v["lei"], v["actif"], v["lignes"]), ("2026-06-30", LEI_VANGUARD, 1466764579568, 507))
        self.assertEqual(v["classes"][0], ["Actions", 99.75])
        self.assertEqual(v["parts"][1], ["C000007774", "Admiral Shares", "VFIAX", "2026-04", [8.56, 5.78, 1.22], None])
        self.assertEqual(v["top"][0], ["NVIDIA Corp", 7.51, "US67066G1040"])
        a = details["S000030390"]
        self.assertEqual((a["date"], a["lei"]), ("2026-07-31", LEI_ASHMORE))
        self.assertEqual(a["parts"][0][3], "2026-02")
        self.assertEqual(a["parts"][0][4], [cu.en_euros(r, m, cu.taux_mensuels(lire_fichier("bce_usd_mensuel.csv")))
                                            for r, m in zip([1.46, -4.24, 3.92, 0.27, -0.32, -0.52],
                                                            ["2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07"])])
        d = details["S000089799"]   # pas de N-PORT dans les extraits, mais un prospectus : frais seuls
        self.assertEqual(d["parts"][0][5], [1.29, None, 1.29, None, None, "2025-08-26"])
        self.assertIsNone(d["date"])
        isin = cu.lire_js((self.dossier / "etats-unis-isin.js").read_text(encoding="utf-8"))
        self.assertEqual(isin, {"IE0000000001": "S000030390", "US9229083632": "S000002839"})
        self.assertTrue(len(list((self.dossier / "etats-unis").iterdir())) == 64)
        self.assertRegex(self.sortie.getvalue(), r"3 séries.*3 détails.*Mo")
        self.assertRegex(self.sortie.getvalue(), r"1 position.*réinvestissement de garanties.*1 fonds")   # résumé imprimé, à part des dérivés

    def test_main_serie_americaine_hors_tickers(self):   # série absente de company_tickers_mf mais retrouvée par son LEI dans FIRDS : dans la zone
        mf = json.loads(lire_fichier("sec_tickers_mf.json"))
        mf["data"] = [l for l in mf["data"] if l[1] != "S000030390"]
        with mock.patch.object(cu, "telecharger", side_effect=lambda url, plage=None: json.dumps(mf).encode() if url == cu.TICKERS
                               else self.faux_telechargement(url, plage)):
            self.assertEqual(self.lancer(), 0)
        zone = cu.lire_zone_existante(self.dossier)
        ligne = next(l for l in zone["lignes"] if l[1] == 30390)
        self.assertEqual((ligne[3], ligne[10]), ("Ashmore Emerging Markets Total Return Fund", "EMKIX EMKCX EMKAX"))
        self.assertIn("S000030390", cu.lire_details_existants(self.dossier))

    def test_main_isin_europeens_ecartes_d_apres_l_annuaire(self):   # la ligne d'annuaire de l'ISIN irlandais est irlandaise : pas de données de la SEC
        (self.dossier / "annuaire.js").write_text(
            'const ANNUAIRE_DATE = "2026-10-01";\nconst ANNUAIRE = [["E",0,0,"Vanguard 500","","","","US9229083632","","US","","","USD",1,1],'
            '["E",0,0,"Fonds irlandais","","","","IE0000000001","","IE","","","USD",0,1]];\n', encoding="utf-8")
        self.assertEqual(self.lancer(), 0)
        isin = cu.lire_js((self.dossier / "etats-unis-isin.js").read_text(encoding="utf-8"))
        self.assertEqual(isin, {"US9229083632": "S000002839"})
        self.assertIn("S000030390", cu.lire_details_existants(self.dossier))   # la série reste (tickers de la SEC), sans l'ISIN irlandais

    def test_main_liste_de_l_annee_en_cours(self):
        self.liste_publiee = 2026
        self.assertEqual(self.lancer(), 0)
        self.assertNotIn(cu.LISTE.format(annee=2025), self.telechargements)

    def test_main_frais_de_plusieurs_trimestres(self):   # pour chaque valeur, le prospectus le plus récent l'emporte, même s'il est plus ancien pour une autre valeur
        entetes = "adsh\ttag\tseries\totherdims\tvalue\n"
        self.archives[(False, "2024q4")] = zip_en_memoire({
            "sub.tsv": "adsh\tfiled\nA1\t20241201\n",
            "num.tsv": entetes + "".join(f"A1\t{tag}\tS000089799\tClass=C000256579;\t{valeur}\n" for tag, valeur in (
                ("ExpensesOverAssets", "0.0200"), ("NetExpensesOverAssets", "0.0150"), ("MaximumSalesChargeImposedOnPurchasesOverOfferingPrice", "0.0300")))})
        self.assertEqual(self.lancer(), 0)
        brut, net, gestion, entree, sortie, depose = cu.lire_details_existants(self.dossier)["S000089799"]["parts"][0][5]
        self.assertEqual((brut, net, gestion, entree, sortie), (1.29, 1.5, 1.29, 3.0, None))   # brut et gestion de 2025q3, net et entrée de 2024q4
        self.assertEqual(depose, "2025-08-26")

    def test_main_trimestre_suivant(self):   # le trimestre suivant est ajouté aux données existantes
        self.assertEqual(self.lancer(), 0)
        premier = {p.name: p.read_bytes() for p in self.dossier.rglob("*.js")}
        self.assertEqual(self.lancer("--forcer", aujourd_hui=date(2026, 10, 12)), 0)   # deux fois de suite : mêmes données
        self.assertEqual({p.name: p.read_bytes() for p in self.dossier.rglob("*.js")}, premier)
        self.ouvertures.clear()
        self.publie["nport"] = "2026q4"
        self.liste_publiee = 2026   # janvier 2027 : la liste 2027 n'existe pas encore
        self.archives[(True, "2026q4")] = self.archive_4e_trimestre()
        self.assertEqual(self.lancer(aujourd_hui=date(2027, 1, 12)), 0)
        self.assertEqual([re.search(r"/(\d{4}q\d)_", u).group(1) for u in self.ouvertures if u.endswith("_nport.zip")], ["2026q4"])
        zone = cu.lire_zone_existante(self.dossier)
        self.assertEqual((zone["maj"], zone["trimestre"]), ("2027-01-12", "2026q4"))
        taux = cu.taux_mensuels(lire_fichier("bce_usd_mensuel.csv"))
        v = cu.lire_details_existants(self.dossier)["S000002839"]
        self.assertEqual(v["date"], "2026-09-30")
        self.assertEqual(v["actif"], round(1000000000.00 / taux["2026-09"]))
        self.assertEqual(v["parts"][1][3:5], ["2026-04", [8.56, 5.78, 1.22, cu.en_euros(1.0, "2026-07", taux), cu.en_euros(2.0, "2026-08", taux),
                                                         cu.en_euros(3.0, "2026-09", taux)]])
        a = cu.lire_details_existants(self.dossier)["S000030390"]   # pas de nouveau dépôt Ashmore : composition et rendements conservés
        self.assertEqual(a["date"], "2026-07-31")
        self.assertEqual(a["parts"][0][3], "2026-02")
        isin = cu.lire_js((self.dossier / "etats-unis-isin.js").read_text(encoding="utf-8"))
        self.assertEqual(set(isin.values()), {"S000002839", "S000030390"})   # LEI de l'ancien détail Ashmore conservé

    def test_main_forcer_ne_relit_pas_les_trimestres(self):
        self.assertEqual(self.lancer(), 0)
        self.ouvertures.clear()
        self.assertEqual(self.lancer("--forcer"), 0)
        self.assertNotIn("Rien de nouveau", self.sortie.getvalue())
        self.assertEqual([u for u in self.ouvertures if u.endswith("_nport.zip")], [])
        self.assertEqual(len([u for u in self.ouvertures if u.endswith("_rr1.zip")]), 8)   # les frais sont relus

    def test_main_complet_ignore_les_anciens_details(self):
        self.assertEqual(self.lancer(), 0)
        ancien = dict(DETAILS_ECRITURE["S000030390"], nom="Ancien nom", date="1999-01-01", lignes=3, top=[["Vieux titre", 1.0, None]])
        zone = cu.lire_zone_existante(self.dossier)
        cu.ecrire_sorties(self.dossier, zone["lignes"], {"S000089799": ancien}, {}, "2026-10-01", "2026q3")
        self.assertEqual(self.lancer("--forcer"), 0)   # sans --complet : le détail déjà écrit est conservé (composition de 1999 comprise)
        gardee = cu.lire_details_existants(self.dossier)["S000089799"]
        self.assertEqual((gardee["date"], gardee["lignes"], gardee["top"]), ("1999-01-01", 3, [["Vieux titre", 1.0, None]]))
        self.ouvertures.clear()
        self.assertEqual(self.lancer("--complet"), 0)   # avec --complet : les anciens détails sont ignorés
        self.assertEqual(len([u for u in self.ouvertures if u.endswith("_nport.zip")]), 28)
        refait = cu.lire_details_existants(self.dossier)["S000089799"]
        self.assertIsNone(refait["date"])
        self.assertEqual(refait["top"], [])
        self.assertEqual(refait["parts"][0][5], [1.29, None, 1.29, None, None, "2025-08-26"])

    def test_main_une_seule_lecture_des_positions(self):   # le gros fichier des positions n'est lu que pour le dernier trimestre
        with mock.patch.object(cu, "resumer_positions", wraps=cu.resumer_positions) as resumer, \
                mock.patch.object(cu, "isins_des_lignes", wraps=cu.isins_des_lignes) as isins:
            self.assertEqual(self.lancer("--complet"), 0)
        self.assertEqual((resumer.call_count, isins.call_count), (1, 1))
        self.assertLessEqual(len(isins.call_args[0][1]), 20)   # seules les 10 premières lignes de chaque fonds

    def archive_avec_spy_et_mdy(self):
        """Extraits réels du 3e trimestre 2026, plus les dépôts de SPY et MDY (sans numéro de série). SPY reçoit les positions de
        Vanguard (même indice) pour que sa composition passe par le même chemin que celle des autres fonds."""
        fichiers = {}
        for nom in FICHIERS_NPORT:
            lignes = list(cu.lire_tsv(SEC / "sec_nport", nom))
            if (SEC / "sec_nport_cik" / nom).exists():
                lignes += list(cu.lire_tsv(SEC / "sec_nport_cik", nom))
            if nom == "FUND_REPORTED_HOLDING.tsv":
                lignes += [dict(l, ACCESSION_NUMBER=SPY) for l in lignes if l["ACCESSION_NUMBER"] == VANGUARD]
            fichiers[nom] = texte_tsv(lignes)
        return zip_en_memoire(fichiers)

    def test_main_fonds_sans_numero_de_serie(self):   # SPY et MDY : pseudo-séries du CIK, nom, symbole, composition, rendements en euros
        self.archives[(True, "2026q3")] = self.archive_avec_spy_et_mdy()
        self.assertEqual(self.lancer(), 0)
        lignes = {l[1]: l for l in cu.lire_zone_existante(self.dossier)["lignes"]}
        self.assertEqual(lignes[900884394], ["S", 900884394, 900884394, "State Street SPDR S&P 500 ETF Trust", "", "", "", "", "", "US", "SPY",
                                             "", "USD", 1, 1])
        self.assertEqual(lignes[900936958][3:4] + lignes[900936958][10:11], ["State Street SPDR S&P MidCap 400SM ETF Trust", "MDY"])
        taux = cu.taux_mensuels(lire_fichier("bce_usd_mensuel.csv"))
        details = cu.lire_details_existants(self.dossier)
        spy = details["S900884394"]
        self.assertEqual((spy["date"], spy["lei"], spy["lignes"]), ("2026-06-30", "549300NZAMSJ8FXPQQ63", 507))
        self.assertEqual(spy["parts"], [["S900884394", "", "SPY", "2026-04",
                                         [cu.en_euros(r, m, taux) for r, m in ((10.48, "2026-04"), (5.25, "2026-05"), (-0.96, "2026-06"))], None]])
        mdy = details["S900936958"]
        self.assertEqual(mdy["parts"][0][3:5], ["2026-04", [cu.en_euros(r, m, taux) for r, m in ((7.79, "2026-04"), (2.42, "2026-05"), (3.6, "2026-06"))]])
        self.assertEqual(mdy["lignes"], 0)   # pas de positions dans l'extrait
        self.assertNotIn("C000000000", json.dumps(details))

    def test_main_fonds_sans_numero_de_serie_gardes_sans_nouveau_trimestre(self):   # --forcer : les pseudo-séries déjà écrites restent
        self.archives[(True, "2026q3")] = self.archive_avec_spy_et_mdy()
        self.assertEqual(self.lancer(), 0)
        self.assertEqual(self.lancer("--forcer"), 0)
        lignes = {l[1]: l for l in cu.lire_zone_existante(self.dossier)["lignes"]}
        self.assertEqual((lignes[900884394][3], lignes[900884394][10]), ("State Street SPDR S&P 500 ETF Trust", "SPY"))
        self.assertEqual(cu.lire_details_existants(self.dossier)["S900884394"]["parts"][0][3], "2026-04")

    def test_main_isin_d_une_serie_hors_zone(self):   # LEI d'un ancien détail sans nom connu : la série n'est pas dans la zone, ses ISIN non plus
        lei = "ABCDEFGHIJ0123456789"
        (self.dossier / "firds.js").write_text(FIRDS_TEST.replace('"LU1681043599"', f'"US0000000042":["{lei}","USD",[],1],"LU1681043599"'), encoding="utf-8")
        cu.ecrire_sorties(self.dossier, [], {"S000000042": dict(DETAILS_ECRITURE["S000030390"], nom="", lei=lei)}, {}, "2026-10-01", "2026q3")
        self.assertEqual(self.lancer("--forcer"), 0)
        self.assertEqual(cu.lire_js((self.dossier / "etats-unis-isin.js").read_text(encoding="utf-8")), {})
        self.assertNotIn(42, [l[1] for l in cu.lire_zone_existante(self.dossier)["lignes"]])

if __name__ == "__main__":
    unittest.main()
