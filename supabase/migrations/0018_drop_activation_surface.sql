-- Drop the Activation Surface backend schema. The frontend feature (the
-- per-brand lanes/tasks view — ActivationView.jsx, ActivationContext.jsx,
-- lib/activation.js, lib/activationTemplate.js, components/activation/*, and
-- all activation-related exports from lib/api.js) was already removed. The
-- deal-stage forward path (client/src/lib/stages.js) now terminates at S4
-- ("Meeting Completed") instead of continuing on into A1-A5; A1-A5 survive
-- only as retired/legacy stage labels so historical stage_history rows (and
-- any deal still parked on an A-stage) still render a label instead of blank.
--
-- Nothing in the client, in any other migration, or in any edge function
-- references activation_brands, activation_items, activation_deps, or
-- ensure_activation_brand() any longer, so this schema (introduced in 0014,
-- simplified in 0015) is fully orphaned. This repo has no down-migration
-- tooling and migrations are forward-only against live prod data, so:
--   - each DROP is IF EXISTS (safe to re-run / safe if already partially
--     applied by hand),
--   - tables are dropped in FK-safe order with NO cascade, so this statement
--     fails loudly instead of silently taking out anything unexpected if some
--     undiscovered dependency still exists.
-- Indexes and RLS policies on these tables are dropped automatically by
-- Postgres along with their owning table — no separate DROP INDEX / DROP
-- POLICY statements are required.

-- ===== Function =====
drop function if exists public.ensure_activation_brand(bigint);

-- ===== Tables (drop in FK-safe / reverse-creation order) =====

-- activation_deps references activation_items (from_item_id, to_item_id) and
-- activation_brands (brand_id) — must go first.
drop table if exists public.activation_deps;

-- activation_items references activation_brands (brand_id) and
-- self-references parent_item_id — must go before activation_brands.
drop table if exists public.activation_items;

-- activation_brands is the root; its deal_id references public.deals(id), but
-- nothing else references activation_brands, so it's safe to drop last.
drop table if exists public.activation_brands;
