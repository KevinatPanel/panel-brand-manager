import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';

// Shared Lead Intelligence state: lead summaries + verticals for the board, and
// the currently-open lead id for the slide-in detail panel. Any mutation calls
// refresh() so the board re-ranks immediately.
const LeadsContext = createContext(null);

// The open lead, if any, is the single source of truth in the URL
// (/leads/:leadId) rather than local state, so it survives refresh, is
// shareable, and closes itself if the user navigates elsewhere.
const LEAD_ROUTE_RE = /^\/leads\/(\d+)$/;

export function LeadsProvider({ children }) {
  const [leads, setLeads] = useState([]);
  const [verticals, setVerticals] = useState([]);
  const [config, setConfig] = useState(null); // scoring rubric (for the panel)
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const location = useLocation();
  const navigate = useNavigate();

  const refresh = useCallback(async () => {
    try {
      setError(null);
      const [l, v] = await Promise.all([api.listLeads(), api.listVerticals()]);
      setLeads(l);
      setVerticals(v);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Scoring config changes rarely (only via the Scoring Config page), so fetch
  // it once rather than on every board refresh.
  const refreshConfig = useCallback(async () => {
    try {
      setConfig(await api.getScoringConfig());
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    refresh();
    refreshConfig();
  }, [refresh, refreshConfig]);

  useEffect(() => {
    const match = location.pathname.match(LEAD_ROUTE_RE);
    if (!match && location.pathname.startsWith('/leads/')) {
      // Malformed lead id (e.g. /leads/abc) — bounce back to the board.
      navigate('/leads', { replace: true });
      return;
    }
    const next = match ? Number(match[1]) : null;
    setSelectedId((prev) => (prev === next ? prev : next));
  }, [location.pathname, navigate]);

  const openLead = useCallback((id) => navigate(`/leads/${id}`), [navigate]);
  const closeLead = useCallback(() => navigate('/leads', { replace: true }), [navigate]);

  const value = {
    leads,
    verticals,
    config,
    loading,
    error,
    refresh,
    refreshConfig,
    selectedId,
    openLead,
    closeLead,
  };

  return <LeadsContext.Provider value={value}>{children}</LeadsContext.Provider>;
}

export function useLeads() {
  const ctx = useContext(LeadsContext);
  if (!ctx) throw new Error('useLeads must be used within a LeadsProvider');
  return ctx;
}
