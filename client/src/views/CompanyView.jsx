import { useParams, useNavigate } from 'react-router-dom';
import ViewHeader from '../components/ViewHeader.jsx';
import CompanyProfile from '../components/CompanyProfile.jsx';
import { useLeads } from '../state/LeadsContext.jsx';

// A company's own full-page space — reached either from a client's sidebar
// link (/clients/:id) or from anywhere that opens a company (/leads/:leadId,
// e.g. the Companies board, global search, a person's "view company" link).
// Both routes render this same component; there is no slide-over anymore.
export default function CompanyView() {
  const { id, leadId } = useParams();
  const navigate = useNavigate();
  const { leads, loading } = useLeads();

  const numId = Number(id ?? leadId);
  const summary = leads.find((l) => l.id === numId);

  // Wait for the board to load before deciding a company is missing.
  if (!loading && Number.isFinite(numId) && leads.length > 0 && !summary) {
    return (
      <div>
        <ViewHeader title="Company" subtitle="Not found" />
        <div className="px-6 py-10 text-text-disabled text-[13px]">
          This company no longer exists.
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen">
      <ViewHeader
        title={summary?.company_name ?? 'Company'}
        subtitle={summary?.is_client ? 'Client account' : 'Company'}
      />
      <CompanyProfile leadId={numId} onDeleted={() => navigate('/leads')} />
    </div>
  );
}
