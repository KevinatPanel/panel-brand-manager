# Everflow Spend & Goals — Setup (manual steps)

These are the dashboard steps that **must be done by hand** (Kevin) before the
`everflow-sync` Edge Function can run. None of this can be scripted from the
repo — it involves a live Everflow API key and Supabase secrets/cron, which
aren't stored or scheduled in migrations.

Project: Supabase `Brand Internal Tool` (`sexvfnypyhojgppwrpxo`).

---

## 1. Get an Everflow API key

Everflow Control Center → **Security** → generate a Network API key. This key
authenticates as `X-Eflow-Api-Key` against `https://api.eflow.team/v1/...`.

---

## 2. Supabase Edge Function secret

Set this as a **function secret** (Dashboard → Project Settings → Edge
Functions → Secrets, or `supabase secrets set`) — server-only, never `VITE_*`,
never committed:

| Secret | Value |
|---|---|
| `EVERFLOW_API_KEY` | the API key from step 1 |

---

## 3. Apply the database migration

`supabase/migrations/0032_client_spend_goals.sql` adds `leads.everflow_advertiser_id`
and the `client_spend_goals` / `client_spend_actuals` tables.

- Local: `supabase db push` (or `supabase migration up`).
- Or apply via the Supabase MCP / SQL editor against the remote project.

---

## 4. Deploy the Edge Function

```sh
supabase functions deploy everflow-sync
```

---

## 5. Schedule the daily sync (pg_cron)

Spend doesn't need `gmail-poll`'s ~2-min cadence — once a day is enough to
keep the current month fresh. `pg_cron`/`pg_net` should already be enabled
(they're shared with the Gmail integration's pollers; see
`docs/gmail-integration-setup.md` §4 if they aren't yet).

In the SQL editor:

```sql
select cron.schedule(
  'everflow-daily-sync',
  '0 12 * * *',  -- daily at noon UTC
  $$
  select net.http_post(
    url := 'https://sexvfnypyhojgppwrpxo.functions.supabase.co/everflow-sync',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || '<service-role-key>',
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  )
  $$
);
```

Replace `<service-role-key>` with the project's service-role key (Dashboard →
Project Settings → API) — `everflow-sync`'s batch path (`{}` body, no
`leadId`) only accepts calls authenticated as the service role, same guard as
`gmail-poll`/`calendar-poll`.

---

## Verify

1. On a client's page, add its Everflow Advertiser ID and click "↻ Sync from
   Everflow" — confirm either a populated current-month revenue figure or a
   readable error (e.g. no data for that advertiser/month yet).
2. Check `public.client_spend_actuals` for a row with a non-null `revenue`
   and a recent `synced_at`.
3. The next day, confirm `synced_at` advanced on its own (cron ran) without a
   manual click — check `select cron.job_run_details` or the function's logs
   for the scheduled invocation.
