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
        with mock.patch.object(ci, "telecharger", return_value=self.brut) as t, mock.patch.object(ci.time, "sleep"):
            self.assertEqual(ci.commercialisation(leis), {"5493003BFED2MWDBYH64"})
        self.assertEqual(t.call_count, 3)
        self.assertTrue(t.call_args_list[0].args[0].startswith(ci.ESMA_CBDIF + "?"))
        self.assertIn("funds_host_country_codes", t.call_args_list[0].args[0])


if __name__ == "__main__":
    unittest.main()
