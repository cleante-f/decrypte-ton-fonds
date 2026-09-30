"""
MarketAux (actualités, secours, clé gratuite MARKETAUX_KEY : 100 requêtes par jour, 3 articles par requête ;
usage non commercial sans accord de leur part).
Appel testé le 30/09/2026 : /v1/news/all?symbols=ASML&filter_entities=true&language=en,fr&limit=3
→ {"meta": {…}, "data": [{"title", "url", "source", "published_at": "AAAA-MM-JJTHH:MM:SS.000000Z", "language": "en",
"entities": [{"symbol", "name"}]}]}. Un appel par entreprise suivie.
"""
from sources.commun import actualites_par_entreprise, appeler_json, cle_api
from sources.entreprises import ENTREPRISES

NOM = "MarketAux"
LIEN = "https://www.marketaux.com"
MENTION = "Actualités : MarketAux"


def recuperer():
    cle = cle_api("MARKETAUX_KEY")

    def articles_de(entreprise):
        symboles = ",".join(ENTREPRISES[entreprise][2])
        r = appeler_json(f"https://api.marketaux.com/v1/news/all?api_token={cle}&symbols={symboles}&filter_entities=true&language=en,fr&limit=3")
        return [{"titre": a["title"] or "", "lien": a["url"] or "", "source": a.get("source") or "",
                 "date": a["published_at"][:16] + "Z", "langue": a.get("language")} for a in r["data"]]

    return actualites_par_entreprise(articles_de)
