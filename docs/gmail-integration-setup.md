# Gmail + Calendar Integration — Setup (manual steps)

These are the dashboard/console steps that **must be done by hand** (Kevin) before
the Edge Functions can run. None of this can be scripted from the repo because it
involves Google Cloud consent, OAuth credentials, and Supabase secrets.

Project: Supabase `Brand Internal Tool` (`sexvfnypyhojgppwrpxo`).

---

## 1. Google Cloud project + OAuth consent (Internal)

1. Go to <https://console.cloud.google.com/> as a Panel Workspace **admin** and
   create a project (e.g. `panel-sales-tracker`).
2. **APIs & Services → Enable APIs**: enable **Gmail API** and **Google Calendar API**.
3. **APIs & Services → OAuth consent screen**:
   - User type = **Internal**. ← critical. Internal apps are limited to your
     Workspace domain and **skip Google's verification/security assessment** for
     restricted Gmail scopes. (If anyone connecting is off-domain this breaks.)
   - App name, support email, developer email — fill in.
   - **Scopes**: add
     - `https://www.googleapis.com/auth/gmail.metadata` (headers only, no bodies)
     - `https://www.googleapis.com/auth/calendar.readonly`
   - (Defer `gmail.readonly` / `gmail.send` — add later only if needed.)
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type = **Web application**.
   - Authorized redirect URI:
     `https://sexvfnypyhojgppwrpxo.functions.supabase.co/google-oauth-callback`
   - Save the **Client ID** and **Client secret**.

---

## 2. Supabase Edge Function secrets

Set ONLY these five as **function secrets** (Dashboard → Project Settings → Edge
Functions → Secrets, or `supabase secrets set`). They are server-only — never
`VITE_*`, never committed.

| Secret | Value |
|---|---|
| `GOOGLE_CLIENT_ID` | from step 1.4 |
| `GOOGLE_CLIENT_SECRET` | from step 1.4 |
| `GOOGLE_REDIRECT_URI` | `https://sexvfnypyhojgppwrpxo.functions.supabase.co/google-oauth-callback` |
| `APP_REDIRECT_URL` | `https://panel-sales-tracker.vercel.app/integrations` (no query string — the callback appends `?connected=1`) |
| `TOKEN_ENC_KEY` | the **output** of `openssl rand -base64 32` (a ~44-char base64 string ending in `=`), NOT the command text itself |

`TOKEN_ENC_KEY` encrypts refresh tokens (AES-GCM) at the application layer inside
the functions. If it is ever rotated, every rep must reconnect.

> **Do NOT set `SUPABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY`.** The Edge runtime
> injects these (plus `SUPABASE_ANON_KEY`, `SUPABASE_DB_URL`) automatically — the
> `SUPABASE_` prefix is reserved and the dashboard will reject manual entries. The
> function code reads them at runtime regardless. If you tried to add them and got
> an error, that's expected — just leave them out.

---

## 3. Apply the database migration

`supabase/migrations/0006_gmail_integration.sql` adds the connection / suggestion /
meeting / domain-rule tables and the `touch_log` columns.

- Local: `supabase db push` (or `supabase migration up`).
- Or apply via the Supabase MCP / SQL editor against the remote project.

> This is the first per-user-private RLS in the schema — review the policies in
> `0006` before applying to production.

---

## 4. Enable scheduling extensions (for the pollers, Phase 1)

In the SQL editor (or a follow-up migration):

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;
```

The poll schedule (every ~2 min) is created in the Phase 1 migration once
`gmail-poll` / `calendar-poll` are deployed.

---

## 5. Deploy the Edge Functions

```sh
supabase functions deploy google-oauth-start
supabase functions deploy google-oauth-callback
supabase functions deploy gmail-poll       # Phase 1
supabase functions deploy calendar-poll    # Phase 1
```

---

## Verify (Phase 0)

1. Sign in to the app, open **Integrations**, click **Connect Gmail**.
2. Complete Google consent (you'll only see the Internal app, no "unverified" warning).
3. Confirm a row in `public.gmail_connections` for your user with a **non-empty,
   non-plaintext** `refresh_token_enc`.
4. Confirm the client can read `gmail_connection_status` but **cannot** read
   `gmail_connections` token columns.
5. Disconnect + reconnect → a fresh refresh token is issued (we send `prompt=consent`).
