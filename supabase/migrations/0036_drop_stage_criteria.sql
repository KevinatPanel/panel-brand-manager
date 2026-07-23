-- Stage Criteria feature (per-stage exit-criteria checklists + the "at risk"
-- deal-health threshold that was configured from the same page) removed.
-- app_settings stays — it's a generic key/value settings table meant for
-- future reuse — only its now-orphaned deal_health row is cleared.
drop table if exists public.deal_stage_checklist;
drop table if exists public.stage_exit_criteria;

delete from public.app_settings where key = 'deal_health';
