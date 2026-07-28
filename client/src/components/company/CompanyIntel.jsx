import { useEffect, useState, useCallback } from 'react';
import { api } from '../../lib/api.js';
import { Eyebrow } from '../ui.jsx';
import ScoreBadge from './ScoreBadge.jsx';
import EnrichmentSection from './EnrichmentSection.jsx';
import SignalsSection from './SignalsSection.jsx';
import FirmographicsFields from './FirmographicsFields.jsx';

// Company Intel — score, firmographics, enrichment, and signals for a deal's
// company, reusing the same components as the company profile. Self-fetching
// via api.getLead, entirely independent of any parent `deal` state.
//
// Collapsed by default (defaultExpanded=false, the Outreach/Meetings slide-out
// usage) — only fetches once expanded, so opening the panel stays cheap for
// the common case of never expanding this section. `onCompanyChanged` lets
// the parent reload anything it derives from the same leads row (e.g. a
// deal's read-only vertical display) and refresh the Leads/Companies board
// after any mutation here.
//
// defaultExpanded=true (the Meetings row usage) skips the collapse-toggle
// header entirely and fetches immediately — the row itself is already the
// collapsible boundary, so a second nested toggle would be redundant chrome.
export default function CompanyIntel({ leadId, config, verticals, onCompanyChanged, defaultExpanded = false }) {
  const [lead, setLead] = useState(null);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(defaultExpanded);

  const load = useCallback(async () => {
    if (leadId == null) return;
    try {
      setLead(await api.getLead(leadId));
    } catch (e) {
      setLead(null);
    }
  }, [leadId]);

  useEffect(() => {
    setLead(null);
    if (expanded || defaultExpanded) load();
  }, [leadId, expanded, defaultExpanded, load]);

  async function after(fn) {
    setBusy(true);
    try {
      await fn();
      await load();
      onCompanyChanged?.();
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  }

  const body = !lead || !config ? (
    <div className={defaultExpanded ? 'text-text-secondary text-[13px]' : 'px-5 pb-4 text-text-secondary text-[13px]'}>
      Loading…
    </div>
  ) : (
    <div className={defaultExpanded ? '' : 'pb-4'}>
      <div className={defaultExpanded ? '' : 'px-5'}>
        <ScoreBadge score={lead.score} updatedAt={lead.score_updated_at} />
        <FirmographicsFields lead={lead} verticals={verticals} after={after} />
      </div>
      <EnrichmentSection lead={lead} busy={busy} after={after} />
      <SignalsSection lead={lead} config={config} after={after} />
    </div>
  );

  if (defaultExpanded) return body;

  return (
    <div className="border-b border-hairline">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-center justify-between px-5 py-3 text-left"
      >
        <Eyebrow>Company Intel</Eyebrow>
        <span className="text-text-muted text-[12px]">{expanded ? '▲ Collapse' : '▼ Expand'}</span>
      </button>
      {expanded && body}
    </div>
  );
}
