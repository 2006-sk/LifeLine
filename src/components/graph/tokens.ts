/**
 * Design-token bridge for the cytoscape canvas.
 *
 * Cytoscape paints to a <canvas>, so it cannot resolve `var(--x)` — it needs
 * concrete colour strings. Two things make that awkward:
 *
 *  1. `getComputedStyle(root).getPropertyValue('--color-text-secondary')`
 *     returns the token verbatim, e.g. `rgb(244 243 239 / 64%)`. Cytoscape's
 *     colour parser only understands hex / named / comma-form rgb(a).
 *  2. A token may be missing entirely (design system still landing, or a
 *     build that tree-shook it away), in which case we must fall back.
 *
 * Both are solved by normalising every raw value through a throwaway probe
 * element: the browser parses it for us and hands back canonical
 * `rgb(r, g, b)` / `rgba(r, g, b, a)`. Invalid or absent values fall through
 * to the hard-coded constant.
 *
 * Token names are tried in order, so this works against BOTH the short names
 * in the visual spec (`--accent`) and the `--color-*` names that actually
 * landed in globals.css.
 */

export interface GraphTokens {
  accent: string;
  safe: string;
  warn: string;
  danger: string;
  info: string;
  textPrimary: string;
  textSecondary: string;
  textTertiary: string;
  bgPanel: string;
  bgBase: string;
  borderHairline: string;
  /**
   * A RESOLVED font stack. Cytoscape paints labels with the canvas 2D API,
   * which cannot parse `var(--font-inter)` — an unparseable `ctx.font` string
   * is silently ignored and every label falls back to the browser default. So
   * we read the already-resolved stack off <body> instead of emitting a var().
   */
  fontFamily: string;
}

/** Hard fallbacks straight from the Lifeline visual spec. */
export const FALLBACK_TOKENS: GraphTokens = {
  accent: "#35D6FF",
  safe: "#2EE6A8",
  warn: "#F5A524",
  danger: "#FF4D5E",
  info: "#8CA3E0",
  textPrimary: "#E8EDF2",
  textSecondary: "rgba(232,237,242,0.6)",
  textTertiary: "rgba(232,237,242,0.42)",
  bgPanel: "#0C1014",
  bgBase: "#07090C",
  borderHairline: "rgba(255,255,255,0.08)",
  fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
};

/**
 * The same tokens as raw CSS, for the HTML chrome around the canvas (toolbar,
 * tooltip, legend, empty state). Native `var()` fallback chaining means these
 * resolve against the short spec names first, then the `--color-*` names that
 * actually landed in globals.css, then a hard constant.
 */
export const CSS_VAR = {
  accent: "var(--accent, var(--color-accent, #35D6FF))",
  safe: "var(--safe, var(--color-safe, #2EE6A8))",
  warn: "var(--warn, var(--color-warn, var(--color-warning, #F5A524)))",
  danger: "var(--danger, var(--color-danger, #FF4D5E))",
  info: "var(--info, var(--color-info, #8CA3E0))",
  textPrimary: "var(--text-primary, var(--color-text-primary, #E8EDF2))",
  textSecondary: "var(--text-secondary, var(--color-text-secondary, rgba(232,237,242,0.6)))",
  textTertiary: "var(--text-tertiary, var(--color-text-tertiary, rgba(232,237,242,0.42)))",
  bgPanel: "var(--bg-panel, var(--color-surface-raised, #0C1014))",
  bgBase: "var(--bg-base, var(--color-surface-base, #07090C))",
  borderHairline: "var(--border-hairline, var(--color-hairline, rgba(255,255,255,0.08)))",
} as const;

/** Candidate custom-property names per colour token, highest priority first. */
const TOKEN_SOURCES = {
  accent: ["--accent", "--color-accent"],
  safe: ["--safe", "--color-safe"],
  warn: ["--warn", "--color-warn", "--color-warning"],
  danger: ["--danger", "--color-danger"],
  info: ["--info", "--color-info"],
  textPrimary: ["--text-primary", "--color-text-primary"],
  textSecondary: ["--text-secondary", "--color-text-secondary"],
  textTertiary: ["--text-tertiary", "--color-text-tertiary"],
  bgPanel: ["--bg-panel", "--color-surface-raised", "--color-surface-glass"],
  bgBase: ["--bg-base", "--color-surface-base", "--color-surface-sunken"],
  borderHairline: ["--border-hairline", "--color-hairline"],
} satisfies Record<string, string[]>;

type ColorToken = keyof typeof TOKEN_SOURCES;

const SENTINEL = "rgb(1, 2, 3)";

/**
 * Parses any CSS colour the browser understands into a canvas-safe string.
 * Returns `fallback` when `raw` is empty or not a colour.
 */
