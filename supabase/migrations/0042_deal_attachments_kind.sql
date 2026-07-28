-- Tag deal_attachments with an optional `kind` so meeting transcripts
-- (uploaded from the Meetings collapsible's TranscriptsSection.jsx) and
-- general deal attachments (AttachmentsSection.jsx on the full /deals/:id
-- record page) can share the same table + storage bucket without collision.
-- NULL = general attachment (today's only kind, unchanged); 'transcript' =
-- a Gemini meeting transcript upload. Plain text column, not an enum — this
-- schema already handles small, possibly-growing vocabularies this way
-- (e.g. touch_log.touch_type), and a v2 AI-analysis feature may want more
-- kinds later without a migration.
alter table public.deal_attachments
  add column if not exists kind text;

create index if not exists idx_deal_attachments_kind on public.deal_attachments(deal_id, kind);
