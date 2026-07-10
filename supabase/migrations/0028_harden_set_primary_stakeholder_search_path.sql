-- Pin search_path on the new set_primary_stakeholder() RPC (0019), same
-- hardening 0004 already applied to sync_deal_current_stage/
-- reset_lead_on_deal_delete/start_outreach — the Supabase security advisor
-- flagged it as mutable. All object references in its body are already
-- schema-qualified (public.deal_stakeholders), so this is safe.
alter function public.set_primary_stakeholder(bigint, bigint) set search_path = '';
