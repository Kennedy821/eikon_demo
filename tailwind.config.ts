import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Mirrors the Streamlit app palette (eikon_demo_app_beta.py CSS)
        eikon: {
          navy: "#1E3A5F",
          muted: "#666666",
          panel: "#f0f2f6",
        },
      },
    },
  },
  plugins: [],
};

export default config;
