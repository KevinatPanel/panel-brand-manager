-- Leads (people) + Company data v1.
-- People (lead_contacts) gain an email. Companies (leads) gain HQ, size,
-- description and a lifecycle status. New columns inherit the existing RLS
-- policies from 0002_rls_policies.sql, so no policy changes are needed.

-- People: add email to the people-at-a-company table.
alter table public.lead_contacts add column if not exists email text;

-- Company data v1.
alter table public.leads add column if not exists hq_location text;
alter table public.leads add column if not exists headcount   text;  -- band e.g. "51-200"
alter table public.leads add column if not exists description text;
alter table public.leads add column if not exists status      text;  -- Researching/Contacted/Active/Passed
