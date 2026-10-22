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


# Refus observés sur le projet de test (PostgREST) : droits ou RLS → code Postgres 42501, 403 si connecté, 401 si anonyme
REFUS_CONNECTE = (403, "42501")
REFUS_ANONYME = (401, "42501")


def suivre(compte, cles, prefer="return=minimal"):
    corps = [{"user_id": compte["id"], "cle_fonds": c} for c in cles]
    return http("/rest/v1/fonds_suivis", "POST", corps, jeton=compte["jeton"], prefer=prefer)


class TestSuiviAlertes(unittest.TestCase):
    """Fonds suivis, préférences d'alertes et état des fonds (migration 20261022000000_suivi_alertes.sql)."""

    @classmethod
    def setUpClass(cls):
        cls.a, cls.b = creer_compte(), creer_compte()
        cls.comptes = [cls.a, cls.b]
        cls.cles_etat = []

    @classmethod
    def tearDownClass(cls):
        for c in cls.comptes:
            http(f"/auth/v1/admin/users/{c['id']}", "DELETE", cle=SECRET)
        for cle in cls.cles_etat:
            http(f"/rest/v1/etat_fonds_suivis?cle_fonds=eq.{cle}", "DELETE", cle=SECRET, prefer="return=minimal")

    def nouveau(self):
        c = creer_compte()
        self.comptes.append(c)
        return c

    def test_chacun_ne_voit_et_ne_modifie_que_ses_fonds_suivis(self):
        s, _ = suivre(self.a, ["FR0011871128"])
        self.assertEqual(s, 201)
        s, lignes = http("/rest/v1/fonds_suivis?select=user_id,cle_fonds", jeton=self.a["jeton"])
        self.assertEqual((s, lignes), (200, [{"user_id": self.a["id"], "cle_fonds": "FR0011871128"}]))
        s, lignes = http("/rest/v1/fonds_suivis?select=cle_fonds", jeton=self.b["jeton"])
        self.assertEqual(lignes, [])                                    # B ne voit pas les fonds de A
        s, err = http("/rest/v1/fonds_suivis", "POST", {"user_id": self.a["id"], "cle_fonds": "LU1681043599"},
                      jeton=self.b["jeton"], prefer="return=minimal")
        self.assertEqual((s, err["code"]), REFUS_CONNECTE)                                    # B ne peut pas ajouter un fonds au nom de A
        http(f"/rest/v1/fonds_suivis?user_id=eq.{self.a['id']}", "PATCH", {"cle_fonds": "PIRATE"},
             jeton=self.b["jeton"], prefer="return=minimal")
        http(f"/rest/v1/fonds_suivis?user_id=eq.{self.a['id']}", "DELETE", jeton=self.b["jeton"], prefer="return=minimal")
        s, lignes = http(f"/rest/v1/fonds_suivis?user_id=eq.{self.a['id']}&select=cle_fonds", cle=SECRET)
        self.assertEqual(lignes, [{"cle_fonds": "FR0011871128"}])        # intact
        s, _ = http("/rest/v1/fonds_suivis?cle_fonds=eq.FR0011871128", "DELETE", jeton=self.a["jeton"], prefer="return=minimal")
        self.assertEqual(s, 204)
        s, lignes = http(f"/rest/v1/fonds_suivis?user_id=eq.{self.a['id']}&select=cle_fonds", cle=SECRET)
        self.assertEqual(lignes, [])                                    # A peut retirer son fonds

    def test_utilisateur_par_defaut_et_date_d_ajout_imposee(self):
        c = self.nouveau()
        s, _ = http("/rest/v1/fonds_suivis", "POST", {"cle_fonds": "S000000123"}, jeton=c["jeton"], prefer="return=minimal")
        self.assertEqual(s, 201)                                        # user_id = auth.uid() par défaut
        s, lignes = http("/rest/v1/fonds_suivis?select=user_id,cle_fonds", jeton=c["jeton"])
        self.assertEqual(lignes, [{"user_id": c["id"], "cle_fonds": "S000000123"}])
        s, _ = http("/rest/v1/fonds_suivis", "POST", {"cle_fonds": "FR0010135103", "ajoute_le": "2000-01-01T00:00:00Z"},
                    jeton=c["jeton"], prefer="return=minimal")
        self.assertEqual(s, REFUS_CONNECTE[0])                          # ajoute_le n'est pas modifiable par le navigateur

    def test_preferences_ses_lignes_seulement(self):
        s, _ = http("/rest/v1/preferences_alertes", "POST", {"user_id": self.a["id"], "seuil_baisse": 10},
                    jeton=self.a["jeton"], prefer="return=minimal")
        self.assertEqual(s, 201)
        s, lignes = http("/rest/v1/preferences_alertes?select=*", jeton=self.a["jeton"])
        self.assertEqual(len(lignes), 1)
        self.assertEqual({k: lignes[0][k] for k in ("actives", "nouveau_dic", "frais", "risque", "seuil_baisse", "reglages_fiche")},
                         {"actives": True, "nouveau_dic": True, "frais": True, "risque": True, "seuil_baisse": 10, "reglages_fiche": {}})
        s, lignes = http("/rest/v1/preferences_alertes?select=*", jeton=self.b["jeton"])
        self.assertEqual(lignes, [])                                    # B ne voit pas les préférences de A
        s, err = http("/rest/v1/preferences_alertes", "POST", {"user_id": self.a["id"]}, jeton=self.b["jeton"], prefer="return=minimal")
        self.assertEqual((s, err["code"]), REFUS_CONNECTE)                                    # ni ne les crée au nom de A
        http(f"/rest/v1/preferences_alertes?user_id=eq.{self.a['id']}", "PATCH", {"actives": False},
             jeton=self.b["jeton"], prefer="return=minimal")
        http(f"/rest/v1/preferences_alertes?user_id=eq.{self.a['id']}", "DELETE", jeton=self.b["jeton"], prefer="return=minimal")
        s, lignes = http(f"/rest/v1/preferences_alertes?user_id=eq.{self.a['id']}&select=actives", cle=SECRET)
        self.assertEqual(lignes, [{"actives": True}])                   # intactes
        s, _ = http(f"/rest/v1/preferences_alertes?user_id=eq.{self.a['id']}", "PATCH",
                    {"actives": False, "seuil_baisse": None, "reglages_fiche": {"concentration": 30}},
                    jeton=self.a["jeton"], prefer="return=minimal")
        self.assertEqual(s, 204)
        s, lignes = http(f"/rest/v1/preferences_alertes?user_id=eq.{self.a['id']}&select=actives,seuil_baisse,reglages_fiche", cle=SECRET)
        self.assertEqual(lignes, [{"actives": False, "seuil_baisse": None, "reglages_fiche": {"concentration": 30}}])

    def test_seuil_de_baisse_invalide_refuse(self):
        c = self.nouveau()
        for seuil in (15, 0, -10, 100):
            s, err = http("/rest/v1/preferences_alertes", "POST", {"user_id": c["id"], "seuil_baisse": seuil},
                          jeton=c["jeton"], prefer="return=minimal")
            self.assertEqual((s, err["code"]), (400, "23514"), seuil)     # contrainte check
        for seuil, statut in ((5, 201), (20, 200)):                    # création puis mise à jour (upsert)
            s, _ = http("/rest/v1/preferences_alertes", "POST", {"user_id": c["id"], "seuil_baisse": seuil},
                        jeton=c["jeton"], prefer="return=minimal,resolution=merge-duplicates")
            self.assertEqual(s, statut, seuil)
        s, err = http(f"/rest/v1/preferences_alertes?user_id=eq.{c['id']}", "PATCH", {"seuil_baisse": 7},
                      jeton=c["jeton"], prefer="return=minimal")
        self.assertEqual((s, err["code"]), (400, "23514"))
        s, lignes = http(f"/rest/v1/preferences_alertes?user_id=eq.{c['id']}&select=seuil_baisse", cle=SECRET)
        self.assertEqual(lignes, [{"seuil_baisse": 20}])

    def test_trente_fonds_au_plus(self):
        c = self.nouveau()
        cles = [f"FR{i:010d}" for i in range(30)]
        s, _ = suivre(c, cles)
        self.assertEqual(s, 201)
        s, err = suivre(c, ["LU1681043599"])
        self.assertEqual((s, err["message"]), (400, "limite_fonds_suivis"))
        s, _ = suivre(c, [cles[0]], prefer="return=minimal,resolution=ignore-duplicates")
        self.assertEqual(s, 201)                                        # re-suivre un fonds déjà suivi : pas une 31e ligne
        s, lignes = http(f"/rest/v1/fonds_suivis?user_id=eq.{c['id']}&select=cle_fonds", cle=SECRET)
        self.assertEqual(len(lignes), 30)
        http(f"/rest/v1/fonds_suivis?cle_fonds=eq.{cles[0]}", "DELETE", jeton=c["jeton"], prefer="return=minimal")
        s, _ = suivre(c, ["LU1681043599"])
        self.assertEqual(s, 201)                                        # une place libérée : l'ajout repasse

    def test_ajout_au_nom_d_un_autre_ne_revele_pas_sa_limite(self):
        c, intrus = self.nouveau(), self.nouveau()
        self.assertEqual(suivre(c, [f"FR{i:010d}" for i in range(30)])[0], 201)
        for cle in ("FR0000000000", "LU1681043599"):                    # fonds déjà suivi par c, puis un nouveau
            s, err = http("/rest/v1/fonds_suivis", "POST", {"user_id": c["id"], "cle_fonds": cle},
                          jeton=intrus["jeton"], prefer="return=minimal")
            self.assertEqual((s, err["code"]), REFUS_CONNECTE, cle)                    # jamais 400 « limite_fonds_suivis » ni 409 (doublon)
        s, lignes = http(f"/rest/v1/fonds_suivis?user_id=eq.{c['id']}&select=cle_fonds", cle=SECRET)
        self.assertEqual(len(lignes), 30)

    def test_on_ne_peut_pas_donner_sa_ligne_a_un_autre(self):
        c = self.nouveau()
        self.assertEqual(suivre(c, ["FR0011871128"])[0], 201)
        s, _ = http("/rest/v1/preferences_alertes", "POST", {"user_id": c["id"]}, jeton=c["jeton"], prefer="return=minimal")
        self.assertEqual(s, 201)
        for table in ("fonds_suivis", "preferences_alertes"):
            s, err = http(f"/rest/v1/{table}?user_id=eq.{c['id']}", "PATCH", {"user_id": self.a["id"]},
                          jeton=c["jeton"], prefer="return=minimal")
            self.assertEqual((s, err["code"]), REFUS_CONNECTE, table)
            s, lignes = http(f"/rest/v1/{table}?user_id=eq.{c['id']}&select=user_id", cle=SECRET)
            self.assertEqual(lignes, [{"user_id": c["id"]}], table)    # ligne inchangée

    def test_cle_de_fonds_en_majuscules(self):
        c = self.nouveau()
        s, err = suivre(c, ["fr0011871128"])
        self.assertEqual((s, err["code"]), (400, "23514"))
        s, _ = suivre(c, ["FR0011871128"])
        self.assertEqual(s, 201)

    def test_trente_et_un_fonds_d_un_coup_refuses(self):
        c = self.nouveau()
        s, err = suivre(c, [f"FR{i:010d}" for i in range(31)])
        self.assertEqual((s, err["message"]), (400, "limite_fonds_suivis"))
        s, lignes = http(f"/rest/v1/fonds_suivis?user_id=eq.{c['id']}&select=cle_fonds", cle=SECRET)
        self.assertEqual(lignes, [])                                    # tout ou rien

    def test_etat_des_fonds_reserve_a_la_cle_service(self):
        cle = "ZZTEST" + secrets.token_hex(4).upper()
        s, _ = http("/rest/v1/etat_fonds_suivis", "POST", {"cle_fonds": cle, "date_dic": "2026-10-01", "frais": 0.5, "sri": 4},
                    cle=SECRET, prefer="return=minimal")
        self.assertEqual(s, 201)                                        # la tâche quotidienne (clé service) écrit
        self.cles_etat.append(cle)
        for qui, refus in (({"jeton": self.a["jeton"]}, REFUS_CONNECTE), ({}, REFUS_ANONYME)):     # connecté puis anonyme
            for methode, chemin, corps in (("GET", f"?cle_fonds=eq.{cle}&select=*", None), ("POST", "", {"cle_fonds": cle + "X"}),
                                           ("PATCH", f"?cle_fonds=eq.{cle}", {"sri": 7}), ("DELETE", f"?cle_fonds=eq.{cle}", None)):
                s, err = http("/rest/v1/etat_fonds_suivis" + chemin, methode, corps, prefer="return=minimal", **qui)
                self.assertEqual((s, err["code"]), refus, (methode, list(qui)))
        s, lignes = http(f"/rest/v1/etat_fonds_suivis?cle_fonds=eq.{cle}&select=sri", cle=SECRET)
        self.assertEqual(lignes, [{"sri": 4}])

    def test_anonyme_ne_lit_ni_n_ecrit_rien(self):
        c_ = self.nouveau()                     # compte neuf : les autres tests écrivent pour A
        corps = {"fonds_suivis": {"user_id": c_["id"], "cle_fonds": "FR0011871128"},
                 "preferences_alertes": {"user_id": c_["id"], "seuil_baisse": 10}}
        for table in ("fonds_suivis", "preferences_alertes"):
            for methode, chemin, c in (("GET", "?select=*", None), ("POST", "", corps[table]),
                                       ("PATCH", f"?user_id=eq.{c_['id']}", {"user_id": c_["id"]}),
                                       ("DELETE", f"?user_id=eq.{c_['id']}", None)):
                s, err = http(f"/rest/v1/{table}{chemin}", methode, c, prefer="return=minimal")
                self.assertEqual((s, err["code"]), REFUS_ANONYME, (table, methode))
            s, lignes = http(f"/rest/v1/{table}?user_id=eq.{c_['id']}&select=user_id", cle=SECRET)
            self.assertEqual(lignes, [], table)                             # rien écrit au nom de ce compte

    def test_adresse_lue_par_l_api_d_administration(self):
        # scripts/alertes.mjs (lireEmail) lit l'adresse d'un titulaire par GET /auth/v1/admin/users/<id> avec la clé service :
        # champ « email » ; un compte inconnu (supprimé entre-temps) répond 404
        s, u = http(f"/auth/v1/admin/users/{self.a['id']}", cle=SECRET)
        self.assertEqual(s, 200)
        self.assertEqual(u["email"], self.a["email"])
        s, _ = http("/auth/v1/admin/users/00000000-0000-4000-8000-000000000000", cle=SECRET)
        self.assertEqual(s, 404)

    def test_suppression_du_compte_efface_fonds_suivis_et_preferences(self):
        c = creer_compte()                     # supprimé dans le test lui-même
        self.assertEqual(suivre(c, ["FR0011871128", "LU1681043599"])[0], 201)
        s, _ = http("/rest/v1/preferences_alertes", "POST", {"user_id": c["id"], "seuil_baisse": 5}, jeton=c["jeton"], prefer="return=minimal")
        self.assertEqual(s, 201)
        s, _ = http(f"/auth/v1/admin/users/{c['id']}", "DELETE", cle=SECRET)
        self.assertEqual(s, 200)
        for table in ("profils?id", "fonds_suivis?user_id", "preferences_alertes?user_id"):
            s, lignes = http(f"/rest/v1/{table}=eq.{c['id']}&select=*", cle=SECRET)
            self.assertEqual((s, lignes), (200, []), table)


if __name__ == "__main__":
    unittest.main()
