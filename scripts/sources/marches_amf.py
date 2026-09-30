"""
Marchés du jour d'après les valeurs liquidatives de fonds indiciels français (source principale, sans clé).
Base GECO de l'AMF, déjà utilisée par tout le site. Appels testés : /funds/compartment/c{cmpId}/shares
puis /funds/chart/{idInterne}?startDate=AAAA-MM-JJ → {"x": ["JJ/MM/AAAA", …], "y": [valeurs]}.
Les valeurs sont en euros : pour les marchés hors zone euro, elles incluent l'effet du change.
"""
import json
from datetime import date, timedelta

from actualiser_contexte import GECO, annuaire_par_isin, nettoyer_historique
from sources.commun import SourceIndisponible, appeler, variations

NOM = "AMF – base GECO (fonds indiciels)"
LIEN = "https://geco.amf-france.org"
MENTION = "Marchés : valeurs liquidatives de fonds indiciels, en euros (AMF – GECO)"

# clé (mêmes clés que les expositions du simulateur), marché, indice suivi, fonds indiciel de référence
INDICES = [
    ("usa", "Actions américaines", "S&P 500", "FR0011871128"),
    ("tech", "Grandes valeurs technologiques américaines", "Nasdaq-100", "FR0011871110"),
    ("euro", "Actions de la zone euro", "Euro Stoxx 50", "FR0012739431"),
    ("europe", "Actions européennes hors zone euro", "MSCI Europe hors UEM", "FR0010821819"),
    ("japon", "Actions japonaises", "Topix", "FR0010245514"),
    ("emergents", "Actions des pays émergents", "MSCI Emerging Markets", "FR0010429068"),
    ("monde", "Actions des pays développés", "MSCI World", "FR0010315770"),
]


def historique(ligne, isin, depuis):
    parts = json.loads(appeler(f"{GECO}/funds/compartment/c{ligne[1]}/shares"))
    part = next((p for p in parts if p.get("isin") == isin), None)
    if not part:
        raise SourceIndisponible(f"part {isin} introuvable")
    h = json.loads(appeler(f"{GECO}/funds/chart/{part['idInterne']}?startDate={depuis}"))
    dates = [date(int(d[6:10]), int(d[3:5]), int(d[0:2])) for d in h.get("x") or []]
    return list(zip(dates, nettoyer_historique(dates, list(h.get("y") or []))))


def recuperer():
    annuaire = annuaire_par_isin()
    depuis = (date.today() - timedelta(days=400)).isoformat()
    indices, erreurs = {}, []
    for cle, marche, indice, isin in INDICES:
        try:
            ligne = annuaire[isin]
            indices[cle] = {"nom": marche, "indice": indice, **variations(historique(ligne, isin, depuis)),
                            "ref": {"code": isin, "nom": ligne[3], "lien": f"https://geco.amf-france.org/produit-d-epargne/c{ligne[1]}"}}
        except (SourceIndisponible, KeyError, ValueError, json.JSONDecodeError) as e:
            erreurs.append(f"{indice} : {e}")
    if len(indices) < 5:
        raise SourceIndisponible(f"seulement {len(indices)} marchés sur {len(INDICES)} ({' ; '.join(erreurs)})")
    return {"devise": "EUR", "indices": indices}
