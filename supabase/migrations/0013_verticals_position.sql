-- Manual vertical ordering.
--
-- Adds a `position` column so verticals can be reordered by drag-and-drop in the
-- Companies side nav; the order drives both the nav and the board (both read the
-- same position-ordered list). Backfill preserves the current visual order
-- (company-count desc, then name) so nothing jumps on first load.
--
-- RLS unchanged: the blanket "authenticated full access" policy (0002) already
-- covers the new column, so any allowlisted user can persist new positions.

alter table public.verticals
  add column if not exists position integer not null default 0;

with counts as (
  select v.id, count(l.id) as cnt, v.name
  from public.verticals v
  left join public.leads l on l.vertical_id = v.id
  group by v.id, v.name
),
ordered as (
  select id, (row_number() over (order by cnt desc, name) - 1) as rn from counts
)
update public.verticals v set position = o.rn from ordered o where v.id = o.id;
