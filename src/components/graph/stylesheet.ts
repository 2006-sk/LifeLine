import type { Css, StylesheetJsonBlock } from "cytoscape";
import { NODE_TYPES, glyphDataUri, roleColor, visualFor } from "./nodeVisuals";
import { alpha, flatten, mix, type GraphTokens } from "./tokens";

/**
 * The visual-state vocabulary, in increasing emphasis.
 *
 *   dim  <  (normal)  <  relevant  <  backup  <  path  <  invalid
 *
 * plus the orthogonal marks `selected` (white ring — syncs with the map),
 * `hover`, and the playback-only classes `pending` / `traversed` / `head` /
 * `flow` that the sequential traversal toggles on and off.
 *
 * These strings are the contract between the stylesheet and every effect in
 * LifelineGraph — nothing else should hard-code a class name.
 */
export const GRAPH_CLASS = {
  /** Irrelevant to the current story: pushed back, label suppressed. */
  dim: "ll-dim",
  /** In the neighbourhood of the plan but not part of it. */
  relevant: "ll-relevant",
  /** Backup plan — amber, medium emphasis. */
  backup: "ll-backup",
  /** Recommended path — accent, strong glow. Resting state in every phase. */
  path: "ll-path",
  /** Path member not yet reached by the traversal reveal. */
  pending: "ll-pending",
  /** Path member the traversal has already lit. */
  traversed: "ll-traversed",
  /** The travelling glow: the element the traversal is on right now. */
  head: "ll-head",
  /** Edge carrying the animated dash flow. */
  flow: "ll-flow",
  /** Blocked / invalidated — red, dashed, barred. */
  invalid: "ll-invalid",
  /** Transient red pulse used by the impact ripple. */
  ripple: "ll-ripple",
  /** Externally selected (map <-> graph sync). */
  selected: "ll-selected",
  /** Pointer is over it. */
  hover: "ll-hover",
  /** Force the name label on. */
  labelled: "ll-labelled",
  /** Mid-expansion: faded out, about to fade in. */
  entering: "ll-entering",
  /** Filtered out by overview mode. */
  hidden: "ll-hidden",
} as const;

export type GraphClass = (typeof GRAPH_CLASS)[keyof typeof GRAPH_CLASS];

/** Every class this component owns; used for wholesale resets. */
export const ALL_STATE_CLASSES: string[] = Object.values(GRAPH_CLASS);

/** Classes owned by the traversal playback (never cleared by state sync). */
export const PLAYBACK_CLASSES: string[] = [
  GRAPH_CLASS.pending,
  GRAPH_CLASS.traversed,
  GRAPH_CLASS.head,
];

/** Classes owned by the visual-state sync (never cleared by playback). */
export const STATE_CLASSES: string[] = [
  GRAPH_CLASS.dim,
  GRAPH_CLASS.relevant,
  GRAPH_CLASS.backup,
  GRAPH_CLASS.path,
  GRAPH_CLASS.flow,
  GRAPH_CLASS.invalid,
  GRAPH_CLASS.labelled,
];

/**
 * Cytoscape accepts far more style properties than `@types/cytoscape@3.21`
 * models (`underlay-*` landed in cytoscape 3.9 but is still missing from the
 * typings). This helper keeps rule bodies ergonomic without turning the whole
 * stylesheet into a cast soup.
 */
type StyleBody = Record<string, string | number | number[]>;

function rule(selector: string, style: StyleBody): StylesheetJsonBlock {
  return { selector, style: style as unknown as Css.Node };
}

export interface StylesheetOptions {
  tokens: GraphTokens;
  /** When true, all cytoscape style transitions collapse to 0ms. */
  reducedMotion: boolean;
}

