# Décrypte ton fonds

Site statique (HTML + CSS + JavaScript, sans framework) qui explique un fonds d'investissement
(OPCVM, SICAV, FCP, ETF) : où est investi l'argent, les risques et les pièges, et ce que pourrait devenir un investissement.

**Site en ligne : https://cleante-f.github.io/decrypte-ton-fonds/**

## Lancer le site

Double-clique sur `index.html`. Une connexion Internet est nécessaire pour les fiches des fonds français,
qui sont chargées en direct depuis la base GECO de l'AMF.

## Les pages

| Page | Rôle |
|---|---|
| `index.html` | Accueil : présentation du site, recherche rapide, accès aux trois espaces |
| `decrypte.html` | **Décrypte ton fonds** : phrase « En bref », puis fiche complète (composition, concentration, risque, pièges, frais) |
| `performances.html` | **Performances** : graphique interactif (périodes, comparaison avec les marchés ou un autre fonds, performances par année) |
| `confidentialite.html` | **Confidentialité et mentions légales** : éditeurs, hébergeur, données transmises à des tiers, stockage dans le navigateur, droits (RGPD), bouton d'effacement |
| `simulateur.html` | **Simulateur** : projection d'un investissement (scénarios, Monte Carlo, frais, inflation, fiscalité, crises, objectif, comparaison, portefeuille, contexte et risques) |

Le fonds consulté est dans l'adresse (`#ISIN`) : les onglets et les boutons « Voir le graphique des performances » /
« Décrypter ce fonds » passent d'une page à l'autre sans le perdre. Depuis l'accueil, la recherche est transmise
avec `?q=…`.

