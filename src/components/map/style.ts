/**
 * Lifeline — the synthetic MapLibre style.
 *
 * There is no tile server and no sprite/glyph server. `glyphs` is deliberately
 * left undefined, which means NO `symbol` layer may ever be added here: every
 * label and icon on this map is a DOM `Marker` (see markers.ts). GL layers are
 * used only for fills, lines and circles.
 *
 * Every source is declared up front — dynamic ones seeded empty — so the
 * component only ever calls `setData()` and never mutates the layer list.
 */

import type {
  ExpressionSpecification,
  SpriteSpecification,
  StyleSpecification,
} from "maplibre-gl";
import {
  buildBoundary,
  buildGraticule,
  buildRelief,
  buildRiver,
  buildRoads,
  emptyLines,
  emptyPolygons,
} from "./geo";
import { world } from "@/lib/world/world";

/* ------------------------------------------------------------------ */
/* Design tokens                                                       */
/* ------------------------------------------------------------------ */

/**
 * WebGL paint properties cannot read CSS custom properties, so the map reads
 * them once from the live container and falls back to these hard values. DOM
 * markers use the `var(--x, fallback)` strings in CSS_VAR directly.
 */
export const TOKEN_FALLBACK = {
  danger: "#FF4D5E",
  warn: "#F5A524",
  safe: "#2EE6A8",
  accent: "#35D6FF",
  textPrimary: "#E8EDF2",
  bgBase: "#07090C",
  borderHairline: "rgba(255,255,255,0.08)",
  // Map-specific tokens, still overridable by the design system.
  road: "#4E6076",
  roadHover: "#AFC4D8",
  river: "#1E5F96",
  riverGlow: "#0C3152",
  grid: "#151C24",
  relief: "#1A2733",
} as const;

/** CSS variable name for each token — the contract with the design system. */
export const TOKEN_VAR = {
  danger: "--danger",
  warn: "--warn",
  safe: "--safe",
  accent: "--accent",
  textPrimary: "--text-primary",
  bgBase: "--bg-base",
  borderHairline: "--border-hairline",
  road: "--map-road",
  roadHover: "--map-road-hover",
  river: "--map-river",
  riverGlow: "--map-river-glow",
  grid: "--map-grid",
  relief: "--map-relief",
} as const;

export type MapTokens = { -readonly [K in keyof typeof TOKEN_FALLBACK]: string };

/** Ready-made `var()` strings for inline styles and marker markup. */
export const CSS_VAR: MapTokens = Object.fromEntries(
  (Object.keys(TOKEN_FALLBACK) as (keyof typeof TOKEN_FALLBACK)[]).map((k) => [
    k,
    `var(${TOKEN_VAR[k]}, ${TOKEN_FALLBACK[k]})`,
  ]),
) as MapTokens;

/**
 * Normalise any CSS colour into something the GL style parser accepts.
 *
 * MapLibre understands named colours, #hex, rgb()/rgba() and hsl()/hsla() only.
 * A design system may legitimately ship `oklch()`, `color-mix()` or the
 * space-separated `rgb(255 255 255 / 8%)` form, any of which would make the
 * whole style unparseable. Canvas 2D serialises a colour it accepts to
 * "#rrggbb" or "rgba(...)", so it is used here as the converter — and anything
 * it rejects falls back rather than poisoning the style.
 */
