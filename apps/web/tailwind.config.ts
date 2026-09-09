import type { Config } from "tailwindcss";

/**
 * Light v2 design tokens — canonical spec: docs/design/ui-theme-v2.html
 * (Warm Professional). Agent identity colors, NPHIES badge semantics, and
 * the teal→indigo accent gradient all come from that mockup.
 */
const config: Config = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "IBM Plex Sans Arabic", "system-ui", "sans-serif"],
        mono: ["ui-monospace", "SF Mono", "Menlo", "Consolas", "monospace"],
      },
      colors: {
        // surfaces & ink
        wash: "#FAFBFE",
        veil: "#F6F5FB", // soft nested surface (inputs, hover fills)
        mist: "#FBFAFE", // quiet nested card fill
        line: "#ECEAF4",
        "line-strong": "#D6D3E8",
        ink: {
          DEFAULT: "#1E1B36",
          deep: "#3D3A57",
          soft: "#7C7A94",
          faint: "#A5A3BC",
        },
        // accent
        brand: {
          teal: "#0EA5A4",
          indigo: "#6366F1",
        },
        // agent identities (Sully lesson — one hue per agent everywhere)
        agent: {
          scribe: "#F43F5E",
          "scribe-bg": "#FFF1F2",
          cons: "#6366F1",
          "cons-bg": "#EEF2FF",
          nph: "#2563EB",
          "nph-bg": "#EFF6FF",
          pharm: "#0D9488",
          "pharm-bg": "#F0FDFA",
          recep: "#D97706",
          "recep-bg": "#FFFBEB",
        },
        // NPHIES badge semantics — green is payer-complete ONLY
        status: {
          ok: "#15803D",
          "ok-bg": "#DCFCE7",
          "ok-line": "#BBF7D0",
          pend: "#A16207",
          "pend-bg": "#FEF6D8",
          "pend-line": "#FDE68A",
          rej: "#BE123C",
          "rej-bg": "#FEE9EC",
          "rej-line": "#FECDD3",
        },
        // demo-mode chip (top bar, always visible)
        demo: {
          chip: "#FFF7E6",
          text: "#B45309",
          line: "#FDE4B8",
          pulse: "#F59E0B",
        },
        // evidence pills & assertion underlines
        ev: {
          pill: "#6366F1",
          "pill-bg": "#EEF2FF",
          "pill-line": "#E0E7FF",
          underline: "#A5B4FC",
        },
        // cypher terminal — intentionally dark (mockup §C), stays dark in v2
        term: {
          bg: "#181632",
          cyan: "#A5F3FC",
        },
      },
      boxShadow: {
        card: "0 1px 2px rgba(30,27,54,.04), 0 8px 24px rgba(30,27,54,.06)",
        pop: "0 2px 6px rgba(30,27,54,.06), 0 16px 40px rgba(30,27,54,.10)",
        pill: "0 4px 10px rgba(79,70,229,.30)",
        nav: "0 6px 14px rgba(79,70,229,.30)",
      },
      backgroundImage: {
        "grad-accent": "linear-gradient(135deg, #0EA5A4 0%, #6366F1 100%)",
        "grad-soft": "linear-gradient(135deg, #CCFBF1, #E0E7FF)",
        "grad-wash": "linear-gradient(180deg, #F4F7FE 0%, #F6F4FE 45%, #F8FAFC 100%)",
      },
    },
  },
  plugins: [],
};

export default config;
