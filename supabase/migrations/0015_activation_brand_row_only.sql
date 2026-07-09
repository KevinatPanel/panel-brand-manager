-- Stop auto-spawning the system template. ensure_activation_brand() now creates
-- ONLY the brand row (idempotent, with the committed-date computation); lanes,
-- tasks, and dependency edges are assembled client-side from the template picker
-- (see client/src/lib/activationTemplate.js). Both the lazy-spawn path (pipeline
-- wins) and manual creation use this to get an empty brand row.

create or replace function public.ensure_activation_brand(p_deal_id bigint)
returns bigint language plpgsql security invoker as $$
declare
  v_brand_id  bigint;
  v_committed date;
begin
  -- committed_date = first activation-stage entry, by insertion order (id), since
  -- stage_history.entered_at is user-editable. Fallback to today.
  select sh.entered_at::date into v_committed
    from public.stage_history sh
   where sh.deal_id = p_deal_id
     and sh.stage in ('A1','A2','A3','A4','A5')
   order by sh.id asc
   limit 1;
  v_committed := coalesce(v_committed, current_date);

  insert into public.activation_brands (deal_id, committed_date)
  values (p_deal_id, v_committed)
  on conflict (deal_id) do nothing
  returning id into v_brand_id;

  return v_brand_id; -- null if it already existed (or lost the race)
end;
$$;
grant execute on function public.ensure_activation_brand(bigint) to authenticated;
alter function public.ensure_activation_brand(bigint) set search_path = '';
