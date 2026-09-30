"""
Outils communs aux modules de sources (un fichier par API dans ce dossier).

Chaque module expose :
  NOM, LIEN, MENTION      le nom de la source, un lien vers elle, la mention à afficher sous la donnée
  recuperer()             les données au format commun du bloc (voir scripts/actualiser_marches.py),
                          ou lève SourceIndisponible (réseau, erreur HTTP, réponse inattendue, clé absente)

Les clés d'API ne sont jamais écrites dans le code : elles viennent des variables d'environnement
(secrets GitHub Actions) ou, pour un essai sur ton ordinateur, du fichier .env à la racine (ignoré par Git).
"""
import calendar
import json
import os
import urllib.error
import urllib.request
from datetime import date, timedelta
from pathlib import Path

RACINE = Path(__file__).resolve().parents[2]
AGENT = "Mozilla/5.0 (compatible; decrypte-ton-fonds/1.0; +https://cleante-f.github.io/decrypte-ton-fonds/)"
DELAI = 8  # secondes au maximum par appel


class SourceIndisponible(Exception):
    """La source n'a pas fourni de données utilisables : on passe à la suivante."""


def appeler(url, entetes=None, donnees=None, delai=DELAI):
    """Contenu brut de la réponse. Les messages d'erreur ne reprennent jamais l'adresse (elle peut contenir une clé)."""
    req = urllib.request.Request(url, data=donnees, headers={
        "User-Agent": AGENT, "Accept": "application/json, text/csv;q=0.9, */*;q=0.5", **(entetes or {})})
    try:
        with urllib.request.urlopen(req, timeout=delai) as r:
            return r.read()
    except urllib.error.HTTPError as e:
        raise SourceIndisponible(f"erreur HTTP {e.code}") from None
    except Exception as e:  # délai dépassé, réseau, DNS…
        raise SourceIndisponible(f"pas de réponse ({type(e).__name__})") from None


def appeler_json(url, **options):
    try:
        return json.loads(appeler(url, **options))
    except json.JSONDecodeError:
        raise SourceIndisponible("réponse illisible (JSON attendu)") from None


def cle_api(nom):
    """Clé lue dans l'environnement, sinon dans le fichier .env local. Absente : la source est simplement sautée."""
    valeur = os.environ.get(nom, "").strip()
    fichier = RACINE / ".env"
    if not valeur and fichier.exists():
        for ligne in fichier.read_text(encoding="utf-8").splitlines():
            if ligne.strip().startswith(nom + "="):
                valeur = ligne.split("=", 1)[1].strip().strip("\"'")
    if not valeur:
        raise SourceIndisponible(f"clé {nom} absente")
    return valeur


# ---------- Variations d'une série quotidienne [(date, valeur), …] triée ----------

def valeur_au(points, jour):
    """Dernière valeur connue à cette date ou avant (week-ends et jours fériés)."""
    avant = [(d, v) for d, v in points if d <= jour]
    return avant[-1] if avant else (None, None)


def variation(maintenant, avant):
    return None if not avant or maintenant is None else round((maintenant / avant - 1) * 100, 2)


def variations(points):
    """Dernière valeur et variations en % : 1 jour, 1 mois, depuis le 1er janvier, 1 an."""
    if len(points) < 2:
        raise SourceIndisponible("historique trop court")
    d, v = points[-1]
    a, m = (d.year - 1, 12) if d.month == 1 else (d.year, d.month - 1)
    mois = date(a, m, min(d.day, calendar.monthrange(a, m)[1]))   # même jour du mois précédent (31/03 → 28 ou 29/02)
    return {
        "date": d.isoformat(), "valeur": round(v, 4),
        "j1": variation(v, points[-2][1]),
        "m1": variation(v, valeur_au(points, mois)[1]),
        "debutAnnee": variation(v, valeur_au(points, date(d.year - 1, 12, 31))[1]),
        "a1": variation(v, valeur_au(points, d - timedelta(days=365))[1]),
    }


# Devises suivies : celles des grandes zones où investissent les fonds (dollar, livre, franc suisse, yen, yuan)
DEVISES = ["USD", "GBP", "CHF", "JPY", "CNY"]


def taux_un_an(points):
    """Taux du dernier jour et d'environ un an avant : {valeur, date, unAn, dateUnAn}."""
    d, v = points[-1]
    d1, v1 = valeur_au(points, d - timedelta(days=365))
    return {"valeur": round(v, 5), "date": d.isoformat(), "unAn": None if v1 is None else round(v1, 5),
            "dateUnAn": None if d1 is None else d1.isoformat()}
