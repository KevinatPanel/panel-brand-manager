import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { gmail } from '../lib/gmail.js';

// Tracks the count of pending Gmail review-queue suggestions so the sidebar can
// show a badge. Refreshed on mount, on a slow interval, and on demand after the
// review queue resolves an item.
const InboxContext = createContext({ pending: 0, refresh: () => {} });

export function InboxProvider({ children }) {
  const [pending, setPending] = useState(0);
  const timer = useRef(null);

  const refresh = useCallback(async () => {
    try {
      setPending(await gmail.pendingCount());
    } catch {
      // Non-fatal (e.g. not connected / offline) — leave the last known count.
    }
  }, []);

  useEffect(() => {
    refresh();
    timer.current = setInterval(refresh, 60_000);
    return () => clearInterval(timer.current);
  }, [refresh]);

  return <InboxContext.Provider value={{ pending, refresh }}>{children}</InboxContext.Provider>;
}

export function useInbox() {
  return useContext(InboxContext);
}
