-- Comptes, 3 simulations offertes et abonnement (conception du 01/10/2026).
-- Le navigateur ne lit que ses propres lignes et ne modifie que le nom et les réglages de ses simulations ;
-- tout le reste passe par des fonctions qui vérifient auth.uid().

create function public.nb_offertes() returns smallint language sql immutable as $$ select 3::smallint $$;

create table public.profils (
  id uuid primary key references auth.users(id) on delete cascade,
  cree_le timestamptz not null default now(),
  offertes_utilisees smallint not null default 0 check (offertes_utilisees between 0 and 3),
  abonnement_statut text not null default 'aucun'
    check (abonnement_statut in ('aucun', 'actif', 'resilie_fin_periode', 'impaye', 'termine')),
  abonnement_fin timestamptz,
  abonnement_evenement timestamptz,          -- date du dernier événement Stripe appliqué : les plus anciens sont ignorés
  stripe_client text unique,
  stripe_abonnement text,
  majeur_confirme_le timestamptz,
  cgv_version text,
  cgv_acceptees_le timestamptz,
  execution_immediate_demandee_le timestamptz,
  derniere_activite timestamptz not null default now(),
  avertissement_inactivite_le timestamptz
);

create table public.simulations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profils(id) on delete cascade,
  nom text not null check (char_length(nom) between 1 and 80),
  fonds text not null check (fonds ~ '^[A-Z0-9]{2,12}$'),
  etat jsonb not null default '{}'::jsonb check (pg_column_size(etat) <= 20480),
  offerte boolean not null default false,
  cree_le timestamptz not null default now(),
  maj_le timestamptz not null default now()
);
create index simulations_par_compte on public.simulations (user_id, maj_le desc);

-- Accès depuis le navigateur
alter table public.profils enable row level security;
alter table public.simulations enable row level security;
revoke all on public.profils, public.simulations from anon, authenticated;
grant select on public.profils to authenticated;
grant select, delete on public.simulations to authenticated;
grant update (nom, etat) on public.simulations to authenticated;

create policy "profil : sa ligne" on public.profils for select to authenticated using (id = (select auth.uid()));
create policy "simulations : lecture" on public.simulations for select to authenticated using (user_id = (select auth.uid()));
create policy "simulations : modification" on public.simulations for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "simulations : suppression" on public.simulations for delete to authenticated using (user_id = (select auth.uid()));

-- Date de modification
create function public.toucher_simulation() returns trigger language plpgsql set search_path = '' as $$
begin new.maj_le := now(); return new; end $$;
create trigger avant_maj_simulation before update on public.simulations for each row execute function public.toucher_simulation();

-- Profil créé à l'inscription, avec les consentements donnés dans le formulaire (métadonnées d'inscription)
create function public.creer_profil() returns trigger language plpgsql security definer set search_path = '' as $$
declare m jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
begin
  insert into public.profils (id, majeur_confirme_le, cgv_version, cgv_acceptees_le)
  values (new.id,
          case when m->>'majeur' = 'true' then now() end,
          m->>'cgv_version',
          case when m ? 'cgv_version' then now() end);
  return new;
end $$;
create trigger apres_inscription after insert on auth.users for each row execute function public.creer_profil();

create function public.est_abonne(p public.profils) returns boolean language sql stable set search_path = '' as $$
  select p.abonnement_statut in ('actif', 'resilie_fin_periode') and coalesce(p.abonnement_fin > now(), false)
$$;

-- Droits de la personne connectée (utilisé par le contrôle Cloudflare et par les pages) ; note l'activité
create function public.droit_acces() returns jsonb language plpgsql security definer set search_path = '' as $$
declare p public.profils; nb integer;
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
    'acces', public.est_abonne(p) or p.offertes_utilisees < public.nb_offertes() or nb > 0);
end $$;

-- Nouvelle simulation : illimitée pour un abonné, sinon consomme une des simulations offertes (verrou sur le profil)
create function public.demarrer_simulation(p_fonds text, p_nom text) returns uuid
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
  if not public.est_abonne(p) then
    if p.offertes_utilisees >= public.nb_offertes() then raise exception 'quota_atteint' using errcode = 'P0001'; end if;
    update public.profils set offertes_utilisees = offertes_utilisees + 1, derniere_activite = now() where id = p.id;
    est_offerte := true;
  end if;
  insert into public.simulations (user_id, nom, fonds, offerte)
  values (p.id, left(coalesce(nullif(trim(p_nom), ''), p_fonds), 80), upper(p_fonds), est_offerte)
  returning id into nouvelle;
  return nouvelle;
end $$;

create function public.demander_execution_immediate() returns void language sql security definer set search_path = '' as $$
  update public.profils set execution_immediate_demandee_le = now() where id = auth.uid();
$$;

-- Comptes inactifs : avertir à 23 mois, supprimer 30 jours après l'avertissement (jamais un abonné)
create function public.comptes_a_entretenir() returns table (id uuid, email text, action text)
language sql security definer set search_path = '' as $$
  with c as (
    select p.id, u.email::text as email, p.avertissement_inactivite_le as avert,
           greatest(p.derniere_activite, coalesce(u.last_sign_in_at, p.cree_le)) as activite
    from public.profils p join auth.users u on u.id = p.id
    where not public.est_abonne(p)
  )
  select c.id, c.email,
         case when c.avert > c.activite and c.avert < now() - interval '30 days' then 'supprimer' else 'avertir' end
  from c
  where c.activite < now() - interval '23 months'
    and (c.avert is null or c.avert < c.activite or c.avert < now() - interval '30 days')
  limit 50
$$;

revoke execute on all functions in schema public from public, anon;
grant execute on function public.droit_acces(), public.demarrer_simulation(text, text), public.demander_execution_immediate(),
  public.nb_offertes(), public.est_abonne(public.profils) to authenticated;
revoke execute on function public.comptes_a_entretenir(), public.creer_profil(), public.toucher_simulation() from authenticated;
