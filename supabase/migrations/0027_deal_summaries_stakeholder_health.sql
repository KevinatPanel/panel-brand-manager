-- Refresh deal_summaries again (full drop/create — Postgres views can't "add
-- a column", and this view has already silently lost columns twice from
-- partial edits, see 0016/0017 — so the entire body from 0017 is copied
-- forward verbatim below, not hand-diffed).
--
-- New columns:
--   - last_touch_in_stage: latest touch_log entry at/after the deal entered
--     its current stage. A bounded subquery, same shape as the view's two
--     existing subqueries.
--   - primary_stakeholder_id/name/role: the deal's primary stakeholder, if any.
--
-- Deal health ("at risk") is deliberately NOT computed here in SQL. days_in_stage
-- is never stored/computed in SQL today (an established convention, see
-- enrichDeal() in api.js) — keeping is_at_risk client-side avoids baking an
-- admin-editable, changeable-at-runtime threshold (app_settings.deal_health)
-- into a view definition that would then need a migration every time someone
-- tweaks it. This view only exposes the one new fact it's positioned to
-- compute cheaply and immutably; api.js combines it with days_in_stage and
-- the fetched threshold.
drop view if exists public.deal_summaries;
create view public.deal_summaries with (security_invoker = true) as
select d.*,
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
from public.deals d;
