-- Phase 3: reply-driven stage moves.
--
-- A prospect replying on an S1 deal's thread is a high-confidence "conversation
-- open" signal. The poller either auto-advances S1->S2 (per-rep opt-in) or files
-- a stage_move suggestion the rep accepts here. Stage changes still go through a
-- stage_history insert so the sync trigger + metrics clock stay correct.

-- Accept a stage_move suggestion: advance the deal (idempotent — only if it
-- isn't already at the proposed stage), then mark the suggestion accepted.
create or replace function public.accept_stage_move_suggestion(
  p_suggestion_id bigint
) returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_sug     public.email_suggestions%rowtype;
  v_current text;
  v_now     timestamptz := now();
begin
  select * into v_sug from public.email_suggestions where id = p_suggestion_id;
  if not found then
    raise exception 'Suggestion % not found', p_suggestion_id;
  end if;
  if v_sug.status <> 'pending' then
    raise exception 'Suggestion already resolved';
  end if;
  if v_sug.proposed_action <> 'stage_move' or v_sug.proposed_deal_id is null
     or v_sug.proposed_stage is null then
    raise exception 'Not a stage-move suggestion';
  end if;

  select current_stage into v_current from public.deals where id = v_sug.proposed_deal_id;
  if v_current is distinct from v_sug.proposed_stage then
    insert into public.stage_history (deal_id, stage, entered_at)
    values (v_sug.proposed_deal_id, v_sug.proposed_stage, v_now);
  end if;

  update public.email_suggestions
     set status = 'accepted', resolved_at = v_now
   where id = p_suggestion_id;

  return v_sug.proposed_deal_id;
end;
$$;

grant execute on function public.accept_stage_move_suggestion(bigint) to authenticated;

-- Let a rep toggle their own auto-advance preference. security definer because
-- gmail_connections has no client UPDATE policy (token columns must stay
-- server-only); this touches just the one boolean on the caller's own row.
create or replace function public.set_gmail_auto_advance(
  p_value boolean
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.gmail_connections
     set auto_advance_s1_s2 = coalesce(p_value, false),
         updated_at = now()
   where user_id = auth.uid();
end;
$$;

grant execute on function public.set_gmail_auto_advance(boolean) to authenticated;
