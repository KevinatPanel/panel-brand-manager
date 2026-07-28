-- Add an optional target-stage parameter to start_outreach() so a deal can be
-- created directly at S4 (Meeting Completed) for meetings that were never
-- tracked through Outreach, without disturbing the S1-only flow everything
-- else still uses. Defaults to 'S1' so every existing caller (CompanyProfile
-- "Start Outreach →", the Outreach "+ Add Deal" modal) is unaffected.
--
-- Adding a parameter changes the function's argument-type signature, so this
-- MUST drop the old 6-arg overload explicitly first, or Postgres keeps both
-- and PostgREST's schema cache picks the wrong one (the exact
-- "Could not find the function ... in the schema cache" overload-ambiguity
-- bug already hit once this session) — same pattern as 0040/0041/0043.
drop function if exists public.start_outreach(bigint, text, text, text, bigint, timestamptz);

create or replace function public.start_outreach(
  p_lead_id     bigint,
  p_owner       text default null,
  p_source      text default 'Outbound',
  p_channel     text default null,
  p_contact_id  bigint default null,
  p_entered_at  timestamptz default now(),
  p_stage       text default 'S1'
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
     contact_id, intent_notes, closed_lost_reason, created_at, updated_at)
  values
    (p_lead_id, p_owner, coalesce(p_source, 'Outbound'), p_stage, p_channel, false,
     p_contact_id, v_notes,
     null, v_now, v_now)
  returning id into v_deal_id;

  insert into public.stage_history (deal_id, stage, entered_at)
  values (v_deal_id, p_stage, v_now);

  return v_deal_id;
end;
$$;
grant execute on function public.start_outreach(bigint, text, text, text, bigint, timestamptz, text) to authenticated;
