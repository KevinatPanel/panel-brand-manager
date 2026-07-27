import { OWNERS, SOURCES, CHANNELS } from '../../lib/stages.js';
import { Field, Select, Eyebrow } from '../ui.jsx';

// Owner/Vertical/Source/Channel/Days-in-Pipeline — shared by the
// slide-out and the full deal page so both autosave the same way instead of
// drifting into two copies. Point of Contact is deliberately NOT part of this
// shared grid: the slide-out keeps its own ContactSelect field as-is, and the
// full page's Stakeholders section supersedes it there (see plan judgment
// call on deals.contact_id staying untouched for this feature).
// Vertical is read-only here — it's the company's vertical (leads.vertical_id,
// via deal_summaries' join), edited from the company profile, not per-deal
// (see 0039_unify_deal_lead_identity).
export default function DealOverviewFields({ deal, patch }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <Field label="Owner">
        <Select value={deal.owner ?? ''} onChange={(e) => patch({ owner: e.target.value })}>
          <option value="">Unassigned</option>
          {OWNERS.map((o) => <option key={o} value={o}>{o}</option>)}
        </Select>
      </Field>
      <div>
        <Eyebrow className="mb-1">Vertical</Eyebrow>
        <span className="font-mono text-[13px] text-text-primary">{deal.vertical_name ?? '—'}</span>
      </div>
      <Field label="Source">
        <Select value={deal.source ?? ''} onChange={(e) => patch({ source: e.target.value })}>
          <option value="">—</option>
          {SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
        </Select>
      </Field>
      <Field label="Channel">
        <Select value={deal.channel ?? ''} onChange={(e) => patch({ channel: e.target.value })}>
          <option value="">—</option>
          {CHANNELS.map((c) => <option key={c} value={c}>{c}</option>)}
        </Select>
      </Field>
      <div className="self-end">
        <Eyebrow className="mb-1">Days in pipeline</Eyebrow>
        <span className="font-mono text-[13px] text-text-primary">{deal.days_in_pipeline}d</span>
      </div>
    </div>
  );
}
