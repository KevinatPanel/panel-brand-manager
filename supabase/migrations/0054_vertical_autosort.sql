-- Auto-sorting companies into verticals. The Companies board places every
-- unsorted company it can: keyword rules first (client lib/verticalRules.js),
-- then Claude for the rest (Edge Function classify-verticals).
--   vertical_source      how the current vertical was set: manual (a person
--                        picked it, including leaving it Unsorted on purpose,
--                        so auto-sort never touches it), rules or ai
--   vertical_reason      one line on why auto-sort placed it, or why it
--                        couldn't
--   vertical_checked_at  when Claude last looked at it, so a company it
--                        couldn't place isn't sent again on every page load
alter table public.leads add column if not exists vertical_source text
  check (vertical_source in ('manual', 'rules', 'ai'));
alter table public.leads add column if not exists vertical_reason text;
alter table public.leads add column if not exists vertical_checked_at timestamptz;

create index if not exists idx_leads_unsorted on public.leads (id) where vertical_id is null;
