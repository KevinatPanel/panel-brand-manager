-- Unify company identity: deals becomes a true child of leads instead of a
-- disconnected record with its own free-text brand_name/vertical.
--
-- The problem: leads.deal_id was a nullable, non-FK soft pointer, populated by
-- exactly one code path (start_outreach()). Two other paths inserted straight
-- into deals with a free-typed brand_name and NO lead_id at all — the
-- standalone "+ Add Deal" modal (Outreach/Meetings) and the Gmail review
-- queue's "Create deal" button (accept_email_suggestion_as_deal, 0007).
-- Nothing stopped either from creating a second, disconnected record for a
-- company that already had a leads row, so the same real-world company could
-- silently exist as an unrelated leads row (Directory) and an orphan deals
-- row (Outreach/Meetings) with no link between them.
--
-- The fix: give every deal a required, unique, real FK to leads, retire the
-- deal-side copies of company_name/vertical (leads is now the single source
-- of truth), and make both deal-creation paths resolve-or-create a lead
-- first instead of inserting a disconnected deal.

-- 1) Backfill a verticals row for any deals.vertical text not already present
--    (mirrors client-side resolveVertical() in api.js).
insert into public.verticals (name, created_at)
select distinct d.vertical, now()
  from public.deals d
 where d.vertical is not null and btrim(d.vertical) <> ''
   and not exists (select 1 from public.verticals v where v.name = d.vertical);

-- 2a) Link each orphan deal to an existing, not-yet-linked lead when its
--     brand_name matches a leads.company_name exactly (case-insensitively).
--     Checked against prod before writing this: 147 of 165 deals were
--     orphans, and 68 of those had an exact-name match to an existing,
--     unlinked Directory row — auto-creating a new lead for every orphan
--     (the original plan) would have manufactured 68 obvious duplicates on
--     top of the ones this migration exists to stop creating. A simple
--     greedy stable match (each side must be the other's top pick, ordered
--     by id) keeps this a 1:1 pairing even if names collide on both sides.
with orphans as (
  select d.id as deal_id, d.brand_name
    from public.deals d
   where not exists (select 1 from public.leads l where l.deal_id = d.id)
),
candidates as (
  select o.deal_id, l.id as lead_id,
         row_number() over (partition by o.deal_id order by l.id) as rn_deal,
         row_number() over (partition by l.id order by o.deal_id) as rn_lead
    from orphans o
    join public.leads l
      on l.deal_id is null
     and lower(btrim(l.company_name)) = lower(btrim(o.brand_name))
),
matched as (
  select deal_id, lead_id from candidates where rn_deal = 1 and rn_lead = 1
)
update public.leads l
   set deal_id = m.deal_id, in_pipeline = true, updated_at = now()
  from matched m
 where l.id = m.lead_id;

-- 2b) Anything still orphaned after the name-match pass gets a freshly
--     created lead — this won't catch a company that already has a
--     *separate* leads row under a differently-spelled name; that's a known,
--     accepted limitation (see the plan) rather than something this
--     migration attempts to fuzzy-match.
insert into public.leads
  (company_name, vertical_id, in_pipeline, deal_id, score, score_updated_at, created_at, updated_at)
select d.brand_name, v.id, true, d.id, 0, d.created_at, d.created_at, d.updated_at
  from public.deals d
  left join public.verticals v on v.name = d.vertical
 where not exists (select 1 from public.leads l where l.deal_id = d.id);

-- 3) Add deals.lead_id, backfill from leads.deal_id (now covers every deal —
--    both the pre-existing links from start_outreach() and the orphans just
--    backfilled above), then lock it down: required, one deal per lead, real FK.
alter table public.deals add column lead_id bigint;

update public.deals d
   set lead_id = l.id
  from public.leads l
 where l.deal_id = d.id;

alter table public.deals
  alter column lead_id set not null,
  add constraint deals_lead_id_unique unique (lead_id),
  add constraint deals_lead_id_fkey foreign key (lead_id) references public.leads(id);

