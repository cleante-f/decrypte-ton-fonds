"""Tests de scripts/construire_etats_unis.py, sans réseau, sur de vrais extraits des fichiers de la SEC (tests/donnees/sec/).

    python3 tests/test_etats_unis.py -v
"""
import io
import math
import sys
import unittest
import urllib.error
import zipfile
from pathlib import Path
from unittest import mock

RACINE = Path(__file__).resolve().parent.parent
SEC = RACINE / "tests" / "donnees" / "sec"
sys.path.insert(0, str(RACINE / "scripts"))
import construire_etats_unis as cu

VANGUARD = "0000036405-26-000473"   # Vanguard 500 Index Fund (S000002839), rapport du 30/06/2026
ASHMORE = "0002066578-26-003500"    # Ashmore Emerging Markets Total Return Fund (S000030390), rapport du 31/07/2026
ASHMORE_AVRIL = "0002066578-26-002478"   # amendement du rapport du 30/04/2026 du même fonds
FICHIERS_NPORT = ["SUBMISSION.tsv", "FUND_REPORTED_INFO.tsv", "MONTHLY_TOTAL_RETURN.tsv", "FUND_REPORTED_HOLDING.tsv",
                  "IDENTIFIERS.tsv"]


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


if __name__ == "__main__":
    unittest.main()
