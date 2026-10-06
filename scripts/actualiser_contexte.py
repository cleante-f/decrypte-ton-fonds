#!/usr/bin/env python3
"""
Met à jour data/contexte.js : le contexte économique et l'actualité utilisés par le simulateur.

Lancé automatiquement chaque jour par GitHub Actions (.github/workflows/contexte.yml),
et utilisable à la main :  python3 scripts/actualiser_contexte.py

Ce que le script récupère (sources publiques et gratuites, bibliothèque standard uniquement) :
  - Banque centrale européenne : taux directeur, €STR, taux d'État, inflation, anticipations d'inflation,
    chômage, croissance, dette publique, taux de change, indicateur de stress financier
  - FMI (World Economic Outlook) : croissance, inflation et dette publique par grande région, prévisions comprises
  - États-Unis : taux de la Fed (Réserve fédérale de New York), taux à 10 ans (Trésor), inflation et chômage (BLS)
  - Titres d'actualité récents de médias reconnus et d'institutions (flux RSS), classés par thème
  - data/references.js : séries des fonds de référence (base GECO de l'AMF), pour alléger le travail des visiteurs

Rien n'est interprété ni inventé : chaque valeur garde sa date, sa source et un lien.
"""
import csv
import email.utils
import gzip
import html
import io
import json
import re
import sys
import time
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from xml.etree import ElementTree

RACINE = Path(__file__).resolve().parent.parent
SORTIE = RACINE / "data" / "contexte.js"
AGENT = "Mozilla/5.0 (compatible; decrypte-ton-fonds/1.0; +https://cleante-f.github.io/decrypte-ton-fonds/)"
BCE = "https://data-api.ecb.europa.eu/service/data/"
AUJOURDHUI = date.today()


def telecharger(url, delai=45, essais=3):
    for essai in range(essais):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": AGENT, "Accept-Encoding": "gzip"})
            with urllib.request.urlopen(req, timeout=delai) as r:
                brut = r.read()
                if r.headers.get("Content-Encoding") == "gzip" or brut[:2] == b"\x1f\x8b":
                    brut = gzip.decompress(brut)
                return brut
        except Exception as e:  # réseau capricieux : on réessaie
            if essai == essais - 1:
                raise
            time.sleep(3 * (essai + 1))


# ---------------------------------------------------------------------------
# Indicateurs
# ---------------------------------------------------------------------------

def lire_serie_bce(texte):
    """Analyse le CSV de l'API de la BCE : liste de (période, valeur), lignes sans valeur ignorées."""
    lignes = list(csv.DictReader(io.StringIO(texte)))
    return [(l["TIME_PERIOD"], float(l["OBS_VALUE"])) for l in lignes if l.get("OBS_VALUE") not in (None, "")]


def serie_bce(cle, debut):
    texte = telecharger(f"{BCE}{cle}?format=csvdata&detail=dataonly&startPeriod={debut}").decode("utf-8")
    return lire_serie_bce(texte)


def mensualiser(points):
    """Garde la dernière valeur de chaque mois (pour les séries quotidiennes)."""
    par_mois = {}
    for d, v in points:
        par_mois[d[:7]] = v
    return sorted(par_mois.items())


def il_y_a_un_an(points, derniere_date):
    """Valeur la plus proche d'un an avant la dernière date (même format de date)."""
    if re.match(r"^\d{4}-Q\d$", derniere_date):
        cible = f"{int(derniere_date[:4]) - 1}{derniere_date[4:]}"
    elif re.match(r"^\d{4}-\d{2}$", derniere_date):
        cible = f"{int(derniere_date[:4]) - 1}{derniere_date[4:]}"
    else:
        cible = str(date.fromisoformat(derniere_date) - timedelta(days=365))
    avant = [v for d, v in points if d <= cible]
    return avant[-1] if avant else None


def indicateur(nom, points, source, lien, frequence, unite="%", decimales=2, quotidienne=False, **autres):
    if not points:
        return None
    derniere_date, valeur = points[-1]
    serie = mensualiser(points) if quotidienne else points
    return {
        "nom": nom, "valeur": round(valeur, decimales), "unite": unite, "date": derniere_date,
        "unAn": None if il_y_a_un_an(points, derniere_date) is None else round(il_y_a_un_an(points, derniere_date), decimales),
        "serie": [[d, round(v, decimales)] for d, v in serie[-36:]],
        "frequence": frequence, "source": source, "lien": lien, **autres,
    }


