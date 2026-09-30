"""
Frankfurter (secours, sans clé, usage commercial autorisé) : taux de la BCE servis par une autre infrastructure.
Appels testés : /v2/providers/ecb/rates?base=EUR&quotes=… (dernier jour) et &date=AAAA-MM-JJ (un an avant)
→ liste de {date, base, quote, rate}.
"""
from datetime import date, timedelta

from sources.commun import DEVISES, SourceIndisponible, appeler_json, taux_un_an

NOM = "Frankfurter (taux de la BCE)"
LIEN = "https://frankfurter.dev"
MENTION = "Taux de change : Banque centrale européenne, via Frankfurter"
ADRESSE = "https://api.frankfurter.dev/v2/providers/ecb/rates?base=EUR&quotes=" + ",".join(DEVISES)


def lire(reponse):
    if not isinstance(reponse, list) or not reponse:
        raise SourceIndisponible("réponse vide")
    return {x["quote"]: (date.fromisoformat(x["date"]), float(x["rate"])) for x in reponse}


def recuperer():
    dernier = lire(appeler_json(ADRESSE))
    jour = max(d for d, _ in dernier.values())
    avant = lire(appeler_json(f"{ADRESSE}&date={(jour - timedelta(days=365)).isoformat()}"))
    taux = {dev: taux_un_an(sorted([avant[dev], dernier[dev]])) for dev in DEVISES if dev in dernier and dev in avant}
    return {"date": jour.isoformat(), "taux": taux}
