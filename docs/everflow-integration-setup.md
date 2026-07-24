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

## 5. Sync every 15 minutes (pg_cron) — DONE, live in prod

`pg_cron`/`pg_net` are enabled (shared with the Gmail integration's pollers)
and a vault secret named `service_role_key` already exists — `gmail-poll` and
`calendar-poll` both reference it the same way. The `everflow-sync-15min` job
(id 5) reuses that same secret, so no raw key ever needed to be pasted
anywhere:

```sql
select cron.schedule(
  'everflow-sync-15min',
  '*/15 * * * *',  -- every 15 minutes
  $$
  select net.http_post(
    url := 'https://sexvfnypyhojgppwrpxo.supabase.co/functions/v1/everflow-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);
```

`everflow-sync`'s batch path (`{}` body, no `leadId`) accepts calls
authenticated as either the service role (this cron job) or a logged-in
rep's JWT (the Home page's "Sync all" button), same guard pattern as
`gmail-poll`/`calendar-poll` but widened to also allow reps.

Note: `syncAll()` syncs current + previous month for every client with an
Everflow Advertiser ID (10 as of this writing — 20 sequential Everflow calls
per run), not full history, so a 15-minute cadence stays cheap per run. It
also degrades gracefully if Everflow rate-limits a call — that client is
just counted as `skipped`, not a hard failure. `timeout_milliseconds` only
bounds how long pg_net waits to capture the HTTP response for logging; it
doesn't cut the sync short server-side if it runs long.

To check on or change the schedule later:

```sql
select jobid, jobname, schedule, active from cron.job;
select * from cron.job_run_details where jobid = 5 order by start_time desc limit 5;
select cron.unschedule('everflow-sync-15min');  -- to stop it
```

---

## Verify

1. On a client's page, add its Everflow Advertiser ID and click "↻ Sync from
   Everflow" — confirm either a populated current-month revenue figure or a
   readable error (e.g. no data for that advertiser/month yet).
2. Check `public.client_spend_actuals` for a row with a non-null `revenue`
   and a recent `synced_at`.
3. After ~15 minutes, confirm `synced_at` advanced on its own (cron ran)
   without a manual click — check `select * from cron.job_run_details order
   by start_time desc limit 5;` or the function's logs for the scheduled
   invocation.
4. On the Home page, click the spend widget's "Sync all" button — confirm it
   disables while running and `synced_at` advances for every client with an
   Everflow Advertiser ID.
