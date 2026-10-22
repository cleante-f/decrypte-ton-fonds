// CVE-2024-4367 (pdf.js 3.11) : un PDF piégé pouvait exécuter du JavaScript via une police.
// Tous les appels à getDocument doivent désactiver isEvalSupported.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

for (const fichier of ['js/geco.js', 'js/inventaire.js']) {
  test(`${fichier} : getDocument avec isEvalSupported: false`, () => {
    const src = readFileSync(new URL('../' + fichier, import.meta.url), 'utf8');
    const appels = src.match(/getDocument\(\{[^}]*\}\)/g) || [];
    assert.ok(appels.length > 0, 'aucun appel getDocument trouvé');
    for (const a of appels) assert.match(a, /isEvalSupported:\s*false/);
  });
}
