# Vertical auto-sort

The Companies board sorts unsorted companies into verticals by itself.

1. **Keyword rules** (`client/src/lib/verticalRules.js`) run in the browser the
   first time the Companies page loads each session. A rule places a company
   only when the evidence is clear: a keyword in its name or domain, two
   keywords in its description, or a description keyword that its Apollo
   industry agrees with. Rules find their vertical by name, so renaming a
   vertical keeps working.
2. **Claude** (Edge Function `classify-verticals`) gets whatever the rules
   left, 60 companies per call, with each vertical's existing companies as
   examples. It picks an existing vertical, or proposes a new one. A new
   vertical is only created once at least two companies share it. Companies it
   can't identify stay in Unsorted with the reason saved in
   `leads.vertical_reason`, and are not re-sent until someone clicks
   **Auto-sort**.

A vertical someone picks by hand (dragging a card, or the company page's
vertical field), including moving a company back to Unsorted, is marked
`vertical_source = 'manual'` and is never moved by auto-sort.

Deleting a vertical sends its companies to Unsorted, and the next auto-sort
places them in the closest remaining vertical. That is the way to merge two
overlapping verticals.

## Setup

- Apply migration `0054_vertical_autosort.sql`.
- Deploy the function: `supabase functions deploy classify-verticals`. It uses
  the same `ANTHROPIC_API_KEY` secret as `analyze-transcript`.

Before the function is deployed, the keyword rules still run. The sidebar
says Claude sorting turns on once the function is deployed.
