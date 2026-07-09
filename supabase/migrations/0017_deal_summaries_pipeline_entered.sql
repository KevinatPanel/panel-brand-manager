-- Add pipeline_entered_at to deal_summaries: the earliest stage_history entry
-- for the deal, i.e. when it first entered the pipeline. Used to show
-- "days in pipeline" on deal cards. Earliest stage_history.entered_at (not
-- deals.created_at) so backfilled/backdated historical accounts report their
-- true elapsed time even after stage dates are edited.
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
    where sh.deal_id = d.id) as pipeline_entered_at
from public.deals d;
