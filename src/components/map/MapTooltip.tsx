"use client";

/**
 * Lifeline — hover card.
 *
 * A plain absolutely-positioned React overlay, NOT a maplibre popup and
 * certainly not a `symbol` layer: the style ships no glyphs, so GL text is
 * impossible. It is pointer-events:none so it can never eat a click.
 */

import type { CSSProperties } from "react";
import { world } from "@/lib/world/world";

export type TipTone = "safe" | "warn" | "danger" | "neutral";

export interface TipRow {
  label: string;
  value: string;
}

export interface TipContent {
  id: string;
  title: string;
  /** Short uppercase category shown next to the title. */
  kind: string;
  status?: { label: string; tone: TipTone };
  rows: TipRow[];
  note?: string;
}

export interface TipState extends TipContent {
  /** Pointer position in container-relative pixels. */
  x: number;
  y: number;
}

export interface MapTooltipProps {
  tip: TipState | null;
  width: number;
  height: number;
}

const pct = (v: number | undefined) => (typeof v === "number" ? `${Math.round(v * 100)}%` : "—");

const ACCESSIBILITY_LABEL: Record<string, string> = {
  full: "Paved · step-free",
  rough: "Vehicle only · not step-free",
  foot_only: "Pedestrians only",
};

const SEGMENT_TONE: Record<string, TipTone> = {
  open: "safe",
  caution: "warn",
  unsafe: "warn",
  blocked: "danger",
};

/* ------------------------------------------------------------------ */
/* Entity -> card                                                      */
/* ------------------------------------------------------------------ */

export interface DescribeContext {
  blockedSegmentIds: ReadonlySet<string>;
  activeHazardIds: ReadonlySet<string>;
}

/**
 * Everything the map can hover resolves through here, so the card always shows
 * the properties that matter for THIS entity type rather than a generic blob.
 */
