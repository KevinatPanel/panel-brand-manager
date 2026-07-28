-- Drop everflow_payable_event_name (0041) — the Meetings v1 redesign cut it
-- from the UI entirely (product decision: v1 is meeting transcripts only,
-- not payable/quality event fields), so the column is dead weight. Revert
-- merge_leads() to its pre-0041 body (matching 0038) since it listed the
-- column explicitly.
alter table public.leads
  drop column if exists everflow_payable_event_name;

create or replace function public.merge_leads(
  p_winner_id bigint,
  p_loser_id  bigint
) returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_winner        public.leads%rowtype;
  v_loser         public.leads%rowtype;
  v_now           timestamptz := now();
begin
  if p_winner_id = p_loser_id then
    raise exception 'Cannot merge a company into itself';
  end if;

  select * into v_winner from public.leads where id = p_winner_id;
  if not found then
    raise exception 'Winner lead % not found', p_winner_id;
  end if;
  select * into v_loser from public.leads where id = p_loser_id;
  if not found then
    raise exception 'Loser lead % not found', p_loser_id;
  end if;

  if v_loser.deal_id is not null then
    if v_winner.deal_id is not null then
      raise exception
        'Both companies have an active deal (winner deal %, loser deal %) — move or close one deal before merging',
        v_winner.deal_id, v_loser.deal_id;
    end if;
    update public.leads
       set deal_id = v_loser.deal_id, in_pipeline = v_loser.in_pipeline
     where id = p_winner_id;
  end if;

  update public.lead_contacts set lead_id = p_winner_id where lead_id = p_loser_id;
  update public.ad_items      set lead_id = p_winner_id where lead_id = p_loser_id;

  insert into public.lead_signals (lead_id, signal_key, value, notes, updated_at)
  select p_winner_id, signal_key, value, notes, updated_at
    from public.lead_signals
   where lead_id = p_loser_id
  on conflict (lead_id, signal_key) do nothing;

  insert into public.client_spend_goals (lead_id, month, goal_amount, notes, created_at, updated_at)
  select p_winner_id, month, goal_amount, notes, created_at, updated_at
    from public.client_spend_goals
   where lead_id = p_loser_id
  on conflict (lead_id, month) do nothing;

  insert into public.client_spend_actuals (lead_id, month, revenue, payout, synced_at, everflow_raw)
  select p_winner_id, month, revenue, payout, synced_at, everflow_raw
    from public.client_spend_actuals
   where lead_id = p_loser_id
  on conflict (lead_id, month) do nothing;

  insert into public.client_quality_actuals (lead_id, month, event_name, event_count, event_revenue, billed_event_count, synced_at, everflow_raw)
  select p_winner_id, month, event_name, event_count, event_revenue, billed_event_count, synced_at, everflow_raw
    from public.client_quality_actuals
   where lead_id = p_loser_id
  on conflict (lead_id, month, event_name) do nothing;

  update public.company_suggestions
     set matched_lead_id = p_winner_id
   where matched_lead_id = p_loser_id;

  update public.leads
     set website                     = coalesce(nullif(btrim(v_winner.website), ''), v_loser.website),
         domain                      = coalesce(nullif(btrim(v_winner.domain), ''), v_loser.domain),
         hq_location                 = coalesce(nullif(btrim(v_winner.hq_location), ''), v_loser.hq_location),
         headcount                   = coalesce(nullif(btrim(v_winner.headcount), ''), v_loser.headcount),
         description                 = coalesce(nullif(btrim(v_winner.description), ''), v_loser.description),
         industry                    = coalesce(nullif(btrim(v_winner.industry), ''), v_loser.industry),
         estimated_revenue           = coalesce(v_winner.estimated_revenue, v_loser.estimated_revenue),
         founded_year                = coalesce(v_winner.founded_year, v_loser.founded_year),
         apollo_org_id               = coalesce(nullif(btrim(v_winner.apollo_org_id), ''), v_loser.apollo_org_id),
         everflow_advertiser_id      = coalesce(nullif(btrim(v_winner.everflow_advertiser_id), ''), v_loser.everflow_advertiser_id),
         everflow_quality_event_name = coalesce(nullif(btrim(v_winner.everflow_quality_event_name), ''), v_loser.everflow_quality_event_name),
         is_client                   = v_winner.is_client or v_loser.is_client,
         updated_at                  = v_now
   where id = p_winner_id;

  delete from public.leads where id = p_loser_id;
end;
$$;
