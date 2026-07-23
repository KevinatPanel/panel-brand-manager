-- merge_leads: fold a duplicate company (p_loser_id) into its surviving
-- record (p_winner_id) and delete the loser. Written for the "cold outreach
-- to two people at the same company created two companies" cleanup — see
-- 0034 for the root-cause fix in accept_company_suggestion.
--
-- Reassigns every child row that has a hard FK to leads.id (lead_contacts,
-- ad_items straight update; lead_signals and client_spend_goals/actuals need
-- conflict handling since they're unique per (lead_id, key/month) — the
-- winner's existing row wins on a clash, the loser's row is simply dropped
-- via cascade delete at the end). Repoints company_suggestions.matched_lead_id
-- so the review queue doesn't dangle. leads.deal_id is a soft, non-FK pointer
-- to deals — if both sides have an active deal that's a genuine conflict a
-- human has to resolve, so we abort loudly rather than silently picking one.

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

  -- Deal reconciliation: leads.deal_id has no FK, so nothing else protects it.
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

  -- Reassign simple children (no uniqueness to worry about).
  update public.lead_contacts set lead_id = p_winner_id where lead_id = p_loser_id;
  update public.ad_items      set lead_id = p_winner_id where lead_id = p_loser_id;

  -- Reassign lead_signals, keeping the winner's value on a signal_key clash.
  insert into public.lead_signals (lead_id, signal_key, value, notes, updated_at)
  select p_winner_id, signal_key, value, notes, updated_at
    from public.lead_signals
   where lead_id = p_loser_id
  on conflict (lead_id, signal_key) do nothing;

  -- Reassign spend goals/actuals, keeping the winner's row on a month clash.
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

  -- Repoint the review queue so it doesn't point at a row about to disappear.
  update public.company_suggestions
     set matched_lead_id = p_winner_id
   where matched_lead_id = p_loser_id;

  -- Fill blanks on the winner from the loser; never overwrite a real value.
  update public.leads
     set website           = coalesce(nullif(btrim(v_winner.website), ''), v_loser.website),
         domain             = coalesce(nullif(btrim(v_winner.domain), ''), v_loser.domain),
         hq_location        = coalesce(nullif(btrim(v_winner.hq_location), ''), v_loser.hq_location),
         headcount          = coalesce(nullif(btrim(v_winner.headcount), ''), v_loser.headcount),
         description        = coalesce(nullif(btrim(v_winner.description), ''), v_loser.description),
         industry           = coalesce(nullif(btrim(v_winner.industry), ''), v_loser.industry),
         estimated_revenue  = coalesce(v_winner.estimated_revenue, v_loser.estimated_revenue),
         founded_year       = coalesce(v_winner.founded_year, v_loser.founded_year),
         apollo_org_id      = coalesce(nullif(btrim(v_winner.apollo_org_id), ''), v_loser.apollo_org_id),
         is_client          = v_winner.is_client or v_loser.is_client,
         updated_at         = v_now
   where id = p_winner_id;

  -- Everything still on the loser at this point (lead_signals/spend rows that
  -- clashed and were skipped above, plus the row itself) goes via cascade.
  delete from public.leads where id = p_loser_id;
end;
$$;

grant execute on function public.merge_leads(bigint, bigint) to authenticated;
