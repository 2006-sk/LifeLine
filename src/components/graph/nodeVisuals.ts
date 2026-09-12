import type { GraphNodeType } from "@/lib/types";
import type { GraphTokens } from "./tokens";

/**
 * Per-type visual vocabulary.
 *
 * ACCESSIBILITY CONTRACT: hue is never the only signal. Every `GraphNodeType`
 * is separated on THREE independent axes —
 *   • shape        (15 distinct cytoscape node shapes)
 *   • border style (solid / dashed / double, plus width)
 *   • glyph        (a 1-3 character mark drawn inside the node body)
 * — so the graph stays readable in greyscale and for colour-vision
 * deficiencies. Colour is the fourth, redundant, signal.
 */

/** Cytoscape node shapes. Kept as a local union so the per-type table is typed. */
export type GraphShape =
  | "ellipse"
  | "round-rectangle"
  | "rectangle"
  | "cut-rectangle"
  | "diamond"
  | "hexagon"
  | "octagon"
  | "pentagon"
  | "heptagon"
  | "round-heptagon"
  | "triangle"
  | "star"
  | "barrel"
  | "rhomboid"
  | "round-tag"
  | "vee";

/** Which semantic token drives a type's colour. */
export type TokenRole = "accent" | "safe" | "warn" | "danger" | "info" | "neutral";

export type BorderStyle = "solid" | "dashed" | "double" | "dotted";

/** Left-to-right narrative bands; also used to group the legend. */
export type GraphBand =
  | "household"
  | "need"
  | "responder"
  | "network"
  | "destination"
  | "supply"
  | "threat"
  | "plan";

export interface NodeVisual {
  type: GraphNodeType;
  /** Human label for the legend. */
  title: string;
  shape: GraphShape;
  /** 1-3 characters, drawn inside the node body via an SVG background image. */
  glyph: string;
  role: TokenRole;
  width: number;
  height: number;
  borderStyle: BorderStyle;
  borderWidth: number;
  /** Font size of the in-body glyph, in model pixels. */
  glyphSize: number;
  /** Types that always carry a visible name label (the rest reveal on hover). */
  alwaysLabel: boolean;
  band: GraphBand;
}

const V = (v: NodeVisual) => v;

export const NODE_VISUALS: Record<GraphNodeType, NodeVisual> = {
  family: V({
    type: "family",
    title: "Family",
    shape: "round-rectangle",
    glyph: "FAM",
    role: "accent",
    width: 54,
    height: 40,
    borderStyle: "solid",
    borderWidth: 2.5,
    glyphSize: 11,
    alwaysLabel: true,
    band: "household",
  }),
  person: V({
    type: "person",
    title: "Person",
    shape: "ellipse",
    glyph: "P",
    role: "info",
    width: 26,
    height: 26,
    borderStyle: "solid",
    borderWidth: 1.5,
    glyphSize: 11,
    alwaysLabel: false,
    band: "household",
  }),
  need: V({
    type: "need",
    title: "Need",
    shape: "diamond",
    glyph: "N",
    role: "warn",
    width: 34,
    height: 34,
    borderStyle: "double",
    borderWidth: 2,
    glyphSize: 11,
    alwaysLabel: false,
    band: "need",
  }),
  volunteer: V({
    type: "volunteer",
    title: "Volunteer",
    shape: "round-tag",
    glyph: "V",
    role: "accent",
    width: 38,
    height: 32,
    borderStyle: "solid",
    borderWidth: 2,
    glyphSize: 12,
    alwaysLabel: false,
    band: "responder",
  }),
  vehicle: V({
    type: "vehicle",
    title: "Vehicle",
    shape: "barrel",
    glyph: "T",
    role: "info",
    width: 34,
    height: 26,
    borderStyle: "solid",
    borderWidth: 1.75,
    glyphSize: 11,
    alwaysLabel: false,
    band: "responder",
  }),
  location: V({
    type: "location",
    title: "Location",
    shape: "hexagon",
    glyph: "•",
    role: "neutral",
    width: 24,
    height: 22,
    borderStyle: "solid",
    borderWidth: 1.25,
    glyphSize: 14,
    alwaysLabel: false,
    band: "network",
  }),
  road: V({
    type: "road",
    title: "Road segment",
    shape: "rectangle",
    glyph: "—",
    role: "neutral",
    width: 30,
    height: 13,
    borderStyle: "solid",
    borderWidth: 1.25,
    glyphSize: 11,
    alwaysLabel: false,
    band: "network",
  }),
  bridge: V({
    type: "bridge",
    title: "Bridge segment",
    shape: "rhomboid",
    glyph: "=",
    role: "neutral",
    width: 32,
    height: 15,
    borderStyle: "dashed",
    borderWidth: 1.5,
    glyphSize: 11,
    alwaysLabel: false,
    band: "network",
  }),
  shelter: V({
    type: "shelter",
    title: "Shelter",
    shape: "octagon",
    glyph: "S",
    role: "safe",
    width: 46,
    height: 42,
    borderStyle: "solid",
    borderWidth: 2.25,
    glyphSize: 13,
    alwaysLabel: true,
    band: "destination",
  }),
  clinic: V({
    type: "clinic",
    title: "Clinic",
    shape: "pentagon",
    glyph: "+",
    role: "safe",
    width: 36,
    height: 34,
    borderStyle: "solid",
    borderWidth: 2,
    glyphSize: 15,
    alwaysLabel: false,
    band: "destination",
  }),
  hospital: V({
    type: "hospital",
    title: "Hospital",
    shape: "star",
    glyph: "H",
    role: "safe",
    width: 44,
    height: 44,
    borderStyle: "solid",
    borderWidth: 2,
    glyphSize: 11,
    alwaysLabel: false,
    band: "destination",
  }),
  resource: V({
    type: "resource",
    title: "Resource",
    shape: "cut-rectangle",
    glyph: "R",
    role: "safe",
    width: 28,
    height: 24,
    borderStyle: "dotted",
    borderWidth: 1.5,
    glyphSize: 11,
    alwaysLabel: false,
    band: "supply",
  }),
  hazard: V({
    type: "hazard",
    title: "Hazard",
    shape: "triangle",
    glyph: "HZ",
    role: "danger",
    width: 44,
    height: 40,
    borderStyle: "solid",
    borderWidth: 2.5,
    glyphSize: 10,
    alwaysLabel: true,
    band: "threat",
  }),
  alert: V({
    type: "alert",
    title: "Alert",
    shape: "vee",
    glyph: "!",
    role: "danger",
    width: 32,
    height: 30,
    borderStyle: "dashed",
    borderWidth: 2,
    glyphSize: 13,
    alwaysLabel: true,
    band: "threat",
  }),
  plan: V({
    type: "plan",
    title: "Plan",
    shape: "round-heptagon",
    glyph: "PLN",
    role: "accent",
    width: 46,
    height: 44,
    borderStyle: "double",
    borderWidth: 2.5,
    glyphSize: 10,
    alwaysLabel: true,
    band: "plan",
  }),
};

