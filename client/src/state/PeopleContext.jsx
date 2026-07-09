import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';

// Shared People state: the contact roster (with outreach rollups) and the
// currently-open person id for the slide-in detail panel. Any mutation calls
// refresh() so the roster updates immediately.
const PeopleContext = createContext(null);

// The open person, if any, is the single source of truth in the URL
// (/people/:personId) rather than local state, so it survives refresh, is
// shareable, and closes itself if the user navigates elsewhere.
const PERSON_ROUTE_RE = /^\/people\/(\d+)$/;

export function PeopleProvider({ children }) {
  const [people, setPeople] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const location = useLocation();
  const navigate = useNavigate();

  const refresh = useCallback(async () => {
    try {
      setError(null);
      setPeople(await api.listContacts());
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
    const match = location.pathname.match(PERSON_ROUTE_RE);
    if (!match && location.pathname.startsWith('/people/')) {
      // Malformed person id (e.g. /people/abc) — bounce back to the roster.
      navigate('/people', { replace: true });
      return;
    }
    const next = match ? Number(match[1]) : null;
    setSelectedId((prev) => (prev === next ? prev : next));
  }, [location.pathname, navigate]);

  const openPerson = useCallback((id) => navigate(`/people/${id}`), [navigate]);
  const closePerson = useCallback(() => navigate('/people', { replace: true }), [navigate]);

  const value = {
    people,
    loading,
    error,
    refresh,
    selectedId,
    openPerson,
    closePerson,
  };

  return <PeopleContext.Provider value={value}>{children}</PeopleContext.Provider>;
}

export function usePeople() {
  const ctx = useContext(PeopleContext);
  if (!ctx) throw new Error('usePeople must be used within a PeopleProvider');
  return ctx;
}
