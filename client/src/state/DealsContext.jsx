import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';

// Shared deals state: the full deal list (used by every board/table) plus the
// currently-open deal id for the slide-in Deal Detail panel. Any mutation
// calls refresh() so all views reflect the change immediately.
const DealsContext = createContext(null);

// The open deal, if any, is the single source of truth in the URL
// (/pipeline/:dealId) rather than local state, so it survives refresh, is
// shareable, and closes itself if the user navigates elsewhere.
const DEAL_ROUTE_RE = /^\/pipeline\/(\d+)$/;

export function DealsProvider({ children }) {
  const [deals, setDeals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const location = useLocation();
  const navigate = useNavigate();

  const refresh = useCallback(async () => {
    try {
      setError(null);
      const data = await api.listDeals();
      setDeals(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const match = location.pathname.match(DEAL_ROUTE_RE);
    if (!match && location.pathname.startsWith('/pipeline/')) {
      // Malformed deal id (e.g. /pipeline/abc) — bounce back to the board.
      navigate('/pipeline', { replace: true });
      return;
    }
    const next = match ? Number(match[1]) : null;
    setSelectedId((prev) => (prev === next ? prev : next));
  }, [location.pathname, navigate]);

  const openDeal = useCallback((id) => navigate(`/pipeline/${id}`), [navigate]);
  const closeDeal = useCallback(() => navigate('/pipeline', { replace: true }), [navigate]);

  const value = {
    deals,
    loading,
    error,
    refresh,
    selectedId,
    openDeal,
    closeDeal,
  };

  return <DealsContext.Provider value={value}>{children}</DealsContext.Provider>;
}

export function useDeals() {
  const ctx = useContext(DealsContext);
  if (!ctx) throw new Error('useDeals must be used within a DealsProvider');
  return ctx;
}
