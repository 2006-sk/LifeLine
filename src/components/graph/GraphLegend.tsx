"use client";

import { type CSSProperties, type ReactElement, useMemo } from "react";
import type { GraphNodeType } from "@/lib/types";
import {
  NODE_TYPES,
  NODE_VISUALS,
  type GraphBand,
  type GraphShape,
  type NodeVisual,
} from "./nodeVisuals";
import { CSS_VAR } from "./tokens";

/**
 * Standalone legend for the Live Knowledge Graph.
 *
 * Mirrors the canvas exactly: same shape, same glyph, same border treatment,
 * same colour — so a judge can map a mark on screen to a concept without
 * relying on hue, which is also the accessibility requirement.
 */

const BAND_TITLES: Record<GraphBand, string> = {
  household: "Household",
  need: "Needs",
  responder: "Responders",
  network: "Physical network",
  destination: "Destinations",
  supply: "Supplies",
  threat: "Threats",
  plan: "Plan",
};

const BAND_ORDER: GraphBand[] = [
  "household",
  "need",
  "responder",
  "network",
  "destination",
  "supply",
  "threat",
  "plan",
];

const ROLE_CSS: Record<NodeVisual["role"], string> = {
  accent: CSS_VAR.accent,
  safe: CSS_VAR.safe,
  warn: CSS_VAR.warn,
  danger: CSS_VAR.danger,
  info: CSS_VAR.info,
  neutral: CSS_VAR.textSecondary,
};

/* ------------------------------------------------------------------ */
/* Shape swatches — SVG mirrors of the cytoscape node shapes            */
/* ------------------------------------------------------------------ */

function regularPolygon(sides: number, rotationDeg: number, radius = 9): string {
  const points: string[] = [];
  for (let i = 0; i < sides; i++) {
    const angle = ((rotationDeg + (i * 360) / sides) * Math.PI) / 180;
    points.push(`${(11 + radius * Math.cos(angle)).toFixed(2)},${(11 + radius * Math.sin(angle)).toFixed(2)}`);
  }
  return points.join(" ");
}

function starPoints(): string {
  const points: string[] = [];
  for (let i = 0; i < 10; i++) {
    const radius = i % 2 === 0 ? 10 : 4.3;
    const angle = ((-90 + i * 36) * Math.PI) / 180;
    points.push(`${(11 + radius * Math.cos(angle)).toFixed(2)},${(11 + radius * Math.sin(angle)).toFixed(2)}`);
  }
  return points.join(" ");
}

function shapeElement(shape: GraphShape, style: CSSProperties): ReactElement {
  const common = { style, vectorEffect: "non-scaling-stroke" as const };
  switch (shape) {
    case "ellipse":
      return <ellipse cx="11" cy="11" rx="9" ry="9" {...common} />;
    case "round-rectangle":
      return <rect x="1.5" y="4" width="19" height="14" rx="4.5" {...common} />;
    case "rectangle":
      return <rect x="1.5" y="6.5" width="19" height="9" {...common} />;
    case "cut-rectangle":
      return <polygon points="4,3 18,3 21,6 21,16 18,19 4,19 1,16 1,6" {...common} />;
    case "barrel":
      return (
        <path
          d="M3 4 Q11 1.5 19 4 L19 18 Q11 20.5 3 18 Z"
          {...common}
        />
      );
    case "rhomboid":
      return <polygon points="5,4.5 21,4.5 17,17.5 1,17.5" {...common} />;
    case "round-tag":
      return <polygon points="2,4 15,4 21,11 15,18 2,18" {...common} />;
    case "vee":
      return <polygon points="1,2.5 11,9.5 21,2.5 11,20" {...common} />;
    case "triangle":
      return <polygon points="11,1.5 20.5,18.5 1.5,18.5" {...common} />;
    case "diamond":
      return <polygon points="11,1 20.5,11 11,21 1.5,11" {...common} />;
    case "star":
      return <polygon points={starPoints()} {...common} />;
    case "pentagon":
      return <polygon points={regularPolygon(5, -90)} {...common} />;
    case "hexagon":
      return <polygon points={regularPolygon(6, -90)} {...common} />;
    case "heptagon":
    case "round-heptagon":
      return <polygon points={regularPolygon(7, -90)} {...common} />;
    case "octagon":
      return <polygon points={regularPolygon(8, -67.5)} {...common} />;
    default:
      return <ellipse cx="11" cy="11" rx="9" ry="9" {...common} />;
  }
}

