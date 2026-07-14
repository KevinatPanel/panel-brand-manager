import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';

// Shared Lead Intelligence state: lead summaries + verticals for the board.
// Any mutation calls refresh() so the board re-ranks immediately.
const LeadsContext = createContext(null);

export function LeadsProvider({ children }) {
  const [leads, setLeads] = useState([]);
  const [verticals, setVerticals] = useState([]);
  const [config, setConfig] = useState(null); // scoring rubric (for the panel)
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
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

  const openLead = useCallback((id) => navigate(`/leads/${id}`), [navigate]);

  const value = {
    leads,
    verticals,
    config,
    loading,
    error,
    refresh,
    refreshConfig,
    openLead,
  };

  return <LeadsContext.Provider value={value}>{children}</LeadsContext.Provider>;
}

export function useLeads() {
  const ctx = useContext(LeadsContext);
  if (!ctx) throw new Error('useLeads must be used within a LeadsProvider');
  return ctx;
}