function toGlColor(value: string, fallback: string): string {
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  try {
    const ctx = document.createElement("canvas").getContext("2d");
    if (!ctx) return fallback;
    // Two different sentinels: an invalid assignment leaves fillStyle untouched,
    // so a rejected colour shows up as two different readings.
    ctx.fillStyle = "#010203";
    ctx.fillStyle = trimmed;
    const first = String(ctx.fillStyle);
    ctx.fillStyle = "#040506";
    ctx.fillStyle = trimmed;
    if (first !== String(ctx.fillStyle)) return fallback;
    return /^#[0-9a-f]{3,8}$/i.test(first) || /^rgba?\(/i.test(first) ? first : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Read the live design-system values off a mounted element, falling back hard.
 *
 * A hidden probe resolves the whole `var()` chain for us (including the
 * fallback), which `getPropertyValue` alone would not do reliably.
 */
export function resolveTokens(el: HTMLElement | null): MapTokens {
  const out = { ...TOKEN_FALLBACK } as MapTokens;
  if (!el || typeof window === "undefined" || typeof document === "undefined") return out;

  let probe: HTMLSpanElement | null = null;
  try {
    probe = document.createElement("span");
    probe.setAttribute("aria-hidden", "true");
    probe.style.cssText = "position:absolute;width:0;height:0;visibility:hidden";
    el.appendChild(probe);
    for (const key of Object.keys(TOKEN_FALLBACK) as (keyof typeof TOKEN_FALLBACK)[]) {
      probe.style.color = "";
      probe.style.color = `var(${TOKEN_VAR[key]}, ${TOKEN_FALLBACK[key]})`;
      out[key] = toGlColor(window.getComputedStyle(probe).color, TOKEN_FALLBACK[key]);
    }
  } catch {
    return { ...TOKEN_FALLBACK } as MapTokens;
  } finally {
    probe?.remove();
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Ids                                                                 */
/* ------------------------------------------------------------------ */

export const SRC = {
  graticule: "lfl-graticule",
  district: "lfl-district",
  relief: "lfl-relief",
  river: "lfl-river",
  hazards: "lfl-hazards",
  roads: "lfl-roads",
  blocked: "lfl-blocked",
  alternatives: "lfl-alternatives",
  pickup: "lfl-pickup",
  route: "lfl-route",
  routeHead: "lfl-route-head",
} as const;

export const LYR = {
  background: "lfl-bg",
  graticule: "lfl-graticule-line",
  districtFill: "lfl-district-fill",
  relief: "lfl-relief-circle",
  districtStroke: "lfl-district-stroke",
  riverGlow: "lfl-river-glow",
  river: "lfl-river-line",
  hazardFill: "lfl-hazard-fill",
  hazardStroke: "lfl-hazard-stroke",
  bridgeCasing: "lfl-bridge-casing",
  roads: "lfl-roads",
  roadsFoot: "lfl-roads-foot",
  blocked: "lfl-blocked-line",
  alternatives: "lfl-alt-line",
  pickup: "lfl-pickup-line",
  routeGlow: "lfl-route-glow",
  route: "lfl-route-line",
  routeDash: "lfl-route-dash",
  routeHead: "lfl-route-head",
  roadsHit: "lfl-roads-hit",
} as const;

/** Layers that answer hover/click queries, topmost first. */
export const INTERACTIVE_LAYERS: string[] = [LYR.roadsHit, LYR.hazardFill];

/* ------------------------------------------------------------------ */
/* Style                                                               */
/* ------------------------------------------------------------------ */

const hoverState: ExpressionSpecification = ["boolean", ["feature-state", "hover"], false];
const selectedState: ExpressionSpecification = ["boolean", ["feature-state", "selected"], false];

export function buildMapStyle(t: MapTokens): StyleSpecification {
  const hazardColor: ExpressionSpecification = [
    "match",
    ["get", "hazardType"],
    "flood",
    "#2F7FD6",
    "landslide",
    t.warn,
    "structural",
    t.danger,
    "fire",
    "#FF7A2F",
    "debris",
    t.warn,
    t.danger,
  ];

  const style: StyleSpecification = {
    version: 8,
    name: "Lifeline — synthetic district",
    // No sprite, no glyphs: fully offline, and symbol layers are impossible.
    glyphs: undefined,
    sprite: undefined,
    sources: {
      [SRC.graticule]: { type: "geojson", data: buildGraticule() },
      [SRC.district]: { type: "geojson", data: buildBoundary() },
      [SRC.relief]: { type: "geojson", data: buildRelief() },
      [SRC.river]: { type: "geojson", data: buildRiver() },
      [SRC.roads]: { type: "geojson", data: buildRoads(), promoteId: "id" },
      [SRC.hazards]: { type: "geojson", data: emptyPolygons(), promoteId: "id" },
      [SRC.blocked]: { type: "geojson", data: emptyLines(), promoteId: "id" },
      [SRC.alternatives]: { type: "geojson", data: emptyLines(), promoteId: "id" },
      [SRC.pickup]: { type: "geojson", data: emptyLines() },
      [SRC.route]: { type: "geojson", data: emptyLines() },
      [SRC.routeHead]: {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      },
    },
    layers: [
      {
        id: LYR.background,
        type: "background",
        paint: { "background-color": t.bgBase },
      },
      {
        id: LYR.graticule,
        type: "line",
        source: SRC.graticule,
        paint: {
          "line-color": t.grid,
          "line-width": 0.6,
          "line-opacity": ["interpolate", ["linear"], ["zoom"], 11, 0.25, 15, 0.6],
        },
      },
      {
        id: LYR.districtFill,
        type: "fill",
        source: SRC.district,
        paint: { "fill-color": t.textPrimary, "fill-opacity": 0.015 },
      },
      {
        id: LYR.relief,
        type: "circle",
        source: SRC.relief,
        paint: {
          // Elevation-driven, heavily blurred blobs: high ground reads lighter.
          "circle-radius": [
            "interpolate",
            ["linear"],
            ["zoom"],
            11,
            ["interpolate", ["linear"], ["get", "elevation"], 4, 8, 61, 22],
            16,
            ["interpolate", ["linear"], ["get", "elevation"], 4, 50, 61, 150],
          ],
          "circle-color": [
            "interpolate",
            ["linear"],
            ["get", "elevation"],
            4,
            t.riverGlow,
            20,
            t.relief,
            61,
            "#2A3A48",
          ],
          "circle-blur": 1,
          "circle-opacity": ["interpolate", ["linear"], ["get", "elevation"], 4, 0.22, 61, 0.4],
        },
      },
      {
        id: LYR.districtStroke,
        type: "line",
        source: SRC.district,
        paint: {
          "line-color": t.borderHairline,
          "line-width": 1.2,
          "line-dasharray": [6, 4],
          "line-opacity": 0.9,
        },
      },
      {
        id: LYR.riverGlow,
        type: "line",
        source: SRC.river,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": t.riverGlow,
          "line-width": ["interpolate", ["linear"], ["zoom"], 11, 10, 16, 44],
          "line-blur": ["interpolate", ["linear"], ["zoom"], 11, 6, 16, 26],
          "line-opacity": 0.75,
        },
      },
      {
        id: LYR.river,
        type: "line",
        source: SRC.river,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": t.river,
          "line-width": ["interpolate", ["linear"], ["zoom"], 11, 3, 16, 16],
          "line-opacity": 0.95,
        },
      },
      {
        id: LYR.hazardFill,
        type: "fill",
        source: SRC.hazards,
        paint: {
          "fill-color": hazardColor,
          "fill-opacity": [
            "case",
            selectedState,
            0.34,
            hoverState,
            0.3,
            ["interpolate", ["linear"], ["get", "severity"], 0.3, 0.12, 0.9, 0.24],
          ],
        },
      },
      {
        id: LYR.hazardStroke,
        type: "line",
        source: SRC.hazards,
        layout: { "line-join": "round" },
        paint: {
          "line-color": hazardColor,
          "line-width": ["case", selectedState, 3.2, 1.8],
          // Dashes, not just colour, mark a hazard boundary.
          "line-dasharray": [3, 2],
          "line-opacity": 0.85,
        },
      },
      {
        id: LYR.bridgeCasing,
        type: "line",
        source: SRC.roads,
        filter: ["==", ["get", "kind"], "Bridge"],
        layout: { "line-cap": "butt" },
        paint: {
          "line-color": t.textPrimary,
          "line-width": ["interpolate", ["linear"], ["zoom"], 11, 3.5, 16, 11],
          "line-opacity": 0.14,
          // Deck ties — a bridge is legible without reading its colour.
          "line-dasharray": [0.6, 0.5],
        },
      },
      {
        id: LYR.roads,
        type: "line",
        source: SRC.roads,
        filter: ["!=", ["get", "accessibility"], "foot_only"],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": ["case", selectedState, t.accent, hoverState, t.roadHover, t.road],
          "line-width": [
            "interpolate",
            ["linear"],
            ["zoom"],
            11,
            ["case", hoverState, 2.4, selectedState, 2.4, 1.1],
            16,
            ["case", hoverState, 7, selectedState, 7, 3.2],
          ],
          "line-opacity": ["case", selectedState, 1, hoverState, 1, 0.82],
        },
      },
      {
        id: LYR.roadsFoot,
        type: "line",
        source: SRC.roads,
        filter: ["==", ["get", "accessibility"], "foot_only"],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": ["case", selectedState, t.accent, hoverState, t.roadHover, t.road],
          "line-width": ["interpolate", ["linear"], ["zoom"], 11, 1.2, 16, 3],
          // Pedestrian-only links are dotted — never signalled by colour alone.
          "line-dasharray": [0.4, 1.8],
          "line-opacity": 0.9,
        },
      },
      {
        id: LYR.blocked,
        type: "line",
        source: SRC.blocked,
        layout: { "line-cap": "butt", "line-join": "round" },
        paint: {
          "line-color": t.danger,
          "line-width": ["interpolate", ["linear"], ["zoom"], 11, 1.8, 16, 5],
          "line-dasharray": [1.6, 1.4],
          "line-opacity": 0.95,
        },
      },
      {
        id: LYR.alternatives,
        type: "line",
        source: SRC.alternatives,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": t.accent,
          "line-width": ["interpolate", ["linear"], ["zoom"], 11, 1.2, 16, 2.4],
          "line-opacity": 0.25,
          "line-dasharray": [4, 3],
        },
      },
      {
        id: LYR.pickup,
        type: "line",
        source: SRC.pickup,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": t.warn,
          "line-width": ["interpolate", ["linear"], ["zoom"], 11, 1.6, 16, 3.6],
          // Dashed: the responder's approach leg, distinct from the evacuation.
          "line-dasharray": [2.2, 1.6],
          "line-opacity": 0.9,
        },
      },
      {
        id: LYR.routeGlow,
        type: "line",
        source: SRC.route,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": t.accent,
          "line-width": ["interpolate", ["linear"], ["zoom"], 11, 8, 16, 22],
          "line-blur": ["interpolate", ["linear"], ["zoom"], 11, 5, 16, 14],
          "line-opacity": 0.35,
        },
      },
      {
        id: LYR.route,
        type: "line",
        source: SRC.route,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": t.accent,
          "line-width": ["interpolate", ["linear"], ["zoom"], 11, 2.6, 16, 6],
          "line-opacity": 1,
        },
      },
      {
        id: LYR.routeDash,
        type: "line",
        source: SRC.route,
        layout: { "line-cap": "butt", "line-join": "round" },
        paint: {
          "line-color": t.bgBase,
          "line-width": ["interpolate", ["linear"], ["zoom"], 11, 1.4, 16, 3.2],
          "line-dasharray": [0, 4, 3],
          "line-opacity": 0.55,
        },
      },
      {
        id: LYR.routeHead,
        type: "circle",
        source: SRC.routeHead,
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 3, 16, 7],
          "circle-color": t.accent,
          "circle-blur": 0.6,
          "circle-opacity": 0.9,
        },
      },
      {
        // Invisible, generously wide: makes thin roads realistically hoverable.
        id: LYR.roadsHit,
        type: "line",
        source: SRC.roads,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": t.accent, "line-width": 16, "line-opacity": 0 },
      },
    ],
    center: world.district.center,
    zoom: world.district.zoom,
  };

  // `glyphs` and `sprite` are declared above purely to document that they are
  // deliberately absent. Strip the keys so the style validator does not report
  // "string expected, undefined found" on every map load.
  delete (style as { glyphs?: string }).glyphs;
  delete (style as { sprite?: SpriteSpecification }).sprite;
  return style;
}

/**
 * Dash offsets for the flowing "traffic is moving along this route" overlay.
 * Straight out of the MapLibre animated-line technique: cycle `line-dasharray`
 * rather than mutating geometry.
 */
export const DASH_SEQUENCE: number[][] = [
  [0, 4, 3],
  [0.5, 4, 2.5],
  [1, 4, 2],
  [1.5, 4, 1.5],
  [2, 4, 1],
  [2.5, 4, 0.5],
  [3, 4, 0],
  [0, 0.5, 3, 3.5],
  [0, 1, 3, 3],
  [0, 1.5, 3, 2.5],
  [0, 2, 3, 2],
  [0, 2.5, 3, 1.5],
  [0, 3, 3, 1],
  [0, 3.5, 3, 0.5],
];
