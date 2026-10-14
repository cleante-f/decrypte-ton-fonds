#!/usr/bin/env python3
"""
Tests de l'annuaire des fonds, sans réseau :
    python3 scripts/tests_annuaire.py
Un ISIN ne doit ouvrir qu'un seul fonds. Bug du 07/10/2026 : FR0010135103 (Carmignac Patrimoine, fonds français) ouvrait la
fiche du fonds luxembourgeois « CARMIGNAC PORTFOLIO - PATRIMOINE », qui avait reçu cet ISIN par la correspondance des noms
avec FIRDS (étape 4 de construire_annuaire.py).
Le test de js/geco.js utilise Node (ignoré s'il n'est pas installé).
"""
import json
import re
import shutil
import subprocess
import unittest
from pathlib import Path

import construire_annuaire as annuaire

RACINE = Path(__file__).resolve().parent.parent
DONNEES = RACINE / "tests" / "donnees"
NODE = shutil.which("node") or next((p for p in ("/usr/local/bin/node", "/opt/homebrew/bin/node") if Path(p).exists()), None)

FONDS = {
    "G28771": {"s": "G", "n": "CARMIGNAC PATRIMOINE", "i": ["FR0010135103"]},
    "G46289": {"s": "G", "n": "R-CO VALOR", "i": ["FR0011253624"]},
    "N53323": {"s": "N", "n": "CARMIGNAC PORTFOLIO - PATRIMOINE", "i": []},
    "N55167": {"s": "N", "n": "R-CO LUX - R-CO LUX VALOR", "i": []},
    "N62552": {"s": "N", "n": "CARMIGNAC PORTFOLIO - PATRIMOINE EUROPE", "i": []},
}
# Noms de cotation réels dans FIRDS (bourses allemandes), relevés le 07/10/2026, sauf le dernier (inventé pour le test)
COTATIONS = [
    {"isin": "FR0010135103", "gnr_full_name": "Carmignac Patrimoine"},
    {"isin": "FR0011253624", "gnr_full_name": "R-CO VALOR C"},
    {"isin": "LU1744628287", "gnr_full_name": "Carmignac Portfolio Patrimoine Europe A Acc"},
]


class RattachementParLeNom(unittest.TestCase):
    def test_le_cas_reproduit_le_bug(self):
        # sans précaution, la correspondance des noms donne les ISIN des fonds français aux fonds luxembourgeois
        brut = annuaire.correspondances({k: f["n"] for k, f in FONDS.items() if f["s"] == "N"}, COTATIONS)
        self.assertEqual(brut.get("N53323"), ["FR0010135103"])
        self.assertEqual(brut.get("N55167"), ["FR0011253624"])

    def test_isin_d_un_fonds_francais_jamais_rattache_par_le_nom(self):
        par_isin = {i: k for k, f in FONDS.items() if f["s"] == "G" for i in f["i"]}
        res = annuaire.isin_retrouves_par_nom(FONDS, COTATIONS, par_isin)
        self.assertNotIn("N53323", res)
        self.assertNotIn("N55167", res)
        self.assertEqual(res.get("N62552"), ["LU1744628287"], "les autres correspondances doivent rester")