export function describeEntity(id: string, ctx: DescribeContext): TipContent | null {
  const seg = world.segments.find((s) => s.id === id);
  if (seg) {
    const blocked = ctx.blockedSegmentIds.has(seg.id);
    const status = blocked ? "blocked" : seg.status;
    const from = world.locations.find((l) => l.id === seg.from)?.name ?? seg.from;
    const to = world.locations.find((l) => l.id === seg.to)?.name ?? seg.to;
    const blockers = world.hazards.filter(
      (h) => ctx.activeHazardIds.has(h.id) && h.blocks.includes(seg.id),
    );
    return {
      id,
      title: seg.name,
      kind: seg.kind,
      status: { label: blocked ? "Impassable" : status, tone: SEGMENT_TONE[status] ?? "neutral" },
      rows: [
        { label: "Travel time", value: `${seg.travelMinutes} min` },
        { label: "Flood risk", value: pct(seg.floodRisk) },
        { label: "Accessibility", value: ACCESSIBILITY_LABEL[seg.accessibility] ?? seg.accessibility },
        { label: "Connects", value: `${from} → ${to}` },
      ],
      note: blockers.length ? `Closed by ${blockers.map((h) => h.name).join(", ")}.` : undefined,
    };
  }

  const loc = world.locations.find((l) => l.id === id);
  if (loc) {
    return {
      id,
      title: loc.name,
      kind: "Location",
      status: {
        label: loc.status,
        tone: loc.status === "evacuating" ? "danger" : loc.status === "watch" ? "warn" : "safe",
      },
      rows: [
        { label: "Zone", value: loc.zone },
        { label: "Elevation", value: `${loc.elevation} m` },
        { label: "Terrain safety", value: pct(loc.safetyScore) },
      ],
    };
  }

  const shelter = world.shelters.find((s) => s.id === id);
  if (shelter) {
    const headroom = Math.max(0, shelter.capacity - shelter.occupancy);
    const at = world.locations.find((l) => l.id === shelter.locationId)?.name ?? shelter.locationId;
    return {
      id,
      title: shelter.name,
      kind: "Shelter",
      status: {
        label: shelter.status === "full" ? "At capacity" : shelter.status,
        tone: shelter.status === "open" ? "safe" : shelter.status === "full" ? "danger" : "neutral",
      },
      rows: [
        { label: "Occupancy", value: `${shelter.occupancy} / ${shelter.capacity}` },
        { label: "Free places", value: `${headroom}` },
        { label: "Step-free access", value: shelter.wheelchairAccessible ? "Yes" : "No" },
        { label: "At", value: at },
      ],
    };
  }

  const care = world.careSites.find((c) => c.id === id);
  if (care) {
    const stock = world.resources.filter((r) => r.holderId === care.id);
    return {
      id,
      title: care.name,
      kind: care.kind,
      status: {
        label: care.status,
        tone: care.status === "open" ? "safe" : care.status === "limited" ? "warn" : "neutral",
      },
      rows: [
        { label: "At", value: world.locations.find((l) => l.id === care.locationId)?.name ?? care.locationId },
        ...stock.map((r) => ({ label: r.name, value: `${r.quantity}${r.status === "low" ? " · low" : ""}` })),
      ],
    };
  }

  const vol = world.volunteers.find((v) => v.id === id);
  if (vol) {
    const vehicle = world.vehicles.find((v) => v.id === vol.vehicleId);
    return {
      id,
      title: vol.name,
      kind: "Responder",
      status: {
        label: vol.status.replace(/_/g, " "),
        tone: vol.status === "available" ? "safe" : vol.status === "on_task" ? "warn" : "neutral",
      },
      rows: [
        { label: "Staged at", value: world.locations.find((l) => l.id === vol.locationId)?.name ?? vol.locationId },
        { label: "Vehicle", value: vehicle ? `${vehicle.name} (${vehicle.type})` : vol.vehicleId },
        { label: "Seats", value: vehicle ? `${vehicle.capacity}` : "—" },
        { label: "Wheelchair access", value: vehicle?.wheelchairAccessible ? "Yes" : "No" },
        { label: "Skills", value: vol.skills.join(", ") },
        ...(vol.distanceOutsideZoneKm
          ? [{ label: "Outside zone", value: `${vol.distanceOutsideZoneKm} km` }]
          : []),
      ],
    };
  }

  const family = world.families.find((f) => f.id === id);
  if (family) {
    const needLabels = family.members
      .flatMap((m) => m.needIds)
      .concat(family.needIds)
      .map((nid) => world.needs.find((n) => n.id === nid)?.label)
      .filter((v): v is string => Boolean(v));
    return {
      id,
      title: family.name,
      kind: "Household",
      status: { label: `${family.size} people`, tone: "danger" },
      rows: [
        { label: "At", value: world.locations.find((l) => l.id === family.locationId)?.name ?? family.locationId },
        { label: "Own vehicle", value: family.hasVehicle ? "Yes" : "No" },
        { label: "Needs", value: Array.from(new Set(needLabels)).join(", ") || "—" },
      ],
      note: family.note,
    };
  }

  const hazard = world.hazards.find((h) => h.id === id);
  if (hazard) {
    const blocks = hazard.blocks
      .map((sid) => world.segments.find((s) => s.id === sid)?.name ?? sid)
      .join(", ");
    return {
      id,
      title: hazard.name,
      kind: hazard.hazardType,
      status: {
        label: ctx.activeHazardIds.has(hazard.id) ? "Active" : "Forecast",
        tone: ctx.activeHazardIds.has(hazard.id) ? "danger" : "warn",
      },
      rows: [
        { label: "Severity", value: pct(hazard.severity) },
        { label: "Segments closed", value: blocks || "—" },
        { label: "Locations affected", value: `${hazard.affects.length}` },
      ],
      note: hazard.description,
    };
  }

  return null;
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export default function MapTooltip({ tip, width, height }: MapTooltipProps) {
  if (!tip) return null;

  // Flip toward the middle of the map so the card never hangs off an edge.
  const flipX = width > 0 && tip.x > width - 300;
  const flipY = height > 0 && tip.y > height - 190;
  const style: CSSProperties = {
    left: flipX ? tip.x - 14 : tip.x + 14,
    top: flipY ? tip.y - 12 : tip.y + 12,
    transform: `translate(${flipX ? "-100%" : "0"}, ${flipY ? "-100%" : "0"})`,
  };

  return (
    <div className="lfl-tip" role="status" aria-live="polite" style={style}>
      <div className="lfl-tip-head">
        <span className="lfl-tip-title">{tip.title}</span>
        <span className="lfl-tip-kind">{tip.kind}</span>
      </div>
      {tip.status ? (
        <div className="lfl-tip-status" data-tone={tip.status.tone}>
          {tip.status.label}
        </div>
      ) : null}
      {tip.rows.length ? (
        <div className="lfl-tip-rows">
          {tip.rows.map((row) => (
            <div className="lfl-tip-row" key={`${row.label}-${row.value}`}>
              <span className="lfl-tip-k">{row.label}</span>
              <span className="lfl-tip-v">{row.value}</span>
            </div>
          ))}
        </div>
      ) : null}
      {tip.note ? <div className="lfl-tip-note">{tip.note}</div> : null}
    </div>
  );
}
