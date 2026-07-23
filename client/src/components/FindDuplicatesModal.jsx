import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { Modal } from './Overlay.jsx';
import { Button, Eyebrow } from './ui.jsx';

// Surfaces merge-candidate groups from api.findDuplicateLeads() — "domain"
// groups are near-certain (the same signal accept_company_suggestion matches
// on), "name" groups are a normalized company_name match across different
// domains and need a human look before merging (could be a rebrand/subdomain,
// or two unrelated companies that happen to share a name). Picking a winner
// per group and merging calls api.mergeLeads(winnerId, loserId) once per
// remaining company in the group.
export default function FindDuplicatesModal({ onClose, onMerged }) {
  const [status, setStatus] = useState('loading');
  const [groups, setGroups] = useState([]);
  const [winners, setWinners] = useState({});
  const [busyKey, setBusyKey] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setStatus('loading');
    setError(null);
    try {
      const rows = await api.findDuplicateLeads();
      setGroups(rows);
      setStatus('ready');
    } catch (e) {
      setError(e.message);
      setStatus('error');
    }
  }

  const groupKey = (g) => g.leads.map((l) => l.id).join('-');
  const defaultWinner = (g) =>
    g.leads.reduce((best, l) => (l.contact_count > best.contact_count ? l : best), g.leads[0]).id;

  function dismiss(key) {
    setGroups((gs) => gs.filter((g) => groupKey(g) !== key));
  }

  async function mergeGroup(g) {
    const key = groupKey(g);
    const winnerId = winners[key] ?? defaultWinner(g);
    const loserIds = g.leads.filter((l) => l.id !== winnerId).map((l) => l.id);
    setBusyKey(key);
    setError(null);
    try {
      for (const loserId of loserIds) {
        // eslint-disable-next-line no-await-in-loop -- each merge must land before the next (same winner row)
        await api.mergeLeads(winnerId, loserId);
      }
      dismiss(key);
      onMerged?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <Modal title="Find Duplicates" onClose={onClose} width="max-w-2xl">
      {status === 'loading' && <div className="text-text-secondary text-[13px]">Scanning companies…</div>}
      {status === 'error' && <div className="text-red-400 text-[13px]">{error}</div>}
      {status === 'ready' && groups.length === 0 && (
        <div className="text-text-secondary text-[13px]">No duplicate companies found.</div>
      )}

      {status === 'ready' && groups.length > 0 && (
        <div className="space-y-4 max-h-[70vh] overflow-y-auto -mx-1 px-1">
          {groups.map((g) => {
            const key = groupKey(g);
            const winnerId = winners[key] ?? defaultWinner(g);
            const busy = busyKey === key;
            return (
              <div key={key} className="panel-card p-4">
                <Eyebrow className="mb-2">
                  {g.reason === 'domain' ? 'Same domain' : 'Similar name — confirm before merging'}
                </Eyebrow>
                <div className="space-y-2">
                  {g.leads.map((l) => (
                    <label key={l.id} className="flex items-start gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name={`winner-${key}`}
                        className="mt-1 shrink-0"
                        checked={winnerId === l.id}
                        disabled={busy}
                        onChange={() => setWinners((w) => ({ ...w, [key]: l.id }))}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-text-primary text-[13px] truncate">
                          {l.company_name}
                          {l.is_client && <span className="ml-2 eyebrow text-signal">client</span>}
                          {l.in_pipeline && <span className="ml-2 eyebrow text-text-disabled">in pipeline</span>}
                        </div>
                        <div className="text-text-disabled text-[12px] truncate">
                          {l.domain || l.website || 'no domain'} · {l.contact_count} contact
                          {l.contact_count === 1 ? '' : 's'}
                        </div>
                      </div>
                    </label>
                  ))}
                </div>
                <div className="mt-3 pt-3 border-t border-hairline flex items-center justify-between gap-3">
                  <div className="text-text-disabled text-[12px]">Keeps the selected company, merges the rest into it.</div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button variant="ghost" disabled={busy} onClick={() => dismiss(key)}>
                      Not a duplicate
                    </Button>
                    <Button variant="primary" disabled={busy} onClick={() => mergeGroup(g)}>
                      {busy ? 'Merging…' : 'Merge'}
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {error && status === 'ready' && <div className="mt-3 text-red-400 text-[12px]">{error}</div>}
    </Modal>
  );
}
