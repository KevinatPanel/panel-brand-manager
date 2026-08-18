import { useState } from 'react';
import { Modal } from '../Overlay.jsx';
import StageWeightsSection from './StageWeightsSection.jsx';

// Settings surface for the Outreach kanban, opened from the gear icon in its
// toolbar. A left-nav of pages inside one dialog rather than a dedicated
// route per setting — Stage Weights is the first page; add more entries here
// as the board grows more configurable.
const PAGES = [{ key: 'stage-weights', label: 'Stage Weights', Component: StageWeightsSection }];

export default function OutreachSettingsDialog({ onClose }) {
  const [active, setActive] = useState(PAGES[0].key);
  const page = PAGES.find((p) => p.key === active);

  return (
    <Modal title="Pipeline Settings" onClose={onClose} width="max-w-2xl">
      <div className="flex gap-6">
        <div className="w-40 shrink-0 space-y-0.5">
          {PAGES.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => setActive(p.key)}
              className={`w-full text-left px-3 py-2 text-[13px] border-l-2 transition-colors ${
                p.key === active
                  ? 'border-signal text-text-primary bg-card-hover'
                  : 'border-transparent text-text-secondary hover:text-text-primary'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="flex-1 min-w-0">{page && <page.Component />}</div>
      </div>
    </Modal>
  );
}
