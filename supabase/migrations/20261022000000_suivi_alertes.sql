-- Liste de suivi et alertes par e-mail (conception du 22/10/2026).
-- Le navigateur lit et modifie ses propres fonds suivis et préférences ; l'état des fonds (dernier DIC, frais, SRI, valeurs)
-- n'est lu et écrit que par la tâche quotidienne, avec la clé « service » (aucune policy pour anon ni authenticated).
-- Suppression du compte : auth.users → profils → fonds suivis et préférences, en cascade.

create table public.fonds_suivis (
  user_id uuid not null default auth.uid() references public.profils(id) on delete cascade,
  -- Clé d'adresse du site (cleEntree) : ISIN ou lettre de source + numéro, toujours en majuscules
  cle_fonds text not null check (char_length(cle_fonds) between 1 and 40 and cle_fonds ~ '^[A-Za-z0-9._-]+$'
                                 and cle_fonds = upper(cle_fonds)),
  ajoute_le timestamptz not null default now(),
  primary key (user_id, cle_fonds)
);
create index fonds_suivis_par_fonds on public.fonds_suivis (cle_fonds);

create table public.preferences_alertes (
  user_id uuid primary key default auth.uid() references public.profils(id) on delete cascade,
  actives boolean not null default true,
  nouveau_dic boolean not null default true,
  frais boolean not null default true,
  risque boolean not null default true,
  seuil_baisse integer check (seuil_baisse in (5, 10, 20)),     -- null : alerte de baisse désactivée
  reglages_fiche jsonb not null default '{}'::jsonb check (pg_column_size(reglages_fiche) <= 20480)
);

create table public.etat_fonds_suivis (
  cle_fonds text primary key,
  date_dic text,
  frais numeric,
  sri integer,
  valeur numeric,
  date_valeur date,
  historique jsonb,
  maj timestamptz
);

-- Accès depuis le navigateur
alter table public.fonds_suivis enable row level security;
alter table public.preferences_alertes enable row level security;
alter table public.etat_fonds_suivis enable row level security;
revoke all on public.fonds_suivis, public.preferences_alertes, public.etat_fonds_suivis from anon, authenticated;
-- Tâche quotidienne (clé service) : droits explicites, sans dépendre des droits par défaut du projet
grant select, insert, update, delete on public.fonds_suivis, public.preferences_alertes, public.etat_fonds_suivis to service_role;
grant select, delete on public.fonds_suivis to authenticated;
grant insert (user_id, cle_fonds) on public.fonds_suivis to authenticated;
-- user_id dans les droits de modification : nécessaire aux ajouts « fusionner les doublons » (upsert) ; les policies
-- « with check » empêchent de l'attribuer à quelqu'un d'autre.
grant update (user_id, cle_fonds) on public.fonds_suivis to authenticated;
grant select, delete on public.preferences_alertes to authenticated;
grant insert (user_id, actives, nouveau_dic, frais, risque, seuil_baisse, reglages_fiche) on public.preferences_alertes to authenticated;
grant update (user_id, actives, nouveau_dic, frais, risque, seuil_baisse, reglages_fiche) on public.preferences_alertes to authenticated;

create policy "fonds suivis : lecture" on public.fonds_suivis for select to authenticated using (user_id = (select auth.uid()));
create policy "fonds suivis : ajout" on public.fonds_suivis for insert to authenticated with check (user_id = (select auth.uid()));
create policy "fonds suivis : modification" on public.fonds_suivis for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "fonds suivis : suppression" on public.fonds_suivis for delete to authenticated using (user_id = (select auth.uid()));

create policy "préférences : lecture" on public.preferences_alertes for select to authenticated using (user_id = (select auth.uid()));
create policy "préférences : ajout" on public.preferences_alertes for insert to authenticated with check (user_id = (select auth.uid()));
create policy "préférences : modification" on public.preferences_alertes for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "préférences : suppression" on public.preferences_alertes for delete to authenticated using (user_id = (select auth.uid()));

-- 30 fonds suivis au plus par personne.
-- security invoker : le compte ne porte que sur les lignes que la RLS laisse voir à l'appelant. Ajouter au nom d'un autre
-- ne révèle donc rien (ni sa liste ni s'il a atteint la limite) : la policy « with check » refuse ensuite l'ajout (403).
-- Verrou consultatif par utilisateur, libéré en fin de transaction : deux ajouts simultanés ne dépassent pas la limite,
-- sans verrouiller la ligne du profil.
create function public.limiter_fonds_suivis() returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  -- Fonds déjà suivi : on laisse la clé primaire régler le doublon (ajout « ignore les doublons » possible à 30 fonds)
  if exists (select 1 from public.fonds_suivis where user_id = new.user_id and cle_fonds = new.cle_fonds) then return new; end if;
  perform pg_advisory_xact_lock(hashtext(new.user_id::text));
  if (select count(*) from public.fonds_suivis where user_id = new.user_id) >= 30 then
    raise exception 'limite_fonds_suivis' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger avant_ajout_fonds_suivi before insert on public.fonds_suivis
  for each row execute function public.limiter_fonds_suivis();

revoke execute on function public.limiter_fonds_suivis() from public, anon, authenticated;
