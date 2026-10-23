// Vérifications hors ligne de la migration « interrupteur paiement » (les vrais tests de la base sont dans test_supabase.py).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const lire = nom => readFileSync(new URL(`../supabase/migrations/${nom}`, import.meta.url), "utf8")
  .replace(/--.*$/gm, "").replace(/\s+/g, " ").toLowerCase();   // sans commentaires, sur une ligne
const sql = lire("20261023000000_paiement.sql");
const origine = lire("20261001000000_comptes.sql");

function corps(texte, debutTexte) {
  const debut = texte.indexOf(debutTexte);
  assert.ok(debut >= 0, `${debutTexte} absent`);
  const fin = texte.indexOf("$$;", texte.indexOf("$$", debut) + 2);
  return texte.slice(debut, fin + 3);
}
// Définition de la fonction (« create function » à l'origine, « create or replace function » ici)
const fonction = (texte, nom) => corps(texte, `${texte === origine ? "create" : "create or replace"} function public.${nom}(`);

test("table reglages_site : une seule ligne, paiement coupé par défaut et à l'installation", () => {
  const debut = sql.indexOf("create table public.reglages_site (");
  assert.ok(debut >= 0);
  const table = sql.slice(debut, sql.indexOf(");", debut) + 2);
  assert.match(table, /id boolean primary key default true check \(id\)/);
  assert.match(table, /paiement_actif boolean not null default false/);
  assert.match(sql, /insert into public\.reglages_site \(id, paiement_actif\) values \(true, false\)/);
});

test("reglages_site : RLS activée, aucune policy, aucun droit pour le navigateur", () => {
  assert.match(sql, /alter table public\.reglages_site enable row level security;/);
  assert.doesNotMatch(sql, /create policy/);
  assert.match(sql, /revoke all on public\.reglages_site from public, anon, authenticated;/);
  for (const g of sql.match(/grant [^;]*;/g) || []) {
    if (g.includes("reglages_site")) assert.match(g, / to service_role;$/, g);
  }
});

test("paiement_actif() : security definer, search_path vide, vrai si la ligne manque", () => {
  const f = fonction(sql, "paiement_actif");
  assert.match(f, /create or replace function public\.paiement_actif\(\) returns boolean language sql stable security definer set search_path = ''/);
  assert.match(f, /coalesce\(\(select r\.paiement_actif from public\.reglages_site r where r\.id\), true\)/);
  // réservée à la base : pas appelable depuis le navigateur
  assert.match(sql, /revoke execute on function public\.paiement_actif\(\) from public, anon, authenticated;/);
});

test("droit_acces() : mêmes champs, plus paiement_actif ; accès ouvert à tout profil quand le paiement est coupé", () => {
  const f = fonction(sql, "droit_acces");
  assert.match(f, /create or replace function public\.droit_acces\(\) returns jsonb language plpgsql security definer set search_path = ''/);
  for (const champ of ["abonne", "abonnement_statut", "abonnement_fin", "offertes_restantes", "nb_simulations", "acces", "paiement_actif"]) {
    assert.ok(f.includes(`'${champ}',`), champ);
  }
  assert.ok(f.includes("raise exception 'non_connecte'") && f.includes("raise exception 'profil_absent'"));
  assert.ok(f.includes("update public.profils set derniere_activite = now() where id = auth.uid() returning * into p;"));
  // paiement actif : exactement la règle d'origine
  const regle = "public.est_abonne(p) or p.offertes_utilisees < public.nb_offertes() or nb > 0";
  assert.ok(fonction(origine, "droit_acces").includes(regle));
  assert.ok(f.includes(`'acces', not paiement or ${regle}`), "règle d'accès");
  assert.match(f, /paiement boolean := public\.paiement_actif\(\);/);
});

test("demarrer_simulation() : quota seulement quand le paiement est actif ; e-mail confirmé et plafond de 200 toujours exigés", () => {
  const f = fonction(sql, "demarrer_simulation");
  assert.match(f, /create or replace function public\.demarrer_simulation\(p_fonds text, p_nom text\) returns uuid language plpgsql security definer set search_path = ''/);
  const ordre = ["raise exception 'non_connecte'", "raise exception 'email_non_confirme'", "for update;",
    "if nb >= 200 then raise exception 'limite_simulations'", "if public.paiement_actif() and not public.est_abonne(p) then",
    "raise exception 'quota_atteint'", "offertes_utilisees = offertes_utilisees + 1", "est_offerte := true;",
    "insert into public.simulations"];
  let pos = -1;
  for (const morceau of ordre) {
    const i = f.indexOf(morceau, pos + 1);
    assert.ok(i > pos, `${morceau} absent ou mal placé`);
    pos = i;
  }
  // un seul endroit consomme une simulation offerte, sous la condition « paiement actif »
  assert.equal(f.split("offertes_utilisees + 1").length, 2);
  assert.match(f, /est_offerte boolean := false;/);
  // le reste du corps est celui d'origine
  const o = fonction(origine, "demarrer_simulation");
  for (const ligne of ["select * into p from public.profils where id = auth.uid() for update;",
    "select count(*) into nb from public.simulations where user_id = p.id;",
    "values (p.id, left(coalesce(nullif(trim(p_nom), ''), p_fonds), 80), upper(p_fonds), est_offerte)"]) {
    assert.ok(o.includes(ligne) && f.includes(ligne), ligne);
  }
});

test("droits des fonctions identiques à la migration d'origine, rien de plus ouvert", () => {
  assert.match(sql, /revoke execute on function public\.droit_acces\(\), public\.demarrer_simulation\(text, text\) from public, anon;/);
  assert.match(sql, /grant execute on function public\.droit_acces\(\), public\.demarrer_simulation\(text, text\) to authenticated;/);
  const grants = sql.match(/grant [^;]*;/g) || [];
  for (const g of grants) assert.doesNotMatch(g, /\b(anon|public)\b(?!\.)/, g);
  assert.ok(!grants.some(g => g.includes("paiement_actif()")), "paiement_actif() jamais accordée");
});

test("entretien des comptes inactifs inchangé", () => {
  assert.doesNotMatch(sql, /comptes_a_entretenir/);
  assert.doesNotMatch(sql, /alter table public\.profils/);
});
