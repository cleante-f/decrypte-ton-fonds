#!/usr/bin/env python3
"""
Met à jour data/marches.js : taux de change, marchés du jour et actualités des grandes entreprises détenues par les fonds,
lus par la fiche Décryptage et le simulateur.

Lancé chaque jour par GitHub Actions (.github/workflows/contexte.yml), ou à la main :
    python3 scripts/actualiser_marches.py            respecte le cache (une source n'est pas rappelée avant 6 h)
    python3 scripts/actualiser_marches.py --forcer   rappelle toutes les sources

Pour chaque bloc, les sources sont essayées dans l'ordre (un module par source dans scripts/sources/) :
la principale, puis les secours. Si toutes tombent, on garde la dernière valeur connue, avec sa date et un message.
Format commun d'un bloc, quelle que soit la source :
    {"etat": "frais" | "secours" | "ancien" | "indisponible", "source", "lien", "mention", "maj", "tentative", "message", …données}
    change  : {"date", "taux": {"USD": {"valeur", "date", "unAn", "dateUnAn"}, …}}          (1 euro = valeur devise)
    marches : {"devise", "indices": {"usa": {"nom", "indice", "date", "valeur", "j1", "m1", "debutAnnee", "a1", "ref"}, …}}
    actus   : {"entreprises": {"nvidia": {"nom", "repere", "articles": [{"titre", "lien", "source", "date", "langue"}]}, …}}
"""
import json
import sys
from datetime import datetime, timedelta, timezone

from sources import actus_newsdata, change_bce, change_currencyapi, change_frankfurter, marches_amf
from sources.commun import RACINE, SourceIndisponible

SORTIE = RACINE / "data" / "marches.js"
FORMAT = "%Y-%m-%dT%H:%MZ"

# bloc : (sources par ordre de préférence, durée du cache en heures, contrôle minimal des données)
# Cache de 6 h : évite de rappeler les API lors d'un lancement manuel, sans bloquer la mise à jour quotidienne suivante.
BLOCS = {
    "change": ([change_bce, change_frankfurter, change_currencyapi], 6, lambda d: "USD" in d["taux"] and len(d["taux"]) >= 3),
    # marchés : pas de source de secours autorisée (la licence gratuite d'Alpha Vantage exclut un site public, vérifié le 01/10/2026) ;
    # si l'AMF ne répond pas, la dernière valeur connue reste affichée avec sa date
    "marches": ([marches_amf], 6, lambda d: len(d["indices"]) >= 4),
    # actualités : au moins une entreprise sur deux avec un article (sinon la source est jugée défaillante)
    "actus": ([actus_newsdata], 6,
              lambda d: sum(1 for e in d["entreprises"].values() if e["articles"]) >= len(d["entreprises"]) / 2),
}


def maintenant():
    return datetime.now(timezone.utc)


def lire_precedent():
    if not SORTIE.exists():
        return {}
    t = SORTIE.read_text(encoding="utf-8")
    try:
        return json.loads(t[t.index("{"):t.rindex("}") + 1])
    except ValueError:
        return {}


def age(bloc):
    return maintenant() - datetime.strptime(bloc["maj"], FORMAT).replace(tzinfo=timezone.utc)


def mettre_a_jour(nom, sources, cache_heures, complet, ancien, forcer):
    if ancien and not forcer and ancien.get("etat") in ("frais", "secours") and age(ancien) < timedelta(hours=cache_heures):
        print(f"  {nom} : données de moins de {cache_heures} h gardées (cache)")
        return ancien
    for rang, module in enumerate(sources):
        try:
            donnees = module.recuperer()
            if not complet(donnees):
                raise SourceIndisponible("réponse incomplète")
        except (SourceIndisponible, KeyError, ValueError, TypeError, IndexError) as e:
            print(f"  ! {nom} : {module.NOM} : {e if isinstance(e, SourceIndisponible) else 'format de réponse inattendu'}", file=sys.stderr)
            continue
        print(f"  {nom} : {module.NOM}{' (secours)' if rang else ''}")
        heure = maintenant().strftime(FORMAT)
        return {"etat": "secours" if rang else "frais", "source": module.NOM, "lien": module.LIEN, "mention": module.MENTION,
                "maj": heure, "tentative": heure, "message": None, **donnees}
    # Toutes les sources sont tombées : dernière valeur connue, avec sa date
    tentative = maintenant()
    if ancien and ancien.get("etat") != "indisponible":
        maj = datetime.strptime(ancien["maj"], FORMAT)
        return {**ancien, "etat": "ancien", "tentative": tentative.strftime(FORMAT),
                "message": f"Les sources n'ont pas répondu le {tentative:%d/%m/%Y} : voici les dernières valeurs connues, du {maj:%d/%m/%Y}."}
    return {"etat": "indisponible", "maj": None, "tentative": tentative.strftime(FORMAT),
            "message": "Données momentanément indisponibles : aucune source n'a répondu."}


def main():
    forcer = "--forcer" in sys.argv
    precedent = lire_precedent()
    blocs = {}
    for nom, (sources, cache_heures, complet) in BLOCS.items():
        print(f"{nom}…")
        blocs[nom] = mettre_a_jour(nom, sources, cache_heures, complet, precedent.get(nom), forcer)
    if all(blocs[n] == precedent.get(n) for n in blocs):
        print("Rien de nouveau : data/marches.js non modifié.")
        return
    SORTIE.write_text(
        "/* Généré automatiquement par scripts/actualiser_marches.py — ne pas modifier à la main.\n"
        " * Taux de change, marchés du jour et actualités d'entreprises. Chaque bloc indique sa source, sa date et son état. */\n"
        f"const MARCHES = {json.dumps({'maj': maintenant().strftime(FORMAT), **blocs}, ensure_ascii=False, separators=(',', ':'))};\n",
        encoding="utf-8")
    print(f"OK → {SORTIE.relative_to(RACINE)}")


if __name__ == "__main__":
    main()