-- 4) Company name and vertical now live only on leads — drop deals' stale,
--    never-synced copies so there's a single source of truth. deal_summaries
--    (d.*-based) depends on both columns, so it has to go first.
drop view if exists public.deal_summaries;
alter table public.deals drop column brand_name;
alter table public.deals drop column vertical;

-- 5) Recreate deal_summaries (same "drop + recreate the whole body verbatim"
--    pattern as 0016/0017/0027 — Postgres views can't add a column, and this
--    view has silently lost columns before from partial edits) joined to
--    leads/verticals so callers read company_name/domain/is_client through
--    the FK instead of a disconnected copy.
create view public.deal_summaries with (security_invoker = true) as
select d.*,
  l.company_name,
  l.domain,
  l.is_client,
  l.vertical_id,
  v.name as vertical_name,
  (select sh.entered_at
     from public.stage_history sh
    where sh.deal_id = d.id and sh.stage = d.current_stage
    order by sh.entered_at desc, sh.id desc
    limit 1) as current_stage_entered_at,
  (select min(sh.entered_at)
     from public.stage_history sh
    where sh.deal_id = d.id) as pipeline_entered_at,
  (select max(t.touch_date)
     from public.touch_log t
    where t.deal_id = d.id
      and t.touch_date >= coalesce(
        (select sh.entered_at
           from public.stage_history sh
          where sh.deal_id = d.id and sh.stage = d.current_stage
          order by sh.entered_at desc, sh.id desc
          limit 1),
        d.created_at
      )
  ) as last_touch_in_stage,
  (select ds.id from public.deal_stakeholders ds
    where ds.deal_id = d.id and ds.is_primary limit 1) as primary_stakeholder_id,
  (select ds.name from public.deal_stakeholders ds
    where ds.deal_id = d.id and ds.is_primary limit 1) as primary_stakeholder_name,
  (select ds.role from public.deal_stakeholders ds
    where ds.deal_id = d.id and ds.is_primary limit 1) as primary_stakeholder_role
from public.deals d
join public.leads l on l.id = d.lead_id
left join public.verticals v on v.id = l.vertical_id;

-- 6) start_outreach(): create the deal linked via lead_id (no more copying
--    company_name into a second column). Extended with the optional fields
--    the old free-text "+ Add Deal" flow used to collect directly on insert,
--    so this RPC can become the single deal-creation path in the app. The old
--    1-arg signature is dropped — Postgres treats different argument lists as
--    different functions, so leaving it would let a stale client keep
--    inserting deals the old, disconnected way.
drop function if exists public.start_outreach(bigint);

create or replace function public.start_outreach(
  p_lead_id     bigint,
  p_owner       text default null,
  p_source      text default 'Outbound',
  p_channel     text default null,
  p_pilot_spend integer default null,
  p_contact_id  bigint default null,
  p_entered_at  timestamptz default now()
)
returns bigint language plpgsql security invoker as $$
declare
  v_lead    public.leads%rowtype;
  v_deal_id bigint;
  v_now     timestamptz := coalesce(p_entered_at, now());
begin
  select * into v_lead from public.leads where id = p_lead_id;
  if not found then
    raise exception 'Lead % not found', p_lead_id;
  end if;
  if v_lead.in_pipeline then
    raise exception 'Lead is already in the pipeline';
  end if;

  insert into public.deals
    (lead_id, owner, source, current_stage, channel, fast_track,
     pilot_spend, contact_id, intent_notes, closed_lost_reason, created_at, updated_at)
  values
    (p_lead_id, p_owner, coalesce(p_source, 'Outbound'), 'S1', p_channel, false,
     p_pilot_spend, p_contact_id,
     'Started from Lead Intelligence (score ' || v_lead.score || ').',
     null, v_now, v_now)
  returning id into v_deal_id;

  insert into public.stage_history (deal_id, stage, entered_at)
  values (v_deal_id, 'S1', v_now);

  -- leads.in_pipeline/deal_id are synced by trg_deal_insert_sync_lead (below)
  -- rather than set inline here, so every deal-creation path (this RPC, and
  -- accept_email_suggestion_as_deal) shares one place that keeps them in sync.
  return v_deal_id;
end;
$$;
grant execute on function public.start_outreach(bigint, text, text, text, integer, bigint, timestamptz) to authenticated;

