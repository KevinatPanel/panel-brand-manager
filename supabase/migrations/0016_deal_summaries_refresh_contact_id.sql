-- deal_summaries (0003) was created with `select d.*` before deals.contact_id
-- (0015) existed. A Postgres view freezes its column list at creation time, so
-- `d.*` does NOT pick up columns added later — contact_id was missing from the
-- view. Recreate the view with the identical definition so d.* re-expands to
-- include contact_id (and any future deals columns added before this point).
drop view if exists public.deal_summaries;
create view public.deal_summaries with (security_invoker = true) as
select d.*,
  (select sh.entered_at
     from public.stage_history sh
    where sh.deal_id = d.id and sh.stage = d.current_stage
    order by sh.entered_at desc, sh.id desc
    limit 1) as current_stage_entered_at
from public.deals d;
