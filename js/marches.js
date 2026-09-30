/*
 * Marchés et devises du jour, pour les zones où investit un fonds.
 * Les données viennent de data/marches.js (fichier du site, mis à jour chaque jour par scripts/actualiser_marches.py) :
 * le navigateur n'appelle jamais une API extérieure. Utilisé par la fiche Décryptage et par le simulateur.
 */

const ZONES_MARCHES = ["usa", "euro", "europe", "japon", "emergents"];
const DEVISES_DES_ZONES = { usa: ["USD"], europe: ["GBP", "CHF"], japon: ["JPY"], emergents: ["CNY"] };
const NOMS_DEVISES = { USD: "Dollar américain", GBP: "Livre sterling", CHF: "Franc suisse", JPY: "Yen japonais", CNY: "Yuan chinois" };
const ZONE_DU_NOM = { "Amérique du Nord": "usa", "Zone euro": "euro", "Europe hors zone euro": "europe", "Asie-Pacifique développée": "japon", "Pays émergents": "emergents" };

function donneesMarches() { return typeof MARCHES !== "undefined" ? MARCHES : null; }

// Poids du fonds par grande zone (en %), d'après la composition calculée (analyse des rendements, sinon zones de l'inventaire)
function poidsParZone(c) {
  if (!c) return null;
  const p = { usa: 0, tech: 0, euro: 0, europe: 0, japon: 0, emergents: 0 };
  if (c.style && c.style.r2 >= 0.5 && c.style.expositions) {
    for (const x of c.style.expositions) if (x.cle in p) p[x.cle] += x.poids;
    p.usa += p.tech;
    return p;
  }
  if (c.zones && c.zones.length) {
    for (const z of c.zones) if (ZONE_DU_NOM[z.nom]) p[ZONE_DU_NOM[z.nom]] += z.poids;
    return p;
  }
  return null;
}

function variationMarche(v) {
  if (v === null || v === undefined) return "—";
  const r = Math.round(v * 10) / 10;   // arrondi d'abord : −0,04 % s'affiche « 0,0 % », sans signe
  return `<span class="${r > 0 ? "hausse" : r < 0 ? "baisse" : ""}">${r > 0 ? "+" : r < 0 ? "−" : ""}${pct(Math.abs(r), 1)}</span>`;
}

function heureMaj(iso) { return new Date(iso).toLocaleString("fr-FR", { dateStyle: "long", timeStyle: "short" }); }
function jourFr(iso) { return new Date(iso + "T12:00:00").toLocaleDateString("fr-FR"); }

// État d'un bloc : secours, dernière valeur connue ou indisponible (jamais de page cassée)
function etatMarches(b, quoi) {
  if (b.etat === "secours") return `<p class="note">Source principale indisponible : ${quoi} viennent de la source de secours (${esc(b.source)}).</p>`;
  if (b.etat === "ancien") return `<p class="note">${esc(b.message)}</p>`;
  return "";
}
function sourceMarches(b) {
  return b && b.maj ? `${esc(b.mention)} (<a href="${esc(b.lien)}" target="_blank" rel="noopener">source</a>), mise à jour le ${heureMaj(b.maj)}` : "";
}

/*
 * poids : { usa, tech, euro, europe, japon, emergents } en % du fonds ; couvert : part couverte contre le change.
 * Renvoie "" quand le fonds n'investit pas dans ces marchés (fonds obligataire ou monétaire en euros, par exemple).
 */
function blocMarchesDevises(poids, { couvert = false } = {}) {
  const M = donneesMarches();
  if (!M || !poids) return "";
  const zones = ZONES_MARCHES.filter(z => (poids[z] || 0) >= 5).sort((a, b) => poids[b] - poids[a]);
  if (!zones.length) return "";
  const m = M.marches || {}, ch = M.change || {};
  const indices = m.indices || {};
  const lignes = [...(zones.length >= 3 ? ["monde"] : []), ...zones.flatMap(z => z === "usa" && poids.tech >= 5 ? ["usa", "tech"] : [z])].filter(k => indices[k]);
  const devises = [...new Set(zones.flatMap(z => DEVISES_DES_ZONES[z] || []))].filter(d => ch.taux && ch.taux[d]);

  const tableMarches = m.etat === "indisponible" || !lignes.length ? nonDispo(m.message || "Marchés indisponibles.") : `
    <div class="cadre-tableau"><table class="tableau-marches">
      <thead><tr><th scope="col">Marché</th><th scope="col">Part du fonds</th><th scope="col">1 jour</th><th scope="col">1 mois</th><th scope="col">Depuis le 1er janvier</th><th scope="col">1 an</th></tr></thead>
      <tbody>${lignes.map(k => { const x = indices[k];
        return `<tr><th scope="row">${esc(x.nom)} <small><a href="${esc(x.ref.lien)}" target="_blank" rel="noopener" title="${esc(x.ref.nom)}">${esc(x.indice)}</a></small></th>
          <td>${k === "monde" ? "—" : `≈ ${pct(poids[k], 0)}`}</td><td>${variationMarche(x.j1)}</td><td>${variationMarche(x.m1)}</td><td>${variationMarche(x.debutAnnee)}</td><td>${variationMarche(x.a1)}</td></tr>`; }).join("")}</tbody>
    </table></div>
    <p class="aide">Cours au ${jourFr(indices[lignes[0]].date)}. ${m.devise === "EUR"
      ? "Chaque marché est mesuré par un fonds indiciel en euros : pour les marchés hors zone euro, les chiffres incluent déjà l'effet du change."
      : "Mesures en dollars (source de secours) : elles n'incluent pas l'effet du change pour un épargnant en euros."} Les performances passées ne préjugent pas des performances futures.</p>`;

  const tableDevises = !devises.length ? "" : ch.etat === "indisponible" ? nonDispo(ch.message || "Taux de change indisponibles.") : `
    <div class="cadre-tableau"><table class="tableau-marches">
      <thead><tr><th scope="col">Devise</th><th scope="col">1 € vaut</th><th scope="col">Face à l'euro, sur 1 an</th></tr></thead>
      <tbody>${devises.map(d => { const t = ch.taux[d];
        const effet = t.unAn ? (t.unAn / t.valeur - 1) * 100 : null;   // > 0 : la devise s'est renforcée, un placement dans cette devise vaut plus en euros
        return `<tr><th scope="row">${esc(NOMS_DEVISES[d] || d)}</th><td>${t.valeur.toLocaleString("fr-FR", { maximumFractionDigits: t.valeur >= 100 ? 2 : 4 })} ${esc(d)}</td><td>${variationMarche(effet === null ? null : Math.round(effet * 100) / 100)}</td></tr>`; }).join("")}</tbody>
    </table></div>
    <p class="aide">Taux du ${jourFr(ch.date)}. Quand une devise gagne face à l'euro, les placements dans cette devise valent plus une fois convertis en euros (et inversement).${couvert ? " <strong>Cette part est couverte contre le risque de change</strong> : ces variations la touchent peu." : ""}</p>`;

  return `${etatMarches(m, "les cours")}${tableMarches}
    ${devises.length ? `${etatMarches(ch, "les taux de change")}${tableDevises}` : ""}
    <p class="source">${[sourceMarches(m), devises.length ? sourceMarches(ch) : ""].filter(Boolean).join(" · ")}.</p>`;
}
