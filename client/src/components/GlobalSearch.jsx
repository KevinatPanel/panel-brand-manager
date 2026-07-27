import { useState, useRef, useEffect, useMemo } from 'react';
import { useDeals } from '../state/DealsContext.jsx';
import { useLeads } from '../state/LeadsContext.jsx';
import { STAGE_LABELS } from '../lib/stages.js';

// Persistent sidebar search across companies (leads is the single source of
// company identity now — see 0039_unify_deal_lead_identity). Pure client-side
// filtering of the in-memory lead list; a company with an active deal opens
// straight into it, otherwise it opens the company profile. This used to
// search deals and leads as two separate, unlinked result sets — since every
// deal now has a lead_id, a company in the pipeline only ever shows once.
const LIMIT = 8;

export default function GlobalSearch() {
  const { deals, openDeal } = useDeals();
  const { leads, openLead } = useLeads();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  // Close the dropdown on outside click.
  useEffect(() => {
    function onDown(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const query = q.trim().toLowerCase();

  const dealByLeadId = useMemo(() => new Map(deals.map((d) => [d.lead_id, d])), [deals]);

  const hits = useMemo(() => {
    if (!query) return [];
    const match = (...vals) => vals.some((v) => v && String(v).toLowerCase().includes(query));
    return leads
      .filter((l) => match(l.company_name, l.website, l.vertical_name))
      .slice(0, LIMIT)
      .map((l) => ({ lead: l, deal: dealByLeadId.get(l.id) ?? null }));
  }, [query, leads, dealByLeadId]);

  const showDropdown = open && query.length > 0;

  function select(hit) {
    if (hit.deal) openDeal(hit.deal.id);
    else openLead(hit.lead.id);
    setQ('');
    setOpen(false);
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') {
      setQ('');
      setOpen(false);
      e.currentTarget.blur();
    } else if (e.key === 'Enter') {
      if (hits[0]) select(hits[0]);
    }
  }

  return (
    <div ref={wrapRef} className="relative px-3 py-3 border-b border-hairline">
      <input
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder="Search companies…"
        className="w-full bg-space border border-hairline px-2.5 py-1.5 text-[12px] text-text-primary placeholder:text-text-disabled outline-none focus:border-signal/60 transition-colors"
      />

      {showDropdown && (
        <div className="absolute left-3 top-full mt-1 w-80 max-h-[70vh] overflow-y-auto bg-space border border-hairline z-40">
          {hits.length === 0 ? (
            <div className="px-3 py-3 text-text-disabled text-[12px]">No results</div>
          ) : (
            hits.map(({ lead, deal }) => (
              <button
                key={lead.id}
                onClick={() => select({ lead, deal })}
                className="w-full text-left px-3 py-2 hover:bg-card-hover flex items-center justify-between gap-2"
              >
                <span className="text-text-primary text-[13px] truncate">{lead.company_name}</span>
                <span className="eyebrow text-text-muted shrink-0">
                  {deal
                    ? STAGE_LABELS[deal.current_stage] ?? deal.current_stage
                    : lead.is_client
                      ? 'Client'
                      : (lead.vertical_name ?? '—') + ' · ' + lead.score}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
