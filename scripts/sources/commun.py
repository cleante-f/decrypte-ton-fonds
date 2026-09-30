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
    """La source n'a pas fourni de données utilisables : on passe à la suivante.
    attente : secondes demandées par la source avant de réessayer (réponse 429 avec l'en-tête Retry-After), sinon None."""
    attente = None


def appeler(url, entetes=None, donnees=None, delai=DELAI):
    """Contenu brut de la réponse. Les messages d'erreur ne reprennent jamais l'adresse (elle peut contenir une clé)."""
    req = urllib.request.Request(url, data=donnees, headers={
        "User-Agent": AGENT, "Accept": "application/json, text/csv;q=0.9, */*;q=0.5", **(entetes or {})})
    try:
        with urllib.request.urlopen(req, timeout=delai) as r:
            return r.read()
    except urllib.error.HTTPError as e:
        erreur = SourceIndisponible(f"erreur HTTP {e.code}")
        if e.code == 429:   # trop de requêtes : la source indique combien de temps attendre
            try:
                erreur.attente = min(300, int(e.headers.get("Retry-After") or 60))
            except ValueError:
                erreur.attente = 60
        raise erreur from None
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


def actualites_par_entreprise(articles_de, complement=None, max_complements=0, pause=1.0):
    """
    Appelle articles_de(cle) pour chaque entreprise suivie et garde les articles utiles (filtres de entreprises.py).
    complement(cle) : seconde recherche, seulement pour les entreprises restées sans article, au plus max_complements fois
    (pour rester sous le plafond de requêtes de la source). Au-delà d'une panne sur deux, la source est jugée indisponible.
    """
    import re
    import time
    from sources.entreprises import ARTICLES_PAR_ENTREPRISE, BRUIT, CASSE_EXACTE, ENTREPRISES, SOURCES_BRUIT

    def reparer(texte):
        """Titres mal décodés par la source (« aprÃ¨s » au lieu de « après ») : on retrouve le texte d'origine."""
        if re.search("Ã[\x80-\xbf]|â€", texte):
            for codage in ("cp1252", "latin-1"):
                try:
                    return texte.encode(codage).decode("utf-8")
                except UnicodeError:
                    continue
        return texte

    def utiles(cle, articles, deja=()):
        vus, garde = {a["titre"].lower() for a in deja}, list(deja)
        for a in sorted(articles, key=lambda a: a["date"], reverse=True):
            titre = reparer(" ".join(a["titre"].split()))
            if (not titre or not a["lien"].startswith("http") or titre.lower() in vus or re.search(BRUIT, titre, re.I)
                    or re.search(SOURCES_BRUIT, a["source"], re.I) or (cle in CASSE_EXACTE and not re.search(CASSE_EXACTE[cle], titre))):
                continue
            vus.add(titre.lower())
            garde.append({**a, "titre": titre})
        return garde[:ARTICLES_PAR_ENTREPRISE]

    def avec_une_attente(appel, cle):
        """Si la source dit « trop de requêtes », on attend le délai qu'elle indique, une seule fois par mise à jour."""
        try:
            return appel(cle)
        except SourceIndisponible as e:
            if not e.attente or etat["attendu"]:
                raise
            etat["attendu"] = True
            print(f"  plafond de requêtes atteint : pause de {e.attente} s demandée par la source")
            time.sleep(e.attente)
            return appel(cle)

    res, pannes, appels, etat = {}, [], 0, {"attendu": False}
    for cle, (nom, _, _, repere) in ENTREPRISES.items():
        if appels:
            time.sleep(pause)
        appels += 1
        try:
            res[cle] = {"nom": nom, "repere": repere, "articles": utiles(cle, avec_une_attente(articles_de, cle))}
        except (SourceIndisponible, KeyError, TypeError, ValueError) as e:
            pannes.append(f"{nom} : {e if isinstance(e, SourceIndisponible) else 'format inattendu'}")
    if len(pannes) > len(ENTREPRISES) / 2:
        raise SourceIndisponible(f"{len(pannes)} entreprises sur {len(ENTREPRISES)} en échec ({pannes[0]}…)")
    if complement:
        for cle in [c for c, e in res.items() if not e["articles"]][:max_complements]:
            time.sleep(pause)
            try:
                res[cle]["articles"] = utiles(cle, avec_une_attente(complement, cle), res[cle]["articles"])
            except (SourceIndisponible, KeyError, TypeError, ValueError):
                pass   # le complément est facultatif
    return {"entreprises": res}
