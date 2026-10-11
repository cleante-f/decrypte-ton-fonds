"""
Tests du registre européen de l'ESMA (scripts/registres_ue.py), sans réseau, sur des extraits réels :
  tests/donnees/sec/esma_registre.json : 5 fiches du registre de la commercialisation transfrontière
    - Amundi MSCI World Swap        2731132 (LU, OPCVM, LEI 5493003BFED2MWDBYH64)
    - GAM Star Absolute Return Macro  90728 (IE, OPCVM, sans LEI)
    - Quaestio                      2103246 (FIA domicilié au LU, autorité italienne, LEI 54930037VM06T2XYAY51)
    - IPM Global Fund               2075934 (IE, fiche inactive)
    - iShares Core MSCI World       2836341 (IE, OPCVM, sans LEI)
  tests/donnees/sec/gleif_fiches.json : réponse de l'API GLEIF pour deux de ces LEI.
    python3 tests/test_registres_ue.py -v
"""
import copy
import json
import re
import sys
import tempfile
import unittest
import urllib.parse
from pathlib import Path
from unittest import mock

RACINE = Path(__file__).resolve().parent.parent
DONNEES = RACINE / "tests" / "donnees" / "sec"
sys.path.insert(0, str(RACINE / "scripts"))
import construire_identite as ci
import registres_ue as ru

LEI_AMUNDI, LEI_ISHARES, LEI_QUAESTIO = "5493003BFED2MWDBYH64", "549300QS4Q1IT6XCA514", "54930037VM06T2XYAY51"
CSSF = "Commission de Surveillance du Secteur Financier (CSSF)"
CBI = "Central Bank of Ireland (CBI)"


def identite(nom):
    return nom


class Base(unittest.TestCase):
    def setUp(self):
        self.docs = json.loads((DONNEES / "esma_registre.json").read_text(encoding="utf-8"))["response"]["docs"]
        self.actifs = ru.actives(self.docs)
        self.lies, self.restes = ru.rapprocher(
            self.docs, {LEI_AMUNDI, LEI_ISHARES}, {LEI_ISHARES: ("iShares Core MSCI World UCITS ETF", "IE")}, {})

    def doc(self, id_):
        return copy.deepcopy(next(d for d in self.docs if d["id"] == id_))


class Constantes(Base):
    def test_cadres(self):
        self.assertEqual(ru.CADRES, {"UCITS": "OPCVM (UCITS)", "AIF": "FIA", "ELTIF": "ELTIF", "EuVECA": "EuVECA", "EuSEF": "EuSEF"})
        self.assertEqual(ru.PAYS_ZONE, {"IE", "LU"})


class Actives(Base):
    def test_actives(self):
        self.assertEqual([d["id"] for d in self.actifs], ["2731132", "90728", "2103246", "2836341"])   # IPM inactif écarté

    def test_actives_sans_statut(self):
        self.assertEqual(ru.actives([{"id": "1"}]), [])


class Autorites(Base):
    def test_autorites(self):
        self.assertEqual(ru.autorites(self.docs), {"LU": CSSF, "IE": CBI})   # Quaestio (FIA) et IPM (inactif) ne comptent pas

    def test_autorites_le_plus_frequent(self):
        docs = []
        for i, autorite in enumerate([CBI, CBI, "Autre autorité"]):
            d = self.doc("90728")
            d.update(id=str(i), funds_manager_comp_cou_code=autorite)
            docs.append(d)
        self.assertEqual(ru.autorites(docs), {"IE": CBI})

    def test_autorites_egalite_ordre_alphabetique(self):
        docs = []
        for i, autorite in enumerate(["Zeta", "Alpha"]):
            d = self.doc("90728")
            d.update(id=str(i), funds_manager_comp_cou_code=autorite)
            docs.append(d)
        self.assertEqual(ru.autorites(docs), {"IE": "Alpha"})

    def test_autorites_sans_nom_ou_sans_pays(self):
        d = self.doc("90728")
        del d["funds_manager_comp_cou_code"]
        e = self.doc("2731132")
        del e["funds_ca_cou_code"]
        self.assertEqual(ru.autorites([d, e]), {})


