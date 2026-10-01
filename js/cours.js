// Cours de bourse des fonds étrangers : relevés chaque jour par scripts/actualiser_cours.py dans data/cours/
// à partir des données différées gratuites de Deutsche Börse (Xetra et Bourse de Francfort).
// Les fichiers sont publiés avec le site : le navigateur ne contacte aucun autre service.

const LIEUX_COURS = { X: "clôture Xetra", F: "Bourse de Francfort" };
const FRAGMENTS_COURS = 32;

// Même découpage que le script Python : somme des codes des caractères de l'ISIN modulo 32
function fragmentCours(isin) {
  let s = 0;
  for (const c of isin) s += c.charCodeAt(0);
  return String(s % FRAGMENTS_COURS).padStart(2, "0");
}

async function chargerCours(isin) {
  if (!isin) return null;
  const index = await (await fetch("data/cours/index.json", { cache: "no-cache" })).json();
  const nn = fragmentCours(isin);
  const annees = await Promise.all(index.annees.map(a =>
    fetch(`data/cours/${a}/${nn}.json`).then(r => (r.ok ? r.json() : null)).catch(() => null)));
  const dates = [], valeurs = [], lieux = [];
  for (const f of annees) {
    if (!f || !f.c[isin]) continue;
    f.c[isin].forEach((v, k) => {
      if (v === null) return;
      dates.push(new Date(f.jours[k] + "T00:00:00"));
      valeurs.push(v);
      lieux.push(f.l[isin][k]);
    });
  }
  if (!valeurs.length) return null;
  return { historique: { dates, valeurs, corrections: [] }, lieu: LIEUX_COURS[lieux[lieux.length - 1]] || "Deutsche Börse", maj: index.maj };
}
