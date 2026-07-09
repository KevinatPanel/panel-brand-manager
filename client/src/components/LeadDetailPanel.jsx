import { useLeads } from '../state/LeadsContext.jsx';
import { SlideOver } from './Overlay.jsx';
import CompanyProfile from './CompanyProfile.jsx';

// Slide-in company detail panel. The body is shared with the full-page client
// space (ClientView) via CompanyProfile — this just wraps it in the overlay.
export default function LeadDetailPanel() {
  const { selectedId, closeLead } = useLeads();
  if (selectedId == null) return null;

  return (
    <SlideOver onClose={closeLead} width="w-[480px]">
      <CompanyProfile leadId={selectedId} onClose={closeLead} onDeleted={closeLead} />
    </SlideOver>
  );
}
