import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";

const lire = f => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
const simple = x => JSON.parse(JSON.stringify(x));
function charger(fichiers, globales = {}) {
  const ctx = vm.createContext({ console, ...globales });
  for (const f of fichiers) vm.runInContext(lire(f), ctx, { filename: f });
  return ctx;
}

test("cleSociete : mêmes résultats que le Python", () => {
  const { cleSociete } = charger(["js/outils.js"]);
  for (const [nom, attendu] of JSON.parse(lire("tests/donnees/noms_societes.json"))) assert.equal(cleSociete(nom), attendu, nom);
  assert.equal(cleSociete(null), "");
});