def lien_bce(cle):
    jeu = cle.split("/")[0]
    return f"https://data.ecb.europa.eu/data/datasets/{jeu}/{cle.replace('/', '.')}"


INDICATEURS_BCE = [
    # clé, nom, clé BCE, fréquence, quotidienne ?, zone
    ("bce_depot", "Taux de dépôt de la BCE (taux directeur)", "FM/B.U2.EUR.4F.KR.DFR.LEV", "décision", True, "Zone euro"),
    ("estr", "€STR (taux du marché monétaire au jour le jour)", "EST/B.EU000A2X2A25.WT", "quotidienne", True, "Zone euro"),
    ("livrets_fr", "Taux moyen des livrets d'épargne (France, ménages)", "MIR/M.FR.B.L23.D.R.A.2250.EUR.N", "mensuelle", False, "France"),
    ("taux3_euro", "Taux d'État à 3 ans (zone euro, AAA)", "YC/B.U2.EUR.4F.G_N_C.SV_C_YM.SR_3Y", "quotidienne", True, "Zone euro"),
    ("taux10_euro", "Taux d'État à 10 ans (zone euro, AAA)", "YC/B.U2.EUR.4F.G_N_C.SV_C_YM.SR_10Y", "quotidienne", True, "Zone euro"),
    ("inflation_euro", "Inflation (zone euro, sur un an)", "HICP/M.U2.N.000000.4D0.ANR", "mensuelle", False, "Zone euro"),
    ("inflation_fr", "Inflation (France, indice harmonisé, sur un an)", "HICP/M.FR.N.000000.4D0.ANR", "mensuelle", False, "France"),
    ("inflation_sous_jacente", "Inflation sous-jacente (hors énergie et alimentation, zone euro)", "HICP/M.U2.N.XEF000.4D0.ANR", "mensuelle", False, "Zone euro"),
    ("inflation_energie", "Prix de l'énergie pour les ménages (zone euro, sur un an)", "HICP/M.U2.N.NRGY00.4D0.ANR", "mensuelle", False, "Zone euro"),
    ("anticipations_inflation", "Inflation attendue à long terme par les prévisionnistes (enquête BCE)", "SPF/Q.U2.HICP.POINT.LT.Q.AVG", "trimestrielle", False, "Zone euro"),
    ("chomage_euro", "Taux de chômage (zone euro)", "LFSI/M.I9.S.UNEHRT.TOTAL0.15_74.T", "mensuelle", False, "Zone euro"),
    ("croissance_euro", "Croissance du PIB (zone euro, sur un an)", "MNA/Q.Y.I9.W2.S1.S1.B.B1GQ._Z._Z._Z.EUR.LR.GY", "trimestrielle", False, "Zone euro"),
    ("dette_euro", "Dette publique (zone euro, en % du PIB)", "GFS/Q.N.I9.W0.S13.S1.C.L.LE.GD.T._Z.XDC_R_B1GQ_CY._T.F.V.N._T", "trimestrielle", False, "Zone euro"),
    ("eurusd", "1 euro en dollars (EUR/USD)", "EXR/D.USD.EUR.SP00.A", "quotidienne", True, "Change"),
    ("eurgbp", "1 euro en livres sterling (EUR/GBP)", "EXR/D.GBP.EUR.SP00.A", "quotidienne", True, "Change"),
    ("eurchf", "1 euro en francs suisses (EUR/CHF)", "EXR/D.CHF.EUR.SP00.A", "quotidienne", True, "Change"),
    ("eurjpy", "1 euro en yens (EUR/JPY)", "EXR/D.JPY.EUR.SP00.A", "quotidienne", True, "Change"),
    ("eurcny", "1 euro en yuans (EUR/CNY)", "EXR/D.CNY.EUR.SP00.A", "quotidienne", True, "Change"),
    ("stress_euro", "Indicateur de stress financier de la BCE (CISS, zone euro)", "CISS/D.U2.Z0Z.4F.EC.SS_CIN.IDX", "quotidienne", True, "Zone euro"),
]