function TypeSwatch({ visual }: { visual: NodeVisual }) {
  const color = ROLE_CSS[visual.role];
  const style: CSSProperties = {
    fill: `color-mix(in srgb, ${color} 14%, transparent)`,
    stroke: color,
    strokeWidth: Math.max(1, visual.borderWidth - 0.5),
    strokeDasharray:
      visual.borderStyle === "dashed" ? "3 2.5" : visual.borderStyle === "dotted" ? "1 2" : undefined,
  };

  return (
    <span
      aria-hidden="true"
      style={{ position: "relative", display: "inline-flex", width: 22, height: 22, flexShrink: 0 }}
    >
      <svg viewBox="0 0 22 22" width="22" height="22">
        {shapeElement(visual.shape, style)}
        {visual.borderStyle === "double" ? shapeElement(visual.shape, { ...style, transform: "scale(0.68)", transformOrigin: "11px 11px", fill: "none" }) : null}
      </svg>
      <span
        style={{
          position: "absolute",
          inset: 0,
          display: "grid",
          placeItems: "center",
          fontSize: visual.glyph.length > 1 ? 6.5 : 9,
          fontWeight: 700,
          letterSpacing: "0.02em",
          color: CSS_VAR.textPrimary,
          lineHeight: 1,
        }}
      >
        {visual.glyph}
      </span>
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Visual states                                                       */
/* ------------------------------------------------------------------ */

interface StateSwatch {
  label: string;
  /** The cytoscape class this row documents. */
  className: string;
  color: string;
  fillPct: number;
  glow: boolean;
  dashed: boolean;
  opacity: number;
  ring?: boolean;
}

const STATE_SWATCHES: StateSwatch[] = [
  { label: "Dimmed", className: "ll-dim", color: CSS_VAR.textSecondary, fillPct: 4, glow: false, dashed: false, opacity: 0.32 },
  { label: "Normal", className: "—", color: CSS_VAR.textSecondary, fillPct: 10, glow: false, dashed: false, opacity: 1 },
  { label: "Relevant", className: "ll-relevant", color: CSS_VAR.info, fillPct: 14, glow: false, dashed: false, opacity: 1 },
  { label: "Backup plan", className: "ll-backup", color: CSS_VAR.warn, fillPct: 20, glow: true, dashed: true, opacity: 1 },
  { label: "Recommended", className: "ll-path", color: CSS_VAR.accent, fillPct: 26, glow: true, dashed: false, opacity: 1 },
  { label: "Blocked", className: "ll-invalid", color: CSS_VAR.danger, fillPct: 24, glow: true, dashed: true, opacity: 1 },
  { label: "Selected", className: "ll-selected", color: CSS_VAR.textPrimary, fillPct: 10, glow: false, dashed: false, opacity: 1, ring: true },
];

function StateRow({ swatch }: { swatch: StateSwatch }) {
  return (
    <li style={{ display: "flex", alignItems: "center", gap: 8, opacity: swatch.opacity }}>
      <span
        aria-hidden="true"
        style={{
          width: 18,
          height: 18,
          flexShrink: 0,
          borderRadius: 5,
          background: `color-mix(in srgb, ${swatch.color} ${swatch.fillPct}%, transparent)`,
          border: `2px ${swatch.dashed ? "dashed" : "solid"} ${swatch.color}`,
          boxShadow: swatch.glow
            ? `0 0 0 3px color-mix(in srgb, ${swatch.color} 22%, transparent)`
            : swatch.ring
              ? `0 0 0 2px color-mix(in srgb, ${swatch.color} 34%, transparent)`
              : "none",
        }}
      />
      <span style={{ fontSize: 11, color: CSS_VAR.textSecondary }}>{swatch.label}</span>
    </li>
  );
}

/* ------------------------------------------------------------------ */

export interface GraphLegendProps {
  className?: string;
  /** Restrict the legend to the types actually on screen. */
  types?: readonly GraphNodeType[];
  /** Drop the visual-state block and tighten the spacing. */
  compact?: boolean;
  style?: CSSProperties;
}

export function GraphLegend({ className, types, compact = false, style }: GraphLegendProps) {
  const grouped = useMemo(() => {
    const allowed = types && types.length > 0 ? new Set(types) : null;
    const map = new Map<GraphBand, NodeVisual[]>();
    for (const type of NODE_TYPES) {
      if (allowed && !allowed.has(type)) continue;
      const visual = NODE_VISUALS[type];
      const list = map.get(visual.band);
      if (list) list.push(visual);
      else map.set(visual.band, [visual]);
    }
    return BAND_ORDER.filter((band) => map.has(band)).map((band) => ({
      band,
      items: map.get(band) ?? [],
    }));
  }, [types]);

  return (
    <div
      className={className}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: compact ? 8 : 12,
        padding: compact ? "10px 12px" : "14px 16px",
        borderRadius: 12,
        background: `color-mix(in srgb, ${CSS_VAR.bgPanel} 92%, transparent)`,
        border: `1px solid ${CSS_VAR.borderHairline}`,
        color: CSS_VAR.textSecondary,
        fontSize: 11,
        lineHeight: 1.35,
        ...style,
      }}
    >
      {grouped.map(({ band, items }) => (
        <div key={band}>
          <div
            style={{
              fontSize: 9,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: CSS_VAR.textTertiary,
              marginBottom: 6,
            }}
          >
            {BAND_TITLES[band]}
          </div>
          <ul
            style={{
              listStyle: "none",
              margin: 0,
              padding: 0,
              display: "grid",
              gridTemplateColumns: compact ? "1fr" : "repeat(auto-fill, minmax(112px, 1fr))",
              gap: "5px 10px",
            }}
          >
            {items.map((visual) => (
              <li
                key={visual.type}
                style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}
              >
                <TypeSwatch visual={visual} />
                <span style={{ color: CSS_VAR.textSecondary, whiteSpace: "nowrap" }}>
                  {visual.title}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}

      {compact ? null : (
        <div>
          <div
            style={{
              fontSize: 9,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: CSS_VAR.textTertiary,
              margin: "2px 0 6px",
            }}
          >
            Emphasis
          </div>
          <ul
            style={{
              listStyle: "none",
              margin: 0,
              padding: 0,
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(112px, 1fr))",
              gap: "5px 10px",
            }}
          >
            {STATE_SWATCHES.map((swatch) => (
              <StateRow key={swatch.label} swatch={swatch} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default GraphLegend;
