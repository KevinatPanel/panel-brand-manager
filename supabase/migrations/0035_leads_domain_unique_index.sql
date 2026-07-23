-- Hard backstop against duplicate-domain leads, now that the existing
-- duplicates (7 pairs, all created via the stale matched_lead_id bug fixed in
-- 0034) have been merged. Partial so leads with a blank domain (most
-- manually-entered companies) are unaffected.
create unique index leads_domain_unique on public.leads (domain)
  where domain is not null and domain <> '';
