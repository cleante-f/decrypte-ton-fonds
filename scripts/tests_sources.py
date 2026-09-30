#!/usr/bin/env python3
"""
Tests des sources de données : chaque test appelle la VRAIE API et vérifie que les champs utilisés existent toujours.
    python3 scripts/tests_sources.py
Une source à clé est ignorée (et signalée) quand sa clé n'est pas définie (variable d'environnement ou fichier .env).
Le dernier test vérifie, sans réseau, le repli : secours, puis dernière valeur connue.
"""
import unittest
from datetime import date

from sources import change_bce, change_currencyapi, change_frankfurter, marches_alphavantage, marches_amf
from sources.commun import DEVISES, SourceIndisponible, cle_api


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

    @unittest.skipUnless(cle_definie("ALPHAVANTAGE_KEY"), "clé ALPHAVANTAGE_KEY absente")
    def test_alphavantage(self):
        self.verifier(marches_alphavantage, "USD")


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


if __name__ == "__main__":
    unittest.main(verbosity=2)
