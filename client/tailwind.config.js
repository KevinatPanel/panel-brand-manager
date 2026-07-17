/** @type {import('tailwindcss').Config} */
// Panel brand design tokens. These values are the single source of truth for
// the UI — do not introduce off-palette colors, radii, or shadows.
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    // Hard corners only — zero border-radius on everything.
    borderRadius: {
      none: '0',
      DEFAULT: '0',
    },
    // No drop shadows on containers.
    boxShadow: {
      none: 'none',
    },
    extend: {
      colors: {
        // Surfaces
        space: '#0A0C12', // Space Black background
        card: 'rgba(255,255,255,0.025)', // Card surface
        'card-hover': 'rgba(255,255,255,0.05)', // Card hover
        'card-inset': 'rgba(255,255,255,0.015)', // Nested/inset panel (e.g. progress tracks)
        hairline: 'rgba(255,255,255,0.08)', // Dividers/borders
        // Signal Green — active states, status dots, CTAs ONLY
        signal: '#37FA77',
        // Text ramp (white at varying opacity)
        'text-primary': 'rgba(255,255,255,1.0)',
        'text-secondary': 'rgba(255,255,255,0.55)',
        'text-muted': 'rgba(255,255,255,0.35)',
        'text-disabled': 'rgba(255,255,255,0.22)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        // "mono" no longer maps to a monospace face — Inter has a clean
        // (unslashed) zero. Numeric alignment comes from tabular-nums (see
        // .font-mono in index.css), not from a fixed-width font.
        mono: ['Inter', 'system-ui', 'sans-serif'],
      },
      borderColor: {
        DEFAULT: 'rgba(255,255,255,0.08)', // default hairline border
      },
      letterSpacing: {
        eyebrow: '0.12em',
      },
    },
  },
  plugins: [],
};