-- 7) Keep leads.deal_id/in_pipeline in sync from the deals side (a single
--    place both deal-creation paths below share), now that deals.lead_id is
--    the real source of truth. The delete-side sync
--    (reset_lead_on_deal_delete, 0003) already exists and is untouched.
create or replace function public.sync_lead_on_deal_insert()
returns trigger language plpgsql as $$
begin
  update public.leads
     set in_pipeline = true, deal_id = new.id, updated_at = now()
   where id = new.lead_id;
  return new;
end;
$$;
create trigger trg_deal_insert_sync_lead
  after insert on public.deals
  for each row execute function public.sync_lead_on_deal_insert();

-- 8) Fix the Gmail review queue's "Create deal" RPC (0007) — it had the exact
--    same disconnection bug as the old "+ Add Deal" modal: a free-typed
--    brand_name with no lead_id. Now it resolves-or-creates a lead by the
--    suggestion's contact_domain (the same normalized-domain match key
--    createLead()/company_suggestions already dedupe companies on), so a
--    Gmail-originated deal links to an existing Directory company instead of
--    creating a disconnected duplicate. If that company already has an
--    active deal, raise a clear error pointing at the existing "attach to
--    deal" flow instead of tripping the new one-deal-per-lead constraint.
create or replace function public.accept_email_suggestion_as_deal(
  p_suggestion_id bigint,
  p_brand_name    text default null
) returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_sug           public.email_suggestions%rowtype;
  v_owner         text;
  v_brand         text;
  v_domain        text;
  v_lead_id       bigint;
  v_existing_deal bigint;
  v_deal_id       bigint;
  v_now           timestamptz := now();
begin
  select * into v_sug from public.email_suggestions where id = p_suggestion_id;
  if not found then
    raise exception 'Suggestion % not found', p_suggestion_id;
  end if;
  if v_sug.status <> 'pending' then
    raise exception 'Suggestion already resolved';
  end if;

  select initcap(split_part(google_email, '@', 1)) into v_owner
    from public.gmail_connections where user_id = v_sug.user_id;

  v_brand := coalesce(
    nullif(btrim(p_brand_name), ''),
    initcap(nullif(split_part(coalesce(v_sug.contact_domain, ''), '.', 1), '')),
    'New opportunity'
  );
  v_domain := nullif(btrim(lower(v_sug.contact_domain)), '');

  if v_domain is not null then
    select id into v_lead_id from public.leads where domain = v_domain;
  end if;

  if v_lead_id is not null then
    select id into v_existing_deal from public.deals where lead_id = v_lead_id;
    if v_existing_deal is not null then
      raise exception
        'This company already has an active deal (%) — attach this thread to it instead of creating a new one',
        v_existing_deal;
    end if;
  else
    insert into public.leads
      (company_name, domain, in_pipeline, score, score_updated_at, created_at, updated_at)
    values
      (v_brand, v_domain, true, 0, v_now, v_now, v_now)
    returning id into v_lead_id;
  end if;

  insert into public.deals
    (lead_id, owner, source, current_stage, channel, fast_track,
     pilot_spend, intent_notes, closed_lost_reason, created_at, updated_at)
  values
    (v_lead_id, v_owner, 'Outbound', 'S1', 'Email', false,
     null, 'Created from Gmail review queue (' || coalesce(v_sug.contact_email, '') || ').',
     null, v_now, v_now)
  returning id into v_deal_id;

  insert into public.stage_history (deal_id, stage, entered_at)
  values (v_deal_id, 'S1', v_now);

  insert into public.deal_email_links
    (deal_id, thread_id, contact_email, contact_domain, created_by, created_at)
  values
    (v_deal_id, v_sug.thread_id, v_sug.contact_email, v_sug.contact_domain, v_sug.user_id, v_now)
  on conflict (deal_id, thread_id) do nothing;

  update public.email_suggestions
     set status = 'accepted', resolved_at = v_now, proposed_deal_id = v_deal_id
   where id = p_suggestion_id;

  return v_deal_id;
end;
$$;

grant execute on function public.accept_email_suggestion_as_deal(bigint, text) to authenticated;
