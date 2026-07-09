-- DB-native replacements for the former Express side-effect logic.

-- 1) Keep deals.current_stage / updated_at in sync on each stage_history insert.
create or replace function public.sync_deal_current_stage()
returns trigger language plpgsql as $$
begin
  update public.deals
     set current_stage = new.stage, updated_at = new.entered_at
   where id = new.deal_id;
  return new;
end;
$$;
create trigger trg_stage_history_sync
  after insert on public.stage_history
  for each row execute function public.sync_deal_current_stage();

-- 2) On deal delete, clear the In Pipeline flag on any lead that linked to it.
create or replace function public.reset_lead_on_deal_delete()
returns trigger language plpgsql as $$
begin
  update public.leads
     set in_pipeline = false, deal_id = null
   where deal_id = old.id;
  return old;
end;
$$;
create trigger trg_deal_delete_reset_lead
  before delete on public.deals
  for each row execute function public.reset_lead_on_deal_delete();

-- 3) Atomic "Start Outreach": create an S1 deal from a lead, log S1 history,
--    flag the lead In Pipeline, return the new deal id. security invoker so RLS
--    applies to the caller.
create or replace function public.start_outreach(p_lead_id bigint)
returns bigint language plpgsql security invoker as $$
declare
  v_lead     public.leads%rowtype;
  v_vertical text;
  v_deal_id  bigint;
  v_now      timestamptz := now();
begin
  select * into v_lead from public.leads where id = p_lead_id;
  if not found then
    raise exception 'Lead % not found', p_lead_id;
  end if;
  if v_lead.in_pipeline then
    raise exception 'Lead is already in the pipeline';
  end if;

  select name into v_vertical from public.verticals where id = v_lead.vertical_id;

  insert into public.deals
    (brand_name, vertical, owner, source, current_stage, channel, fast_track,
     pilot_spend, intent_notes, closed_lost_reason, created_at, updated_at)
  values
    (v_lead.company_name, v_vertical, null, 'Outbound', 'S1', null, false,
     null, 'Started from Lead Intelligence (score ' || v_lead.score || ').',
     null, v_now, v_now)
  returning id into v_deal_id;

  insert into public.stage_history (deal_id, stage, entered_at)
  values (v_deal_id, 'S1', v_now);

  update public.leads
     set in_pipeline = true, deal_id = v_deal_id, updated_at = v_now
   where id = p_lead_id;

  return v_deal_id;
end;
$$;
grant execute on function public.start_outreach(bigint) to authenticated;

-- 4) deal_summaries view: deals + entered_at of the current stage, so the
--    client can compute "days in stage" without pulling all history.
create view public.deal_summaries with (security_invoker = true) as
select d.*,
  (select sh.entered_at
     from public.stage_history sh
    where sh.deal_id = d.id and sh.stage = d.current_stage
    order by sh.entered_at desc, sh.id desc
    limit 1) as current_stage_entered_at
from public.deals d;
