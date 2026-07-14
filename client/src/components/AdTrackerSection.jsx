import { useEffect, useState, useCallback } from 'react';
import { api } from '../lib/api.js';
import {
  OWNERS,
  PLATFORMS,
  AD_STAGE_LABELS,
  nextAdStageCode,
  adSlaStatus,
  adSlaColor,
} from '../lib/stages.js';
import { Eyebrow, Input, Select, Button } from './ui.jsx';

// Per-client creator-ad pipeline: submitted -> sent to brand -> brand
// approved -> live (or rejected from sent-to-brand). Self-fetching, same
// pattern as deal/TasksSection.jsx.
export default function AdTrackerSection({ leadId }) {
  const [items, setItems] = useState(null);
  const [adding, setAdding] = useState(false);
  const [showTerminal, setShowTerminal] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.listAdItems(leadId).then(setItems).catch(() => setItems([]));
  }, [leadId]);

  useEffect(() => {
    load();
  }, [load]);

  async function after(fn) {
    setBusy(true);
    try {
      await fn();
      load();
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (items === null) return null;

  const active = items.filter((i) => i.current_stage !== 'live' && i.current_stage !== 'rejected');
  const terminal = items.filter((i) => i.current_stage === 'live' || i.current_stage === 'rejected');

  return (
    <div className="px-5 py-4 border-t border-hairline">
      <div className="flex items-center justify-between mb-3">
        <Eyebrow>Ad Tracker</Eyebrow>
        <Button variant="ghost" onClick={() => setAdding((a) => !a)}>+ Add creator submission</Button>
      </div>

      {adding && (
        <AdItemForm
          busy={busy}
          onCancel={() => setAdding(false)}
          onSubmit={(body) => after(() => api.addAdItem(leadId, body)).then(() => setAdding(false))}
        />
      )}

      {active.length === 0 && !adding ? (
        <div className="text-text-disabled text-[12px]">No creator submissions yet.</div>
      ) : (
        <div className="space-y-2">
          {active.map((item) => (
            <AdItemRow
              key={item.id}
              item={item}
              busy={busy}
              onAdvance={() => after(() => api.setAdItemStage(item.id, nextAdStageCode(item.current_stage)))}
              onReject={() => after(() => api.setAdItemStage(item.id, 'rejected'))}
              onRemove={() => after(() => api.deleteAdItem(item.id))}
            />
          ))}
        </div>
      )}

      {terminal.length > 0 && (
        <div className="mt-3">
          <button
            onClick={() => setShowTerminal((s) => !s)}
            className="eyebrow text-text-muted hover:text-text-primary"
          >
            {showTerminal ? '▾' : '▸'} Live / Rejected ({terminal.length})
          </button>
          {showTerminal && (
            <div className="space-y-2 mt-2">
              {terminal.map((item) => (
                <AdItemRow key={item.id} item={item} busy={busy} terminal
                  onRemove={() => after(() => api.deleteAdItem(item.id))} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AdItemForm({ busy, onCancel, onSubmit }) {
  const [form, setForm] = useState({
    creator_link: '',
    platform: '',
    creator_owner: '',
    brand_owner: '',
  });
  return (
    <div className="border border-hairline p-3 mb-3 space-y-2">
      <Input
        value={form.creator_link}
        onChange={(e) => setForm({ ...form, creator_link: e.target.value })}
        placeholder="Creator link (profile or content URL)"
        autoFocus
      />
      <div className="grid grid-cols-3 gap-2">
        <Select value={form.platform} onChange={(e) => setForm({ ...form, platform: e.target.value })}>
          <option value="">Platform</option>
          {PLATFORMS.map((p) => <option key={p} value={p}>{p}</option>)}
        </Select>
        <Select value={form.creator_owner} onChange={(e) => setForm({ ...form, creator_owner: e.target.value })}>
          <option value="">Creator owner</option>
          {OWNERS.map((o) => <option key={o} value={o}>{o}</option>)}
        </Select>
        <Select value={form.brand_owner} onChange={(e) => setForm({ ...form, brand_owner: e.target.value })}>
          <option value="">Brand owner</option>
          {OWNERS.map((o) => <option key={o} value={o}>{o}</option>)}
        </Select>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button variant="primary" disabled={busy || !form.creator_link.trim()} onClick={() => onSubmit(form)}>
          Submit
        </Button>
      </div>
    </div>
  );
}

// Strip the scheme/www for compact display; the full URL is still the href.
function displayLink(url) {
  return String(url).replace(/^https?:\/\/(www\.)?/i, '');
}

function AdItemRow({ item, busy, terminal, onAdvance, onReject, onRemove }) {
  const next = nextAdStageCode(item.current_stage);
  const sla = adSlaStatus(item);
  return (
    <div className="flex items-center justify-between gap-2 border-b border-hairline pb-2">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <a
            href={item.creator_link}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[13px] text-text-primary truncate hover:underline"
          >
            {displayLink(item.creator_link)}
          </a>
          {item.platform && (
            <span className="eyebrow text-text-secondary border border-hairline px-1.5 py-0.5 shrink-0">
              {item.platform}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 mt-1">
          <span
            className={`eyebrow px-1.5 py-0.5 border shrink-0 ${
              item.current_stage === 'rejected'
                ? 'border-red-400/40 text-red-400'
                : item.current_stage === 'live'
                  ? 'border-signal/40 text-signal'
                  : 'border-hairline text-text-secondary'
            }`}
          >
            {AD_STAGE_LABELS[item.current_stage]}
          </span>
          <span className="text-[11px] text-text-muted">
            {item.creator_owner ?? '—'} → {item.brand_owner ?? '—'}
          </span>
          {sla && (
            <span className={`font-mono text-[11px] ${adSlaColor(sla)}`}>
              {sla.overdue ? `${Math.abs(sla.daysLeft)}d overdue` : `${sla.daysLeft}d left (SLA)`}
            </span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {!terminal && next && (
          <Button variant="ghost" disabled={busy} onClick={onAdvance}>
            {AD_STAGE_LABELS[next]} →
          </Button>
        )}
        {!terminal && item.current_stage === 'sent_to_brand' && (
          <Button variant="ghost" disabled={busy} onClick={onReject}>Reject</Button>
        )}
        <Button variant="ghost" disabled={busy} onClick={onRemove}>Remove</Button>
      </div>
    </div>
  );
}
