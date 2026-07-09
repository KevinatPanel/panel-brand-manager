-- Phase 5: Apollo.io enrichment.
--
-- Adds enrichment columns to the existing CRM tables so the apollo-enrich Edge
-- Function can fill firmographic/person data fetched from Apollo. We reuse the
-- columns already on `leads` (hq_location, headcount, description, website,
-- domain) and on `lead_contacts` (title, email, phone, linkedin, location,
-- seniority) where they map, and add the rest here.
--
-- Same trust model as the Gmail integration (0006/0009): the Edge Function
-- writes via the service-role key. These two tables are workspace-level (not
-- user-scoped), so the existing `authenticated` RLS policies already cover the
-- new columns — no new policies needed.
--
-- `apollo_raw` keeps the full Apollo payload so we can re-map fields later
-- without re-spending credits. `enriched_source` is 'apollo' for now but leaves
-- room for other providers.

-- ===== Company enrichment (leads) =====
alter table public.leads
  add column if not exists apollo_org_id    text,
  add column if not exists industry         text,
  add column if not exists estimated_revenue bigint,   -- annual revenue (USD)
  add column if not exists founded_year     integer,
  add column if not exists technologies     jsonb,     -- array of tech names
  add column if not exists apollo_raw        jsonb,
  add column if not exists enriched_at       timestamptz,
  add column if not exists enriched_source   text;

-- ===== Person enrichment (lead_contacts) =====
alter table public.lead_contacts
  add column if not exists apollo_person_id text,
  add column if not exists apollo_raw        jsonb,
  add column if not exists enriched_at       timestamptz;
