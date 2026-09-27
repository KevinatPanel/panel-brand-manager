-- More structure per call, so the Calls view can chart what brands push on and
-- who stands between the call and a signature (the analysis charts modeled on
-- Raven's "Panel Sales Calls: The Data" page). Filled by analyze-transcript and
-- the Tactiq sync agent alongside the 0049 fields.
alter table public.call_insights
  -- [{ theme, text }] — each objection / hard question tagged with one theme:
  -- quality | control | mechanics | scripts | proof | price | supply | tracking | launch
  add column if not exists pushback        jsonb not null default '[]',
  -- ["legal", "manager", …] — people or teams the brand said must sign off
  -- between this call and a signature
  add column if not exists decision_layers jsonb not null default '[]',
  -- buyer profile checks established on the call; true / false, or absent when
  -- the call didn't establish it: kpi_owner_on_call, named_flat_fee_pain,
  -- can_sign_alone, cheap_frequent_event, tracking_ready, ok_with_ad_approval,
  -- supply_restriction
  add column if not exists profile         jsonb not null default '{}';