def indicateurs_bce():
    res = {}
    debut = f"{AUJOURDHUI.year - 3}-01-01"
    for cle, nom, serie, frequence, quotidienne, zone in INDICATEURS_BCE:
        try:
            pts = serie_bce(serie, debut)
            dec = 4 if cle.startswith("eur") or cle.startswith("stress") else 2
            ind = indicateur(nom, pts, "Banque centrale européenne", lien_bce(serie), frequence,
                             unite="" if cle.startswith("eur") or cle.startswith("stress") else "%",
                             decimales=dec, quotidienne=quotidienne, zone=zone)
            if ind:
                res[cle] = ind
        except Exception as e:
            print(f"  ! BCE {cle} : {e}", file=sys.stderr)
    return res


def indicateurs_usa():
    res = {}
    # Taux de la Fed (taux effectif et fourchette cible), Réserve fédérale de New York
    try:
        d = json.loads(telecharger("https://markets.newyorkfed.org/api/rates/unsecured/effr/last/400.json"))
        pts = sorted((r["effectiveDate"], float(r["percentRate"])) for r in d["refRates"])
        dernier = max(d["refRates"], key=lambda r: r["effectiveDate"])
        ind = indicateur("Taux directeur de la Fed (taux effectif des fonds fédéraux)", pts, "Réserve fédérale de New York",
                         "https://www.newyorkfed.org/markets/reference-rates/effr", "quotidienne", quotidienne=True, zone="États-Unis")
        ind["fourchette"] = [dernier.get("targetRateFrom"), dernier.get("targetRateTo")]
        res["fed"] = ind
    except Exception as e:
        print(f"  ! Fed : {e}", file=sys.stderr)
    # Taux d'État américain à 10 ans (Trésor américain), année en cours et précédente
    try:
        pts = []
        for annee in (AUJOURDHUI.year - 1, AUJOURDHUI.year):
            url = (f"https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/{annee}/all"
                   f"?type=daily_treasury_yield_curve&field_tdr_date_value={annee}&page&_format=csv")
            for l in csv.DictReader(io.StringIO(telecharger(url).decode("utf-8-sig"))):
                if l.get("10 Yr"):
                    m, j, a = l["Date"].split("/")
                    pts.append((f"{a}-{m}-{j}", float(l["10 Yr"])))
        pts.sort()
        res["taux10_us"] = indicateur("Taux d'État à 10 ans (États-Unis)", pts, "Trésor américain",
                                      "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/TextView?type=daily_treasury_yield_curve",
                                      "quotidienne", quotidienne=True, zone="États-Unis")
    except Exception as e:
        print(f"  ! Trésor : {e}", file=sys.stderr)
    # Inflation et chômage américains (Bureau of Labor Statistics)
    for cle, serie, nom, lien in (("inflation_us", "CUUR0000SA0", "Inflation (États-Unis, sur un an)", "https://www.bls.gov/cpi/"),
                                  ("chomage_us", "LNS14000000", "Taux de chômage (États-Unis)", "https://www.bls.gov/cps/")):
        try:
            d = json.loads(telecharger(f"https://api.bls.gov/publicAPI/v1/timeseries/data/{serie}"))
            donnees = d["Results"]["series"][0]["data"]
            pts = sorted((f"{x['year']}-{x['period'][1:]}", float(x["value"])) for x in donnees
                         if x["period"].startswith("M") and x["period"] != "M13" and re.match(r"^-?\d+(\.\d+)?$", x["value"]))
            if cle == "inflation_us":  # l'indice des prix → variation sur un an
                indice = dict(pts)
                pts = [(d, (v / indice[f"{int(d[:4]) - 1}{d[4:]}"] - 1) * 100) for d, v in pts if f"{int(d[:4]) - 1}{d[4:]}" in indice]
            res[cle] = indicateur(nom, pts, "Bureau of Labor Statistics (États-Unis)", lien, "mensuelle", decimales=1, zone="États-Unis")
        except Exception as e:
            print(f"  ! BLS {cle} : {e}", file=sys.stderr)
    return res


