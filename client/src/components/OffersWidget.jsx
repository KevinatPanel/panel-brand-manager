import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { formatCurrency } from '../lib/stages.js';
import { Eyebrow } from './ui.jsx';

// First-of-month date string (YYYY-MM-DD) for the current month — mirrors
// SpendGoalWidget/QualityMetricWidget's own local monthKey helper.
function currentMonthKey() {
  const d = new Date();
  d.setDate(1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

function monthFullLabel(monthStr) {
  const [y, m] = monthStr.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long' });
}

// Per-offer breakdown for advertisers running several simultaneous Everflow
// offers under one account (e.g. tiered payouts T1/T2/T3/T4 for the same
// property, distinct payouts per tier). Offers are auto-discovered by
// everflow-sync from Everflow's own per-offer report breakdown, not created
// here — this just lists what that sync already wrote (client_offers) plus
// this month's revenue per offer, with an inline rename per offer (same
// defaultValue/onBlur pattern as the company-name header in
// CompanyProfile.jsx). No per-offer goals — goals stay client-level only.
export default function OffersWidget({ lead }) {
  const [offers, setOffers] = useState(null);
  const [actualsByOffer, setActualsByOffer] = useState({});

  const load = () => {
    api.listClientOffers(lead.id).then(setOffers).catch(() => setOffers([]));
  };

  useEffect(load, [lead.id]);

  useEffect(() => {
    if (!offers || offers.length === 0) {
      setActualsByOffer({});
      return;
    }
    const month = currentMonthKey();
    Promise.all(
      offers.map((o) =>
        api
          .listOfferSpendActuals(o.id)
          .then((rows) => [o.id, rows.find((r) => r.month === month) ?? null])
          .catch(() => [o.id, null]),
      ),
    ).then((pairs) => setActualsByOffer(Object.fromEntries(pairs)));
  }, [offers]);

  if (!lead.everflow_advertiser_id) return null;

  const loading = offers === null;

  return (
    <div className="px-5 py-4 border-t border-hairline">
      {/* "Revenue — <Month>" (same "Section — qualifier" convention as
          QualityMetricWidget's "Quality — {event name}") names both the
          metric (billed-to-advertiser revenue, same as Spend vs. goal
          tracks — not payout/profit) and the period (current calendar
          month only, no historical browsing here) in one heading instead of
          a second header row. */}
      <Eyebrow>Revenue — {monthFullLabel(currentMonthKey())}</Eyebrow>
      {!loading && offers.length === 0 && (
        <div className="mt-2 text-text-disabled text-[12px]">
          No offers found yet — sync from Everflow to discover them.
        </div>
      )}
      {!loading && offers.length > 0 && (
        <div className="mt-2.5 space-y-2">
          {offers.map((offer) => (
            <OfferRow key={offer.id} offer={offer} actual={actualsByOffer[offer.id]} onRenamed={load} />
          ))}
        </div>
      )}
    </div>
  );
}

function OfferRow({ offer, actual, onRenamed }) {
  async function commit(e) {
    const next = e.target.value.trim();
    if (next === (offer.display_name ?? '')) return;
    await api.renameClientOffer(offer.id, next || null);
    onRenamed();
  }

  return (
    <div className="flex items-center justify-between gap-3">
      <input
        key={offer.id}
        defaultValue={offer.display_name ?? offer.everflow_offer_name ?? ''}
        onBlur={commit}
        placeholder={offer.everflow_offer_name ?? 'Offer'}
        className="bg-transparent text-text-primary text-[13px] font-medium outline-none min-w-0 flex-1 truncate"
      />
      <span className="font-mono font-medium text-text-secondary text-[13px] shrink-0">
        {actual?.revenue != null ? formatCurrency(actual.revenue) : '—'}
      </span>
    </div>
  );
}
