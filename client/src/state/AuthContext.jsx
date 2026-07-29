import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient.js';

// Tracks the Supabase auth session and exposes magic-link sign-in / sign-out.
// supabase-js auto-detects the magic-link callback in the URL on load, so no
// dedicated callback route is needed.
const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      setLoading(false);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // shouldCreateUser:false + disabled public signups = allowlist-only access.
  const signInWithEmail = (email) =>
    supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false, emailRedirectTo: window.location.origin },
    });

  // Local-dev bypass: sign in to a dedicated dev account whose password is the
  // numeric code. Only ever invoked from dev-gated UI (see LoginView). Produces
  // a real Supabase session so RLS is satisfied. The code is never stored in the
  // bundle — it's typed at runtime and verified by Supabase. Gated on
  // import.meta.env.DEV so the whole helper (and the dev email) is dead-code
  // eliminated from production builds.
  const devSignIn = import.meta.env.DEV
    ? (code) =>
        supabase.auth.signInWithPassword({
          email: import.meta.env.VITE_DEV_EMAIL ?? 'dev@panel.local',
          password: code,
        })
    : undefined;

  const signOut = () => supabase.auth.signOut();

  // Stored in Supabase auth's own user_metadata — no separate profiles table
  // exists in this app. Supabase fires a USER_UPDATED auth-state-change event
  // on success, which the listener above picks up, so no manual refetch here.
  const updateProfile = ({ firstName, lastName }) =>
    supabase.auth.updateUser({ data: { first_name: firstName.trim(), last_name: lastName.trim() } });

  return (
    <AuthContext.Provider
      value={{ session, user: session?.user ?? null, loading, signInWithEmail, devSignIn, signOut, updateProfile }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
