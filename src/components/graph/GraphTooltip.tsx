"use client";

import { AnimatePresence, motion } from "framer-motion";
import type { GraphNode, GraphNodeType } from "@/lib/types";
import { roleColor, visualFor } from "./nodeVisuals";
import { CSS_VAR, FALLBACK_TOKENS } from "./tokens";

/**
 * Hover card for a graph node: label, type, and the handful of properties that
 * actually explain why the node is in the plan. Rendered as HTML on top of the
 * canvas rather than inside it, so it stays crisp at any zoom.
 */

/** Curated property order per type — the rest are hidden to keep the card small. */
const PROPERTY_KEYS: Partial<Record<GraphNodeType, string[]>> = {
  family: ["size", "status", "hasVehicle", "note"],
  person: ["role", "age"],
  need: ["kind", "critical"],
  location: ["zone", "status", "elevation", "safetyScore"],
  road: ["status", "accessibility", "travelMinutes", "floodRisk"],
  bridge: ["status", "accessibility", "travelMinutes", "floodRisk"],
  shelter: ["status", "capacity", "occupancy", "wheelchairAccessible"],
  clinic: ["kind", "status"],
  hospital: ["kind", "status"],
  volunteer: ["status", "skills", "canAssist", "distanceOutsideZoneKm"],
  vehicle: ["type", "capacity", "wheelchairAccessible", "status"],
  resource: ["type", "quantity", "status"],
  hazard: ["hazardType", "severity", "active", "description"],
  alert: ["severity", "status", "message"],
  plan: ["status", "estimatedMinutes", "destinationName"],
};

const HUMAN_KEY: Record<string, string> = {
  hazardType: "type",
  travelMinutes: "travel",
  floodRisk: "flood risk",
  safetyScore: "safety",
  wheelchairAccessible: "step-free",
  distanceOutsideZoneKm: "outside zone",
  estimatedMinutes: "eta",
  destinationName: "destination",
  hasVehicle: "own vehicle",
  canAssist: "can assist",
};

function humanize(key: string): string {
  if (HUMAN_KEY[key]) return HUMAN_KEY[key];
  return key.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
}

function formatValue(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "number") {
    return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0$/, "");
  }
  if (typeof value === "string") return value.length > 90 ? `${value.slice(0, 89)}…` : value;
  if (Array.isArray(value)) {
    const parts = value.map((v) => formatValue(v)).filter(Boolean);
    return parts.length > 0 ? parts.join(", ") : null;
  }
  return null;
}

function pickRows(node: GraphNode): { key: string; value: string }[] {
  const properties = node.properties ?? {};
  const rows: { key: string; value: string }[] = [];
  const preferred = PROPERTY_KEYS[node.type] ?? [];

  for (const key of preferred) {
    const value = formatValue(properties[key]);
    if (value !== null) rows.push({ key: humanize(key), value });
  }

  if (rows.length === 0) {
    for (const [key, raw] of Object.entries(properties)) {
      if (rows.length >= 4) break;
      if (key === "id" || key === "label" || key === "name") continue;
      const value = formatValue(raw);
      if (value !== null) rows.push({ key: humanize(key), value });
    }
  }

  return rows.slice(0, 5);
}

export interface GraphTooltipProps {
  node: GraphNode | null;
  /** Position in container-relative CSS pixels (the node's rendered centre). */
  x: number;
  y: number;
  containerWidth: number;
  containerHeight: number;
  reducedMotion?: boolean;
}

const CARD_WIDTH = 224;

export function GraphTooltip({
  node,
  x,
  y,
  containerWidth,
  containerHeight,
  reducedMotion = false,
}: GraphTooltipProps) {
  const visual = node ? visualFor(node.type) : null;
  const rows = node ? pickRows(node) : [];

  // Flip toward the inside of the panel when we are near an edge.
  const flipX = x + CARD_WIDTH + 28 > containerWidth;
  const estimatedHeight = 62 + rows.length * 17;
  const flipY = y + estimatedHeight + 26 > containerHeight;

  const left = Math.max(8, Math.min(containerWidth - CARD_WIDTH - 8, flipX ? x - CARD_WIDTH - 18 : x + 18));
  const top = Math.max(8, flipY ? y - estimatedHeight - 14 : y + 14);

  const accent = visual
    ? roleColor(visual.role, {
        ...FALLBACK_TOKENS,
        accent: CSS_VAR.accent,
        safe: CSS_VAR.safe,
        warn: CSS_VAR.warn,
        danger: CSS_VAR.danger,
        info: CSS_VAR.info,
        textSecondary: CSS_VAR.textSecondary,
      })
    : CSS_VAR.textSecondary;

  return (
    <AnimatePresence>
      {node && visual ? (
        <motion.div
          key={node.id}
          role="tooltip"
          initial={reducedMotion ? false : { opacity: 0, y: 4, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 2, scale: 0.99 }}
          transition={{ duration: reducedMotion ? 0 : 0.13, ease: [0.16, 1, 0.3, 1] }}
          style={{
            position: "absolute",
            left,
            top,
            width: CARD_WIDTH,
            pointerEvents: "none",
            zIndex: 40,
            padding: "9px 11px",
            borderRadius: 10,
            background: `color-mix(in srgb, ${CSS_VAR.bgPanel} 94%, transparent)`,
            border: `1px solid ${CSS_VAR.borderHairline}`,
            boxShadow: "0 18px 40px -18px rgba(0,0,0,0.8)",
            backdropFilter: "blur(10px)",
            WebkitBackdropFilter: "blur(10px)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
            <span
              aria-hidden="true"
              style={{
                width: 7,
                height: 7,
                borderRadius: 2,
                background: accent,
                flexShrink: 0,
              }}
            />
            <span
              style={{
                fontSize: 9,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                color: accent,
              }}
            >
              {visual.title}
            </span>
          </div>

          <div
            style={{
              fontSize: 12.5,
              fontWeight: 650,
              color: CSS_VAR.textPrimary,
              lineHeight: 1.25,
              marginBottom: rows.length > 0 ? 7 : 0,
              overflowWrap: "anywhere",
            }}
          >
            {node.label || node.id}
          </div>

          {rows.length > 0 ? (
            <dl
              style={{
                margin: 0,
                display: "grid",
                gridTemplateColumns: "auto 1fr",
                columnGap: 8,
                rowGap: 2,
                fontSize: 10.5,
                lineHeight: 1.4,
              }}
            >
              {rows.map((row) => (
                <div key={row.key} style={{ display: "contents" }}>
                  <dt style={{ color: CSS_VAR.textTertiary, whiteSpace: "nowrap" }}>{row.key}</dt>
                  <dd
                    style={{
                      margin: 0,
                      color: CSS_VAR.textSecondary,
                      fontVariantNumeric: "tabular-nums",
                      overflowWrap: "anywhere",
                    }}
                  >
                    {row.value}
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

export default GraphTooltip;