function normalizeColor(probe: HTMLElement, raw: string, fallback: string): string {
  const value = raw.trim();
  if (!value) return fallback;

  probe.style.color = "";
  probe.style.color = SENTINEL;
  // If the sentinel itself does not round-trip we are in a non-DOM-ish
  // environment; bail out rather than emit nonsense.
  if (window.getComputedStyle(probe).color !== SENTINEL) return fallback;

  probe.style.color = value;
  const out = window.getComputedStyle(probe).color;
  if (!out || out === SENTINEL) return fallback;
  return out;
}

/**
 * Reads the live design tokens. Safe to call on every theme change; safe to
 * call during SSR (returns the fallbacks).
 */
export function readGraphTokens(): GraphTokens {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return { ...FALLBACK_TOKENS };
  }

  const probe = document.createElement("span");
  probe.setAttribute("aria-hidden", "true");
  probe.style.cssText =
    "position:absolute;left:-9999px;top:-9999px;width:0;height:0;opacity:0;pointer-events:none;";
  document.body.appendChild(probe);

  try {
    const root = window.getComputedStyle(document.documentElement);
    const out = { ...FALLBACK_TOKENS };

    (Object.keys(TOKEN_SOURCES) as ColorToken[]).forEach((key) => {
      const fallback = FALLBACK_TOKENS[key];
      let resolved = fallback;

      for (const name of TOKEN_SOURCES[key]) {
        const raw = root.getPropertyValue(name);
        if (!raw || !raw.trim()) continue;
        const normalized = normalizeColor(probe, raw, "");
        if (normalized) {
          resolved = normalized;
          break;
        }
      }

      out[key] = normalizeColor(probe, resolved, fallback);
    });

    const bodyFont = window.getComputedStyle(document.body).fontFamily;
    if (bodyFont && bodyFont.trim() && !bodyFont.includes("var(")) {
      out.fontFamily = bodyFont.trim();
    }

    return out;
  } catch {
    return { ...FALLBACK_TOKENS };
  } finally {
    probe.remove();
  }
}

/* ------------------------------------------------------------------ */
/* Colour maths — cytoscape has no color-mix(), so we do it ourselves.  */
/* ------------------------------------------------------------------ */

type Rgba = [number, number, number, number];

function parseRgba(input: string): Rgba {
  const value = input.trim();

  if (value.startsWith("#")) {
    const hex = value.slice(1);
    const expand = (h: string) => parseInt(h.length === 1 ? h + h : h, 16);
    if (hex.length === 3 || hex.length === 4) {
      return [
        expand(hex[0]),
        expand(hex[1]),
        expand(hex[2]),
        hex.length === 4 ? expand(hex[3]) / 255 : 1,
      ];
    }
    if (hex.length === 6 || hex.length === 8) {
      return [
        parseInt(hex.slice(0, 2), 16),
        parseInt(hex.slice(2, 4), 16),
        parseInt(hex.slice(4, 6), 16),
        hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1,
      ];
    }
    return [255, 255, 255, 1];
  }

  const nums = value.match(/-?[\d.]+%?/g);
  if (!nums || nums.length < 3) return [255, 255, 255, 1];
  const channel = (raw: string) =>
    raw.endsWith("%") ? (parseFloat(raw) / 100) * 255 : parseFloat(raw);

  return [
    channel(nums[0]),
    channel(nums[1]),
    channel(nums[2]),
    nums[3] ? (nums[3].endsWith("%") ? parseFloat(nums[3]) / 100 : parseFloat(nums[3])) : 1,
  ];
}

const clamp255 = (n: number) => Math.max(0, Math.min(255, Math.round(n)));

/** `t = 0` returns `a`, `t = 1` returns `b`. Always opaque — canvas-safe. */
export function mix(a: string, b: string, t: number): string {
  const [ar, ag, ab] = parseRgba(a);
  const [br, bg, bb] = parseRgba(b);
  const k = Math.max(0, Math.min(1, t));
  return `rgb(${clamp255(ar + (br - ar) * k)}, ${clamp255(ag + (bg - ag) * k)}, ${clamp255(
    ab + (bb - ab) * k,
  )})`;
}

/** Re-alpha a colour, discarding whatever alpha it already had. */
export function alpha(color: string, a: number): string {
  const [r, g, b] = parseRgba(color);
  return `rgba(${clamp255(r)}, ${clamp255(g)}, ${clamp255(b)}, ${Math.max(0, Math.min(1, a))})`;
}

/** Flattens a possibly translucent colour onto an opaque backdrop. */
export function flatten(color: string, backdrop: string): string {
  const [r, g, b, a] = parseRgba(color);
  if (a >= 1) return `rgb(${clamp255(r)}, ${clamp255(g)}, ${clamp255(b)})`;
  return mix(backdrop, `rgb(${clamp255(r)}, ${clamp255(g)}, ${clamp255(b)})`, a);
}
