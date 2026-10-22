// Vérifications hors ligne de la migration « fonds suivis et alertes » (les vrais tests de la base sont dans test_supabase.py).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const brut = readFileSync(new URL("../supabase/migrations/20261022000000_suivi_alertes.sql", import.meta.url), "utf8");
const sql = brut.replace(/--.*$/gm, "").replace(/\s+/g, " ").toLowerCase();   // sans commentaires, sur une ligne
const TABLES = ["fonds_suivis", "preferences_alertes", "etat_fonds_suivis"];

function corpsTable(nom) {
  const debut = sql.indexOf(`create table public.${nom} (`);
  assert.ok(debut >= 0, `table ${nom} absente`);
  let profondeur = 0;
  for (let i = sql.indexOf("(", debut); i < sql.length; i++) {
    if (sql[i] === "(") profondeur++;
    if (sql[i] === ")" && --profondeur === 0) return sql.slice(debut, i + 1);
  }
  throw new Error(`table ${nom} non fermée`);
}
const policies = [...sql.matchAll(/create policy "[^"]+" on public\.(\w+) for (\w+) to (\w+)([^;]*);/g)]
  .map(([, table, action, role, reste]) => ({ table, action, role, reste }));

test("les trois tables existent, avec la RLS activée", () => {
  for (const t of TABLES) {
    corpsTable(t);
    assert.ok(sql.includes(`alter table public.${t} enable row level security;`), t);
  }
});

test("navigateur : tous les droits retirés d'abord, aucun droit ni policy sur l'état des fonds", () => {
  assert.match(sql, /revoke all on public\.fonds_suivis, public\.preferences_alertes, public\.etat_fonds_suivis from anon, authenticated;/);
  assert.equal(policies.filter(p => p.table === "etat_fonds_suivis").length, 0);
  assert.doesNotMatch(sql, /grant [^;]* on (table )?public\.etat_fonds_suivis/);
  assert.equal(policies.filter(p => p.role !== "authenticated").length, 0);   // jamais anon ni public
});

test("fonds suivis et préférences : lecture, ajout, modification, suppression de ses lignes seulement", () => {
  for (const t of ["fonds_suivis", "preferences_alertes"]) {
    const actions = policies.filter(p => p.table === t).map(p => p.action).sort();
    assert.deepEqual(actions, ["delete", "insert", "select", "update"], t);
    const propre = "(user_id = (select auth.uid()))";
    const attendu = { select: `using ${propre}`, delete: `using ${propre}`, insert: `with check ${propre}`,
      update: `using ${propre} with check ${propre}` };
    for (const p of policies.filter(p => p.table === t)) assert.equal(p.reste.trim(), attendu[p.action], `${t} ${p.action}`);
  }
});

test("suppression du compte : fonds suivis et préférences effacés en cascade", () => {
  assert.match(corpsTable("fonds_suivis"), /user_id uuid not null default auth\.uid\(\) references public\.profils\(id\) on delete cascade/);
  assert.match(corpsTable("fonds_suivis"), /primary key \(user_id, cle_fonds\)/);
  assert.match(corpsTable("preferences_alertes"), /user_id uuid primary key default auth\.uid\(\) references public\.profils\(id\) on delete cascade/);
});

test("préférences : valeurs par défaut et seuil de baisse 5, 10, 20 ou aucun", () => {
  const t = corpsTable("preferences_alertes");
  for (const c of ["actives", "nouveau_dic", "frais", "risque"]) assert.match(t, new RegExp(`${c} boolean not null default true`));
  assert.match(t, /seuil_baisse integer check \(seuil_baisse in \(5, 10, 20\)\)/);
  assert.doesNotMatch(t, /seuil_baisse integer not null/);
  assert.match(t, /reglages_fiche jsonb not null default '\{\}'::jsonb/);
});

test("état des fonds : colonnes attendues", () => {
  const t = corpsTable("etat_fonds_suivis");
  for (const c of ["cle_fonds text primary key", "date_dic text", "frais numeric", "sri integer", "valeur numeric",
    "date_valeur date", "historique jsonb", "maj timestamptz"]) assert.ok(t.includes(c), c);
});

test("31e fonds refusé par un déclencheur avant ajout (limite_fonds_suivis)", () => {
  const debut = sql.indexOf("create function public.limiter_fonds_suivis()");
  assert.ok(debut >= 0);
  const fonction = sql.slice(debut, sql.indexOf("end $$;", debut));
  assert.match(fonction, /security definer set search_path = ''/);
  assert.match(fonction, /for update/);                                  // verrou : pas de dépassement par deux ajouts simultanés
  assert.match(fonction, />= 30 then raise exception 'limite_fonds_suivis'/);
  assert.match(sql, /create trigger \w+ before insert on public\.fonds_suivis for each row execute function public\.limiter_fonds_suivis\(\);/);
  assert.match(sql, /revoke execute on function public\.limiter_fonds_suivis\(\) from public, anon, authenticated;/);
});

test("ajout côté navigateur : ajoute_le reste fixé par la base", () => {
  const insert = sql.match(/grant insert \(([^)]*)\) on public\.fonds_suivis to authenticated;/);
  assert.ok(insert);
  assert.deepEqual(insert[1].split(",").map(s => s.trim()).sort(), ["cle_fonds", "user_id"]);
  assert.doesNotMatch(sql, /grant (insert|update|all)( on|, [^;]*) public\.fonds_suivis/);    // pas de droit sur toutes les colonnes
});