class Rapprochement(Base):
    def test_rapprocher(self):
        self.assertEqual({k: d["id"] for k, d in self.lies.items()}, {LEI_AMUNDI: "2731132", LEI_ISHARES: "2836341"})
        self.assertEqual(sorted(d["id"] for d in self.restes), ["2103246", "90728"])   # IPM inactif : ni l'un ni l'autre

    def test_rapprocher_fonds_geco(self):
        lies, restes = ru.rapprocher(self.docs, set(), {}, {"N4321": ("GAM STAR ABSOLUTE RETURN MACRO", "IE")})
        self.assertEqual({k: d["id"] for k, d in lies.items()}, {"N4321": "90728"})
        self.assertEqual(sorted(d["id"] for d in restes), ["2103246", "2731132", "2836341"])

    def test_rapprocher_fonds_geco_autre_pays(self):
        lies, _ = ru.rapprocher(self.docs, set(), {}, {"N4321": ("GAM STAR ABSOLUTE RETURN MACRO", "LU")})
        self.assertEqual(lies, {})

    def test_rapprocher_ambigu(self):
        geco = {"N4321": ("GAM Star Absolute Return Macro", "IE"), "N4322": ("GAM STAR ABSOLUTE RETURN MACRO", "IE")}
        lies, restes = ru.rapprocher(self.docs, set(), {}, geco)
        self.assertEqual(lies, {})
        self.assertIn("90728", [d["id"] for d in restes])   # GAM non rapproché

    def test_rapprocher_ambigu_noms_gleif(self):
        noms = {"A" * 20: ("iShares Core MSCI World UCITS ETF", "IE"), "B" * 20: ("ISHARES CORE MSCI WORLD UCITS ETF", "IE")}
        lies, restes = ru.rapprocher(self.docs, {"A" * 20, "B" * 20}, noms, {})
        self.assertEqual(lies, {})
        self.assertIn("2836341", [d["id"] for d in restes])

    def test_rapprocher_nom_gleif_autre_pays(self):
        lies, _ = ru.rapprocher(self.docs, {LEI_ISHARES}, {LEI_ISHARES: ("iShares Core MSCI World UCITS ETF", "LU")}, {})
        self.assertNotIn(LEI_ISHARES, lies)

    def test_rapprocher_nom_gleif_prioritaire_sur_geco(self):
        lies, _ = ru.rapprocher(self.docs, {LEI_ISHARES}, {LEI_ISHARES: ("iShares Core MSCI World UCITS ETF", "IE")},
                                {"N9": ("ISHARES CORE MSCI WORLD UCITS ETF", "IE")})
        self.assertEqual({k: d["id"] for k, d in lies.items() if d["id"] == "2836341"}, {LEI_ISHARES: "2836341"})

    def test_rapprocher_cle_deja_prise(self):
        # deux fiches ESMA du même LEI : la première garde la clé, la seconde n'est pas rapprochée
        copie = self.doc("2731132")
        copie["id"] = "9999999"
        lies, restes = ru.rapprocher([self.doc("2731132"), copie], {LEI_AMUNDI}, {}, {})
        self.assertEqual({k: d["id"] for k, d in lies.items()}, {LEI_AMUNDI: "2731132"})
        self.assertEqual([d["id"] for d in restes], ["9999999"])

    def test_rapprocher_ne_garde_que_les_actives(self):
        lies, restes = ru.rapprocher(self.docs, set(), {}, {"N1": ("IPM Global Fund Plc - IPM Systematic Macro Fund (Ireland)", "IE")})
        self.assertEqual(lies, {})
        self.assertNotIn("2075934", [d["id"] for d in restes])

    def test_rapprocher_ne_modifie_pas_les_entrees(self):
        avant = copy.deepcopy(self.docs)
        ru.rapprocher(self.docs, {LEI_AMUNDI}, {}, {})
        self.assertEqual(self.docs, avant)


class Entrees(Base):
    def test_entree_esma(self):
        self.assertEqual(ru.entree_esma(self.doc("2731132"), identite),
                         ["AMUNDI LUXEMBOURG S.A.", "LU", "UCITS", "FR IT NL FI SE ES AT DE IE PT DK NO"])

    def test_entree_esma_nom_id(self):
        self.assertEqual(ru.entree_esma(self.doc("2103246"), lambda n: 7), [7, "IT", "AIF", "LU"])