ZONES_FMI = [("WEOWORLD", "Monde"), ("ADVEC", "Pays avancés"), ("OEMDC", "Pays émergents et en développement"),
             ("USA", "États-Unis"), ("EURO", "Zone euro"), ("FRA", "France"), ("DEU", "Allemagne"), ("GBR", "Royaume-Uni"),
             ("JPN", "Japon"), ("CHN", "Chine"), ("IND", "Inde"), ("BRA", "Brésil")]


def previsions_fmi():
    res = {"zones": dict(ZONES_FMI), "annees": [str(AUJOURDHUI.year - 1), str(AUJOURDHUI.year), str(AUJOURDHUI.year + 1)]}
    try:
        meta = json.loads(telecharger("https://www.imf.org/external/datamapper/api/v1/indicators"))["indicators"]
    except Exception:
        meta = {}
    for cle, code in (("croissance", "NGDP_RPCH"), ("inflation", "PCPIPCH"), ("dette", "GGXWDG_NGDP")):
        try:
            v = json.loads(telecharger(f"https://www.imf.org/external/datamapper/api/v1/{code}"))["values"][code]
            res[cle] = {z: {a: v.get(z, {}).get(a) for a in res["annees"]} for z, _ in ZONES_FMI}
            res["edition"] = (meta.get(code) or {}).get("source") or res.get("edition")
        except Exception as e:
            print(f"  ! FMI {code} : {e}", file=sys.stderr)
    res["lien"] = "https://www.imf.org/external/datamapper/NGDP_RPCH@WEO"
    return res


# ---------------------------------------------------------------------------
# Actualités (titres et liens uniquement, classés par thème)
# ---------------------------------------------------------------------------

FLUX = [
    ("Le Monde", "fr", "https://www.lemonde.fr/economie/rss_full.xml"),
    ("Le Monde", "fr", "https://www.lemonde.fr/international/rss_full.xml"),
    ("Le Monde", "fr", "https://www.lemonde.fr/economie-mondiale/rss_full.xml"),
    ("Le Monde", "fr", "https://www.lemonde.fr/pixels/rss_full.xml"),
    ("Franceinfo", "fr", "https://www.francetvinfo.fr/economie.rss"),
    ("Franceinfo", "fr", "https://www.francetvinfo.fr/monde.rss"),
    ("France 24", "fr", "https://www.france24.com/fr/economie/rss"),
    ("RFI", "fr", "https://www.rfi.fr/fr/economie/rss"),
    ("Le Figaro", "fr", "https://www.lefigaro.fr/rss/figaro_economie.xml"),
    ("Le Figaro", "fr", "https://www.lefigaro.fr/rss/figaro_international.xml"),
    ("BBC", "en", "https://feeds.bbci.co.uk/news/business/rss.xml"),
    ("BBC", "en", "https://feeds.bbci.co.uk/news/world/rss.xml"),
    ("The New York Times", "en", "https://rss.nytimes.com/services/xml/rss/nyt/Business.xml"),
    ("The Guardian", "en", "https://www.theguardian.com/business/rss"),
    ("Banque centrale européenne", "en", "https://www.ecb.europa.eu/rss/press.html"),
    ("Réserve fédérale (Fed)", "en", "https://www.federalreserve.gov/feeds/press_all.xml"),
    ("Commission européenne", "fr", "https://ec.europa.eu/commission/presscorner/api/rss?language=fr"),
]

