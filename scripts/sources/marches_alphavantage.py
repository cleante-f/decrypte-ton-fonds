"""
Alpha Vantage (secours des marchés, clé gratuite ALPHAVANTAGE_KEY : 25 requêtes par jour, appels à espacer).
Appels testés le 30/09/2026 avec la clé :
  TIME_SERIES_DAILY (outputsize=compact) → {"Time Series (Daily)": {"AAAA-MM-JJ": {"4. close": "…"}}}, 100 derniers jours ;
  TIME_SERIES_WEEKLY → {"Weekly Time Series": {…}}, tout l'historique (outputsize=full est réservé aux offres payantes).
Sans cours dans la réponse (limite atteinte, appels trop rapprochés…), Alpha Vantage répond 200 avec un champ
"Information" : c'est traité comme une panne. 2 appels par marché, soit 12 par mise à jour (seulement si l'AMF tombe).
Les symboles sont des fonds indiciels cotés aux États-Unis : les valeurs sont en dollars.
"""
import time
from datetime import date

from sources.commun import SourceIndisponible, appeler_json, cle_api, variations

NOM = "Alpha Vantage"
LIEN = "https://www.alphavantage.co"
MENTION = "Marchés : Alpha Vantage (fonds indiciels cotés aux États-Unis, en dollars)"

# clé, marché, indice suivi, symbole du fonds indiciel américain qui le réplique
INDICES = [
    ("usa", "Actions américaines", "S&P 500", "SPY"),
    ("tech", "Grandes valeurs technologiques américaines", "Nasdaq-100", "QQQ"),
    ("euro", "Actions de la zone euro", "Euro Stoxx 50", "FEZ"),
    ("japon", "Actions japonaises", "MSCI Japan", "EWJ"),
    ("emergents", "Actions des pays émergents", "MSCI Emerging Markets", "EEM"),
    ("monde", "Actions des pays développés", "MSCI World", "URTH"),
]


PAUSE = 13  # secondes entre deux appels (l'offre gratuite demande d'espacer les requêtes)


def cours(fonction, champ, symbole, cle, options=""):
    r = appeler_json(f"https://www.alphavantage.co/query?function={fonction}&symbol={symbole}{options}&apikey={cle}")
    serie = r.get(champ)
    if not serie:
        raise SourceIndisponible(str(r.get("Information") or "réponse sans cours").replace(cle, "***")[:160])
    return sorted((date.fromisoformat(d), float(v["4. close"])) for d, v in serie.items())


def recuperer():
    cle = cle_api("ALPHAVANTAGE_KEY")
    indices = {}
    for i, (code, marche, indice, symbole) in enumerate(INDICES):
        if i:
            time.sleep(PAUSE)
        jours = cours("TIME_SERIES_DAILY", "Time Series (Daily)", symbole, cle, "&outputsize=compact")       # 100 derniers jours : 1 jour, 1 mois
        time.sleep(PAUSE)
        semaines = cours("TIME_SERIES_WEEKLY", "Weekly Time Series", symbole, cle)   # plus ancien : 1er janvier, 1 an
        points = [p for p in semaines if p[0] < jours[0][0]] + jours
        indices[code] = {"nom": marche, "indice": indice, **variations(points),
                         "ref": {"code": symbole, "nom": f"Fonds indiciel {symbole} (États-Unis)", "lien": LIEN}}
    return {"devise": "USD", "indices": indices}
