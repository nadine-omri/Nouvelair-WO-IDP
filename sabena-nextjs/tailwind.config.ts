import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./src/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        violet: {
          50: "#faf8ff",
          100: "#f2edff",
          150: "#e9e1ff",
          200: "#ddd0ff",
          300: "#c3aeff",
          400: "#a480ff",
          500: "#8656f5",
          600: "#7039db",
          700: "#5c2bb5",
          800: "#4a2391",
          900: "#3a1c72",
          950: "#241147",
        },
      },
      fontFamily: {
        display: ["var(--font-display)"],
        sans: ["var(--font-sans)"],
        mono: ["var(--font-mono)"],
      },
      boxShadow: {
        soft: "0 1px 2px rgba(58, 28, 114, 0.04), 0 8px 24px -8px rgba(58, 28, 114, 0.12)",
        lift: "0 4px 12px rgba(58, 28, 114, 0.08), 0 16px 40px -12px rgba(58, 28, 114, 0.22)",
        glow: "0 0 0 1px rgba(134, 86, 245, 0.15), 0 8px 30px -6px rgba(134, 86, 245, 0.35)",
      },
      keyframes: {
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "fade-in": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-400px 0" },
          "100%": { backgroundPosition: "400px 0" },
        },
        "pulse-ring": {
          "0%": { transform: "scale(0.9)", opacity: "0.6" },
          "100%": { transform: "scale(1.6)", opacity: "0" },
        },
        float: {
          "0%, 100%": { transform: "translate(0, 0)" },
          "50%": { transform: "translate(2%, -3%)" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.5s cubic-bezier(0.16, 1, 0.3, 1) both",
        "fade-in": "fade-in 0.4s ease both",
        shimmer: "shimmer 1.6s ease-in-out infinite",
        "pulse-ring": "pulse-ring 1.8s cubic-bezier(0.2, 0.8, 0.2, 1) infinite",
        float: "float 14s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
