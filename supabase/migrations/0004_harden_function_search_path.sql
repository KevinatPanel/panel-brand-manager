-- Pin search_path to empty so these functions can't be hijacked via a mutable
-- search_path. All object references in their bodies are schema-qualified.
alter function public.sync_deal_current_stage() set search_path = '';
alter function public.reset_lead_on_deal_delete() set search_path = '';
alter function public.start_outreach(bigint) set search_path = '';
