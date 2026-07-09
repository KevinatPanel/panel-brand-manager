import { createClient } from '@supabase/supabase-js';

// Single shared Supabase client. The publishable (anon) key is browser-safe;
// Row Level Security gates the data and magic-link auth gates the app.
const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  // Surfaced loudly so a missing .env is obvious in dev.
  console.error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY — check client/.env');
}

export const supabase = createClient(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true, // auto-handles the magic-link callback fragment
  },
});
