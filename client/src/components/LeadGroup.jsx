import LeadCard from './LeadCard.jsx';
import { Eyebrow } from './ui.jsx';

// A collapsible vertical section. Leads arrive pre-sorted by score desc and are
// ranked 1..n within the group. Open/closed state is controlled by LeadsView so
// the second nav can force a section open when jumping to it. The `id` anchors
// the section for scroll-into-view.
export default function LeadGroup({ id, name, leads, open, onToggle, onCardClick }) {
  return (
    <section id={`vert-${id}`} className="mb-8 scroll-mt-20">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-6 py-2 group"
      >
        <div className="flex items-center gap-2">
          <span className="text-text-muted text-[10px]">{open ? '▾' : '▸'}</span>
          <Eyebrow className="group-hover:text-text-secondary">{name}</Eyebrow>
        </div>
        <span className="font-mono text-text-muted text-[12px]">{leads.length}</span>
      </button>
      <div className="border-b border-hairline mx-6" />

      {open && (
        <div className="px-6 pt-3 space-y-2">
          {leads.length === 0 ? (
            <div className="text-text-disabled text-[12px] py-2">No leads in this vertical.</div>
          ) : (
            leads.map((lead, i) => (
              <LeadCard key={lead.id} lead={lead} rank={i + 1} onClick={() => onCardClick(lead.id)} />
            ))
          )}
        </div>
      )}
    </section>
  );
}
