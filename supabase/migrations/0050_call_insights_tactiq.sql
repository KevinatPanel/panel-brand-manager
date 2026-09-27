-- Let a call come straight from Tactiq instead of an uploaded transcript file.
-- A scheduled Claude agent (see docs/tactiq-call-sync.md) reads each brand call
-- through the Tactiq connector, matches it to a deal via the Google Calendar
-- invite's attendee emails, and writes the call_insights row itself — so there
-- is no deal_attachments row behind it.
alter table public.call_insights
  alter column attachment_id drop not null,
  add column if not exists source            text not null default 'upload', -- upload | tactiq
  add column if not exists tactiq_meeting_id text,
  add column if not exists title             text,                          -- meeting title (Tactiq)
  add column if not exists source_url        text;                          -- link to the Tactiq recording

-- Re-running the agent must never add the same Tactiq call twice.
create unique index if not exists uq_call_insights_tactiq
  on public.call_insights(tactiq_meeting_id) where tactiq_meeting_id is not null;

-- Every call comes from one of the two sources.
alter table public.call_insights
  add constraint call_insights_has_source
  check (attachment_id is not null or tactiq_meeting_id is not null);
