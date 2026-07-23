import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';

// Shared deals state: the full deal list (used by every board/table) plus the
// currently-open deal id for the slide-in Deal Detail panel. Any mutation
// calls refresh() so all views reflect the change immediately.
const DealsContext = createContext(null);

// The open deal, if any, is the single source of truth in the URL
// (/outreach/:dealId or /meetings/:dealId) rather than local state, so it
// survives refresh, is shareable, and closes itself if the user navigates
// elsewhere. openDeal/closeDeal derive which of the two base paths is
// current from location.pathname, so the same panel works from either board.
const DEAL_ROUTE_RE = /^\/(outreach|meetings)\/(\d+)$/;
const BOARD_BASE_RE = /^\/(outreach|meetings)(\/|$)/;

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
    const baseMatch = location.pathname.match(BOARD_BASE_RE);
    if (!match && baseMatch && location.pathname !== `/${baseMatch[1]}`) {
      // Malformed deal id (e.g. /outreach/abc) — bounce back to that board.
      navigate(`/${baseMatch[1]}`, { replace: true });
      return;
    }
    const next = match ? Number(match[2]) : null;
    setSelectedId((prev) => (prev === next ? prev : next));
  }, [location.pathname, navigate]);

  // Preserve the board's filter query string (?q=&owner=&channel=&stale=)
  // across opening/closing the slide-out, so it survives round-tripping
  // through /outreach/:dealId or /meetings/:dealId the same way it already
  // survives everything else about this URL-driven pattern. The base path
  // (which of the two boards we're on) is read from the current URL so the
  // panel returns to wherever it was actually opened from.
  const currentBase = useCallback(() => {
    const match = location.pathname.match(BOARD_BASE_RE);
    return match ? `/${match[1]}` : '/outreach';
  }, [location.pathname]);
  const openDeal = useCallback(
    (id) => navigate(`${currentBase()}/${id}${location.search}`),
    [navigate, currentBase, location.search],
  );
  const closeDeal = useCallback(
    () => navigate(`${currentBase()}${location.search}`, { replace: true }),
    [navigate, currentBase, location.search],
  );

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
