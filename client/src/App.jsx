import { useEffect } from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import SideNav from './components/SideNav.jsx';
import { useAuth } from './state/AuthContext.jsx';
import LoginView from './views/LoginView.jsx';
import { DealsProvider } from './state/DealsContext.jsx';
import { LeadsProvider } from './state/LeadsContext.jsx';
import DealDetailPanel from './components/DealDetailPanel.jsx';
import LeadDetailPanel from './components/LeadDetailPanel.jsx';
import HomeView from './views/HomeView.jsx';
import PipelineView from './views/PipelineView.jsx';
import DealView from './views/DealView.jsx';
import ClientView from './views/ClientView.jsx';
import LeadsView from './views/LeadsView.jsx';
import PeopleView from './views/PeopleView.jsx';
import ScoringConfigView from './views/ScoringConfigView.jsx';
import StageCriteriaConfigView from './views/StageCriteriaConfigView.jsx';
import SettingsView from './views/SettingsView.jsx';
import ReviewQueueView from './views/ReviewQueueView.jsx';
import { InboxProvider } from './state/InboxContext.jsx';

const POST_LOGIN_REDIRECT_KEY = 'post-login-redirect';

export default function App() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();

  // Capture the URL a logged-out visitor landed on (e.g. a shared deep link)
  // so we can send them back to it once they sign in.
  useEffect(() => {
    if (!loading && !session) {
      const path = window.location.pathname + window.location.search;
      if (path !== '/') sessionStorage.setItem(POST_LOGIN_REDIRECT_KEY, path);
    }
  }, [loading, session]);

  // Restore it once login succeeds. Keyed on Boolean(session) rather than
  // session itself since Supabase hands back a new session object on every
  // token refresh, not just on actual sign-in.
  useEffect(() => {
    if (session) {
      const target = sessionStorage.getItem(POST_LOGIN_REDIRECT_KEY);
      if (target) {
        sessionStorage.removeItem(POST_LOGIN_REDIRECT_KEY);
        navigate(target, { replace: true });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Boolean(session)]);

  // Gate the whole app behind login.
  if (loading) {
    return (
      <div className="min-h-screen bg-space flex items-center justify-center text-text-secondary text-[13px]">
        Loading…
      </div>
    );
  }
  if (!session) return <LoginView />;

  return (
    <DealsProvider>
      <LeadsProvider>
        <InboxProvider>
        <div className="flex min-h-screen bg-space">
          <SideNav />
          <div className="flex-1 min-w-0">
            <main>
              <Routes>
              <Route path="/" element={<Navigate to="/pipeline" replace />} />
              <Route path="/home" element={<HomeView />} />
              <Route path="/pipeline" element={<PipelineView />} />
              <Route path="/pipeline/:dealId" element={<PipelineView />} />
              <Route path="/deals/:dealId" element={<DealView />} />
              <Route path="/clients/:id" element={<ClientView />} />
              <Route path="/leads" element={<LeadsView />} />
              <Route path="/leads/:leadId" element={<LeadsView />} />
              <Route path="/people" element={<PeopleView />} />
              <Route path="/people/:personId" element={<PeopleView />} />
              <Route path="/scoring-config" element={<ScoringConfigView />} />
              <Route path="/stage-criteria" element={<StageCriteriaConfigView />} />
              <Route path="/settings" element={<SettingsView />} />
              {/* OAuth callback redirects to /integrations?connected=1 — keep it
                  mapped to Settings so the round-trip lands on this page. */}
              <Route path="/integrations" element={<SettingsView />} />
              <Route path="/inbox" element={<ReviewQueueView />} />
              <Route path="*" element={<Navigate to="/pipeline" replace />} />
              </Routes>
            </main>
          </div>
        </div>
        {/* Global slide-in panels — open whenever a deal/lead is selected. */}
        <DealDetailPanel />
        <LeadDetailPanel />
        </InboxProvider>
      </LeadsProvider>
    </DealsProvider>
  );
}
