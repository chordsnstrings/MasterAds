/** Design tokens per UX §8 — palette, type, radius, spacing. */
/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "media",
  theme: {
    extend: {
      colors: {
        canvas: "#F7F8FA",
        surface: "#FFFFFF",
        ink: "#16181D",
        "ink-muted": "#697079",
        "ink-muted-deep": "#525964",
        hairline: "#E7E9ED",
        accent: "#2F4BDA",
        "accent-soft": "#EEF1FE",
        positive: "#2E7D5B",
        "positive-deep": "#1F5C42",
        attention: "#B5791F",
        "attention-deep": "#8A5A10",
        critical: "#B23A48",
        "canvas-dark": "#15171C",
        "surface-dark": "#1D2026",
      },
      borderRadius: {
        card: "12px",
        control: "8px",
      },
      fontFamily: {
        sans: ["Geist", "General Sans", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["Geist Mono", "JetBrains Mono", "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
};