# Thèmes : (clé, libellé, expression régulière appliquée au titre et au résumé)
THEMES = [
    ("commerce", "Tensions commerciales et droits de douane",
     r"droits? de douane|tarifs? douaniers?|surtaxe|guerre commerciale|protectionnis|accord commercial|\btariffs?\b|trade (war|deal|talks|tensions?)"),
    ("sanctions", "Sanctions internationales",
     r"\bsanctions?\b(?!.*\b(joueur|club|match|arbitre|footballeur)\b)|\bembargo"),
    ("elections", "Élections et changements politiques",
     r"élections? (présidentielles?|législatives|européennes|générales|anticipées|de mi-mandat)|\bprésidentielle\b|\blégislatives\b|\bmidterms?\b|(general|presidential|snap|parliamentary) elections?|\bmotion de censure\b|vote de confiance|dissolution de l'Assemblée"),
    ("puissances", "Tensions entre grandes puissances",
     r"Taïwan|Taiwan|Pékin.{0,60}Washington|Washington.{0,60}Pékin|Chine.{0,40}États-Unis|États-Unis.{0,40}Chine|US-China|China-US|Beijing.{0,60}Washington|Washington.{0,60}Beijing|mer de Chine|South China Sea"),
    ("conflits", "Conflits et crises géopolitiques",
     r"\bguerre\b|\bconflit|\bUkraine\b|\bGaza\b|\bIsraël|\bIsrael\b|\bIran\b|Moyen-Orient|Middle East|\bwar\b|\bmissiles?\b|cessez-le-feu|ceasefire|mer Rouge|Red Sea|Ormuz|Hormuz|\binvasion\b"),
    ("industrie", "Politiques industrielles",
     r"politique industrielle|subventions?|Chips Act|Inflation Reduction Act|réindustrialis|souveraineté (industrielle|technologique)|industrial policy|subsid(y|ies)"),
    ("regl_europe", "Réglementation européenne",
     r"AI Act|Digital Markets Act|Digital Services Act|\bDMA\b|\bDSA\b|(Bruxelles|Commission européenne|Union européenne|\bUE\b|European Commission|\bEU\b).{0,80}(règles?|réglement|amende|enquête|directive|régul|interdi|fines?|rules|regulat|probe|antitrust)"),
    ("regl_usa", "Réglementation américaine",
     r"export controls?|contrôles? (à l'|aux |des )exportations?|((?-i:\bSEC\b|\bFTC\b)|Department of Justice|Justice Department|ministère américain de la justice|régulateurs? américains?|US regulators?).{0,80}(antitrust|régul|enquête|amende|lawsuit|probe|rules|ban|interdi|fine)"),
    ("regl_chine", "Réglementation chinoise",
     r"(Pékin|Chine|Beijing|China|chinois|Chinese).{0,60}(régul|réglement|regulat|crackdown|interdi|\bban\b|enquête antitrust|antitrust probe|probe)"),
    ("banques_centrales", "Banques centrales et taux d'intérêt",
     r"(?-i:\bBCE\b|\bFed\b|\bFOMC\b|\bECB\b)|Banque centrale européenne|Réserve fédérale|Federal Reserve|taux directeurs?|interest rates?|rate (cut|hike)s?|baisse des taux|hausse des taux|Banque du Japon|Bank of Japan|Bank of England|Banque d'Angleterre"),
    ("ia", "Intelligence artificielle",
     r"intelligence artificielle|(?-i:\bIA\b|\bAI\b)|OpenAI|ChatGPT|\bLLM|générative|generative|Anthropic|machine learning|apprentissage automatique"),
    ("semi", "Semi-conducteurs",
     r"semi-?conducteurs?|semiconductors?|\bpuces?\b|\bchips?\b(?! Act)|Nvidia|TSMC|ASML|\bIntel\b|\bAMD\b|Broadcom|Qualcomm|Micron|STMicro"),
    ("cloud", "Cloud et centres de données",
     r"\bcloud\b|centres? de données|data ?cent(er|re)s?|hyperscal|\bAWS\b|\bAzure\b|Google Cloud"),
    ("cyber", "Cybersécurité",
     r"cyber|piratage|rançongiciel|ransomware|\bhack(er|ers|ing|ed)?\b|fuite de données|data breach"),
    ("robotique", "Robotique et automatisation",
     r"\brobot|automatisation|\bautomation\b|humanoïde|humanoid"),
    ("energie", "Transition énergétique",
     r"transition énergétique|énergies? renouvelables?|renewables?|\bsolaire\b|\bsolar\b|éolien|wind (farm|power|energy)|véhicules? électriques?|electric vehicles?|(?-i:\bEVs?\b)|\bbatteries\b|hydrogène|hydrogen|\bclimat\b|climate"),
]


