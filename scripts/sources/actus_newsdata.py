"""
NewsData.io (actualités, source principale, clé gratuite NEWSDATA_KEY : 200 crédits par jour, décalage de 12 h).
Appel testé le 30/09/2026 : /api/1/latest?qInTitle=ASML&language=en,fr → {"status": "success", "results": [{"title",
"link", "source_name", "pubDate": "AAAA-MM-JJ HH:MM:SS", "pubDateTZ": "UTC", "language": "english"}, …]}.
Plafond lu dans les en-têtes le 30/09/2026 : X-RateLimit-Limit = 60 requêtes par fenêtre (les 429 comptent), Retry-After
en secondes, X-API-Limit-Remaining = crédits restants du jour. Sur une réponse 429, on attend Retry-After une fois (commun.py).
Une mise à jour fait donc au plus 28 requêtes : la catégorie « business » pour chaque entreprise suivie
(&category=business, la plus pertinente), puis la recherche générale pour au plus 5 entreprises restées sans article.
"""
import urllib.parse

from sources.commun import SourceIndisponible, actualites_par_entreprise, appeler_json, cle_api
from sources.entreprises import ENTREPRISES

NOM = "NewsData.io"
LIEN = "https://newsdata.io"
MENTION = "Actualités : NewsData.io"
LANGUES = {"english": "en", "french": "fr"}


def recuperer():
    cle = cle_api("NEWSDATA_KEY")

    def recherche(mot, options=""):
        r = appeler_json(f"https://newsdata.io/api/1/latest?apikey={cle}&qInTitle={mot}&language=en,fr{options}")
        if r.get("status") != "success":
            raise SourceIndisponible("réponse en erreur")
        return [{"titre": a["title"] or "", "lien": a["link"] or "", "source": a.get("source_name") or "",
                 "date": a["pubDate"][:16].replace(" ", "T") + "Z", "langue": LANGUES.get(a.get("language"), a.get("language"))}
                for a in r["results"]]

    mot = lambda entreprise: urllib.parse.quote(ENTREPRISES[entreprise][1])
    return actualites_par_entreprise(lambda e: recherche(mot(e), "&category=business"), complement=lambda e: recherche(mot(e)),
                                     max_complements=5)