@unittest.skipUnless(NODE, "Node n'est pas installé")
class IndexDuSite(unittest.TestCase):
    """js/geco.js : si un ISIN figure sur plusieurs lignes de l'annuaire, c'est la fiche du fonds français (GECO) qui s'ouvre."""
    G = ["G", 28771, 28771, "CARMIGNAC PATRIMOINE", "CARMIGNAC GESTION", "Fonds mixtes", "FCP", "FR0010135103 FR0010306142",
         "2004-11-08", "FR", "", "", "", 0, 1]
    N = ["N", 53323, 0, "CARMIGNAC PORTFOLIO - PATRIMOINE", "CARMIGNAC GESTION LUXEMBOURG", "", "", "FR0010135103", "2015-05-28",
         "LU", "", "", "", 0, 1]

    def ouvrir(self, lignes, isin):
        code = ("function normaliser(t) { return String(t || '').toLowerCase(); }\n"
                f"const ANNUAIRE = {json.dumps(lignes)};\n"
                + (RACINE / "js" / "geco.js").read_text(encoding="utf-8")
                + f"\nconsole.log(JSON.stringify([annuaireParIsin({json.dumps(isin)}).nom, rechercherAnnuaire({json.dumps(isin)})[0].nom]));\n")
        r = subprocess.run([NODE, "-"], input=code, capture_output=True, text=True, timeout=30)
        self.assertEqual(r.returncode, 0, r.stderr)
        return json.loads(r.stdout)

    def test_le_fonds_francais_l_emporte(self):
        for lignes in ([self.G, self.N], [self.N, self.G]):
            self.assertEqual(self.ouvrir(lignes, "FR0010135103"), ["CARMIGNAC PATRIMOINE"] * 2)


class FondsEtrangersDeGeco(unittest.TestCase):
    """Étape 4 : tous les fonds étrangers vivants de GECO, OPCVM et FIA (extraits réels du 14/10/2026 dans tests/donnees)."""
    def setUp(self):
        self.opcvm, self.fia = json.loads((DONNEES / "geco_non_fr.json").read_text(encoding="utf-8"))["compartmentDtos"]

    def test_opcvm_ouvert_a_tous(self):
        self.assertEqual(annuaire.entree_etrangere(self.opcvm), {
            "s": "N", "c": 60382, "n": "20UGS (UCITS) FUNDS - PINESTONE GLOBAL EQUITY", "g": "KROLL (LUXEMBOURG) MANAGEMENT COMPANY, S.A R.L",
            "pays": "LU", "d": "2018-01-08", "i": [], "tk": [], "pub": True})

    def test_fia_garde_mais_reserve(self):
        e = annuaire.entree_etrangere(self.fia)
        self.assertEqual((e["s"], e["c"], e["n"], e["g"], e["pays"], e["d"], e["pub"]),
                         ("N", 76104, "10X FOUNDERS FUND GMBH & CO. KG", "10X FOUNDERS GMBH", "DE", "2022-10-20", False))
        self.assertEqual(e["t"], "EuVECA", "label EuVECA de GECO")

    def test_type_du_fia_d_apres_les_labels(self):
        self.assertEqual(annuaire.entree_etrangere(dict(self.fia, cmpLblEuveca=0))["t"], "FIA")
        self.assertEqual(annuaire.entree_etrangere(dict(self.fia, cmpLblEuveca=0, cmpLblEltif=1))["t"], "ELTIF")
        self.assertEqual(annuaire.entree_etrangere(dict(self.fia, cmpLblEuveca=0, cmpLblEusef=1))["t"], "EuSEF")

    def test_fonds_qui_n_est_plus_vivant_ecarte(self):
        self.assertIsNone(annuaire.entree_etrangere(dict(self.opcvm, cmpStatutCode="ECL")))
        self.assertIsNone(annuaire.entree_etrangere(dict(self.fia, cmpStatutCode="ECL")))


