import { useMemo, useState } from 'react';
import { PeopleProvider, usePeople } from '../state/PeopleContext.jsx';
import ViewHeader from '../components/ViewHeader.jsx';
import { Input, Button, Select } from '../components/ui.jsx';
import { TierChip } from '../components/playbook/BuyerTier.jsx';
import { TIERS, TIER_ORDER, tierOf } from '../lib/buyerTiers.js';
import { relativeTime } from '../lib/leads.js';
import PersonDetailPanel from '../components/PersonDetailPanel.jsx';
import AddPersonModal from '../components/AddPersonModal.jsx';
import EnrichAllButton from '../components/EnrichAllButton.jsx';

// People roster — every person reached out to, with outreach rollups. Clicking
// a row opens that person's full profile + history.
function PeopleRoster() {
  const { people, loading, error, refresh, openPerson } = usePeople();
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('recent'); // 'recent' | 'stale'
  const [adding, setAdding] = useState(false);
  const [tier, setTier] = useState(''); // buyer tier filter ('' = all)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const byTier = tier ? people.filter((p) => tierOf(p) === tier) : people;
    const matched = !q
      ? byTier
      : byTier.filter((p) =>
          [p.name, p.email, p.title, p.company_name, p.location, p.seniority]
            .filter(Boolean)
            .some((v) => v.toLowerCase().includes(q)),
        );
    // Sort by last touch. 'recent' = most-recently contacted first (never-contacted last);
    // 'stale' = least-recently contacted first (never-contacted first — who's gone cold).
    const ts = (p) => (p.last_touch_at ? new Date(p.last_touch_at).getTime() : null);
    return [...matched].sort((a, b) => {
      const ta = ts(a);
      const tb = ts(b);
      if (sort === 'recent') {
        if (ta == null && tb == null) return 0;
        if (ta == null) return 1;
        if (tb == null) return -1;
        return tb - ta;
      }
      // stale
      if (ta == null && tb == null) return 0;
      if (ta == null) return -1;
      if (tb == null) return 1;
      return ta - tb;
    });
  }, [people, query, sort, tier]);

  return (
    <div>
      <ViewHeader title="People" subtitle={`${people.length} people contacted`}>
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name, email, company…"
          className="w-64"
        />
        <Select value={tier} onChange={(e) => setTier(e.target.value)} className="w-40">
          <option value="">All buyer tiers</option>
          {TIER_ORDER.map((t) => (
            <option key={t} value={t}>{TIERS[t].label}</option>
          ))}
        </Select>
        <Button variant="secondary" onClick={() => setSort((s) => (s === 'recent' ? 'stale' : 'recent'))}>
          {sort === 'recent' ? 'Recently contacted' : 'Gone cold first'}
        </Button>
        <EnrichAllButton mode="people" onDone={refresh} />
        <Button variant="primary" onClick={() => setAdding(true)}>+ Add Person</Button>
      </ViewHeader>

      {loading ? (
        <div className="px-6 py-10 text-text-secondary text-[13px]">Loading…</div>
      ) : error ? (
        <div className="px-6 py-10 text-red-400 text-[13px]">{error}</div>
      ) : people.length === 0 ? (
        <div className="px-6 py-10 text-text-disabled text-[13px]">
          No people yet. Add one, or add contacts from a company in the Companies tab.
        </div>
      ) : (
        <div className="py-2">
          {/* Column header */}
          <div className="grid grid-cols-[1.4fr_0.8fr_1.2fr_1.3fr_1.4fr_1fr] gap-4 px-6 py-2 border-b border-hairline">
            <Col>Name</Col>
            <Col>Buyer tier</Col>
            <Col>Title</Col>
            <Col>Company</Col>
            <Col>Email</Col>
            <Col>Last touch</Col>
          </div>

          {filtered.length === 0 ? (
            <div className="px-6 py-10 text-text-disabled text-[13px]">No matches.</div>
          ) : (
            filtered.map((p) => (
              <div
                key={p.id}
                onClick={() => openPerson(p.id)}
                className="grid grid-cols-[1.4fr_0.8fr_1.2fr_1.3fr_1.4fr_1fr] gap-4 px-6 py-3 border-b border-hairline items-center cursor-pointer hover:bg-card-hover transition-colors"
              >
                <div className="text-text-primary text-[13px] truncate">{p.name || '—'}</div>
                <div>{tierOf(p) ? <TierChip contact={p} /> : <span className="text-text-disabled text-[13px]">—</span>}</div>
                <div className="text-text-secondary text-[13px] truncate">{p.title || '—'}</div>
                <div className="text-text-secondary text-[13px] truncate">{p.company_name || '—'}</div>
                <div className="text-text-secondary text-[13px] truncate">{p.email || '—'}</div>
                <div className="text-text-secondary text-[12px] truncate">
                  {p.last_touch_at ? relativeTime(p.last_touch_at) : <span className="text-text-disabled">Never</span>}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {adding && <AddPersonModal onClose={() => setAdding(false)} onCreated={refresh} />}
    </div>
  );
}

function Col({ children }) {
  return <div className="eyebrow text-text-muted">{children}</div>;
}

export default function PeopleView() {
  return (
    <PeopleProvider>
      <PeopleRoster />
      <PersonDetailPanel />
    </PeopleProvider>
  );
}
