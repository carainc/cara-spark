import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // Default brand; per-tenant branding (Lane D) overrides via CSS vars.
        brand: {
          DEFAULT: '#0f766e',
          fg: '#ffffff',
        },
        crisis: '#b91c1c',
      },
    },
  },
  plugins: [],
};

export default config;