**Historique des valeurs liquidatives** : les valeurs publiées ne sont pas ajustées des divisions de parts
(ex. une part divisée par 10). Le site les repère (variation d'un jour égale à un facteur entier) et corrige
l'historique antérieur ; les points isolés aberrants sont lissés. Chaque correction est signalée sous le graphique.

**Phrase « En bref »** (en tête de fiche, `enBref` dans `js/fiche-auto.js`) : l'indice suivi quand le nom en contient
un connu (description fixe de son contenu, variantes et versions ESG signalées) ; sinon la composition calculée (classes
d'actifs arrondies à 5 %, région principale) ; sinon la catégorie AMF ; sinon ce que le nom laisse deviner, présenté
comme tel (« D'après son nom… ») ; sinon la première phrase de l'objectif du DIC. Rien n'est affiché si aucune source ne suffit.

## Le simulateur (méthode)

Accessible depuis l'onglet « Simulateur » ou le bouton « Simuler mon investissement » de chaque fiche.
L'utilisateur répond à 4 questions (capital de départ, versement régulier, durée, ce qu'il veut simuler), puis ajuste
son plan et les options avancées (inflation, frais, fiscalité française, prime de risque des actions).
**Aucun chiffre n'est présenté comme une prévision** : le site montre toujours une fourchette et des scénarios.

1. **Historique long** (`js/projection.js`) : rendements mensuels du fonds ; avant sa création, historique *reconstitué*
   en appliquant son exposition estimée (analyse des rendements) à des fonds de référence de la base GECO cotés
   depuis les années 1990 (AXA Indice USA, AXA Indice Euro, SG Actions US Techno, Covéa Euro Souverain…).
   On retrouve ainsi le comportement probable du fonds en 2000-2003, 2008, 2011, 2020 et 2022.
2. **Rendement attendu** : moyenne pondérée entre une estimation « de marché » (taux d'État actuels de la BCE
   + prime de risque des actions de 3,5 %, modifiable) et le rendement historique. Le poids de l'historique dépend
   de sa précision statistique (longueur et volatilité), plafonné à 50 % pour les actions et à 10 % pour les obligations
   et le monétaire (leur rendement futur dépend surtout des taux actuels).
3. **Monte Carlo** : 3 000 trajectoires de 40 ans, par blocs de 12 mois consécutifs tirés dans l'historique
   (bootstrap circulaire), recalés sur le rendement et la volatilité retenus. Tirages reproductibles.
4. **Plan** appliqué à chaque trajectoire : versements (mensuels, trimestriels, annuels, avec hausse annuelle),
   date de début (si elle est passée, les premiers mois suivent l'historique réel), frais courants (lus dans le DIC),
   frais d'entrée, de courtage, de change et de contrat, dividendes réinvestis ou versés, inflation,
   fiscalité française simplifiée (compte-titres, PEA, assurance-vie ; règles 2026 de service-public.fr).
5. **Scénarios** : défavorable (rang 10 %), central (médiane), favorable (rang 90 %) et tensions
   (pire baisse sur 12 mois de l'historique, subie pendant la dernière année). **Objectif** : versement, capital ou durée nécessaires pour 1 chance
   sur 2, 3 sur 4, 9 sur 10. **Crises** : 6 crises réelles rejouées et 7 chocs hypothétiques.
   **Portefeuille** : trajectoires jointes (mêmes périodes tirées pour tous les fonds), corrélations, diversification.
6. **Réduire le risque** : le site repère la principale concentration du fonds (une région pour un fonds d'actions,
   les taux pour un fonds d'obligations longues, la part d'actions pour un fonds mixte) et propose un fonds indiciel
   français du même type qui ne l'a pas (ex. actions européennes pour un fonds très américain). Parmi quelques fonds
   compatibles, il garde le plus proche, sauf si un autre réduit nettement mieux les variations. La répartition est celle
   qui a le plus réduit les variations sur le passé (entre 50 et 80 % pour le fonds de départ). Suivent un comparatif
   des risques et des performances passées, sans et avec ce fonds. Exemple pédagogique, pas un conseil.
7. **Contexte** (`js/contexte-fonds.js`) : tableau de bord des risques (marché, géopolitique, change, secteur,
   concentration, taux, réglementation), indicateurs économiques pertinents pour le fonds, risques géopolitiques illustrés par des titres de presse récents (datés, sourcés), exposition aux
   tendances technologiques (opportunité / risque, sans recommandation).

### Données mises à jour automatiquement chaque jour

`scripts/actualiser_contexte.py`, lancé chaque matin par GitHub Actions (`.github/workflows/contexte.yml`), écrit :
- `data/contexte.js` : indicateurs de la BCE (taux, inflation, anticipations, chômage, croissance, dette, change,
  stress financier), de la Fed de New York, du Trésor américain et du BLS (prévisions du FMI retirées le 01/10/2026 :
  usage commercial soumis à autorisation) et titres d'actualité classés par thème (BCE, Fed, Commission européenne ; flux des médias retirés le 01/10/2026,
  leurs conditions excluant l'usage commercial) ;
- `data/references.js` : séries des fonds de référence, pour que chaque visiteur n'ait pas à les télécharger.

Chaque donnée garde sa date et sa source ; une donnée en retard sur son rythme de publication est signalée.
Si une source ne répond pas, le fichier précédent est conservé. Pour lancer une mise à jour à la main :
onglet **Actions** du dépôt GitHub → « Mise à jour des données du simulateur » → **Run workflow**, ou :

```bash
python3 scripts/actualiser_contexte.py
```

### Marchés, devises et actualités d'entreprises (API, avec sources de secours)

`scripts/actualiser_marches.py`, lancé juste après par la même tâche, écrit `data/marches.js`. Il est affiché dans
la fiche (section « 4. Risque ») et dans l'onglet « Contexte & risques » du simulateur (`js/marches.js`). Le navigateur
n'appelle aucune API : il lit ce fichier du site. Un module par source dans `scripts/sources/` (délai maximum 8 s) :

| Bloc | Principale | Secours | Dernier recours | Cache |
|---|---|---|---|---|
| Taux de change (USD, GBP, CHF, JPY, CNY) | BCE, sans clé | Frankfurter (taux BCE), sans clé | Currency-api (fawazahmed0), sans clé | 6 h |
| Marchés (S&P 500, Nasdaq-100, Euro Stoxx 50, Europe hors UEM, Topix, émergents, MSCI World) | Valeurs liquidatives de fonds indiciels (AMF – GECO), sans clé | — (aucune source gratuite n'autorise un site public : Alpha Vantage retiré le 01/10/2026) | Dernière valeur connue | 6 h |
| Actualités de 23 grandes entreprises souvent détenues (`scripts/sources/entreprises.py`) | NewsData.io, clé `NEWSDATA_KEY` (28 requêtes au plus : 60 par fenêtre, 200 crédits par jour) | — (MarketAux retiré le 01/10/2026 : usage commercial interdit) | — | 6 h |

Les actualités s'affichent sous les principales lignes d'un fonds (fiche, section 2) et dans « Contexte & risques », pour
les entreprises reconnues parmi ses lignes. Filtres : titres générés automatiquement (déclarations de positions,
formulaires SEC, « prévisions » de cours, communiqués d'études de marché) et sites qui en publient surtout ; titres
mal encodés réparés. Sur une réponse 429 (trop de requêtes), le script attend une fois le délai `Retry-After`.

Si toutes les sources d'un bloc tombent, la dernière valeur connue est gardée avec sa date et un message ; la page
n'est jamais cassée. Chaque bloc affiche sa source et l'heure de sa mise à jour.

- Clés : jamais dans le code. Sur GitHub : Settings → Secrets and variables → Actions (noms dans `.env.example`) ;
  pour un essai local, copier `.env.example` en `.env` (ignoré par Git). Une clé absente fait simplement sauter la source.
- Tests (appellent les vraies API et vérifient les champs utilisés) : `python3 scripts/tests_sources.py`
- Avant d'écrire le module d'une API à clé : `python3 scripts/sonder_api.py` affiche la structure réelle de sa réponse
  (sans jamais afficher la clé).
- Forcer un nouvel appel malgré le cache : `python3 scripts/actualiser_marches.py --forcer`, ou sur GitHub :
  Actions → « Mise à jour des données du simulateur » → Run workflow → cocher « Rappeler toutes les API ».

## Ce que contient la base

| Type de fonds | Nombre | Source | Données disponibles |
|---|---|---|---|
| Fonds de droit français (FCP, SICAV, FCPE, FCPI…) | ≈ 11 400 | AMF – base GECO | Identité, parts, encours, historique sur 10 ans (volatilité, perte maximale, performance), documents officiels, **DIC lu automatiquement** (SRI, frais, durée, objectif…) et **composition calculée** (voir ci-dessous) |
| ETF étrangers cotés en Europe | ≈ 7 900 (dont ≈ 2 400 américains, signalés comme inaccessibles aux particuliers) | ESMA (registres FIRDS et FITRS) + Xetra, OpenFIGI, BCE, GLEIF, cours Deutsche Börse | Identité officielle (LEI, devise, places de cotation dans l'UE, société de gestion, compartiment, type, tranche d'encours), tickers, cours de clôture relevé chaque jour (Xetra), montant échangé en bourse, et composition estimée via un fonds français « jumeau » qui suit le même indice |
| Fonds étrangers commercialisés en France | ≈ 8 500 | AMF – base GECO, + ESMA (FIRDS), BCE, GLEIF, cours Deutsche Börse | Identité ; pour ceux qui sont cotés dans l'UE, ISIN retrouvés par leur LEI ou par le nom (noms des bourses dans FIRDS ou nom officiel GLEIF : correspondance prudente, signalée « à vérifier dans le DIC »), et cours relevé chaque jour à la Bourse de Francfort quand il existe |
| Autres fonds cotés en Europe, absents de la liste de l'AMF | ≈ 2 700 | ESMA (FIRDS), GLEIF, BCE, cours Deutsche Börse | Identité (nom officiel GLEIF, parts regroupées par compartiment grâce au LEI), cours quand il existe ; alerte « peut-être pas proposé en France », et alerte plus forte pour les fonds de droit non européen (sans DIC européen) |

## Comment on calcule « Où est investi l'argent ? » (méthode maison)

Aucune analyse toute faite n'est reprise : on part de données brutes publiques et on calcule nous-mêmes.

**Moteur 1 — lecture de l'inventaire** (`js/inventaire.js`)
Les fonds français publient dans leur rapport annuel (déposé dans GECO) la liste de toutes leurs positions.
Le site télécharge le PDF, reconstitue les lignes à partir de la position du texte, puis calcule :
top 10, poids de chaque ligne, classes d'actifs, devises, secteurs (quand le rapport les indique) et pays
(code ISIN de chaque ligne, rubriques par pays, tableau réglementaire « ventilation par pays », ou à défaut
devise de cotation de chaque ligne — signalé comme tel).
Il repère aussi les swaps (réplication synthétique), les fonds de fonds et les fonds nourriciers.
Quand une ligne est elle-même un fonds référencé dans l'annuaire (retrouvé par son ISIN, ou par son nom une fois
abréviations et mentions de part retirées), son nom devient un lien, ouvert dans un nouvel onglet :
vers sa fiche sur ce site si elle est bien fournie (fonds français suivi par l'AMF, ou ETF dont l'indice est reconnu),
sinon vers sa page officielle (fiche AMF pour un fonds étranger commercialisé en France, page Euronext ou Deutsche Börse
pour un ETF). Dans le doute (nom abrégé, part couverte ou non, fonds introuvable), aucun lien n'est proposé.
Les rapports des SICAV à compartiments sont découpés en blocs ; on garde celui qui porte le nom du fonds.

**Moteur 2 — analyse des rendements** (`js/style.js`)
On cherche le mélange de références qui reproduit le mieux les variations hebdomadaires du fonds sur 3 ans
(régression sous contraintes : poids positifs, total 100 %). Références : fonds indiciels français (valeurs
liquidatives GECO) et indices obligataires et monétaire construits à partir des taux de la BCE, plus une couche
« dollar » qui révèle une éventuelle couverture de change. Le R² indique la fiabilité.
Ce moteur donne l'exposition **réelle** même quand le fonds passe par des swaps ou par d'autres fonds.

**Fonds étrangers (ETF irlandais, luxembourgeois…)** : on cherche dans GECO un fonds français qui suit le même
indice (« fonds jumeau ») et on applique les deux moteurs à ce jumeau.

`js/composition.js` choisit la meilleure source et prépare les alertes de concentration. Garde-fou : si l'inventaire
trouvé contredit nettement les rendements (par exemple 0 % d'actions pour un fonds qui se comporte comme un fonds
actions), c'est sans doute celui d'un autre compartiment : il est écarté au profit de l'analyse des rendements.
Les résultats sont gardés une semaine dans le navigateur (la lecture d'un gros rapport peut prendre du temps).

**Limites connues**
- Environ 3 fonds français sur 10 n'ont aucun rapport dans GECO : il reste alors l'analyse des rendements.
- Le dernier inventaire peut dater de plusieurs mois (un avertissement s'affiche au-delà de 18 mois).
- L'analyse des rendements ne distingue pas les pays à l'intérieur d'une zone (sauf États-Unis et Japon)
  et ne voit pas les secteurs (sauf une forte dépendance à la tech américaine).
- Beaucoup de fonds n'ont pas de DIC dans GECO : sans DIC, pas de SRI ni de frais.

## Mettre à jour l'annuaire

```bash
python3 scripts/construire_annuaire.py
```

Ce script régénère `data/annuaire.js` (environ 3,5 Mo), `data/resume.js` et `data/firds.js` (identité ESMA des fonds
étrangers). Il n'utilise que Python, sans rien à installer, et dure 15 à 20 minutes (OpenFIGI limite les requêtes sans clé).
Une mise à jour par mois suffit. Ensuite :

```bash
python3 scripts/construire_identite.py
```

régénère `data/identite.js` (3 minutes) : société de gestion, type de fonds et tranche d'encours (liste des fonds de la BCE),
fonds parapluie et fonds maître (GLEIF), montant moyen échangé en bourse (ESMA FITRS). La tâche `identite.yml` le relance le 20 de chaque mois.

## Cours des fonds étrangers

`scripts/actualiser_cours.py` relève chaque jour le cours de clôture des fonds étrangers de l'annuaire : enchère de clôture
de Xetra, sinon dernier cours de la Bourse de Francfort (en euros). Source : les données différées que Deutsche Börse publie
gratuitement 15 minutes après chaque transaction (MiFIR art. 13, https://mfs.deutsche-boerse.com). Leur licence est gratuite
tant que les données ne sont ni revendues ni intégrées à un service payant (conditions acceptées le 01/10/2026).
Le fichier quotidien ne reste en ligne qu'un jour : l'historique se construit jour après jour dans `data/cours/AAAA/NN.json`
(32 fichiers par an, lus par `js/cours.js`). La tâche `cours.yml` passe deux fois par jour.

Sources et droits de réutilisation (vérifiés le 01/10/2026) :
- AMF (GECO), ESMA (FIRDS et FITRS : « reproduction… authorised… provided the source is acknowledged »), Deutsche Börse
  (liste Xetra ; cours différés gratuits hors usage payant), OpenFIGI (identifiants du domaine public), ISO 10383 (codes des
  places de marché), BCE (réutilisation libre en citant la BCE), GLEIF (licence CC0).
- **À venir** : l'ESAP, point d'accès unique de l'Union européenne, publiera les DIC de tous les fonds à partir du 10/01/2028,
  gratuitement et sans restriction de réutilisation : ce sera la source des frais et du SRI des fonds étrangers.
- **Non utilisés** faute d'autorisation : la liste et les cours d'Euronext (compilation et affichage public interdits sans accord
  écrit), Alpha Vantage, Yahoo, Morningstar, justETF, fundinfo et les sites des sociétés de gestion (usage personnel seulement),
  les cours différés de gettex et de la Bourse de Stuttgart (usage privé seulement), Swiss Fund Data (accord écrit requis),
  les offres gratuites de Twelve Data, Marketstack, EODHD et Finnhub (affichage public interdit).
  Demandes d'autorisation préparées pour Euronext, Alpha Vantage et HSBC AM (brouillons à envoyer par les éditeurs).

## Licences pour un site avec abonnement (vérifiées le 01/10/2026)

| Source | Usage commercial | Décision |
|---|---|---|
| MarketAux | Interdit (usage non commercial) | Retirée |
| FMI (World Economic Outlook) | Sur autorisation (copyright@imf.org), téléchargement automatique interdit sans accord | Retirée du contexte et du simulateur |
| Flux RSS des médias (Le Monde, Franceinfo, France 24, RFI, Le Figaro, BBC, New York Times, The Guardian) | Usage personnel, ou autorisation requise | Retirés ; seuls restent les communiqués de la BCE, de la Fed et de la Commission européenne |
| NewsData.io | Autorisé (« personal or commercial purposes », dans le respect du droit d'auteur) | Gardé |
| Currency-api (fawazahmed0) | Licence CC0 | Gardé |
| AMF (base GECO) | « Toute utilisation à des fins commerciales ou publicitaires est exclue », sauf accord | **Demande d'autorisation à envoyer avant d'ouvrir l'abonnement** (formulaire « Nous contacter ») |
| Deutsche Börse (cours différés, fiches gratuites) | Gratuit hors revente | Demande de confirmation envoyée à data.services@deutsche-boerse.com |
| BCE, ESMA, GLEIF, OpenFIGI, BLS, Trésor et Fed de New York | Autorisé (en citant la source) | Gardés |

## Données personnelles (RGPD)

Pas de compte, pas de cookie, pas de mesure d'audience. Le navigateur des visiteurs ne contacte que GitHub (hébergeur),
l'AMF (GECO) et la BCE ; tout le reste est récupéré par la tâche quotidienne. Stockage local (`localStorage`) :
- plan du simulateur **seulement si** la case « Mémoriser mon plan sur cet appareil » est cochée ;
- réglages des alertes enregistrés par l'utilisateur ;
- caches de données publiques, effacés automatiquement une fois périmés (`nettoyerStockage` dans `js/outils.js`).

Toute nouvelle clé de stockage doit être ajoutée à `CLES_STOCKAGE_SITE` (`js/outils.js`) et décrite sur `confidentialite.html`.
Tout nouveau service contacté par le navigateur doit aussi y être décrit.

## Organisation des fichiers

⚠️ Éviter les noms de fichiers que les bloqueurs de publicités interdisent (ex. `analyse.js`, `analytics.js`, `tracking.js`) :
le fichier ne serait pas chargé chez les visiteurs équipés d'un bloqueur et le site cesserait de fonctionner pour eux.

| Fichier | Rôle |
|---|---|
| `data/annuaire.js` | Liste de tous les fonds (générée par le script) |
| `js/geco.js` | Appels à l'API GECO, calculs sur l'historique, lecture du DIC (pdf.js) |
| `js/inventaire.js` | Moteur 1 : lecture de l'inventaire des rapports annuels (PDF) |
| `js/style.js` | Moteur 2 : analyse des rendements, recherche d'un fonds jumeau |
| `js/composition.js` | Assemble les deux moteurs, cache, préparation des alertes |
| `js/fiche-auto.js` | Fiche automatique : détection des pièges et affichage |
| `js/outils.js` / `js/affichage.js` | Outils partagés : mise en forme des nombres, alertes de concentration, graphiques en barres, liste de résultats |
| `js/glossaire.js` | Explications des infobulles |
| `js/config.js` | Seuils des alertes |
| `js/app.js` | Page « Décrypte ton fonds » : recherche, navigation, réglages |
| `js/performances.js` | Page « Performances » : chargement des séries, graphique interactif, comparaisons |
| `js/projection.js` | Simulateur : historique reconstitué, rendement attendu, Monte Carlo, plan, fiscalité, objectif, crises, portefeuille |
| `js/contexte-fonds.js` | Simulateur : profil d'exposition, sensibilités, tendances technologiques, facteurs économiques, géopolitique, tableau de bord des risques |
| `js/graphiques-simu.js` | Simulateur : graphiques interactifs (éventail, répartition, crise, objectif, comparaison, corrélations) |
| `js/simulateur.js` | Page « Simulateur » : assistant en 4 étapes, chargement des données, calculs et affichage |
| `data/contexte.js` / `data/references.js` / `data/marches.js` | Données mises à jour chaque jour (voir plus haut) |
| `scripts/actualiser_contexte.py` | Script de mise à jour quotidienne (bibliothèque standard Python uniquement) |
| `scripts/actualiser_marches.py` | Marchés et devises du jour : sources par ordre de préférence, repli, cache |
| `scripts/sources/` | Un module par API (format commun dans `commun.py`) |
| `scripts/tests_sources.py` / `scripts/sonder_api.py` | Tests des sources ; sonde de la structure des API à clé |
| `js/marches.js` | Tableau « marchés et devises » de la fiche et du simulateur |
| `js/confidentialite.js` | Page de confidentialité : données du site dans ce navigateur et bouton d'effacement |
| `js/vendor/pdfjs/` | pdf.js 3.11.174 (Mozilla, licence Apache 2.0), hébergé avec le site : aucun appel à un service tiers |
| `js/nav.js` | Onglets communs (le fonds suit d'une page à l'autre) |
| `js/infobulles.js` | Infobulles des termes techniques (toutes les pages) |
| `js/createur.js` | Bouton « Créateur » et son animation |
| `data/resume.js` | Chiffres de l'annuaire affichés sur l'accueil (générés par le script) |

## Feuille de route

1. ✅ Premier prototype (fonds fictifs, retirés depuis)
2. ✅ Annuaire de tous les fonds + fiches automatiques (GECO, ESMA FIRDS, Xetra, OpenFIGI, lecture du DIC)
3. ✅ Composition calculée : inventaire des rapports annuels + analyse des rendements + fonds jumeaux
4. Données de risque (SRI, volatilité) pour les ETF étrangers
5. ✅ Page d'accueil et page « Performances » (graphique interactif, comparaisons)
6. ✅ Mise en ligne (GitHub Pages)
7. ✅ Simulateur de projection (scénarios, Monte Carlo, crises, objectif, comparaison, portefeuille, contexte)
8. Comparaison automatique avec des fonds similaires
