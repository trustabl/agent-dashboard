// Keeps the token-backed colors and the named type scale (DESIGN.md: never
// text-[Npx]); drops the legacy gradient/button component classes.
import type { Config } from "tailwindcss";

const config: Config = {
  theme: {
    extend: {
      colors: {
        background: "var(--color-bg-page)",
        foreground: "var(--color-text-primary)",
        surface: "var(--color-bg-surface)",
        raised: "var(--color-bg-raised)",
        overlay: "var(--color-bg-overlay)",
        border: { DEFAULT: "var(--color-border-muted)" },
        accent: { DEFAULT: "var(--color-accent-default)" },
      },
      fontFamily: {
        sans: ["var(--font-inter)", "Inter Variable", "Inter", "Arial", "Helvetica", "sans-serif"],
        mono: ["var(--font-geist-mono)", "Geist Mono", "ui-monospace", "monospace"],
      },
      fontSize: {
        "2xs": ["9px", { lineHeight: "13px" }],
        xs: ["10px", { lineHeight: "15px" }],
        sm: ["12px", { lineHeight: "18px" }],
        base: ["14px", { lineHeight: "21px" }],
        md: ["16px", { lineHeight: "24px" }],
        lg: ["18px", { lineHeight: "27px" }],
        xl: ["20px", { lineHeight: "30px" }],
        "2xl": ["30px", { lineHeight: "36px" }],
      },
    },
  },
};

export default config;
