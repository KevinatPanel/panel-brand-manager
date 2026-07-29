-- Stage weighting: an editable, admin-configurable multiplier applied to
-- deal_size to get a weighted pipeline value per deal (deal_size * weight),
-- mirroring the scoring_config / ScoringConfigView.jsx editable-config
-- pattern. Stored as a 0-1 fraction (not 0-100) since it's used directly as
-- a multiplier against deal_size on the client; the admin UI
-- (StageWeightsView.jsx) is the only place that renders/edits it as a %.
create table public.stage_weights (
  stage_code text primary key,
  weight     numeric not null default 0 check (weight >= 0 and weight <= 1),
  updated_at timestamptz not null default now()
);

-- Seeded for every stage that can actually hold a deal_size-bearing deals
-- row: S1-S4 (ramping 10% -> 75% as a deal gets more real), WON (100%, fully
-- realized), LOST (0%, fully dead — listed explicitly rather than omitted so
-- the admin UI shows the whole funnel in one place). P1/P2 (prospecting)
-- are excluded: those stages precede start_outreach() and never correspond
-- to a deals row at all (a deal doesn't exist until S1), so a weight row for
-- them would be dead config with nothing to multiply against.
insert into public.stage_weights (stage_code, weight) values
  ('S1', 0.10),
  ('S2', 0.25),
  ('S3', 0.50),
  ('S4', 0.75),
  ('WON', 1.00),
  ('LOST', 0.00);

alter table public.stage_weights enable row level security;
create policy "authenticated full access" on public.stage_weights
  for all to authenticated using (true) with check (true);
