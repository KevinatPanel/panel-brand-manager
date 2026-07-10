import { OWNERS, SOURCES, CHANNELS } from '../../lib/stages.js';
import { Field, Input, Select, Eyebrow } from '../ui.jsx';

// Owner/Vertical/Source/Channel/Pilot Spend/Days-in-Pipeline — shared by the
// slide-out and the full deal page so both autosave the same way instead of
// drifting into two copies. Point of Contact is deliberately NOT part of this
// shared grid: the slide-out keeps its own ContactSelect field as-is, and the
// full page's Stakeholders section supersedes it there (see plan judgment
// call on deals.contact_id staying untouched for this feature).
export default function DealOverviewFields({ deal, verticals, patch }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <Field label="Owner">
        <Select value={deal.owner ?? ''} onChange={(e) => patch({ owner: e.target.value })}>
          <option value="">Unassigned</option>
          {OWNERS.map((o) => <option key={o} value={o}>{o}</option>)}
        </Select>
      </Field>
      <Field label="Vertical">
        <Select value={deal.vertical ?? ''} onChange={(e) => patch({ vertical: e.target.value })}>
          <option value="">Unsorted</option>
          {verticals.map((v) => <option key={v.id} value={v.name}>{v.name}</option>)}
          {deal.vertical && !verticals.some((v) => v.name === deal.vertical) && (
            <option value={deal.vertical}>{deal.vertical}</option>
          )}
        </Select>
      </Field>
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
      <Field label="Pilot Spend (USD)">
        <Input
          type="number"
          min="0"
          defaultValue={deal.pilot_spend ?? ''}
          onBlur={(e) => patch({ pilot_spend: e.target.value === '' ? null : Number(e.target.value) })}
          className="font-mono"
        />
      </Field>
      <div className="self-end">
        <Eyebrow className="mb-1">Days in pipeline</Eyebrow>
        <span className="font-mono text-[13px] text-text-primary">{deal.days_in_pipeline}d</span>
      </div>
    </div>
  );
}
