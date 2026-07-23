# Migrations

Apply in **filename order**. Three numeric prefixes were reused for unrelated
changes (a branching accident); the pairs are independent, so either order
within a pair is fine, but apply them in the order listed below to match prod.

| # | File | What it does |
|---|------|--------------|
| 0001 | `0001_init_schema.sql` | Initial schema |
| 0002 | `0002_rls_policies.sql` | RLS policies |
| 0003 | `0003_triggers_functions_views.sql` | Triggers, functions, views |
| 0004 | `0004_harden_function_search_path.sql` | Pin `search_path` on functions |
| 0005 | `0005_leads_people_company_v1.sql` | Leads / people / company model |
| 0006a | `0006_gmail_integration.sql` | Gmail integration tables |
| 0006b | `0006_person_profiles_outreach.sql` | Person profiles + outreach |
| 0007 | `0007_email_suggestions_rpc.sql` | Email-suggestions RPC |
| 0008 | `0008_stage_move_suggestions.sql` | Stage-move suggestions |
| 0009 | `0009_contact_suggestions.sql` | Contact suggestions |
| 0010 | `0010_contact_suggestions_rpc.sql` | Contact-suggestions RPC |
| 0011 | `0011_apollo_enrichment.sql` | Apollo enrichment |
| 0012a | `0012_lead_is_client.sql` | `leads.is_client` flag |
| 0012b | `0012_person_gmail_touches.sql` | Person ↔ Gmail touches |
| 0013 | `0013_verticals_position.sql` | Vertical position ordering |
| 0014 | `0014_activation_surface.sql` | Activation surface |
| 0015a | `0015_activation_brand_row_only.sql` | Activation brand-row-only |
| 0015b | `0015_deal_contact_link.sql` | Deal ↔ contact link |
| 0016 | `0016_deal_summaries_refresh_contact_id.sql` | Refresh `deal_summaries` view |
| 0017 | `0017_deal_summaries_pipeline_entered.sql` | Add `pipeline_entered_at` to `deal_summaries` |
| 0018 | `0018_drop_activation_surface.sql` | Drop Activation Surface schema (tables + `ensure_activation_brand`) |
| 0019 | `0019_deal_stakeholders.sql` | `deal_stakeholders` table + `set_primary_stakeholder()` RPC |
| 0020 | `0020_deal_stakeholders_migrate_contact.sql` | Backfill `deals.contact_id` into `deal_stakeholders` |
| 0021 | `0021_deal_tasks.sql` | `deal_tasks` table |
| 0022 | `0022_deal_notes.sql` | `deal_notes` table |
| 0023 | `0023_deal_attachments_storage.sql` | `deal_attachments` table + `deal-attachments` Storage bucket |
| 0024 | `0024_stage_exit_criteria.sql` | `stage_exit_criteria` + `deal_stage_checklist` tables |
| 0025 | `0025_related_deals.sql` | `deal_relations` table |
| 0026 | `0026_app_settings.sql` | `app_settings` key/value table (deal health threshold) |
| 0027 | `0027_deal_summaries_stakeholder_health.sql` | Add `last_touch_in_stage` + primary stakeholder columns to `deal_summaries` |
| 0028 | `0028_harden_set_primary_stakeholder_search_path.sql` | Pin `search_path` on `set_primary_stakeholder()` (same hardening as 0004) |
| 0029 | `0029_drop_related_deals.sql` | Drop `deal_relations` (Related Deals feature removed before shipping) |
| 0030 | `0030_ad_tracker.sql` | `ad_items` + `ad_item_stage_history` tables, stage-sync trigger, `ad_item_summaries` view |
| 0031 | `0031_ad_items_creator_link.sql` | Replace `ad_items.creator_name`/`creator_handle` with a single `creator_link` column |
| 0032 | `0032_client_spend_goals.sql` | `leads.everflow_advertiser_id`, `client_spend_goals` + `client_spend_actuals` tables |
| 0033 | `0033_merge_leads.sql` | `merge_leads(winner_id, loser_id)` RPC — folds a duplicate company into another and deletes it |
| 0034 | `0034_fix_company_suggestion_stale_match.sql` | Fix `accept_company_suggestion` re-creating a duplicate lead when `matched_lead_id` went stale |
| 0035 | `0035_leads_domain_unique_index.sql` | Partial unique index on `leads.domain` (after existing duplicate-domain leads were merged) |

> ⚠️ The `0006`, `0012`, and `0015` files are already applied in production —
> **do not rename them.** For any new migration, use the next free number
> (`0019_…`) and never reuse a prefix.
