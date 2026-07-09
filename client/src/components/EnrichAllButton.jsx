import { useState } from 'react';
import { api } from '../lib/api.js';
import { Button } from './ui.jsx';

// "Enrich all eligible" — bulk-enriches every company/person that would
// actually spend a credit (not yet enriched + has a usable identifier). It
// confirms the credit cost up front, shows live progress, and reports a
// summary. The per-record credit guards live in the Edge Function; this just
// pre-filters so the count shown is accurate.
export default function EnrichAllButton({ mode, onDone }) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);

  const isCompanies = mode === 'companies';
  const noun = isCompanies ? 'companies' : 'people';
  const countFn = isCompanies ? api.enrichableLeadCount : api.enrichableContactCount;
  const runFn = isCompanies ? api.enrichAllLeads : api.enrichAllContacts;

  async function run() {
    if (busy) return;
    setBusy(true);
    try {
      const n = await countFn();
      if (n === 0) {
        alert(`Nothing to enrich — every eligible ${noun.slice(0, -1)} is already enriched (or missing a ${isCompanies ? 'domain/website' : 'work email/LinkedIn'}).`);
        return;
      }
      if (!window.confirm(`Enrich ${n} ${noun} from Apollo?\n\nThis uses up to ${n} Apollo credit${n === 1 ? '' : 's'} (already-enriched records are skipped).`)) {
        return;
      }
      const summary = await runFn({ onProgress: (p) => setProgress(p) });
      const parts = [`${summary.enriched} enriched`];
      if (summary.noMatch) parts.push(`${summary.noMatch} no match`);
      if (summary.failed) parts.push(`${summary.failed} failed`);
      if (summary.stopped) parts.push('stopped early — Apollo rate limit, run again later');
      alert(`Done — ${parts.join(', ')}.`);
      await onDone?.();
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  return (
    <Button variant="secondary" disabled={busy} onClick={run}>
      {busy && progress ? `Enriching ${progress.done}/${progress.total}…` : busy ? 'Enriching…' : '↻ Enrich all'}
    </Button>
  );
}