class SymbolesEuropeens(unittest.TestCase):
    """Symboles boursiers des ETF sur toutes les bourses européennes (réponse réelle d'OpenFIGI du 14/10/2026), sans ceux des
    plateformes qui ajoutent un suffixe de devise ou de segment (« CSPXCZK », « CSSPXM »…) ni ceux d'Amérique ou d'Asie."""
    def setUp(self):
        self.figi = json.loads((DONNEES / "openfigi.json").read_text(encoding="utf-8"))

    def test_bourses_europeennes_seulement(self):
        cspx, cw8 = (annuaire.symboles_europeens(r.get("data", [])) for r in self.figi["reponse"])
        self.assertEqual(cspx, ["CSP1", "CSPX", "CSSPX", "EX05", "SXR8"])   # Londres, Amsterdam, Suisse, Vienne, Allemagne
        self.assertEqual(cw8, ["AM76", "AMEW", "AMEX", "CW8", "CW8E"])      # Paris, Milan, Allemagne, Vienne, Suisse

    def test_isin_inconnu(self):
        self.assertEqual(annuaire.symboles_europeens([]), [])

    def test_tous_les_etf_et_seulement_eux(self):
        fonds = {"EIE00B5BMR087": {"s": "E", "i": ["IE00B5BMR087"], "tk": ["SXR8"], "etf": True},
                 "G1": {"s": "G", "i": ["FR0010315770", "FR0010315771"], "tk": [], "etf": True},
                 "ULU0000000001": {"s": "U", "i": ["LU0000000001"], "tk": []},
                 "N5": {"s": "N", "i": [], "tk": []}}
        self.assertEqual(annuaire.isins_etf(fonds), ["FR0010315770", "FR0010315771", "IE00B5BMR087"])
        annuaire.ajouter_symboles(fonds, {"IE00B5BMR087": ["CSPX", "SXR8"], "FR0010315770": ["CW8"], "FR0010315771": []})
        self.assertEqual(fonds["EIE00B5BMR087"]["tk"], ["CSPX", "SXR8"])
        self.assertEqual(fonds["G1"]["tk"], ["CW8"])
        self.assertEqual(fonds["ULU0000000001"]["tk"], [])


class ResumeAccueil(unittest.TestCase):
    """data/resume.js compte tous les fonds du site : annuaire européen et zones (SEC, registre ESMA), quel que soit le script lancé."""
    def test_total_avec_les_zones(self):
        import tempfile
        with tempfile.TemporaryDirectory() as d:
            d = Path(d)
            (d / "annuaire.js").write_text('const ANNUAIRE_DATE = "2026-10-14";\nconst ANNUAIRE = [["G",1,1,"A"],["E",0,0,"B"],["N",2,0,"C"],["U",0,0,"D"]];\n', encoding="utf-8")
            (d / "annuaire-etats-unis.js").write_text('/* x */\nANNUAIRE_ZONES["etats-unis"] = {"maj":"2026-10-14","lignes":[["S",1],["S",2],["S",3]]};\n', encoding="utf-8")
            (d / "annuaire-registres-ue.js").write_text('ANNUAIRE_ZONES["registres-ue"] = {"maj":"2026-10-14","lignes":[["R",5],["R",6]]};\n', encoding="utf-8")
            annuaire.ecrire_resume(d)
            r = json.loads(re.search(r"const RESUME_ANNUAIRE = (.*);", (d / "resume.js").read_text(encoding="utf-8")).group(1))
            self.assertEqual((r["total"], r["francais"], r["etf"], r["etrangers"], r["europe"], r["etats_unis"], r["registres_ue"], r["date"]),
                             (9, 1, 1, 1, 1, 3, 2, "2026-10-14"))
            (d / "annuaire-registres-ue.js").unlink()   # zone absente : comptée zéro
            annuaire.ecrire_resume(d)
            self.assertIn('"total": 7', (d / "resume.js").read_text(encoding="utf-8"))


class DonneesPubliees(unittest.TestCase):
    def test_isin_des_fonds_francais_sur_une_seule_fiche(self):
        texte = (RACINE / "data" / "annuaire.js").read_text(encoding="utf-8")
        lignes = json.loads(re.search(r"^const ANNUAIRE = (\[.*\]);$", texte, re.M).group(1))
        francais = {i for l in lignes if l[0] == "G" for i in l[7].split()}
        partages = sorted(francais & {i for l in lignes if l[0] != "G" for i in l[7].split()})
        self.assertEqual(partages, [], "ISIN de fonds français rattachés aussi à un autre fonds : relancer construire_annuaire.py")


if __name__ == "__main__":
    unittest.main(verbosity=2)
