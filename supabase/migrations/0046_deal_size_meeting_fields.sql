-- Reintroduce a per-deal dollar amount (deal_size, replacing the removed
-- pilot_spend — see 0040) and add Meeting Outcome/Notes fields for the
-- enhanced Meetings page. Bundled into one migration because all three are
-- `deals` columns and deal_summaries (d.*-based) only needs to be
-- dropped/recreated once, not three times — same reasoning as every prior
-- deals-column migration (0016/0017/0027/0039/0040).

alter table public.deals
  add column if not exists deal_size integer not null default 10000,
  add column if not exists meeting_outcome text,
  add column if not exists meeting_notes text;

drop view if exists public.deal_summaries;

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

-- start_outreach() gains an optional p_deal_size param (default 10000,
-- matching the column default) so the deal-creation flow can set it. Drop
-- the old 7-arg overload first — a new parameter changes the signature, and
-- leaving both around causes PostgREST's schema-cache overload-ambiguity bug
-- (already hit once this session per 0044's comment).
drop function if exists public.start_outreach(bigint, text, text, text, bigint, timestamptz, text);

create or replace function public.start_outreach(
  p_lead_id     bigint,
  p_owner       text default null,
  p_source      text default 'Outbound',
  p_channel     text default null,
  p_contact_id  bigint default null,
  p_entered_at  timestamptz default now(),
  p_stage       text default 'S1',
  p_deal_size   integer default 10000
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
  v_notes   text;
begin
  if p_stage not in ('S1', 'S2', 'S3', 'S4') then
    raise exception 'Invalid target stage: %', p_stage;
  end if;

  select * into v_lead from public.leads where id = p_lead_id;
  if not found then
    raise exception 'Lead % not found', p_lead_id;
  end if;
  if v_lead.in_pipeline then
    raise exception 'Lead is already in the pipeline';
  end if;

  v_notes := case
    when p_stage = 'S4' then
      'Logged directly as a completed meeting (score ' || v_lead.score || ').'
    else
      'Started from Lead Intelligence (score ' || v_lead.score || ').'
  end;

  insert into public.deals
    (lead_id, owner, source, current_stage, channel, fast_track,
     contact_id, intent_notes, closed_lost_reason, deal_size, created_at, updated_at)
  values
    (p_lead_id, p_owner, coalesce(p_source, 'Outbound'), p_stage, p_channel, false,
     p_contact_id, v_notes,
     null, coalesce(p_deal_size, 10000), v_now, v_now)
  returning id into v_deal_id;

  insert into public.stage_history (deal_id, stage, entered_at)
  values (v_deal_id, p_stage, v_now);

  return v_deal_id;
end;
$$;
grant execute on function public.start_outreach(bigint, text, text, text, bigint, timestamptz, text, integer) to authenticated;

-- accept_email_suggestion_as_deal() (0007, fixed in 0039/0040) doesn't name
-- deal_size in its insert list, so the new NOT NULL DEFAULT 10000 column is
-- populated automatically — no change needed there.
