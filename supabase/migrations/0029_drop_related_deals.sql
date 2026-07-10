-- Drop the Related Deals schema (deal_relations, from 0025). The frontend
-- feature (RelatedDealsSection.jsx, api.js's listRelatedDeals/addRelatedDeal/
-- removeRelatedDeal) was removed at the user's request before shipping, so
-- this table was never populated by real usage — safe to drop outright
-- rather than leave as dead schema.
drop table if exists public.deal_relations;