class Lignes(Base):
    def test_lignes_registres(self):
        l = {x[1]: x for x in ru.lignes_registres(self.restes, ci.joli)}
        self.assertEqual(l[90728], ["R", 90728, 90728, "GAM Star Absolute Return Macro", "GAM Fund Management Limited", "", "OPCVM (UCITS)",
                                    "", "", "IE", "", "", "", 0, 1])
        self.assertEqual((l[2103246][4], l[2103246][6], l[2103246][9], l[2103246][14]), ("Quaestio Capital Sgr S.P.A.", "FIA", "LU", 0))

    def test_lignes_registres_hors_zone(self):
        d = self.doc("90728")
        d["funds_domicile_cou_code"] = "DE"
        self.assertEqual(ru.lignes_registres([d], ci.joli), [])

    def test_lignes_registres_etf(self):
        d = self.doc("2836341")
        self.assertEqual(ru.lignes_registres([d], ci.joli)[0][13], 1)
        d["funds_national_name"] = "iShares Core ETFS MSCI World"   # « ETFS » n'est pas « ETF »
        self.assertEqual(ru.lignes_registres([d], ci.joli)[0][13], 0)

    def test_lignes_registres_cadres(self):
        for cadre, attendu, public in [("ELTIF", "ELTIF", 0), ("EuVECA", "EuVECA", 0), ("EuSEF", "EuSEF", 0), ("UCITS", "OPCVM (UCITS)", 1)]:
            d = self.doc("90728")
            d["funds_legal_framework_name"] = cadre
            ligne = ru.lignes_registres([d], ci.joli)[0]
            self.assertEqual((ligne[6], ligne[14]), (attendu, public), cadre)

    def test_lignes_registres_triees_par_nom(self):
        a, b, c = self.doc("90728"), self.doc("90728"), self.doc("90728")
        for d, id_, nom in [(a, "3", "banque Z"), (b, "1", "Zèbre"), (c, "2", "Alpha")]:
            d.update(id=id_, funds_national_name=nom)
        self.assertEqual([l[3] for l in ru.lignes_registres([a, b, c], ci.joli)], ["Alpha", "banque Z", "Zèbre"])

    def test_lignes_registres_espaces(self):
        # le registre contient des noms avec un espace en tête (« ␣SOLUTIO PREMIUM… ») ou des espaces doubles
        d = self.doc("90728")
        d.update(funds_national_name="  SOLUTIO  PREMIUM Private Debt IV ", funds_manager_nat_name=" Pantheon Ventures  (Ireland) DAC ")
        ligne = ru.lignes_registres([d], ci.joli)[0]
        self.assertEqual((ligne[3], ligne[4]), ("SOLUTIO PREMIUM Private Debt IV", "Pantheon Ventures (Ireland) DAC"))
        self.assertEqual(ru.propre(None), "")

    def test_lignes_registres_json(self):
        json.dumps(ru.lignes_registres(self.restes, ci.joli))   # ids entiers, pas de valeur non sérialisable


class Infos(Base):
    def test_infos_registres(self):
        infos = ru.infos_registres(self.restes, {}, {}, {})
        self.assertEqual(infos["2103246"], [LEI_QUAESTIO, "IT", "LU", "", 0, ""])
        self.assertEqual(infos["90728"], ["", "IE", "AT DE ES FR", "", 0, ""])
        self.assertEqual(set(infos), {"2103246", "90728"})

    def test_infos_registres_bce(self):
        infos = ru.infos_registres(self.restes, {LEI_QUAESTIO: {"politique": "X", "tranche": 3, "etf": False}}, {}, {})
        self.assertEqual(infos["2103246"][3:5], ["X", 3])

    def test_infos_registres_parapluie(self):
        parapluie = "5299000J2N45DDNE4Y28"
        liens = {LEI_QUAESTIO: {"parapluie": parapluie, "gestion": "549300R4O3O16JWCZK60"}}
        infos = ru.infos_registres(self.restes, {}, liens, {parapluie: {"nom": "Quaestio Alternative Funds"}})
        self.assertEqual(infos["2103246"][5], "Quaestio Alternative Funds")
        # parapluie sans fiche GLEIF : pas de nom
        self.assertEqual(ru.infos_registres(self.restes, {}, liens, {})["2103246"][5], "")


class DepuisAnnuaire(Base):
    """Noms GLEIF et fonds GECO sans ISIN tirés de l'annuaire (fonction utilisée par construire_identite.main)."""

    def test_rapprochement_depuis_l_annuaire(self):
        gleif = json.loads((DONNEES / "gleif_fiches.json").read_text(encoding="utf-8"))
        with mock.patch.object(ci, "telecharger", return_value=json.dumps(gleif).encode()), mock.patch.object(ci.time, "sleep"):
            fiches = ci.fiches_gleif({LEI_AMUNDI, LEI_ISHARES})
        annuaire = [
            ["E", 0, 0, "iShares Core MSCI World UCITS ETF", "", "", "", "IE00B4L5Y983", "", "IE", "", "", "USD", 1, 1],
            ["E", 0, 0, "iShares Core MSCI World UCITS ETF (Dist)", "", "", "", "IE00BKBF6H24", "", "IE", "", "", "EUR", 1, 1],
            ["N", 4321, 0, "GAM STAR ABSOLUTE RETURN MACRO", "GAM", "", "", "", "", "IE", "", "", "", 0, 1],
            ["N", 4322, 0, "Fonds avec ISIN", "", "", "", "LU0000000001", "", "LU", "", "", "", 0, 1],
            ["G", 7, 7, "Fonds français", "", "", "", "", "", "FR", "", "", "", 0, 1],
        ]
        lei_de = {"IE00B4L5Y983": LEI_ISHARES, "IE00BKBF6H24": LEI_ISHARES, "LU0000000001": LEI_AMUNDI}
        noms_lei, fonds_n = ru.depuis_annuaire(annuaire, lei_de, fiches)
        self.assertEqual(noms_lei, {LEI_ISHARES: ("iShares Core MSCI World UCITS ETF", "IE"), LEI_AMUNDI: ("Amundi MSCI World Swap", "LU")})
        self.assertEqual(fonds_n, {"N4321": ("GAM STAR ABSOLUTE RETURN MACRO", "IE")})
        lies, restes = ru.rapprocher(self.docs, set(noms_lei), noms_lei, fonds_n)
        self.assertEqual({k: d["id"] for k, d in lies.items()}, {LEI_AMUNDI: "2731132", LEI_ISHARES: "2836341", "N4321": "90728"})
        self.assertEqual([d["id"] for d in restes], ["2103246"])