export const NODE_TYPES = Object.keys(NODE_VISUALS) as GraphNodeType[];

/** Fallback for any type the API invents after this file was written. */
export const UNKNOWN_VISUAL: NodeVisual = {
  type: "location",
  title: "Unknown",
  shape: "ellipse",
  glyph: "?",
  role: "neutral",
  width: 24,
  height: 24,
  borderStyle: "dotted",
  borderWidth: 1.25,
  glyphSize: 12,
  alwaysLabel: false,
  band: "network",
};

export function visualFor(type: string): NodeVisual {
  return NODE_VISUALS[type as GraphNodeType] ?? UNKNOWN_VISUAL;
}

/** Resolves a type's `TokenRole` against the live token set. */
export function roleColor(role: TokenRole, tokens: GraphTokens): string {
  switch (role) {
    case "accent":
      return tokens.accent;
    case "safe":
      return tokens.safe;
    case "warn":
      return tokens.warn;
    case "danger":
      return tokens.danger;
    case "info":
      return tokens.info;
    default:
      return tokens.textSecondary;
  }
}

/* ------------------------------------------------------------------ */
/* Glyphs                                                              */
/* ------------------------------------------------------------------ */

/**
 * Builds an inline SVG data URI holding a single short glyph. Cytoscape draws
 * it as the node's `background-image`, which gives us "icon inside the shape"
 * without shipping a sprite sheet. Rendering is best-effort: if a browser
 * refuses the data URI the node is still fully distinguishable by shape,
 * border treatment and colour.
 */
export function glyphDataUri(glyph: string, color: string, size: number): string {
  const escaped = glyph
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Multi-character glyphs ("FAM", "PLN", "HZ") overrun a 32-unit viewBox at
  // this font size and get clipped, so they are squeezed to fit with
  // textLength instead of silently losing their first letter.
  const fit =
    glyph.length > 1
      ? ` textLength="${glyph.length >= 3 ? 29 : 23}" lengthAdjust="spacingAndGlyphs"`
      : "";

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">` +
    `<text x="16" y="16" text-anchor="middle" dominant-baseline="central" ` +
    // Font names stay unquoted + single-word: the whole SVG lives inside a
    // data URI and is rendered as an <img>, where web fonts are unavailable.
    `font-family="system-ui,sans-serif" ` +
    `font-size="${size * 2}" font-weight="700" fill="${color}"${fit}>${escaped}</text>` +
    `</svg>`;

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
