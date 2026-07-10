-- Generic key/value global settings table — a plain single-row config table
-- (or a synthetic id=1 singleton row) would be awkward to extend; this is
-- cheap to add more global v2 settings to later without a new migration per
-- key. First (and for now only) key: deal health's global stale-days
-- threshold (a deal is "at risk" once it has spent more than this many days
-- in its current stage with no touch logged in that window — see 0027).
create table public.app_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.app_settings enable row level security;
create policy "authenticated full access" on public.app_settings
  for all to authenticated using (true) with check (true);

insert into public.app_settings (key, value, updated_at)
values ('deal_health', '{"stale_days_threshold": 7}'::jsonb, now());
