-- Phase 2: accept a Gmail review-queue suggestion as a new deal.
--
-- Atomic, mirroring start_outreach(): create an S1 deal, log the S1 stage entry
-- (the trigger syncs deals.current_stage), link the email thread to the deal,
-- and mark the suggestion accepted. security invoker so RLS applies — the caller
-- can only resolve their own suggestion (email_suggestions is auth.uid()-scoped).

create or replace function public.accept_email_suggestion_as_deal(
  p_suggestion_id bigint,
  p_brand_name    text default null
) returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_sug     public.email_suggestions%rowtype;
  v_owner   text;
  v_brand   text;
  v_deal_id bigint;
  v_now     timestamptz := now();
begin
  select * into v_sug from public.email_suggestions where id = p_suggestion_id;
  if not found then
    raise exception 'Suggestion % not found', p_suggestion_id;
  end if;
  if v_sug.status <> 'pending' then
    raise exception 'Suggestion already resolved';
  end if;

  -- Owner = the connecting rep (kevin@... -> Kevin). Free text on deals anyway.
  select initcap(split_part(google_email, '@', 1)) into v_owner
    from public.gmail_connections where user_id = v_sug.user_id;

  v_brand := coalesce(
    nullif(btrim(p_brand_name), ''),
    initcap(nullif(split_part(coalesce(v_sug.contact_domain, ''), '.', 1), '')),
    'New opportunity'
  );

  insert into public.deals
    (brand_name, vertical, owner, source, current_stage, channel, fast_track,
     pilot_spend, intent_notes, closed_lost_reason, created_at, updated_at)
  values
    (v_brand, null, v_owner, 'Outbound', 'S1', 'Email', false,
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
