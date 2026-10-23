-- Interrupteur « paiement » (plan du 23/10/2026, comptes gratuits).
-- Paiement coupé (valeur installée) : tout compte connecté a l'accès au simulateur et des simulations illimitées
-- (plafond de 200 et e-mail confirmé toujours exigés) ; aucune simulation offerte n'est consommée.
-- Paiement actif : comportement d'origine (3 simulations offertes, puis abonnement), strictement identique.
-- Rallumer le paiement (éditeur SQL de Supabase ou clé service) :
--   update public.reglages_site set paiement_actif = true;
-- Personne ne lit ni ne modifie ce réglage depuis le navigateur (RLS sans policy, aucun droit pour anon ni authenticated).

create table public.reglages_site (
  id boolean primary key default true check (id),       -- une seule ligne possible
  paiement_actif boolean not null default false
);
insert into public.reglages_site (id, paiement_actif) values (true, false) on conflict (id) do nothing;

alter table public.reglages_site enable row level security;
revoke all on public.reglages_site from public, anon, authenticated;
-- Clé service (tests, bascule) : droits explicites, sans dépendre des droits par défaut du projet
grant select, update on public.reglages_site to service_role;

-- Ligne absente : paiement considéré comme actif, pour ne jamais ouvrir l'accès gratuit par accident
create or replace function public.paiement_actif() returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select r.paiement_actif from public.reglages_site r where r.id), true)
$$;

-- Droits de la personne connectée (utilisé par le contrôle Cloudflare et par les pages) ; note l'activité.
-- Mêmes champs qu'à l'origine, plus « paiement_actif ».
create or replace function public.droit_acces() returns jsonb language plpgsql security definer set search_path = '' as $$
declare p public.profils; nb integer; paiement boolean := public.paiement_actif();
begin
  if auth.uid() is null then raise exception 'non_connecte' using errcode = 'P0001'; end if;
  update public.profils set derniere_activite = now() where id = auth.uid() returning * into p;
  if p.id is null then raise exception 'profil_absent' using errcode = 'P0001'; end if;
  select count(*) into nb from public.simulations where user_id = p.id;
  return jsonb_build_object(
    'abonne', public.est_abonne(p),
    'abonnement_statut', p.abonnement_statut,
    'abonnement_fin', p.abonnement_fin,
    'offertes_restantes', public.nb_offertes() - p.offertes_utilisees,
    'nb_simulations', nb,
    'paiement_actif', paiement,
    'acces', not paiement or public.est_abonne(p) or p.offertes_utilisees < public.nb_offertes() or nb > 0);
end $$;

-- Nouvelle simulation. Paiement actif : illimitée pour un abonné, sinon consomme une des simulations offertes
-- (verrou sur le profil). Paiement coupé : illimitée pour tous (dans la limite de 200), jamais « offerte ».
create or replace function public.demarrer_simulation(p_fonds text, p_nom text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare p public.profils; nb integer; est_offerte boolean := false; nouvelle uuid;
begin
  if auth.uid() is null then raise exception 'non_connecte' using errcode = 'P0001'; end if;
  if not exists (select 1 from auth.users where id = auth.uid() and email_confirmed_at is not null) then
    raise exception 'email_non_confirme' using errcode = 'P0001';
  end if;
  select * into p from public.profils where id = auth.uid() for update;
  select count(*) into nb from public.simulations where user_id = p.id;
  if nb >= 200 then raise exception 'limite_simulations' using errcode = 'P0001'; end if;
  if public.paiement_actif() and not public.est_abonne(p) then
    if p.offertes_utilisees >= public.nb_offertes() then raise exception 'quota_atteint' using errcode = 'P0001'; end if;
    update public.profils set offertes_utilisees = offertes_utilisees + 1, derniere_activite = now() where id = p.id;
    est_offerte := true;
  end if;
  insert into public.simulations (user_id, nom, fonds, offerte)
  values (p.id, left(coalesce(nullif(trim(p_nom), ''), p_fonds), 80), upper(p_fonds), est_offerte)
  returning id into nouvelle;
  return nouvelle;
end $$;

-- Droits : identiques à la migration d'origine ; paiement_actif() n'est appelable que par la base elle-même
-- (les fonctions ci-dessus sont security definer).
revoke execute on function public.paiement_actif() from public, anon, authenticated;
revoke execute on function public.droit_acces(), public.demarrer_simulation(text, text) from public, anon;
grant execute on function public.droit_acces(), public.demarrer_simulation(text, text) to authenticated;