def texte_propre(t):
    t = html.unescape(re.sub(r"<[^>]+>", " ", t or ""))
    return re.sub(r"\s+", " ", t).strip()


def date_article(texte):
    if not texte:
        return None
    texte = texte.strip()
    try:
        d = email.utils.parsedate_to_datetime(texte)
    except Exception:
        try:
            d = datetime.fromisoformat(texte.replace("Z", "+00:00"))
        except Exception:
            return None
    if d.tzinfo is None:
        d = d.replace(tzinfo=timezone.utc)
    return d.astimezone(timezone.utc)


def lire_flux(nom, langue, url):
    brut = telecharger(url, delai=30, essais=2)
    racine = ElementTree.fromstring(brut)
    articles = []
    for item in racine.iter():
        balise = item.tag.split("}")[-1]
        if balise not in ("item", "entry"):
            continue
        champs = {}
        for enfant in item:
            b = enfant.tag.split("}")[-1]
            if b == "link" and enfant.get("href"):
                champs.setdefault("link", enfant.get("href"))
            elif enfant.text:
                champs.setdefault(b, enfant.text)
        titre = texte_propre(champs.get("title"))
        lien = (champs.get("link") or champs.get("guid") or "").strip()
        quand = date_article(champs.get("pubDate") or champs.get("date") or champs.get("updated") or champs.get("published"))
        if titre and lien.startswith("http") and quand:
            articles.append({"titre": titre, "resume": texte_propre(champs.get("description") or champs.get("summary"))[:400],
                             "lien": lien, "source": nom, "langue": langue, "date": quand})
    return articles


def actualites():
    limite = datetime.now(timezone.utc) - timedelta(days=30)
    tous, sources_ok = [], []
    for nom, langue, url in FLUX:
        try:
            a = [x for x in lire_flux(nom, langue, url) if x["date"] >= limite]
            tous += a
            sources_ok.append({"nom": nom, "url": url, "articles": len(a)})
        except Exception as e:
            print(f"  ! flux {nom} ({url}) : {e}", file=sys.stderr)
    tous.sort(key=lambda a: a["date"], reverse=True)
    par_theme = {}
    for cle, libelle, motif in THEMES:
        re_theme = re.compile(motif, re.I)
        vus, liste = set(), []
        for a in tous:
            if a["source"] in ("Banque centrale européenne", "Réserve fédérale (Fed)"):
                # communiqués institutionnels : on ne garde que ceux sur la politique monétaire
                ok = cle == "banques_centrales" and bool(re.search(r"FOMC|monetary policy|policy rate|interest rate|politique monétaire", a["titre"], re.I))
            else:
                ok = bool(re_theme.search(a["titre"])) or (bool(re_theme.search(a["resume"])) and cle not in ("ia", "cyber", "elections"))
            empreinte = re.sub(r"\W+", "", a["titre"].lower())[:80]
            if ok and empreinte not in vus:
                vus.add(empreinte)
                liste.append({"titre": a["titre"], "lien": a["lien"], "source": a["source"], "langue": a["langue"],
                              "date": a["date"].strftime("%Y-%m-%dT%H:%MZ")})
            if len(liste) >= 8:
                break
        par_theme[cle] = {"nom": libelle, "articles": liste}
    return par_theme, sources_ok


# ---------------------------------------------------------------------------
# Séries de référence (fonds indiciels de la base GECO), préparées une fois par jour
# pour que chaque visiteur n'ait pas à les télécharger lui-même
# ---------------------------------------------------------------------------

GECO = "https://geco.amf-france.org/back-office"
SORTIE_REFERENCES = RACINE / "data" / "references.js"

# Mêmes clés que js/projection.js (SERIES_LONGUES) et js/style.js (FACTEURS)
SERIES_LONGUES = [("usa", "FR0000436438"), ("tech", "FR0000431538"), ("euro", "FR0000990764"), ("europe", "FR0000441628"),
                  ("japon", "FR0000435174"), ("emergents", "FR0007492749"), ("oblig10", "FR0000939951"),
                  ("oblig3", "FR0007457114"), ("monetaire", "FR0000293698")]
