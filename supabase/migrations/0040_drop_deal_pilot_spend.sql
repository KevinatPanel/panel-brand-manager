-- Remove the "pilot spend" field from deals entirely — unused going forward
-- per product decision, dropped from Meetings/Outreach/Add Deal in the client
-- alongside this migration.

-- deal_summaries (d.*-based) depends on the column, so it has to go first —
-- same pattern as 0039's brand_name/vertical drop.
drop view if exists public.deal_summaries;
alter table public.deals drop column pilot_spend;

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

-- start_outreach() took p_pilot_spend as its 5th positional arg (0039) — drop
-- that signature and recreate without it so a stale client can't keep passing
-- a value for a column that no longer exists.
drop function if exists public.start_outreach(bigint, text, text, text, integer, bigint, timestamptz);

create or replace function public.start_outreach(
  p_lead_id     bigint,
  p_owner       text default null,
  p_source      text default 'Outbound',
  p_channel     text default null,
  p_contact_id  bigint default null,
  p_entered_at  timestamptz default now()
)
returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
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
     contact_id, intent_notes, closed_lost_reason, created_at, updated_at)
  values
    (p_lead_id, p_owner, coalesce(p_source, 'Outbound'), 'S1', p_channel, false,
     p_contact_id,
     'Started from Lead Intelligence (score ' || v_lead.score || ').',
     null, v_now, v_now)
  returning id into v_deal_id;

  insert into public.stage_history (deal_id, stage, entered_at)
  values (v_deal_id, 'S1', v_now);

  return v_deal_id;
end;
$$;
grant execute on function public.start_outreach(bigint, text, text, text, bigint, timestamptz) to authenticated;

-- accept_email_suggestion_as_deal() (0007, fixed in 0039) also inserted a
-- literal null into pilot_spend — just drop it from the column/value lists,
-- signature is unchanged so no drop function is needed here.
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
     intent_notes, closed_lost_reason, created_at, updated_at)
  values
    (v_lead_id, v_owner, 'Outbound', 'S1', 'Email', false,
     'Created from Gmail review queue (' || coalesce(v_sug.contact_email, '') || ').',
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
