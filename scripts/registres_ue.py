"""
Registre européen de l'ESMA – commercialisation transfrontière des OPCVM et FIA : fonctions pures (sans réseau).

Source : ESMA, registre de la commercialisation transfrontière des OPCVM et FIA (esma_registers_funds_cbdif),
réutilisation autorisée en citant la source. La lecture du registre (réseau) et l'écriture des fichiers sont dans
scripts/construire_identite.py ; ce module décide seulement quoi en faire :
  - autorites : pays → nom de l'autorité de contrôle ;
  - rapprocher : quelles fiches du registre sont déjà dans l'annuaire du site (par LEI, puis par nom) ;
  - entree_esma / lignes_registres / infos_registres : les trois sorties lues par le navigateur.

Une fiche du registre (champs utilisés) : id, funds_lei (souvent absent), funds_national_name, funds_legal_framework_name
(UCITS, AIF, ELTIF, EuVECA, EuSEF), funds_manager_nat_name, funds_manager_comp_cou_code (nom de l'autorité),
funds_ca_cou_code (pays de l'autorité), funds_domicile_cou_code, funds_host_country_codes (pays de commercialisation),
funds_status_code (ACTV ou INAC).
"""
import re
from collections import Counter, defaultdict

from construire_identite import ACTIF, OPCVM, cle_societe

CADRES = {"UCITS": "OPCVM (UCITS)", "AIF": "FIA", "ELTIF": "ELTIF", "EuVECA": "EuVECA", "EuSEF": "EuSEF"}
PAYS_ZONE = {"IE", "LU"}   # pays dont les fonds absents de l'annuaire forment la zone « registres-ue »


def propre(texte):
    """Nom sans espace en tête, en queue ni en double (le registre en contient : « ␣SOLUTIO PREMIUM… »)."""
    return " ".join((texte or "").split())


def actives(docs):
    """Fiches actives du registre (statut ACTV)."""
    return [d for d in docs if d.get("funds_status_code") == ACTIF]


def autorites(docs):
    """Pays de l'autorité → nom de l'autorité : le plus fréquent parmi les fiches actives d'OPCVM de ce pays ;
    à égalité, le premier dans l'ordre alphabétique."""
    comptes = defaultdict(Counter)
    for d in actives(docs):
        pays, nom = d.get("funds_ca_cou_code"), d.get("funds_manager_comp_cou_code")
        if pays and nom and d.get("funds_legal_framework_name") == OPCVM:
            comptes[pays][nom] += 1
    return {pays: min(c, key=lambda nom: (-c[nom], nom)) for pays, c in sorted(comptes.items())}


def _ordre(doc):
    """Ordre stable des fiches : par numéro croissant (la première fiche garde la clé en cas de conflit)."""
    identifiant = str(doc.get("id", ""))
    return len(identifiant), identifiant


def rapprocher(docs, leis_annuaire, noms_lei, fonds_n):
    """Rapproche les fiches actives du registre des fonds déjà présents dans l'annuaire du site.
    Trois règles, appliquées l'une après l'autre à toutes les fiches (la plus sûre d'abord) :
      1. le LEI de la fiche est un LEI de l'annuaire → clé = ce LEI ;
      2. sinon le nom de la fiche (cle_societe) est le nom GLEIF d'exactement un LEI de l'annuaire du même pays
         (noms_lei : LEI → (nom GLEIF, pays)) → clé = ce LEI ;
      3. sinon il est le nom d'exactement un fonds GECO sans ISIN du même pays (fonds_n : « N<numéro> » → (nom, pays))
         → clé = « N<numéro> ».
    Deux candidats (ou plus) pour un nom : ambigu, pas de rapprochement. Une clé déjà prise n'est jamais réattribuée.
    Renvoie ({clé: fiche rapprochée}, [fiches actives non rapprochées])."""
    par_lei, par_geco = defaultdict(list), defaultdict(list)
    for lei, (nom, pays) in noms_lei.items():
        if lei in leis_annuaire and cle_societe(nom):
            par_lei[(cle_societe(nom), pays)].append(lei)
    for cle, (nom, pays) in fonds_n.items():
        if cle_societe(nom):
            par_geco[(cle_societe(nom), pays)].append(cle)

    lies, restes = {}, sorted(actives(docs), key=_ordre)

    def passe(candidat):
        nonlocal restes
        non_lies = []
        for d in restes:
            cle = candidat(d)
            if cle and cle not in lies:
                lies[cle] = d
            else:
                non_lies.append(d)
        restes = non_lies

    def unique(index, d):
        trouves = index.get((cle_societe(d.get("funds_national_name")), d.get("funds_domicile_cou_code")), [])
        return trouves[0] if len(trouves) == 1 else None

    passe(lambda d: d.get("funds_lei") if d.get("funds_lei") in leis_annuaire else None)
    passe(lambda d: unique(par_lei, d))
    passe(lambda d: unique(par_geco, d))
    return lies, restes


