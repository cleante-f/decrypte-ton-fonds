"""
Alpha Vantage (secours des marchés, clé gratuite ALPHAVANTAGE_KEY, 25 requêtes par jour).
Appel testé avec la clé de démonstration : function=TIME_SERIES_DAILY → {"Time Series (Daily)": {"AAAA-MM-JJ": {"4. close": "…"}}}.
Sans cours dans la réponse (clé de démo, limite atteinte…), Alpha Vantage répond 200 avec un champ "Information" :
c'est traité comme une panne.
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


def serie(symbole, cle):
    message = "réponse sans cours"
    for taille in ("full", "compact"):   # l'historique complet peut être réservé aux offres payantes
        r = appeler_json(f"https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol={symbole}&outputsize={taille}&apikey={cle}")
        jours = r.get("Time Series (Daily)")
        if jours:
            return sorted((date.fromisoformat(d), float(v["4. close"])) for d, v in jours.items())
        message = str(r.get("Information") or message).replace(cle, "***")
    raise SourceIndisponible(message[:160])


def recuperer():
    cle = cle_api("ALPHAVANTAGE_KEY")
    indices = {}
    for i, (code, marche, indice, symbole) in enumerate(INDICES):
        if i:
            time.sleep(1.5)   # l'offre gratuite limite aussi le nombre d'appels par seconde
        indices[code] = {"nom": marche, "indice": indice, **variations(serie(symbole, cle)),
                         "ref": {"code": symbole, "nom": f"Fonds indiciel {symbole} (États-Unis)", "lien": LIEN}}
    return {"devise": "USD", "indices": indices}
