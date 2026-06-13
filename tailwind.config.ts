import type { Config } from 'tailwindcss';

/**
 * Cara Spark design system — "Clinical Ledger" (tk-0015 design elevation).
 *
 * Ethos: a failsafe medical-triage tool for community health centers + safety-net patients.
 * Calm, trustworthy, clinical-but-human, and ACCESSIBILITY-FIRST (high contrast, large readable
 * type). The thesis — "the engine decided, and you can prove it" — drives the visual language:
 * the provable trace reads like a tamper-evident receipt, with monospace verification stamps.
 *
 * Tokens are additive. The original `brand.DEFAULT`, `brand.fg`, and `crisis` keys are PRESERVED
 * (existing components and per-tenant branding read `bg-brand`, `text-crisis`, `--brand`, etc.),
 * so this elevation never breaks an existing class or the runtime branding override.
 */
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // --- Brand teal ramp. DEFAULT + fg preserved; per-tenant branding overrides via --brand. ---
        brand: {
          DEFAULT: '#0f766e',
          fg: '#ffffff',
          50: '#eefbf8',
          100: '#d3f4ec',
          200: '#a9e8db',
          300: '#73d4c4',
          400: '#3bb9a8',
          500: '#1c9b8c',
          600: '#107d72',
          700: '#0f766e', // canonical brand
          800: '#115e57',
          900: '#134e48',
          950: '#042f2c',
        },
        // --- Crisis red. Single value preserved (text-crisis, bg-crisis/10 used widely). ---
        crisis: '#b91c1c',
        // --- "Verified" green — distinct from brand so a checksum-OK stamp never reads as decoration. ---
        verified: {
          DEFAULT: '#15803d',
          soft: '#dcfce7',
          ink: '#14532d',
        },
        // --- Warm paper canvas. Pure white is harsh under fluorescent clinic light; paper lifts
        //     perceived text contrast and reads calmer for long triage sessions. ---
        paper: {
          DEFAULT: '#fbfaf7',
          raised: '#ffffff',
          sunken: '#f3f1ea',
        },
        // --- Ink ramp for text. ink.900 on paper clears WCAG AAA for body copy. ---
        ink: {
          DEFAULT: '#1c1917',
          900: '#1c1917',
          700: '#3f3a36',
          500: '#6b645d',
          300: '#a8a29b',
          line: '#e7e3da', // hairline rule
        },
      },
      fontFamily: {
        // Wired in app/layout.tsx via next/font (self-hosted at build — no runtime CDN, safe for
        // air-gapped CHC deploys). Fallback stacks keep type legible if a face fails to load.
        display: ['var(--font-display)', 'Newsreader', 'Georgia', 'serif'],
        sans: ['var(--font-sans)', 'Public Sans', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'IBM Plex Mono', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      fontSize: {
        // Accessibility-first scale: body sits at 1.0625rem (17px) for readability on cheap screens.
        'display-xl': ['3.25rem', { lineHeight: '1.05', letterSpacing: '-0.02em', fontWeight: '600' }],
        'display-lg': ['2.5rem', { lineHeight: '1.1', letterSpacing: '-0.015em', fontWeight: '600' }],
        'display-md': ['1.875rem', { lineHeight: '1.15', letterSpacing: '-0.01em', fontWeight: '600' }],
        'body-lg': ['1.1875rem', { lineHeight: '1.6' }],
        body: ['1.0625rem', { lineHeight: '1.6' }],
        stamp: ['0.8125rem', { lineHeight: '1.4', letterSpacing: '0.01em' }],
      },
      borderRadius: {
        card: '0.875rem',
        stamp: '0.375rem',
      },
      boxShadow: {
        // Soft, low-spread shadows — a clinical instrument, not a floating SaaS card.
        card: '0 1px 2px rgba(28, 25, 23, 0.04), 0 8px 24px -12px rgba(28, 25, 23, 0.12)',
        raised: '0 2px 4px rgba(28, 25, 23, 0.05), 0 16px 40px -20px rgba(15, 118, 110, 0.18)',
        stamp: 'inset 0 0 0 1px rgba(21, 128, 61, 0.25)',
      },
      backgroundImage: {
        // Ledger hairline texture — a faint horizontal rule, like clinical paper. Decorative only.
        'ledger-rule':
          'repeating-linear-gradient(to bottom, transparent 0, transparent 27px, rgba(231, 227, 218, 0.6) 27px, rgba(231, 227, 218, 0.6) 28px)',
        // A calm radial wash for hero atmosphere (teal mist), never a loud AI gradient.
        'mist': 'radial-gradient(120% 80% at 50% -10%, rgba(168, 232, 219, 0.35) 0%, rgba(251, 250, 247, 0) 60%)',
      },
      keyframes: {
        'rise-in': {
          '0%': { opacity: '0', transform: 'translateY(6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'stamp-in': {
          '0%': { opacity: '0', transform: 'scale(0.96)' },
          '60%': { opacity: '1', transform: 'scale(1.02)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
      },
      animation: {
        // Staggered via inline animation-delay so the CAUSAL chain reveals in order:
        // evidence → rule → decision → verification stamp.
        'rise-in': 'rise-in 0.45s cubic-bezier(0.22, 1, 0.36, 1) both',
        'stamp-in': 'stamp-in 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) both',
      },
    },
  },
  plugins: [],
};

export default config;
