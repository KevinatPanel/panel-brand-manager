-- Ad Tracker: replace creator_name + creator_handle with a single
-- creator_link field. In practice the creator team just shares a URL to the
-- creator's profile/content rather than typing a name and handle
-- separately. ad_items has no rows in production yet (feature just shipped
-- in 0030), so no backfill is needed.

drop view if exists public.ad_item_summaries;

alter table public.ad_items drop column creator_name;
alter table public.ad_items drop column creator_handle;
alter table public.ad_items add column creator_link text not null;

-- Recreate the view (see deal_summaries' column-freeze precedent) now that
-- ad_items' column list has changed.
create view public.ad_item_summaries with (security_invoker = true) as
select ai.*,
  (select sh.entered_at
     from public.ad_item_stage_history sh
    where sh.ad_item_id = ai.id and sh.stage = ai.current_stage
    order by sh.entered_at desc, sh.id desc
    limit 1) as current_stage_entered_at,
  (select sh.entered_at
     from public.ad_item_stage_history sh
    where sh.ad_item_id = ai.id and sh.stage = 'brand_approved'
    order by sh.entered_at asc, sh.id asc
    limit 1) as approved_at
from public.ad_items ai;
