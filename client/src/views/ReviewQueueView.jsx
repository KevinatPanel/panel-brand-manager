import { useEffect, useState, useCallback } from 'react';
import ViewHeader from '../components/ViewHeader.jsx';
import { Eyebrow, Button, Input, CopyButton, IconButton } from '../components/ui.jsx';
import SearchSelect from '../components/SearchSelect.jsx';
import { gmail } from '../lib/gmail.js';
import { STAGE_LABELS } from '../lib/stages.js';
import { useDeals } from '../state/DealsContext.jsx';
import { useInbox } from '../state/InboxContext.jsx';

// Default brand name from a domain: "acme.io" -> "Acme".
function brandFromDomain(domain) {
  if (!domain) return '';
  const base = domain.split('.')[0] ?? '';
  return base ? base[0].toUpperCase() + base.slice(1) : '';
}

// A square "View conversation" icon button. stopPropagation so it can sit inside
// a <label> (the company card's person rows) without toggling its checkbox.
function ViewThreadButton({ threadId, title, onOpen }) {
  if (!threadId) return null;
  return (
    <IconButton
      icon="eye"
      title="View conversation"
      aria-label="View conversation"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onOpen({ threadId, title });
      }}
    />
  );
}

function SuggestionCard({ sug, deals, onResolve, onOpenThread }) {
  const { openDeal, refresh: refreshDeals } = useDeals();
  const [brand, setBrand] = useState(brandFromDomain(sug.contact_domain));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  async function run(fn) {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      await refreshDeals();
      onResolve(sug.id);
    } catch (e) {
      setErr(e.message);
      setBusy(false);
    }
  }

  const createDeal = () =>
    run(async () => {
      const dealId = await gmail.acceptSuggestionAsDeal(sug.id, brand);
      openDeal(dealId);
    });

  const attach = (dealId) => {
    if (!dealId) return;
    run(() => gmail.attachSuggestionToDeal(sug.id, Number(dealId)));
  };

  return (
    <div className="panel-card p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <Eyebrow className="mb-1">You emailed a new contact</Eyebrow>
          <div className="flex items-center gap-2 min-w-0">
            <div className="text-text-primary text-[14px] truncate">{sug.contact_email}</div>
            <CopyButton value={sug.contact_email} />
          </div>
          {sug.subject && (
            <div className="text-text-secondary text-[12px] mt-1 truncate">“{sug.subject}”</div>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <ViewThreadButton threadId={sug.thread_id} title={sug.contact_email} onOpen={onOpenThread} />
          <span className="eyebrow text-text-disabled">{sug.contact_domain}</span>
        </div>
      </div>

      <div className="mt-3 pt-3 border-t border-hairline space-y-2">
        <div className="flex items-end gap-2">
          <label className="flex-1">
            <Eyebrow className="mb-1">New deal name</Eyebrow>
            <Input value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="Company name" />
          </label>
          <Button variant="primary" disabled={busy} onClick={createDeal}>
            {busy ? 'Working…' : 'Create deal'}
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <SearchSelect
            value=""
            disabled={busy}
            onChange={(id) => attach(id)}
            options={deals.map((d) => ({ value: d.id, label: d.company_name }))}
            placeholder="Attach to existing deal…"
            className="flex-1"
          />
          <Button variant="ghost" disabled={busy} onClick={() => run(() => gmail.dismissSuggestion(sug.id))}>
            Ignore
          </Button>
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => run(() => gmail.ignoreDomain(sug.contact_domain))}
            title={`Never suggest ${sug.contact_domain} again`}
          >
            Ignore domain
          </Button>
        </div>
        {err && <div className="text-red-400 text-[12px]">{err}</div>}
      </div>
    </div>
  );
}

