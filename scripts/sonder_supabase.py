"""
Sonde Supabase : affiche les champs réels des réponses avant d'écrire du code qui les utilise (règle du projet).
    python3 scripts/sonder_supabase.py
Lit l'URL et la clé publique dans js/config-compte.js, et la clé secrète dans .env (SUPABASE_SECRET_KEY). N'affiche aucune clé.
"""
import json
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

RACINE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
from sources.commun import cle_api  # noqa: E402


def config_publique():
    texte = (RACINE / "js" / "config-compte.js").read_text(encoding="utf-8")
    valeur = lambda nom: re.search(rf'{nom}:\s*"([^"]*)"', texte).group(1)
    return {"url": valeur("supabaseUrl").rstrip("/"), "publique": valeur("supabaseCle")}


def entetes(cle):
    h = {"apikey": cle, "Content-Type": "application/json"}
    if cle.count(".") == 2:          # ancienne clé au format JWT : aussi dans Authorization
        h["Authorization"] = "Bearer " + cle
    return h


def appeler(url, cle, methode="GET", corps=None):
    req = urllib.request.Request(url, method=methode, headers=entetes(cle),
                                 data=None if corps is None else json.dumps(corps).encode())
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status, json.loads(r.read() or b"null")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"null")


def main():
    c = config_publique()
    if "[[" in c["url"] or "[[" in c["publique"]:
        sys.exit("Remplis d'abord supabaseUrl et supabaseCle dans js/config-compte.js")
    statut, r = appeler(c["url"] + "/auth/v1/settings", c["publique"])
    print("GET /auth/v1/settings", statut, "→ champs :", sorted(r) if isinstance(r, dict) else r)
    print("  mailer_autoconfirm =", r.get("mailer_autoconfirm"), "· disable_signup =", r.get("disable_signup"))
    statut, r = appeler(c["url"] + "/auth/v1/token?grant_type=password", c["publique"], "POST",
                        {"email": "personne@example.com", "password": "faux-mot-de-passe"})
    print("POST /token (identifiants faux)", statut, "→", r)
    secret = cle_api("SUPABASE_SECRET_KEY")
    statut, r = appeler(c["url"] + "/auth/v1/admin/users?per_page=1", secret)
    print("GET /admin/users", statut, "→ champs :", sorted(r) if isinstance(r, dict) else type(r).__name__)


if __name__ == "__main__":
    main()
