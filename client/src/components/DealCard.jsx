import { useState } from 'react';
import { formatCurrency } from '../lib/stages.js';
import { Icon } from './ui.jsx';

// Every card field but the company name (always shown) is toggleable from
// the Outreach toolbar's Card Fields menu — see CardFieldsMenu.jsx.
export const CARD_FIELD_OPTIONS = [
  { key: 'owner', label: 'Account Manager' },
  { key: 'daysInPipeline', label: 'Days in Pipeline' },
  { key: 'dealSize', label: 'Deal Size' },
  { key: 'contact', label: 'Company Contact' },
];
export const DEFAULT_CARD_FIELDS = Object.fromEntries(CARD_FIELD_OPTIONS.map((o) => [o.key, true]));

// A single deal card for the Kanban boards. Company name always shows;
// everything else renders per the `fields` toggle map. Clicking opens the
// Deal Detail panel; the card is also draggable so it can be dropped onto
// another stage column.
export default function DealCard({ deal, fields = DEFAULT_CARD_FIELDS, onClick }) {
  const [dragging, setDragging] = useState(false);
  const showStats = fields.daysInPipeline || fields.dealSize;
  const showFooter = showStats || fields.owner;

  return (
    <button
      onClick={onClick}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/deal', deal.id);
        e.dataTransfer.effectAllowed = 'move';
        setDragging(true);
      }}
      onDragEnd={() => setDragging(false)}
      className={`panel-card w-full text-left p-3 block cursor-grab active:cursor-grabbing ${
        dragging ? 'opacity-50' : ''
      }`}
    >
      <div className="min-w-0">
        <div className="text-text-primary text-[13px] font-semibold truncate">
          {deal.company_name}
        </div>
        {fields.contact && deal.primary_stakeholder_name && (
          <div className="text-text-secondary text-[12px] mt-0.5 truncate">
            {deal.primary_stakeholder_name}
          </div>
        )}
      </div>

      {showFooter && (
        <div className="flex items-center justify-between mt-3 pt-3 border-t border-hairline">
          <div className="flex items-center gap-3">
            {fields.daysInPipeline && (
              <span className="flex items-center gap-1 font-mono text-[12px] text-text-secondary">
                <Icon name="clock" className="w-3 h-3 text-text-muted" />
                {deal.days_in_pipeline}d
              </span>
            )}
            {fields.dealSize && (
              <span className="flex items-center gap-1 font-mono text-[12px] text-text-secondary">
                <Icon name="value" className="w-3 h-3 text-text-muted" />
                {formatCurrency(deal.deal_size)}
              </span>
            )}
          </div>
          {fields.owner && (
            <span className="eyebrow text-text-secondary border border-hairline px-1.5 py-0.5">
              {deal.owner ?? '—'}
            </span>
          )}
        </div>
      )}
    </button>
  );
}
