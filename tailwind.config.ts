import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        eikon: {
          navy: "#0D9488",      // teal — dominant brand colour
          teal: "#0D9488",      // alias for explicit use
          // Accent for CTAs and active states. Sampled from the logo mark
          // (~#128698) and deepened so white text clears 4.5:1 contrast.
          accent: "#0E7490",
          accentDark: "#0B5E75", // hover/pressed
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
