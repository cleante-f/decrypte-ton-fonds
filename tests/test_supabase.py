"""
Tests de la base Supabase (RLS, quota de 3 simulations, abonnement, concurrence) contre le projet de TEST.
    python3 -m unittest tests/test_supabase.py -v
Crée des comptes jetables (…@example.com) avec la clé secrète du .env, et les supprime à la fin.
"""
import json
import secrets
import sys
import threading
import unittest
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
from sonder_supabase import config_publique, entetes  # noqa: E402
from sources.commun import cle_api  # noqa: E402

C = config_publique()
SECRET = cle_api("SUPABASE_SECRET_KEY")
# Jeton factice accepté par la clé secrète de TEST de Turnstile (1x000…AA) configurée dans Supabase
CAPTCHA_TEST = "XXXX.DUMMY.TOKEN.XXXX"


def http(chemin, methode="GET", corps=None, cle=None, jeton=None, prefer=None):
    h = entetes(cle or C["publique"])
    if jeton:
        h["Authorization"] = "Bearer " + jeton
    if prefer:
        h["Prefer"] = prefer
    req = urllib.request.Request(C["url"] + chemin, method=methode, headers=h,
                                 data=None if corps is None else json.dumps(corps).encode())
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            brut = r.read()
            return r.status, json.loads(brut) if brut else None
    except urllib.error.HTTPError as e:
        brut = e.read()
        return e.code, json.loads(brut) if brut else None


def creer_compte(confirme=True):
    email = f"test-{secrets.token_hex(6)}@example.com"
    mdp = secrets.token_urlsafe(16)
    s, u = http("/auth/v1/admin/users", "POST", {"email": email, "password": mdp, "email_confirm": confirme,
                                                  "user_metadata": {"majeur": True, "cgv_version": "2026-10"}}, cle=SECRET)
    assert s in (200, 201), (s, u)
    jeton = None
    if confirme:
        s, t = http("/auth/v1/token?grant_type=password", "POST", {"email": email, "password": mdp,
                                                                     "gotrue_meta_security": {"captcha_token": CAPTCHA_TEST}})
        assert s == 200, (s, t)
        jeton = t["access_token"]
    return {"id": u["id"], "email": email, "jeton": jeton}


def rpc(nom, compte, corps=None):
    return http(f"/rest/v1/rpc/{nom}", "POST", corps or {}, jeton=compte["jeton"])


def admin_profil(id_, champs):
    s, _ = http(f"/rest/v1/profils?id=eq.{id_}", "PATCH", champs, cle=SECRET, prefer="return=minimal")
    assert s == 204, s