export function buildStylesheet({ tokens, reducedMotion }: StylesheetOptions): StylesheetJsonBlock[] {
  const panel = flatten(tokens.bgPanel, tokens.bgBase);
  const base = mix(panel, "#FFFFFF", 0.05);
  const t = reducedMotion ? 0 : 220;

  const TRANSITIONS: StyleBody = {
    "transition-property":
      "background-color, border-color, border-width, line-color, opacity, width, height, color, underlay-opacity, underlay-padding, overlay-opacity, overlay-padding, target-arrow-color",
    "transition-duration": t,
    "transition-timing-function": "ease-out",
  };

  const sheet: StylesheetJsonBlock[] = [];

  /* ---------------- core ---------------- */
  sheet.push(
    rule("core", {
      "active-bg-opacity": 0,
      "selection-box-opacity": 0,
      "outside-texture-bg-color": panel,
    }),
  );

  /* ---------------- node base ---------------- */
  sheet.push(
    rule("node", {
      ...TRANSITIONS,
      shape: "ellipse",
      width: 24,
      height: 24,
      "background-color": base,
      "background-opacity": 1,
      "border-color": alpha(tokens.textSecondary, 0.5),
      "border-width": 1.25,
      "border-style": "solid",
      "border-opacity": 1,
      "background-fit": "none",
      "background-clip": "none",
      "background-image-containment": "over",
      "background-image-opacity": 0.92,
      "background-width": 18,
      "background-height": 18,
      label: "",
      color: tokens.textSecondary,
      "font-family": tokens.fontFamily,
      // Cytoscape font sizes are MODEL units, so they shrink with zoom. The
      // board fits a ~400px panel at roughly 0.45x, hence the generous values
      // here — on screen these land around 7-9px, which is the readable floor.
      "font-size": 17,
      "font-weight": 600,
      "text-valign": "bottom",
      "text-halign": "center",
      "text-margin-y": 4,
      // Labels are clamped to roughly one band's width so a long shelter name
      // cannot smear across the column next to it.
      "text-wrap": "ellipsis",
      // Columns sit ~58-66 model px apart, so a wide label bleeds into its
      // neighbour's lane. Ellipsis keeps each one inside roughly its own band;
      // the tooltip carries the untruncated name.
      "text-max-width": 104,
      "text-outline-color": flatten(tokens.bgBase, "#000000"),
      "text-outline-width": 2.4,
      "text-outline-opacity": 0.95,
      // The board is wider than the side panel, so the overview sits near
      // zoom 0.4. Keep labels alive down there instead of blanking the graph.
      "min-zoomed-font-size": 5,
      "overlay-opacity": 0,
      "underlay-opacity": 0,
      "underlay-color": tokens.accent,
      "underlay-padding": 0,
      "z-index": 10,
      opacity: 1,
    }),
  );

  /* ---------------- one rule per GraphNodeType ----------------
     Shape cannot be a data() mapper (it is a literal union), and a rule per
     type is also what lets each type carry its own glyph image, border
     treatment and size. */
  for (const type of NODE_TYPES) {
    const visual = visualFor(type);
    const color = roleColor(visual.role, tokens);
    sheet.push(
      rule(`node[type = "${type}"]`, {
        shape: visual.shape,
        width: visual.width,
        height: visual.height,
        "background-color": mix(panel, color, 0.1),
        "border-color": alpha(color, 0.62),
        "border-width": visual.borderWidth,
        "border-style": visual.borderStyle,
        "background-image": glyphDataUri(
          visual.glyph,
          alpha(tokens.textPrimary, 0.82),
          visual.glyphSize,
        ),
        "background-width": Math.round(visual.glyphSize * 2.6),
        "background-height": Math.round(visual.glyphSize * 2.6),
        "underlay-color": color,
      }),
    );
  }

  /* ---------------- edge base ---------------- */
  sheet.push(
    rule("edge", {
      ...TRANSITIONS,
      "curve-style": "bezier",
      "control-point-step-size": 26,
      width: 1.1,
      "line-color": alpha(tokens.textSecondary, 0.45),
      "line-style": "solid",
      opacity: 0.38,
      "target-arrow-shape": "none",
      "target-arrow-color": alpha(tokens.textSecondary, 0.45),
      "arrow-scale": 0.55,
      "overlay-opacity": 0,
      "underlay-opacity": 0,
      "underlay-color": tokens.accent,
      "underlay-padding": 0,
      label: "",
      "z-index": 1,
    }),
    rule("edge[directed = 1]", { "target-arrow-shape": "triangle" }),
  );

  /* ---------------- state: dimmed ---------------- */
  sheet.push(
    rule(`node.${GRAPH_CLASS.dim}`, {
      opacity: 0.2,
      "background-color": mix(panel, "#FFFFFF", 0.02),
      "border-color": alpha(tokens.textSecondary, 0.18),
      "background-image-opacity": 0.3,
      "underlay-opacity": 0,
      "z-index": 2,
    }),
    rule(`edge.${GRAPH_CLASS.dim}`, { opacity: 0.07, width: 0.8, "z-index": 0 }),
  );

  /* ---------------- state: relevant ---------------- */
  sheet.push(
    rule(`node.${GRAPH_CLASS.relevant}`, {
      opacity: 1,
      "border-width": 1.75,
      "background-image-opacity": 1,
      "z-index": 14,
    }),
    rule(`edge.${GRAPH_CLASS.relevant}`, { opacity: 0.5, width: 1.4, "z-index": 4 }),
  );

  /* ---------------- state: backup plan (amber) ---------------- */
  sheet.push(
    rule(`node.${GRAPH_CLASS.backup}`, {
      opacity: 1,
      "background-color": mix(panel, tokens.warn, 0.2),
      "border-color": tokens.warn,
      "border-width": 2.25,
      "underlay-color": tokens.warn,
      "underlay-opacity": 0.16,
      "underlay-padding": 7,
      color: mix(tokens.textPrimary, tokens.warn, 0.45),
      "z-index": 22,
    }),
    rule(`edge.${GRAPH_CLASS.backup}`, {
      "line-color": tokens.warn,
      "target-arrow-color": tokens.warn,
      "line-style": "dashed",
      "line-dash-pattern": [7, 4],
      width: 2,
      opacity: 0.78,
      "z-index": 12,
    }),
  );

  /* ---------------- state: recommended path (accent + glow) ---------------- */
  const pathNode: StyleBody = {
    opacity: 1,
    "background-color": mix(panel, tokens.accent, 0.26),
    "border-color": tokens.accent,
    "border-width": 3,
    "border-style": "solid",
    "underlay-color": tokens.accent,
    "underlay-opacity": 0.32,
    "underlay-padding": 9,
    "background-image-opacity": 1,
    color: tokens.textPrimary,
    "font-size": 18,
    "font-weight": 700,
    "z-index": 34,
  };
  const pathEdge: StyleBody = {
    "line-color": tokens.accent,
    "target-arrow-color": tokens.accent,
    width: 3,
    opacity: 1,
    "underlay-color": tokens.accent,
    "underlay-opacity": 0.16,
    "underlay-padding": 3,
    "z-index": 24,
  };

  sheet.push(
    rule(`node.${GRAPH_CLASS.path}`, pathNode),
    rule(`edge.${GRAPH_CLASS.path}`, pathEdge),
  );

  /* ---------------- playback: not yet reached ---------------- */
  sheet.push(
    rule(`node.${GRAPH_CLASS.pending}`, {
      "background-color": mix(panel, tokens.accent, 0.05),
      "border-color": alpha(tokens.accent, 0.3),
      "border-width": 1.5,
      "underlay-opacity": 0,
      "underlay-padding": 0,
      "background-image-opacity": 0.4,
      color: alpha(tokens.textSecondary, 0.5),
      opacity: 0.5,
      "z-index": 12,
    }),
    rule(`edge.${GRAPH_CLASS.pending}`, {
      "line-color": alpha(tokens.accent, 0.25),
      "target-arrow-color": alpha(tokens.accent, 0.25),
      width: 1.2,
      opacity: 0.22,
      "underlay-opacity": 0,
      "z-index": 6,
    }),
  );

  /* ---------------- playback: already lit (overrides pending) ---------------- */
  sheet.push(
    rule(`node.${GRAPH_CLASS.traversed}`, pathNode),
    rule(`edge.${GRAPH_CLASS.traversed}`, pathEdge),
  );

  /* ---------------- playback: the travelling glow ---------------- */
  sheet.push(
    rule(`node.${GRAPH_CLASS.head}`, {
      "background-color": mix(panel, tokens.accent, 0.46),
      "border-color": mix(tokens.accent, "#FFFFFF", 0.35),
      "border-width": 4.5,
      "underlay-color": tokens.accent,
      "underlay-opacity": 0.58,
      "underlay-padding": 17,
      color: tokens.textPrimary,
      "z-index": 48,
    }),
    rule(`edge.${GRAPH_CLASS.head}`, {
      "line-color": mix(tokens.accent, "#FFFFFF", 0.3),
      "target-arrow-color": mix(tokens.accent, "#FFFFFF", 0.3),
      width: 4.5,
      opacity: 1,
      "underlay-opacity": 0.4,
      "underlay-padding": 5,
      "z-index": 30,
    }),
    rule(`edge.${GRAPH_CLASS.flow}`, {
      "line-style": "dashed",
      "line-dash-pattern": [11, 8],
    }),
  );

  /* ---------------- state: blocked / invalidated ---------------- */
  sheet.push(
    rule(`node.${GRAPH_CLASS.invalid}`, {
      opacity: 1,
      "background-color": mix(panel, tokens.danger, 0.24),
      "border-color": tokens.danger,
      "border-width": 2.75,
      "border-style": "dashed",
      "underlay-color": tokens.danger,
      "underlay-opacity": 0.26,
      "underlay-padding": 8,
      // The X mark: invalidated nodes swap their type glyph for a cross.
      "background-image": glyphDataUri("✕", tokens.danger, 13),
      "background-width": 26,
      "background-height": 26,
      "background-image-opacity": 1,
      color: mix(tokens.textPrimary, tokens.danger, 0.5),
      "z-index": 44,
    }),
    rule(`edge.${GRAPH_CLASS.invalid}`, {
      "line-color": tokens.danger,
      "target-arrow-color": tokens.danger,
      "line-style": "dashed",
      "line-dash-pattern": [3, 4],
      // A bar across the middle of the edge — the "this is barred" mark.
      "mid-target-arrow-shape": "tee",
      "mid-target-arrow-color": tokens.danger,
      width: 2.4,
      opacity: 0.9,
      "underlay-color": tokens.danger,
      "underlay-opacity": 0.14,
      "underlay-padding": 3,
      "z-index": 26,
    }),
  );

  /* ---------------- impact ripple ----------------
     The pulse is pure class toggling: `overlay-opacity` and `overlay-padding`
     are in `transition-property`, so adding then removing this class gives a
     ring that swells and fades with no imperative animation to leak. */
  sheet.push(
    rule(`node.${GRAPH_CLASS.ripple}`, {
      "overlay-color": tokens.danger,
      "overlay-opacity": 0.45,
      "overlay-padding": 20,
      "z-index": 62,
    }),
    rule(`edge.${GRAPH_CLASS.ripple}`, {
      "overlay-color": tokens.danger,
      "overlay-opacity": 0.4,
      "overlay-padding": 9,
      "z-index": 42,
    }),
  );

  /* ---------------- labels ----------------
     Headline types always read; everything else stays quiet until it matters,
     which is what keeps a 200-node network from looking like spaghetti. */
  sheet.push(
    rule("node[?showLabel]", { label: "data(short)" }),
    rule(
      [
        `node.${GRAPH_CLASS.labelled}`,
        `node.${GRAPH_CLASS.hover}`,
        `node.${GRAPH_CLASS.selected}`,
        `node.${GRAPH_CLASS.path}`,
        `node.${GRAPH_CLASS.traversed}`,
        `node.${GRAPH_CLASS.backup}`,
        `node.${GRAPH_CLASS.invalid}`,
      ].join(", "),
      { label: "data(short)" },
    ),
    // The Location/Segment lattice is the one dense region of the board: a
    // dozen road names inside 320x330 model units collide into spaghetti at
    // the overview fit. Per the brief, these dense filler nodes stay quiet
    // until hover or selection — path membership alone is not enough. Their
    // glow still shows the traversal, the tooltip always carries the full
    // name, and the route's road names are spelled out in the plan panel.
    rule('node[type = "location"], node[type = "road"], node[type = "bridge"]', {
      label: "",
    }),
    rule(
      [
        `node[type = "location"].${GRAPH_CLASS.hover}`,
        `node[type = "road"].${GRAPH_CLASS.hover}`,
        `node[type = "bridge"].${GRAPH_CLASS.hover}`,
        `node[type = "location"].${GRAPH_CLASS.selected}`,
        `node[type = "road"].${GRAPH_CLASS.selected}`,
        `node[type = "bridge"].${GRAPH_CLASS.selected}`,
      ].join(", "),
      { label: "data(short)" },
    ),
    rule(`node.${GRAPH_CLASS.dim}`, { label: "" }),
    rule(`edge.${GRAPH_CLASS.hover}`, {
      label: "data(type)",
      "font-size": 12,
      color: tokens.textSecondary,
      "text-outline-color": flatten(tokens.bgBase, "#000000"),
      "text-outline-width": 2.4,
      "text-rotation": "autorotate",
    }),
  );

  /* ---------------- selection ring (map <-> graph sync) ---------------- */
  sheet.push(
    rule(`node.${GRAPH_CLASS.selected}`, {
      opacity: 1,
      "border-color": tokens.textPrimary,
      "border-width": 3.5,
      "border-style": "solid",
      "overlay-color": tokens.textPrimary,
      "overlay-opacity": 0.1,
      "overlay-padding": 13,
      color: tokens.textPrimary,
      "font-size": 19,
      "font-weight": 700,
      "background-image-opacity": 1,
      "z-index": 70,
    }),
    rule(`edge.${GRAPH_CLASS.selected}`, {
      "line-color": tokens.textPrimary,
      width: 3,
      opacity: 1,
      "z-index": 40,
    }),
  );

  /* ---------------- hover ---------------- */
  sheet.push(
    rule(`node.${GRAPH_CLASS.hover}`, {
      "border-width": 3,
      "font-size": 18,
      "background-image-opacity": 1,
      opacity: 1,
      "z-index": 66,
    }),
    rule(`edge.${GRAPH_CLASS.hover}`, { opacity: 1, width: 2.4, "z-index": 38 }),
  );

  /* ---------------- expansion + filtering (must win) ---------------- */
  sheet.push(
    rule(`.${GRAPH_CLASS.entering}`, { opacity: 0 }),
    rule(`.${GRAPH_CLASS.hidden}`, { display: "none" }),
  );

  return sheet;
}
