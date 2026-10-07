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
