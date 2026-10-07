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


class DonneesPubliees(unittest.TestCase):
    def test_isin_des_fonds_francais_sur_une_seule_fiche(self):
        texte = (RACINE / "data" / "annuaire.js").read_text(encoding="utf-8")
        lignes = json.loads(re.search(r"^const ANNUAIRE = (\[.*\]);$", texte, re.M).group(1))
        francais = {i for l in lignes if l[0] == "G" for i in l[7].split()}
        partages = sorted(francais & {i for l in lignes if l[0] != "G" for i in l[7].split()})
        self.assertEqual(partages, [], "ISIN de fonds français rattachés aussi à un autre fonds : relancer construire_annuaire.py")


if __name__ == "__main__":
    unittest.main(verbosity=2)
