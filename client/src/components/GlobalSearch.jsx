import { useState, useRef, useEffect, useMemo } from 'react';
import { useDeals } from '../state/DealsContext.jsx';
import { useLeads } from '../state/LeadsContext.jsx';
import { STAGE_LABELS } from '../lib/stages.js';

// Persistent sidebar search across deals + leads. Pure client-side filtering of
// the in-memory lists; selecting a result opens the matching (globally mounted)
// detail panel from any view.
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

  const { dealHits, leadHits } = useMemo(() => {
    if (!query) return { dealHits: [], leadHits: [] };
    const match = (...vals) => vals.some((v) => v && String(v).toLowerCase().includes(query));
    return {
      dealHits: deals
        .filter((d) =>
          match(d.brand_name, d.owner, d.vertical, d.intent_notes, d.closed_lost_reason),
        )
        .slice(0, LIMIT),
      leadHits: leads
        .filter((l) => match(l.company_name, l.website, l.vertical_name))
        .slice(0, LIMIT),
    };
  }, [query, deals, leads]);

  const showDropdown = open && query.length > 0;
  const hasResults = dealHits.length > 0 || leadHits.length > 0;

  function select(openFn, id) {
    openFn(id);
    setQ('');
    setOpen(false);
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') {
      setQ('');
      setOpen(false);
      e.currentTarget.blur();
    } else if (e.key === 'Enter') {
      const first = dealHits[0] ?? leadHits[0];
      if (first) select(dealHits[0] ? openDeal : openLead, first.id);
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
        placeholder="Search deals & leads…"
        className="w-full bg-space border border-hairline px-2.5 py-1.5 text-[12px] text-text-primary placeholder:text-text-disabled outline-none focus:border-signal/60 transition-colors"
      />

      {showDropdown && (
        <div className="absolute left-3 top-full mt-1 w-80 max-h-[70vh] overflow-y-auto bg-space border border-hairline z-40">
          {!hasResults ? (
            <div className="px-3 py-3 text-text-disabled text-[12px]">No results</div>
          ) : (
            <>
              {dealHits.length > 0 && (
                <div>
                  <div className="px-3 pt-2 pb-1">
                    <span className="eyebrow text-text-muted">Deals</span>
                  </div>
                  {dealHits.map((d) => (
                    <button
                      key={`d${d.id}`}
                      onClick={() => select(openDeal, d.id)}
                      className="w-full text-left px-3 py-2 hover:bg-card-hover flex items-center justify-between gap-2"
                    >
                      <span className="text-text-primary text-[13px] truncate">{d.brand_name}</span>
                      <span className="eyebrow text-text-muted shrink-0">
                        {STAGE_LABELS[d.current_stage] ?? d.current_stage}
                      </span>
                    </button>
                  ))}
                </div>
              )}
              {leadHits.length > 0 && (
                <div>
                  <div className="px-3 pt-2 pb-1">
                    <span className="eyebrow text-text-muted">Leads</span>
                  </div>
                  {leadHits.map((l) => (
                    <button
                      key={`l${l.id}`}
                      onClick={() => select(openLead, l.id)}
                      className="w-full text-left px-3 py-2 hover:bg-card-hover flex items-center justify-between gap-2"
                    >
                      <span className="text-text-primary text-[13px] truncate">
                        {l.company_name}
                      </span>
                      <span className="eyebrow text-text-muted shrink-0">
                        {(l.vertical_name ?? '—') + ' · ' + l.score}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
