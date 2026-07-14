# Panel — Brand Manager

An internal tool for Panel's brand team to manage deals from first outreach to
first client conversion. Built to be handed off to a tech team later, so the
code is modular and commented.

- **Frontend:** React + Tailwind CSS (Vite)
- **Backend:** Supabase (Postgres) — the client talks directly to Supabase via
  `@supabase/supabase-js`; there is no Node server
- **Auth:** Supabase magic-link, allowlist-only (only pre-created team emails
  can sign in)
- **Security:** Row Level Security on every table (authenticated = full access;
  anonymous = none)

---

## Running locally

Requirements: Node.js 18+ (developed on Node 24).

```bash
# 1. Install dependencies
npm run install:all      # == npm install --prefix client

# 2. Configure Supabase connection
cp client/.env.example client/.env
#    then fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (publishable key)

# 3. Start the dev server
npm run dev
```

Then open **http://localhost:5173** and sign in with a team email — a one-time
magic link is sent to your inbox. Data lives in Supabase, so it's shared across
the team and persists between sessions.

### Production build

```bash
npm run build     # builds the client into client/dist (static — host anywhere)
```

The build is a static SPA; deploy `client/dist` to any static host. Set the
Supabase **Site URL** and **Redirect URLs** to the deployed origin so magic-link
sign-in redirects back correctly.

---

## Supabase setup

The database schema, RLS policies, triggers, and the `start_outreach` function
live in `supabase/migrations/` (applied to the project via the Supabase MCP).
Key pieces:

- **Triggers** — a stage_history insert syncs `deals.current_stage`; deleting a
  deal resets its linked lead's `in_pipeline`/`deal_id`.
- **`start_outreach(lead_id)`** — atomically creates an S1 deal from a lead.
- **`deal_summaries` view** — deals plus the current stage's entry timestamp.
- **Scoring** runs client-side (`client/src/lib/leadScoring.js`) and writes
  `leads.score`; the `scoring_config` table holds the editable rubric.

**Auth / allowlist:** disable public sign-ups in the Supabase dashboard and
pre-create each team member (magic-link, no password). The client passes
`shouldCreateUser:false`, so only pre-created emails can sign in.

> Never put the Supabase **secret** key in the client or repo — only the
> publishable (anon) key, which is safe to ship because RLS protects the data.

---

## Project structure

```
/panel-brand-manager
  /client                React frontend (Vite + Tailwind + supabase-js)
    /src/lib             api.js (data layer), scoring, metrics, supabaseClient
    /src/state           Auth + Deals/Leads context
    /src/views           Pipeline, Activation, Leads, Metrics, Login, …
  /supabase/migrations   Postgres schema, RLS, triggers, functions
  README.md
```

---

## Views

- **Pipeline** — Kanban board of the active sales cycle (stages S1–S7, plus a
  collapsed LOST column). Each card shows brand, owner, days in current stage
  (color-coded green/yellow/red), channel, and pilot spend. Click a card to
  open the Deal Detail panel; add new deals with the button top-right.
- **Activation** — Kanban board for post-signing activation (stages A1–A5).
  Shows only deals that have reached S7 (MSA Signed). Days in activation stage
  are highlighted — this is where friction lives.
- **Leads** — Lead Intelligence Board: prospecting targets grouped by vertical
  and ranked by a live 0–100 score that recalculates whenever any signal
  changes. Each card shows rank, score, a signal-completion bar, and the top
  filled signals. Click a card to open the Lead Detail panel and fill in
  signals (which auto-save and rescore), manage key contacts, and "Start
  Outreach" to create a Deal at S1 (the lead stays on the board, flagged
  *In Pipeline*). The **Scoring Config** page (button top-right) is the only
  place point values can be edited; saving rescores every lead.
- **Metrics** — The measurement layer: average sales cycle, activation cycle,
  and time-to-revenue; per-stage averages; funnel drop-off; loss reasons;
  pipeline by owner; and fast-track vs. standard comparison. All metrics show
  "Not enough data yet" until at least 3 closed deals exist.

---

## How cycle time works

Every stage transition appends a row to `stage_history` (a Postgres trigger
syncs `deals.current_stage` from it). Entry dates default to now but are
editable, so historical accounts can be backfilled with their true timeline.
"Days in stage" is always computed live from those timestamps — never stored.

- **Sales cycle** clock starts at `S1` (first outreach) and stops at `S7`.
- **Activation cycle** clock starts at `S7` and stops at `A5` (first revenue).
- **Time to revenue** spans `S1 → A5`.

---

## Stage framework

| Group | Codes | Meaning |
|-------|-------|---------|
| Prospecting (no clock) | P1–P2 | Target → Intent Flagged |
| Sales cycle (clock S1→S7) | S1–S7 | Outreach Sent → MSA Signed (Closed Won) |
| Activation (clock S7→A5) | A1–A5 | Kickoff → First Conversion |
| Terminal | LOST | Closed Lost (exitable from any S stage) |

---

## Lead scoring

The Leads board runs on a separate set of tables (`verticals`, `leads`,
`lead_signals`, `lead_contacts`, `scoring_config`) and is independent of the
deals pipeline above.

Each lead's score is computed from its signals against the editable rubric:

```
score = (sum of points earned across all signals)
      / (sum of max_points across all signals)
      * 100, rounded
```

The default rubric totals 100 max points across six categories (Trackability,
Performance Marketing Maturity, Paid Media Activity, Company Growth Signals,
Relationship & Access, Intelligence Quality). Scoring is a pure function
(`client/src/lib/leadScoring.js`) run client-side; the data layer
(`client/src/lib/api.js`) recomputes and writes `leads.score` whenever a signal
changes, a contact is added/removed, or the scoring config is edited (which
rescores every lead).

Structural facts that aren't user-tunable — which signals carry notes/date
fields, and the 18-month funding-recency window — live in
`client/src/lib/scoringDefaults.js`, keyed by `signal_key`. The Scoring Config
page edits point values only.
