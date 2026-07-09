import { useEffect, useState, useCallback, useRef } from 'react';
import { Eyebrow, Button } from './ui.jsx';
import { gmail } from '../lib/gmail.js';

// Relative "x ago" for the last-sync line.
function ago(iso) {
  if (!iso) return 'never';
  const secs = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

const STATUS_LABEL = {
  active: { text: 'Connected', className: 'text-signal' },
  needs_reauth: { text: 'Needs reconnect', className: 'text-amber-400' },
  revoked: { text: 'Disconnected', className: 'text-text-muted' },
};

// Per-rep toggle: auto-advance an S1 deal to S2 when the prospect replies.
function AutoAdvanceToggle({ initial }) {
  const [on, setOn] = useState(!!initial);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    const next = !on;
    setOn(next); // optimistic
    setBusy(true);
    try {
      await gmail.setAutoAdvance(next);
    } catch {
      setOn(!next); // revert on failure
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 pt-4 border-t border-hairline flex items-center justify-between gap-4">
      <div className="text-[12px] text-text-secondary leading-relaxed">
        Auto-advance <span className="font-mono">S1 → S2</span> when a prospect replies.
        <div className="text-text-disabled">Off keeps it as a review-queue suggestion instead.</div>
      </div>
      <button
        onClick={toggle}
        disabled={busy}
        className={`w-8 h-[18px] shrink-0 border flex items-center px-0.5 transition-colors ${
          on ? 'border-signal/60 bg-signal/15 justify-end' : 'border-hairline justify-start'
        }`}
        aria-pressed={on}
        title="Toggle auto-advance"
      >
        <span className={`w-3 h-3 ${on ? 'bg-signal' : 'bg-text-muted'}`} />
      </button>
    </div>
  );
}

// A scan that hasn't advanced its row in this long is treated as stalled (the
// backfill died before reaching its next checkpoint) — so the button re-enables
// instead of spinning forever. A live batch checkpoints well inside this window.
const SCAN_STALE_MS = 90_000;

// One-time inbox scan: walks your sent mail to propose people + companies into
// the Review Queue. Shows live progress; on success/failure/stall it always
// returns to a clickable state with a message.
function ScanInboxSection() {
  const [job, setJob] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [now, setNow] = useState(() => Date.now());
  const timer = useRef(null);

  const refresh = useCallback(async () => {
    try {
      setJob(await gmail.scanStatus());
      setNow(Date.now());
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const active = job?.status === 'queued' || job?.status === 'running';
  // Stalled = "active" on paper but the row hasn't moved within the window.
  const stalled = active && job?.updated_at
    ? now - new Date(job.updated_at).getTime() > SCAN_STALE_MS
    : false;
  const inProgress = active && !stalled;

  // Poll while a scan is genuinely in flight (advances `now` so `stalled` can
  // flip even if the row stops changing). Stops once done/error/stalled.
  useEffect(() => {
    if (inProgress) {
      timer.current = setInterval(refresh, 4000);
      return () => clearInterval(timer.current);
    }
  }, [inProgress, refresh]);

  async function scan() {
    setBusy(true);
    setError(null);
    try {
      await gmail.startInboxScan();
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const failed = job?.status === 'error' || stalled;
  const label = stalled
    ? 'Scan stalled — please try again.'
    : job?.status === 'error'
      ? `Scan failed: ${job.error ?? 'unknown error'}`
      : job?.status === 'done'
        ? `Last scan: ${job.processed_count} emails · ${job.suggested_count} suggestions`
        : inProgress
          ? `Scanning… ${job.processed_count} emails · ${job.suggested_count} found`
          : 'Scan your sent mail to find people and companies to add.';

  return (
    <div className="mt-4 pt-4 border-t border-hairline flex items-center justify-between gap-4">
      <div className="text-[12px] text-text-secondary leading-relaxed min-w-0">
        Inbox scan
        <div className={`${failed ? 'text-red-400' : 'text-text-disabled'} truncate`}>
          {label}
        </div>
        {error && <div className="text-red-400">{error}</div>}
      </div>
      <Button variant="secondary" onClick={scan} disabled={busy || inProgress} className="shrink-0">
        {inProgress ? 'Scanning…' : busy ? 'Starting…' : failed ? 'Try again' : 'Scan inbox'}
      </Button>
    </div>
  );
}

// Self-contained Gmail connection card: fetches its own status and drives the
// OAuth connect handoff. Reused on the Settings page.
export default function GmailConnectionCard() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setStatus(await gmail.getStatus());
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function connect() {
    setConnecting(true);
    setError(null);
    try {
      const url = await gmail.startConnect();
      window.location.assign(url); // hand off to Google consent
    } catch (e) {
      setError(e.message);
      setConnecting(false);
    }
  }

  const s = STATUS_LABEL[status?.status] ?? null;

  return (
    <div className="panel-card p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-text-primary text-[15px] font-medium">Workspace Gmail</div>
          <div className="text-text-secondary text-[13px] mt-1 leading-relaxed">
            Logs emails onto matching deals, suggests new opportunities, people,
            and companies from who you email, and surfaces booked meetings.
          </div>
        </div>
        <div className="shrink-0">
          {loading ? (
            <span className="text-text-disabled text-[12px]">Loading…</span>
          ) : status ? (
            <Button variant="secondary" onClick={connect} disabled={connecting}>
              {connecting ? 'Opening…' : 'Reconnect'}
            </Button>
          ) : (
            <Button variant="primary" onClick={connect} disabled={connecting}>
              {connecting ? 'Opening…' : 'Connect Gmail'}
            </Button>
          )}
        </div>
      </div>

      {status && (
        <div className="mt-4 pt-4 border-t border-hairline flex items-center gap-6">
          <div>
            <Eyebrow className="mb-1">Account</Eyebrow>
            <div className="text-text-primary text-[13px]">{status.google_email}</div>
          </div>
          <div>
            <Eyebrow className="mb-1">Status</Eyebrow>
            <div className={`text-[13px] ${s?.className ?? 'text-text-secondary'}`}>
              {s?.text ?? status.status}
            </div>
          </div>
          <div>
            <Eyebrow className="mb-1">Last sync</Eyebrow>
            <div className="text-text-secondary text-[13px]">{ago(status.last_synced_at)}</div>
          </div>
        </div>
      )}

      {status && <AutoAdvanceToggle initial={status.auto_advance_s1_s2} />}

      {status?.status === 'active' && <ScanInboxSection />}

      {error && <div className="mt-4 text-red-400 text-[12px]">{error}</div>}
    </div>
  );
}
