import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";

const lire = f => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
function charger(fichiers, globales = {}) {
  const ctx = vm.createContext({ console, ...globales });
  for (const f of fichiers) vm.runInContext(lire(f), ctx, { filename: f });
  return ctx;
}
const proche = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≠ ${b}`);
const { impotALaSortie } = charger(["js/outils.js", "js/projection.js"]);

test("PEE : gains exonérés d'impôt sur le revenu, 18,6 % de prélèvements sociaux, quelle que soit la durée", () => {
  proche(impotALaSortie({ enveloppe: "pee" }, 15000, 10000, 3), 5000 * 0.186);
  proche(impotALaSortie({ enveloppe: "pee" }, 15000, 10000, 12), 5000 * 0.186);
  assert.equal(impotALaSortie({ enveloppe: "pee" }, 9000, 10000, 6), 0);
});

test("les autres enveloppes ne changent pas", () => {
  proche(impotALaSortie({ enveloppe: "cto" }, 15000, 10000, 3), 5000 * 0.314);
  proche(impotALaSortie({ enveloppe: "pea" }, 15000, 10000, 6), 5000 * 0.186);
  proche(impotALaSortie({ enveloppe: "pea" }, 15000, 10000, 3), 5000 * 0.314);
});

test("infobulle « Enveloppe » : taux de chaque enveloppe, identiques à ceux du calcul", () => {
  const c = charger(["js/glossaire.js", "js/outils.js", "js/projection.js"]);
  const texte = vm.runInContext('GLOSSAIRE.enveloppe_fiscale || ""', c);
  const F = vm.runInContext("FISCALITE_FR", c);
  const taux = x => x.toFixed(1).replace(".", ",").replace(/,0$/, "") + " %";
  const espaces = s => s.replace(/[\u202f\u00a0]/g, " ");
  for (const mot of ["Compte-titres", "PEA", "Assurance-vie", "PEE"]) assert.ok(texte.includes(mot), mot);
  for (const t of [taux(F.pfu.ir + F.pfu.ps), taux(F.pea.ps), taux(F.av.irAvant + F.av.ps), taux(F.av.ps), taux(F.av.irApres), taux(F.pee.ps)])
    assert.ok(texte.includes(t), t);
  assert.ok(espaces(texte).includes(espaces(F.av.abattement.toLocaleString("fr-FR")) + " €"));
  assert.ok(texte.length < 600, "explication brève");
  // l'infobulle s'ouvre en touchant le mot « Enveloppe » à côté du menu
  assert.ok(lire("js/simulateur.js").includes('terme("enveloppe_fiscale", "Enveloppe")'));
});