SERIES_STYLE = [("usa", ["FR0011871128"]), ("tech", ["FR0011871110", "FR001400ZGR7"]), ("euro", ["FR0012739431"]),
                ("europe", ["FR0010821819"]), ("japon", ["FR0010245514"]), ("emergents", ["FR0010429068"])]
FACTEURS_DIVISION = list(range(2, 21)) + [25, 40, 50, 100, 200, 500, 1000]


def annuaire_par_isin():
    t = (RACINE / "data" / "annuaire.js").read_text(encoding="utf-8")
    debut = t.index("[", t.index("const ANNUAIRE ="))
    lignes = json.loads(t[debut:t.rindex("]") + 1])
    res = {}
    for l in lignes:
        for isin in (l[7] or "").split():
            res[isin] = l
    return res


def historique_geco(ligne, isin, depuis="1990-01-01"):
    parts = json.loads(telecharger(f"{GECO}/funds/compartment/c{ligne[1]}/shares"))
    part = next((p for p in parts if p.get("isin") == isin), parts[0] if parts else None)
    if not part:
        raise ValueError("aucune part")
    h = json.loads(telecharger(f"{GECO}/funds/chart/{part['idInterne']}?startDate={depuis}"))
    dates = [date(int(d[6:10]), int(d[3:5]), int(d[0:2])) for d in h.get("x") or []]
    return dates, nettoyer_historique(dates, list(h.get("y") or []))


def nettoyer_historique(dates, v):
    """Même correction que historiqueDepuisGeco (js/geco.js) : points aberrants et divisions de parts."""
    for i in range(1, len(v) - 1):
        a, b, c = v[i - 1], v[i], v[i + 1]
        if a > 0 and c > 0 and abs(c / a - 1) < 0.1 and abs(b / a - 1) > 0.2 and abs(b / c - 1) > 0.2:
            v[i] = (a + c) / 2
    for i in range(1, len(v)):
        if not v[i - 1]:
            continue
        r = v[i] / v[i - 1]
        if not (r < 0.6 or r > 1.6):
            continue
        f = 1 / r if r < 1 else r
        rond = next((x for x in FACTEURS_DIVISION if abs(f / x - 1) < 0.015), None)
        if not rond or (rond < 10 and (dates[i] - dates[i - 1]).days > 7):
            continue
        ajust = 1 / rond if r < 1 else rond
        for k in range(i):
            v[k] *= ajust
    return v


def rendements_mensuels(dates, valeurs):
    """Dernière valeur de chaque mois (mois en cours exclu), puis rendements entre mois consécutifs ; plus longue suite récente.
    Comme dans js/projection.js, un trou de 1 ou 2 mois est comblé en répartissant la variation sur les mois manquants."""
    niveaux = {}
    for d, v in zip(dates, valeurs):
        niveaux[f"{d.year}-{d.month:02d}"] = v
    niveaux.pop(f"{AUJOURDHUI.year}-{AUJOURDHUI.month:02d}", None)
    mois = sorted(niveaux)
    ecart = lambda a, b: (int(b[:4]) - int(a[:4])) * 12 + int(b[5:]) - int(a[5:])
    r, premier = [], None
    for i in range(1, len(mois)):
        e = ecart(mois[i - 1], mois[i])
        if e > 3 or not niveaux[mois[i - 1]] or not niveaux[mois[i]]:
            r, premier = [], None     # trou trop long : on repart de zéro (on garde la suite la plus récente)
            continue
        if not r:
            a, m = int(mois[i - 1][:4]), int(mois[i - 1][5:]) + 1
            premier = f"{a + (m > 12)}-{(m - 1) % 12 + 1:02d}"
        par_mois = (niveaux[mois[i]] / niveaux[mois[i - 1]]) ** (1 / e) - 1
        r.extend([round(par_mois, 6)] * e)
    return (premier, r) if r else (None, [])


