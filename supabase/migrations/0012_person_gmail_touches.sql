-- v3 — Gmail provenance on person touches.
-- contact_touches can now be auto-created by gmail-poll (mirrors touch_log's
-- source + external_id). A single message can hit To+Cc, so dedupe is per
-- (contact, message) rather than per message.

alter table public.contact_touches add column if not exists source      text not null default 'manual';
alter table public.contact_touches add column if not exists external_id text;

create unique index if not exists uq_contact_touches_external
  on public.contact_touches (contact_id, external_id) where external_id is not null;