def depuis_annuaire(annuaire, lei_de, fiches):
    """Ce que rapprocher() demande à l'annuaire du site : (noms_lei, fonds_n).
    noms_lei : LEI → (nom GLEIF, pays de l'annuaire) pour les fonds étrangers (E, N, U) dont le LEI est connu par leurs ISIN
    (lei_de : ISIN → LEI) et dont la fiche GLEIF existe (fiches : LEI → {nom, …}) ; si les parts d'un LEI sont de pays
    différents, le plus fréquent (à égalité, le premier dans l'ordre alphabétique).
    fonds_n : « N<numéro> » → (nom, pays) pour les fonds GECO étrangers sans ISIN."""
    pays_de = defaultdict(Counter)
    for l in annuaire:
        if l[0] in "ENU" and l[9]:
            for isin in (l[7] or "").split():
                if lei_de.get(isin):
                    pays_de[lei_de[isin]][l[9]] += 1
    noms_lei = {lei: (fiches[lei]["nom"], min(c, key=lambda p: (-c[p], p)))
                for lei, c in sorted(pays_de.items()) if (fiches.get(lei) or {}).get("nom")}
    fonds_n = {"N" + str(l[1]): (l[3], l[9]) for l in annuaire if l[0] == "N" and not l[7] and l[9]}
    return noms_lei, fonds_n


def entree_esma(doc, nom_id):
    """Entrée de IDENTITE.esmaFonds : [société de gestion (index dans noms, par nom_id), pays de l'autorité, cadre juridique,
    pays de commercialisation séparés par des espaces]."""
    return [nom_id(doc.get("funds_manager_nat_name")), doc.get("funds_ca_cou_code") or "", doc.get("funds_legal_framework_name") or "",
            " ".join(doc.get("funds_host_country_codes") or [])]


def lignes_registres(docs, joli):
    """Lignes de la zone « registres-ue » (format de l'annuaire) pour les fiches données domiciliées dans PAYS_ZONE, triées par nom :
    ["R", id, id, nom, société de gestion, "", cadre en français, "", "", pays, "", "", "", ETF (1/0), public (1 pour un OPCVM)]."""
    lignes = []
    for d in docs:
        if d.get("funds_domicile_cou_code") not in PAYS_ZONE:
            continue
        nom, cadre = propre(d.get("funds_national_name")), d.get("funds_legal_framework_name") or ""
        numero = int(d["id"])
        lignes.append(["R", numero, numero, joli(nom), joli(propre(d.get("funds_manager_nat_name"))), "", CADRES.get(cadre, cadre), "", "",
                       d["funds_domicile_cou_code"], "", "", "", 1 if re.search(r"\bETF\b", nom) else 0, 1 if cadre == OPCVM else 0])
    lignes.sort(key=lambda l: (l[3].lower(), l[1]))
    return lignes


def infos_registres(docs, bce, liens, fiches):
    """Informations chargées à l'ouverture d'une fiche « R » : numéro de fiche (texte) → [LEI ou "", pays de l'autorité,
    pays de commercialisation, politique d'investissement BCE ou "", tranche d'encours BCE ou 0, nom GLEIF du fonds parapluie ou ""].
    bce : LEI → {politique, tranche, …} ; liens : LEI → {parapluie, …} ; fiches : LEI → {nom, …}."""
    infos = {}
    for d in docs:
        lei = d.get("funds_lei") or ""
        b = bce.get(lei) or {}
        parapluie = (fiches.get((liens.get(lei) or {}).get("parapluie")) or {}).get("nom", "")
        infos[str(d["id"])] = [lei, d.get("funds_ca_cou_code") or "", " ".join(d.get("funds_host_country_codes") or []),
                               b.get("politique", ""), b.get("tranche", 0), parapluie]
    return infos
