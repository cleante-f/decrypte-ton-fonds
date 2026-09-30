"""
Taux de change de référence de la Banque centrale européenne (source principale, sans clé).
Appel testé : EXR/D.USD+GBP+JPY+CHF+CNY.EUR.SP00.A au format CSV → colonnes CURRENCY, TIME_PERIOD, OBS_VALUE.
"""
import csv
import io
from datetime import date, timedelta

from sources.commun import DEVISES, SourceIndisponible, appeler, taux_un_an

NOM = "Banque centrale européenne"
LIEN = "https://data.ecb.europa.eu/data/datasets/EXR"
MENTION = "Taux de change : Banque centrale européenne (taux de référence)"


def recuperer():
    debut = (date.today() - timedelta(days=400)).isoformat()
    texte = appeler(f"https://data-api.ecb.europa.eu/service/data/EXR/D.{'+'.join(DEVISES)}.EUR.SP00.A"
                    f"?format=csvdata&detail=dataonly&startPeriod={debut}").decode("utf-8")
    series = {}
    for ligne in csv.DictReader(io.StringIO(texte)):
        if ligne.get("OBS_VALUE"):
            series.setdefault(ligne["CURRENCY"], []).append((date.fromisoformat(ligne["TIME_PERIOD"]), float(ligne["OBS_VALUE"])))
    if not series:
        raise SourceIndisponible("aucun taux dans la réponse")
    taux = {dev: taux_un_an(sorted(series[dev])) for dev in DEVISES if series.get(dev)}
    return {"date": max(t["date"] for t in taux.values()), "taux": taux}