class LectureDuRegistre(unittest.TestCase):
    """registre_esma lit le registre par pages (réseau simulé : aucune requête réelle)."""

    def reponses(self, total, par_page):
        """Faux serveur : renvoie les pages d'un registre de `total` fiches et note les requêtes."""
        self.requetes = []

        def telecharger(url, *args, **kwargs):
            params = dict(urllib.parse.parse_qsl(urllib.parse.urlsplit(url).query))
            self.requetes.append(params)
            debut = int(params["start"])
            return json.dumps({"response": {"numFound": total, "start": debut,
                                            "docs": [{"id": str(n)} for n in range(debut, min(debut + int(params["rows"]), total))]}}).encode()
        return telecharger

    def lire(self, total, **kwargs):
        with mock.patch.object(ci, "telecharger", self.reponses(total, kwargs.get("par_page", 5000))), \
                mock.patch.object(ci.time, "sleep") as pause, mock.patch("builtins.print"):
            return ci.registre_esma(**kwargs), pause

    def test_pages_successives(self):
        docs, pause = self.lire(12, par_page=5)
        self.assertEqual([d["id"] for d in docs], [str(n) for n in range(12)])
        self.assertEqual([r["start"] for r in self.requetes], ["0", "5", "10"])
        self.assertEqual(pause.call_args_list, [mock.call(0.5), mock.call(0.5)])   # 0,5 s entre deux requêtes, pas après la dernière

    def test_requete(self):
        self.lire(3)
        r = self.requetes[0]
        self.assertEqual((r["q"], r["rows"], r["wt"], r["sort"]), ("type_s:parent AND funds_status_code:ACTV", "5000", "json", "id asc"))
        self.assertEqual(r["fl"].split(","), ci.CHAMPS_ESMA)
        self.assertEqual(len(self.requetes), 1)

    def test_page_unique(self):
        docs, _ = self.lire(100, par_page=1, pages=1)
        self.assertEqual([d["id"] for d in docs], ["0"])
        self.assertEqual(len(self.requetes), 1)

    def test_champs(self):
        self.assertEqual(len(ci.CHAMPS_ESMA), len(set(ci.CHAMPS_ESMA)))
        self.assertTrue({"id", "funds_lei", "funds_national_name", "funds_legal_framework_name", "funds_manager_nat_name",
                         "funds_manager_comp_cou_code", "funds_ca_cou_code", "funds_domicile_cou_code", "funds_host_country_codes",
                         "funds_status_code"} <= set(ci.CHAMPS_ESMA))


class Ecriture(Base):
    def test_ecrire_registres_ue(self):
        lignes = ru.lignes_registres(self.restes, ci.joli)
        infos = ru.infos_registres(self.restes, {}, {}, {})
        with tempfile.TemporaryDirectory() as dossier:
            ci.ecrire_registres_ue(lignes, infos, "2026-10-11", dossier)
            zone = (Path(dossier) / "annuaire-registres-ue.js").read_text(encoding="utf-8")
            fichier_infos = (Path(dossier) / "registres-ue-infos.js").read_text(encoding="utf-8")
        for texte in (zone, fichier_infos):
            self.assertTrue(texte.startswith("/* Généré par scripts/construire_identite.py — ne pas modifier à la main."))
            self.assertIn("ESMA", texte)
            self.assertTrue(texte.endswith(";\n"))
        m = re.search(r'ANNUAIRE_ZONES\["registres-ue"\] = (.*);\n$', zone, re.S)
        self.assertEqual(json.loads(m.group(1)), {"maj": "2026-10-11", "lignes": lignes})
        m = re.search(r"const REGISTRES_UE_INFOS = (.*);\n$", fichier_infos, re.S)
        self.assertEqual(json.loads(m.group(1)), infos)
        self.assertEqual(list(json.loads(m.group(1))), ["90728", "2103246"])   # par numéro croissant


if __name__ == "__main__":
    unittest.main()
