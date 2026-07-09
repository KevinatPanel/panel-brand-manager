import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The app talks directly to Supabase (no local API server), so there is no
// proxy. The dev port is taken from PORT when provided (so a preview/dev
// supervisor can assign one), falling back to 5173.
const PORT = Number(process.env.PORT) || 5173;

export default defineConfig({
  plugins: [react()],
  server: {
    port: PORT,
  },
});
