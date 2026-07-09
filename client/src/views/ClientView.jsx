import { useParams, useNavigate } from 'react-router-dom';
import ViewHeader from '../components/ViewHeader.jsx';
import CompanyProfile from '../components/CompanyProfile.jsx';
import { useLeads } from '../state/LeadsContext.jsx';

// A client's own space: the full company profile rendered as a page rather than
// a slide-over. Reached from the dynamic per-client links in the sidebar.
export default function ClientView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { leads, loading } = useLeads();

  const leadId = Number(id);
  const summary = leads.find((l) => l.id === leadId);

  // Wait for the board to load before deciding a company is missing.
  if (!loading && Number.isFinite(leadId) && leads.length > 0 && !summary) {
    return (
      <div>
        <ViewHeader title="Client" subtitle="Not found" />
        <div className="px-6 py-10 text-text-disabled text-[13px]">
          This company no longer exists.
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen">
      <ViewHeader title={summary?.company_name ?? 'Client'} subtitle="Client account" />
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-[640px]">
          <CompanyProfile leadId={leadId} onDeleted={() => navigate('/leads')} />
        </div>
      </div>
    </div>
  );
}
