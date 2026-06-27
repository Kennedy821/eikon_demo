import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        eikon: {
          navy: "#0D9488",      // teal — dominant brand colour
          teal: "#0D9488",      // alias for explicit use
          orange: "#EA580C",    // dark orange — CTA buttons
          midnight: "#1E2D6B",  // midnight blue — secondary accents
          muted: "#64748B",     // blue-slate muted text
          panel: "#F0FAFA",     // very light teal tint for panels
        },
      },
      fontFamily: {
        sans: ["var(--font-inter)", "Helvetica Neue", "Arial", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
