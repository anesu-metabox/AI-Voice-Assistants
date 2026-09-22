import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/App.tsx",
  ],
  theme: {
    extend: {
      colors: {
        background: "#0a0d14",
        surface: "#111726",
        surfaceBorder: "#1e293b",
        primary: "#38bdf8",
        accent: "#818cf8",
        success: "#34d399",
        warning: "#fbbf24",
        danger: "#f87171",
      },
      animation: {
        "pulse-slow": "pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite",
      },
    },
  },
  plugins: [],
};
export default config;
