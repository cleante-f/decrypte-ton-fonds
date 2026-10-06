import json
import re
import sys
import tempfile
import unittest
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


if __name__ == "__main__":
    unittest.main()