// A prospect replied on an S1 deal — offer to advance it to S2.
function StageMoveCard({ sug, deals, onResolve, onOpenThread }) {
  const { openDeal, refresh: refreshDeals } = useDeals();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const dealName = deals.find((d) => d.id === sug.proposed_deal_id)?.company_name ?? 'this deal';

  async function run(fn) {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      await refreshDeals();
      onResolve(sug.id);
    } catch (e) {
      setErr(e.message);
      setBusy(false);
    }
  }

  return (
    <div className="panel-card p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <Eyebrow className="mb-1">Reply received</Eyebrow>
          <div className="flex items-center gap-2 min-w-0">
            <div className="text-text-primary text-[14px] truncate">{sug.contact_email}</div>
            <CopyButton value={sug.contact_email} />
          </div>
          {sug.subject && (
            <div className="text-text-secondary text-[12px] mt-1 truncate">“{sug.subject}”</div>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <ViewThreadButton threadId={sug.thread_id} title={sug.contact_email} onOpen={onOpenThread} />
          <span className="eyebrow text-text-disabled">{sug.contact_domain}</span>
        </div>
      </div>
      <div className="mt-3 pt-3 border-t border-hairline flex items-center justify-between gap-3">
        <div className="text-[13px] text-text-secondary min-w-0 truncate">
          Move <span className="text-text-primary">{dealName}</span> to {sug.proposed_stage} ·{' '}
          {STAGE_LABELS[sug.proposed_stage]}?
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="primary"
            disabled={busy}
            onClick={() =>
              run(async () => {
                const id = await gmail.acceptStageMove(sug.id);
                openDeal(id);
              })
            }
          >
            {busy ? 'Working…' : `Move to ${sug.proposed_stage}`}
          </Button>
          <Button variant="ghost" disabled={busy} onClick={() => run(() => gmail.dismissSuggestion(sug.id))}>
            Dismiss
          </Button>
        </div>
      </div>
      {err && <div className="mt-2 text-red-400 text-[12px]">{err}</div>}
    </div>
  );
}

// A company we found in your sent mail, with the people to add under it. Approve
// creates the company (or attaches to the existing one) + the checked people.
function CompanySuggestionCard({ comp, onResolve, onOpenThread }) {
  const [selected, setSelected] = useState(() => new Set(comp.contacts.map((c) => c.id)));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const isExisting = !!comp.matched_lead_id;
  const title = comp.proposed_company_name || comp.domain;

  function toggle(id) {
    setSelected((cur) => {
      const next = new Set(cur);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function run(fn) {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      onResolve(comp.id);
    } catch (e) {
      setErr(e.message);
      setBusy(false);
    }
  }

  const approve = () =>
    run(() => gmail.acceptCompanySuggestion(comp.id, [...selected]));
  const reject = () => run(() => gmail.rejectCompanySuggestion(comp.id));
  const ignoreDomain = () =>
    run(async () => {
      await gmail.ignoreDomain(comp.domain);
      await gmail.rejectCompanySuggestion(comp.id);
    });

  return (
    <div className="panel-card p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <Eyebrow className="mb-1">{isExisting ? 'Add people to existing company' : 'New company found'}</Eyebrow>
          <div className="text-text-primary text-[14px] truncate">{title}</div>
        </div>
        <span className="eyebrow text-text-disabled shrink-0">{comp.domain}</span>
      </div>

      <div className="mt-3 pt-3 border-t border-hairline space-y-2">
        {comp.contacts.length === 0 ? (
          <div className="text-text-disabled text-[12px]">No new people to add.</div>
        ) : (
          comp.contacts.map((p) => (
            <label key={p.id} className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                className="mt-1 shrink-0"
                checked={selected.has(p.id)}
                disabled={busy}
                onChange={() => toggle(p.id)}
              />
              <div className="min-w-0 flex-1">
                <div className="text-text-primary text-[13px] truncate">
                  {p.name || p.email}
                  {p.title && <span className="text-text-secondary"> · {p.title}</span>}
                  {p.two_way && (
                    <span className="ml-2 eyebrow text-signal" title="This contact replied to you">
                      replied
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 min-w-0">
                  <div className="text-text-disabled text-[12px] truncate">{p.email}</div>
                  <CopyButton value={p.email} />
                  <ViewThreadButton threadId={p.source_thread_id} title={p.email} onOpen={onOpenThread} />
                </div>
              </div>
            </label>
          ))
        )}
      </div>

      <div className="mt-3 pt-3 border-t border-hairline flex items-center gap-2">
        <Button variant="primary" disabled={busy || selected.size === 0} onClick={approve}>
          {busy ? 'Working…' : isExisting ? 'Add people' : 'Create company'}
        </Button>
        <Button variant="ghost" disabled={busy} onClick={reject}>
          Reject
        </Button>
        <Button
          variant="ghost"
          disabled={busy}
          onClick={ignoreDomain}
          title={`Never suggest ${comp.domain} again`}
        >
          Ignore domain
        </Button>
      </div>
      {err && <div className="mt-2 text-red-400 text-[12px]">{err}</div>}
    </div>
  );
}

// Right-rail pane showing the live Gmail thread behind a suggestion. The body is
// fetched on demand (never stored), so this calls the gmail-thread Edge Function.
function ConversationPanel({ selected, onClose }) {
  const [state, setState] = useState({ status: 'loading', messages: [] });

  useEffect(() => {
    if (!selected?.threadId) return;
    let alive = true;
    setState({ status: 'loading', messages: [] });
    gmail
      .getThread(selected.threadId)
      .then((data) => {
        if (!alive) return;
        if (data?.error === 'needs_reauth') return setState({ status: 'needs_reauth', messages: [] });
        setState({ status: 'ready', messages: data?.messages ?? [] });
      })
      .catch((e) => alive && setState({ status: 'error', messages: [], error: e.message }));
    return () => {
      alive = false;
    };
  }, [selected?.threadId]);

  return (
    <div className="panel-card flex flex-col max-h-[calc(100vh-8rem)]">
      <div className="flex items-start justify-between gap-3 px-4 pt-4 pb-3 border-b border-hairline">
        <div className="min-w-0">
          <Eyebrow className="mb-1">Conversation</Eyebrow>
          <div className="text-text-primary text-[13px] truncate">{selected.title}</div>
        </div>
        <button onClick={onClose} className="text-text-muted hover:text-text-primary text-[13px]">
          ✕
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {state.status === 'loading' && (
          <div className="text-text-disabled text-[12px]">Loading conversation…</div>
        )}
        {state.status === 'error' && (
          <div className="text-red-400 text-[12px]">{state.error || 'Could not load conversation.'}</div>
        )}
        {state.status === 'needs_reauth' && (
          <div className="text-text-secondary text-[12px]">
            This thread can’t be read with the current Gmail grant. Reconnect Gmail (with the newer
            read permission) from Settings to view conversations.
          </div>
        )}
        {state.status === 'ready' && state.messages.length === 0 && (
          <div className="text-text-disabled text-[12px]">No messages found in this thread.</div>
        )}
        {state.status === 'ready' &&
          state.messages.map((m, i) => (
            <div key={i} className="border-b border-hairline pb-3 last:border-0">
              <div className="flex items-center justify-between gap-2">
                <div className="text-text-primary text-[12px] truncate">{m.from}</div>
                <div className="eyebrow text-text-disabled shrink-0">{m.date}</div>
              </div>
              {m.subject && <div className="text-text-secondary text-[12px] mt-0.5 truncate">{m.subject}</div>}
              <div className="text-text-secondary text-[12px] mt-2 whitespace-pre-wrap break-words">
                {m.body || '—'}
              </div>
            </div>
          ))}
      </div>
    </div>
  );
}

export default function ReviewQueueView() {
  const { deals } = useDeals();
  const { refresh: refreshInbox } = useInbox();
  const [suggestions, setSuggestions] = useState(null);
  const [companies, setCompanies] = useState(null);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null); // { threadId, title } | null

  const load = useCallback(async () => {
    try {
      const [sugs, comps] = await Promise.all([
        gmail.listSuggestions(),
        gmail.listCompanySuggestions(),
      ]);
      setSuggestions(sugs);
      setCompanies(comps);
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Drop a resolved deal card immediately, then refresh the nav badge.
  const onResolve = useCallback(
    (id) => {
      setSuggestions((cur) => (cur ?? []).filter((s) => s.id !== id));
      refreshInbox();
    },
    [refreshInbox],
  );

  const onResolveCompany = useCallback(
    (id) => {
      setCompanies((cur) => (cur ?? []).filter((c) => c.id !== id));
      refreshInbox();
    },
    [refreshInbox],
  );

  const loading = suggestions == null || companies == null;
  const empty = !loading && (suggestions?.length ?? 0) === 0 && (companies?.length ?? 0) === 0;

  return (
    <>
      <ViewHeader
        title="Review Queue"
        subtitle="New contacts you've emailed — turn them into opportunities, people, and companies"
      />
      <div className="flex items-start gap-4 p-6">
        <div className="flex-1 min-w-0 max-w-2xl space-y-3">
          {error && <div className="text-red-400 text-[13px]">{error}</div>}
          {loading ? (
            <div className="text-text-disabled text-[13px]">Loading…</div>
          ) : empty ? (
            <div className="text-text-secondary text-[13px]">
              Nothing to review. New external contacts you email — and companies found by an inbox
              scan — will show up here.
            </div>
          ) : (
            <>
              {(companies ?? []).map((c) => (
                <CompanySuggestionCard
                  key={`c${c.id}`}
                  comp={c}
                  onResolve={onResolveCompany}
                  onOpenThread={setSelected}
                />
              ))}
              {(suggestions ?? []).map((s) =>
                s.proposed_action === 'stage_move' ? (
                  <StageMoveCard key={s.id} sug={s} deals={deals} onResolve={onResolve} onOpenThread={setSelected} />
                ) : (
                  <SuggestionCard key={s.id} sug={s} deals={deals} onResolve={onResolve} onOpenThread={setSelected} />
                ),
              )}
            </>
          )}
        </div>

        {selected && (
          <div className="w-[420px] shrink-0 sticky top-6 hidden lg:block">
            <ConversationPanel selected={selected} onClose={() => setSelected(null)} />
          </div>
        )}
      </div>
    </>
  );
}
