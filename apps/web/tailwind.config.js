/** Design tokens — minimal modern overhaul (owner-requested deviation from
 *  UX §8 visuals, 2026-06-11; accessibility constraints retained).
 *  Token NAMES are stable; values define the new look. */
/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "media",
  theme: {
    extend: {
      colors: {
        canvas: "#FAFAF9",
        surface: "#FFFFFF",
        ink: "#101113",
        "ink-muted": "#646C77",
        "ink-muted-deep": "#4E555F",
        hairline: "#ECEDEF",
        accent: "#4F46E5",
        "accent-deep": "#4338CA",
        "accent-soft": "#EEF2FF",
        positive: "#2E7D5B",
        "positive-deep": "#1F5C42",
        attention: "#B5791F",
        "attention-deep": "#8A5A10",
        critical: "#B23A48",
        "canvas-dark": "#0E0F12",
        "surface-dark": "#17181C",
      },
      borderRadius: {
        card: "16px",
        control: "10px",
      },
      boxShadow: {
        card: "0 1px 2px rgb(16 17 19 / 0.04), 0 4px 16px -2px rgb(16 17 19 / 0.06)",
        "card-hover": "0 2px 4px rgb(16 17 19 / 0.05), 0 12px 28px -4px rgb(16 17 19 / 0.10)",
        pop: "0 8px 24px -6px rgb(79 70 229 / 0.35)",
      },
      fontFamily: {
        sans: ["Geist", "General Sans", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["Geist Mono", "JetBrains Mono", "ui-monospace", "monospace"],
      },
      keyframes: {
        "fade-up": {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        "scale-in": {
          from: { opacity: "0", transform: "scale(0.97)" },
          to: { opacity: "1", transform: "scale(1)" },
        },
        "grow-x": {
          from: { transform: "scaleX(0)" },
          to: { transform: "scaleX(1)" },
        },
        "pulse-soft": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.4" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.45s cubic-bezier(0.16, 1, 0.3, 1) both",
        "fade-in": "fade-in 0.3s ease-out both",
        "scale-in": "scale-in 0.3s cubic-bezier(0.16, 1, 0.3, 1) both",
        "grow-x": "grow-x 0.6s cubic-bezier(0.16, 1, 0.3, 1) both",
        "pulse-soft": "pulse-soft 2s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
