#!/usr/bin/env python3
"""
Tests des sources de données : chaque test appelle la VRAIE API et vérifie que les champs utilisés existent toujours.
    python3 scripts/tests_sources.py
Une source à clé est ignorée (et signalée) quand sa clé n'est pas définie (variable d'environnement ou fichier .env).
Le dernier test vérifie, sans réseau, le repli : secours, puis dernière valeur connue.
"""
import unittest
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