def references():
    par_isin = annuaire_par_isin()
    res = {"longues": {}, "style": {}}
    for cle, isin in SERIES_LONGUES:
        try:
            dates, valeurs = historique_geco(par_isin[isin], isin)
            mois0, r = rendements_mensuels(dates, valeurs)
            if len(r) > 120:
                res["longues"][cle] = {"isin": isin, "mois0": mois0, "r": r}
        except Exception as e:
            print(f"  ! série longue {cle} : {e}", file=sys.stderr)
        time.sleep(1)
    # Dollar : 1 dollar exprimé en euros, fin de mois (BCE)
    try:
        pts = [(d, 1 / v) for d, v in serie_bce("EXR/M.USD.EUR.SP00.E", "1999-01")]
        dates = [date(int(d[:4]), int(d[5:7]), 28) for d, _ in pts]
        mois0, r = rendements_mensuels(dates, [v for _, v in pts])
        if r:
            res["longues"]["dollar"] = {"isin": None, "mois0": mois0, "r": r}
    except Exception as e:
        print(f"  ! dollar : {e}", file=sys.stderr)
    depuis = AUJOURDHUI - timedelta(days=int(365.25 * 3.7))
    for cle, isins in SERIES_STYLE:
        for isin in isins:
            try:
                dates, valeurs = historique_geco(par_isin[isin], isin, depuis.isoformat())
                if len(dates) > 200:
                    d0 = dates[0]
                    res["style"][cle] = {"isin": isin, "d0": d0.isoformat(), "j": [(d - d0).days for d in dates], "v": [round(x, 4) for x in valeurs]}
                    break
            except Exception as e:
                print(f"  ! série de style {cle} ({isin}) : {e}", file=sys.stderr)
            time.sleep(1)
    return res


def ecrire_references():
    try:
        ref = references()
    except Exception as e:
        print(f"  ! références : {e}", file=sys.stderr)
        return
    # Si l'AMF ne répond pas, on garde le fichier précédent (le site sait aussi relire GECO en direct)
    if len(ref["longues"]) < 7 or len(ref["style"]) < 5:
        print(f"  ! références incomplètes ({len(ref['longues'])} longues, {len(ref['style'])} de style) : fichier non modifié", file=sys.stderr)
        return
    ref["maj"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%MZ")
    SORTIE_REFERENCES.write_text(
        "/* Généré automatiquement par scripts/actualiser_contexte.py — ne pas modifier à la main.\n"
        " * Rendements mensuels de fonds de référence à long historique et valeurs quotidiennes des fonds indiciels\n"
        " * utilisés par l'analyse des rendements. Source : AMF (base GECO), BCE. */\n"
        f"const DONNEES_REFERENCES = {json.dumps(ref, separators=(',', ':'))};\n", encoding="utf-8")
    print(f"OK : {len(ref['longues'])} séries longues, {len(ref['style'])} séries de style → {SORTIE_REFERENCES.relative_to(RACINE)}")


# ---------------------------------------------------------------------------

def main():
    print("Indicateurs BCE…")
    ind = indicateurs_bce()
    print("Indicateurs américains…")
    ind.update(indicateurs_usa())
    print("Prévisions du FMI…")
    fmi = previsions_fmi()
    print("Actualités…")
    actus, flux = actualites()

    # Garde-fou : si presque tout a échoué (panne réseau), on ne remplace pas un fichier correct par un fichier vide
    if len(ind) < 8:
        sys.exit(f"Trop peu d'indicateurs récupérés ({len(ind)}) : fichier non modifié.")

    contexte = {
        "maj": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%MZ"),
        "indicateurs": ind,
        "fmi": fmi,
        "actualites": actus,
        "flux": flux,
    }
    SORTIE.write_text(
        "/* Généré automatiquement par scripts/actualiser_contexte.py — ne pas modifier à la main.\n"
        " * Sources : BCE, FMI, Réserve fédérale de New York, Trésor américain, BLS, flux RSS de médias et d'institutions. */\n"
        f"const CONTEXTE = {json.dumps(contexte, ensure_ascii=False, separators=(',', ':'))};\n",
        encoding="utf-8")
    nb = sum(len(t["articles"]) for t in actus.values())
    print(f"OK : {len(ind)} indicateurs, {nb} titres d'actualité, {len(flux)} flux → {SORTIE.relative_to(RACINE)}")
    print("Séries de référence (AMF)…")
    ecrire_references()


if __name__ == "__main__":
    main()
