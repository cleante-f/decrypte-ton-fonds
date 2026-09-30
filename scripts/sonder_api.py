#!/usr/bin/env python3
"""
Sonde les API à clé AVANT d'écrire (ou de modifier) leur module : pour chacune, affiche le code de réponse
et la structure réelle (noms des champs, types, un exemple tronqué). La clé n'est jamais affichée.
    python3 scripts/sonder_api.py
Les clés viennent des variables d'environnement ou du fichier .env (voir .env.example).
"""
import json
import urllib.error
import urllib.request

from sources.commun import AGENT, SourceIndisponible, cle_api

APPELS = [
    # les appels exacts des modules (voir scripts/sources/)
    ("NewsData.io", "NEWSDATA_KEY", "https://newsdata.io/api/1/latest?apikey={cle}&qInTitle=ASML&language=en,fr"),
    ("MarketAux", "MARKETAUX_KEY", "https://api.marketaux.com/v1/news/all?api_token={cle}&symbols=ASML&filter_entities=true&language=en,fr&limit=3"),
    ("Alpha Vantage (quotidien)", "ALPHAVANTAGE_KEY", "https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=SPY&outputsize=compact&apikey={cle}"),
]


def structure(x, retrait="  ", profondeur=0):
    if profondeur > 4:
        return ["…"]
    if isinstance(x, dict):
        lignes = []
        for k, v in list(x.items())[:25]:
            if isinstance(v, (dict, list)):
                lignes.append(f"{retrait}{k}: {type(v).__name__} ({len(v)})")
                lignes += structure(v, retrait + "  ", profondeur + 1)
            else:
                lignes.append(f"{retrait}{k}: {type(v).__name__} = {str(v)[:80]!r}")
        return lignes
    if isinstance(x, list) and x:
        return [f"{retrait}[0] ↓"] + structure(x[0], retrait + "  ", profondeur + 1)
    return []


for nom, variable, modele in APPELS:
    print(f"\n=== {nom}")
    try:
        cle = cle_api(variable)
    except SourceIndisponible as e:
        print(f"  ignoré : {e}")
        continue
    req = urllib.request.Request(modele.format(cle=cle), headers={"User-Agent": AGENT, "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=8) as r:
            code, corps = r.status, r.read()
    except urllib.error.HTTPError as e:
        code, corps = e.code, e.read()
    except Exception as e:
        print(f"  pas de réponse ({type(e).__name__})")
        continue
    print(f"  HTTP {code}, {len(corps)} octets")
    try:
        print("\n".join(structure(json.loads(corps))).replace(cle, "***"))
    except json.JSONDecodeError:
        print("  réponse non JSON :", corps[:200].decode("utf-8", "replace").replace(cle, "***"))