class TestBase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.a, cls.b = creer_compte(), creer_compte()
        cls.comptes = [cls.a, cls.b]

    @classmethod
    def tearDownClass(cls):
        for c in cls.comptes:
            http(f"/auth/v1/admin/users/{c['id']}", "DELETE", cle=SECRET)

    def nouveau(self, confirme=True):
        c = creer_compte(confirme)
        self.comptes.append(c)
        return c

    def test_profil_cree_avec_consentements(self):
        c = self.nouveau()   # compte neuf : les autres tests consomment des simulations sur A
        s, lignes = http("/rest/v1/profils?select=*", jeton=c["jeton"])
        self.assertEqual(s, 200)
        self.assertEqual(len(lignes), 1)                      # A ne voit que son profil
        self.assertEqual(lignes[0]["offertes_utilisees"], 0)
        self.assertIsNotNone(lignes[0]["majeur_confirme_le"])
        self.assertEqual(lignes[0]["cgv_version"], "2026-10")

    def test_quota_de_trois_puis_refus_et_compteur_monotone(self):
        c = self.nouveau()
        s, d = rpc("droit_acces", c)
        self.assertEqual((s, d["offertes_restantes"], d["acces"], d["abonne"]), (200, 3, True, False))
        for i in range(3):
            s, _ = rpc("demarrer_simulation", c, {"p_fonds": "FR0011871128", "p_nom": f"Essai {i}"})
            self.assertEqual(s, 200)
        s, err = rpc("demarrer_simulation", c, {"p_fonds": "FR0011871128", "p_nom": "Quatrième"})
        self.assertEqual((s, err["message"]), (400, "quota_atteint"))
        s, d = rpc("droit_acces", c)
        self.assertEqual((d["offertes_restantes"], d["nb_simulations"], d["acces"]), (0, 3, True))
        s, _ = http("/rest/v1/simulations?fonds=eq.FR0011871128", "DELETE", jeton=c["jeton"], prefer="return=minimal")
        self.assertEqual(s, 204)
        s, d = rpc("droit_acces", c)
        self.assertEqual((d["offertes_restantes"], d["nb_simulations"], d["acces"]), (0, 0, False))   # pas de crédit regagné

    def test_un_compte_ne_voit_ni_ne_touche_les_simulations_d_un_autre(self):
        s, id_b = rpc("demarrer_simulation", self.b, {"p_fonds": "LU1681043599", "p_nom": "De B"})
        self.assertEqual(s, 200)
        s, lignes = http(f"/rest/v1/simulations?id=eq.{id_b}&select=*", jeton=self.a["jeton"])
        self.assertEqual(lignes, [])
        http(f"/rest/v1/simulations?id=eq.{id_b}", "PATCH", {"nom": "Piraté"}, jeton=self.a["jeton"], prefer="return=minimal")
        http(f"/rest/v1/simulations?id=eq.{id_b}", "DELETE", jeton=self.a["jeton"], prefer="return=minimal")
        s, lignes = http(f"/rest/v1/simulations?id=eq.{id_b}&select=nom", cle=SECRET)
        self.assertEqual(lignes, [{"nom": "De B"}])

    def test_le_navigateur_ne_peut_ni_tricher_ni_inserer(self):
        s, _ = http(f"/rest/v1/profils?id=eq.{self.a['id']}", "PATCH", {"offertes_utilisees": 0, "abonnement_statut": "actif"},
                    jeton=self.a["jeton"], prefer="return=minimal")
        self.assertIn(s, (401, 403))
        s, _ = http("/rest/v1/simulations", "POST", {"user_id": self.a["id"], "nom": "x", "fonds": "FR0011871128"},
                    jeton=self.a["jeton"], prefer="return=minimal")
        self.assertIn(s, (401, 403))
        s, id_ = rpc("demarrer_simulation", self.a, {"p_fonds": "FR0010135103", "p_nom": "A"})
        s, _ = http(f"/rest/v1/simulations?id=eq.{id_}", "PATCH", {"offerte": False, "fonds": "FR0011871128"},
                    jeton=self.a["jeton"], prefer="return=minimal")
        self.assertIn(s, (401, 403))

    def test_reglages_limites_a_20_ko(self):
        c = self.nouveau()
        s, id_ = rpc("demarrer_simulation", c, {"p_fonds": "FR0011871128", "p_nom": "Gros"})
        s, err = http(f"/rest/v1/simulations?id=eq.{id_}", "PATCH", {"etat": {"x": "a" * 30000}}, jeton=c["jeton"], prefer="return=minimal")
        self.assertEqual(s, 400)
        s, _ = http(f"/rest/v1/simulations?id=eq.{id_}", "PATCH", {"etat": {"plan": {"capital": 1000}}}, jeton=c["jeton"], prefer="return=minimal")
        self.assertEqual(s, 204)

    def test_abonne_illimite_puis_abonnement_expire(self):
        c = self.nouveau()
        admin_profil(c["id"], {"offertes_utilisees": 3, "abonnement_statut": "actif",
                               "abonnement_fin": (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()})
        s, d = rpc("droit_acces", c)
        self.assertTrue(d["abonne"])
        s, id_ = rpc("demarrer_simulation", c, {"p_fonds": "FR0011871128", "p_nom": "Abonné"})
        self.assertEqual(s, 200)
        s, lignes = http(f"/rest/v1/simulations?id=eq.{id_}&select=offerte", jeton=c["jeton"])
        self.assertEqual(lignes, [{"offerte": False}])
        admin_profil(c["id"], {"abonnement_fin": (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()})
        s, err = rpc("demarrer_simulation", c, {"p_fonds": "FR0011871128", "p_nom": "Expiré"})
        self.assertEqual(err["message"], "quota_atteint")

    def test_deux_lancements_simultanes_ne_consomment_qu_une_simulation(self):
        c = self.nouveau()
        admin_profil(c["id"], {"offertes_utilisees": 2})
        resultats = []
        fils = [threading.Thread(target=lambda: resultats.append(rpc("demarrer_simulation", c, {"p_fonds": "FR0011871128", "p_nom": "Course"})[0]))
                for _ in range(2)]
        for f in fils:
            f.start()
        for f in fils:
            f.join()
        self.assertEqual(sorted(resultats), [200, 400])

    def test_email_non_confirme_refuse(self):
        c = self.nouveau(confirme=False)
        s, jeton = http("/auth/v1/token?grant_type=password", "POST", {"email": c["email"], "password": "x"})
        self.assertNotEqual(s, 200)            # pas de session sans confirmation
        s, err = http("/rest/v1/rpc/demarrer_simulation", "POST", {"p_fonds": "FR0011871128", "p_nom": "x"})
        self.assertIn(s, (400, 401))            # anonyme : refusé

    def test_entretien_reserve_au_role_service(self):
        s, _ = rpc("comptes_a_entretenir", self.a)
        self.assertIn(s, (401, 403, 404))

    def test_entretien_avertit_puis_supprime_un_compte_inactif(self):
        c = self.nouveau(confirme=False)          # jamais connecté : last_sign_in_at vide
        vieux = (datetime.now(timezone.utc) - timedelta(days=740)).isoformat()
        admin_profil(c["id"], {"cree_le": vieux, "derniere_activite": vieux})
        s, lignes = http("/rest/v1/rpc/comptes_a_entretenir", "POST", {}, cle=SECRET)
        self.assertIn({"id": c["id"], "email": c["email"], "action": "avertir"}, lignes)
        admin_profil(c["id"], {"avertissement_inactivite_le": (datetime.now(timezone.utc) - timedelta(days=31)).isoformat()})
        s, lignes = http("/rest/v1/rpc/comptes_a_entretenir", "POST", {}, cle=SECRET)
        self.assertIn({"id": c["id"], "email": c["email"], "action": "supprimer"}, lignes)
        admin_profil(c["id"], {"abonnement_statut": "actif", "abonnement_fin": (datetime.now(timezone.utc) + timedelta(days=5)).isoformat()})
        s, lignes = http("/rest/v1/rpc/comptes_a_entretenir", "POST", {}, cle=SECRET)
        self.assertNotIn(c["id"], [l["id"] for l in lignes])     # un abonné n'est jamais supprimé

if __name__ == "__main__":
    unittest.main()
