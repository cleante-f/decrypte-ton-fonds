"""
Currency-api de fawazahmed0 (dernier recours, sans clé, domaine public CC0) : source indépendante de la BCE.
Appels testés : …/currency-api@latest/v1/currencies/eur.min.json et …@AAAA-MM-JJ/… → {"date", "eur": {"usd": …}}.
Le projet demande d'utiliser son miroir Cloudflare si jsDelivr ne répond pas.
"""
from datetime import date, timedelta

from sources.commun import DEVISES, SourceIndisponible, appeler_json, taux_un_an

NOM = "Currency-api (fawazahmed0)"
LIEN = "https://github.com/fawazahmed0/exchange-api"
MENTION = "Taux de change : Currency-api (fawazahmed0), source de secours"


def jour(version):
    for url in (f"https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@{version}/v1/currencies/eur.min.json",
                f"https://{version}.currency-api.pages.dev/v1/currencies/eur.min.json"):
        try:
            r = appeler_json(url)
            return date.fromisoformat(r["date"]), r["eur"]
        except (SourceIndisponible, KeyError, TypeError, ValueError):
            continue
    raise SourceIndisponible(f"aucun des deux miroirs n'a répondu ({version})")


def recuperer():
    d, dernier = jour("latest")
    d1, avant = jour((d - timedelta(days=365)).isoformat())
    taux = {dev: taux_un_an([(d1, float(avant[dev.lower()])), (d, float(dernier[dev.lower()]))])
            for dev in DEVISES if dev.lower() in dernier and dev.lower() in avant}
    return {"date": d.isoformat(), "taux": taux}
