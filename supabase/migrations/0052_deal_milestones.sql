-- The deal milestones that live in email rather than on calls, per deal: the
-- first outreach email, when the paper was done (MSA / NDA / Impact terms), and
-- when the brand went live (an approved ad running or a creative in the
-- portal), plus a one-line status. The Calls view measures its timelines
-- against these. The Tactiq call sync agent fills them by reading the rep's
-- Gmail threads with the brand (see docs/tactiq-call-sync.md); a one-time
-- import can seed them too. `source` says who last wrote the row.
create table public.deal_milestones (
  deal_id        bigint primary key references public.deals(id) on delete cascade,
  first_email_at date,
  paper_at       date,
  paper_note     text,        -- e.g. "MSA signed and countersigned"
  live_at        date,
  live_note      text,        -- e.g. "first ad approved and live"
  status_note    text,        -- e.g. "Waiting on postback setup"
  source         text,        -- email-agent | import | manual
  updated_at     timestamptz not null default now()
);

-- Workspace-wide, like the rest of the CRM (0002).
alter table public.deal_milestones enable row level security;
create policy "authenticated full access" on public.deal_milestones
  for all to authenticated using (true) with check (true);
