/**
 * Lifeline — DOM marker factories.
 *
 * The style has no `glyphs` URL, so `symbol` layers (and therefore GL text and
 * GL icons) are impossible by construction. Every label, glyph and badge on the
 * map is one of these plain HTML elements, handed to `new maplibregl.Marker`.
 *
 * Status is never carried by colour alone: each state also changes a glyph, a
 * badge word, a dash pattern or the opacity.
 */

import type {
  WorldCareSite,
  WorldFamily,
  WorldHazard,
  WorldLocation,
  WorldSegment,
  WorldShelter,
  WorldVehicle,
  WorldVolunteer,
} from "@/lib/types";
import type { Pos } from "./geo";
import { midpointAlong, segmentCoords } from "./geo";
import { locationById, vehicleById, world } from "@/lib/world/world";

export type MarkerAnchor = "center" | "top" | "bottom" | "left" | "right";

export interface MarkerSpec {
  /** Entity id — what `onSelect` reports and `selectedId` matches against. */
  id: string;
  kind: "location" | "family" | "shelter" | "care" | "volunteer" | "hazard" | "blocked";
  el: HTMLElement;
  lngLat: Pos;
  anchor: MarkerAnchor;
  offset: [number, number];
  /** Plain-text label used for the accessible name and the hover card title. */
  label: string;
}

/* ------------------------------------------------------------------ */
/* Primitives                                                          */
/* ------------------------------------------------------------------ */

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function root(kind: MarkerSpec["kind"], id: string, label: string, extraClass = ""): HTMLElement {
  const el = document.createElement("div");
  el.className = `lfl-marker lfl-marker--${kind}${extraClass ? ` ${extraClass}` : ""}`;
  el.dataset.entityId = id;
  el.dataset.entityKind = kind;
  el.setAttribute("role", "button");
  el.setAttribute("tabindex", "0");
  el.setAttribute("aria-label", label);
  return el;
}

const svg = (body: string, size = 14) =>
  `<svg class="lfl-glyph" viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true" focusable="false">${body}</svg>`;

const GLYPH = {
  home: svg('<path d="M3 11.2 12 4l9 7.2V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" fill="currentColor"/>'),
  shield: svg(
    '<path d="M12 2.6 20 5.4v6.2c0 4.7-3.2 8.6-8 9.8-4.8-1.2-8-5.1-8-9.8V5.4z" fill="currentColor" opacity=".22"/>' +
      '<path d="M12 2.6 20 5.4v6.2c0 4.7-3.2 8.6-8 9.8-4.8-1.2-8-5.1-8-9.8V5.4z" fill="none" stroke="currentColor" stroke-width="1.6"/>' +
      '<path d="M7.6 12.4 12 8.6l4.4 3.8V17h-2.8v-3h-3.2v3H7.6z" fill="currentColor"/>',
  ),
  cross: svg(
    '<rect x="3" y="3" width="18" height="18" rx="4.5" fill="currentColor" opacity=".2"/>' +
      '<rect x="3" y="3" width="18" height="18" rx="4.5" fill="none" stroke="currentColor" stroke-width="1.5"/>' +
      '<path d="M10.3 6.8h3.4v3.5h3.5v3.4h-3.5v3.5h-3.4v-3.5H6.8v-3.4h3.5z" fill="currentColor"/>',
  ),
  van: svg(
    '<path d="M2 15V9.5A1.5 1.5 0 0 1 3.5 8H13l3.4 3H20a2 2 0 0 1 2 2v2z" fill="currentColor" opacity=".3"/>' +
      '<path d="M2 15V9.5A1.5 1.5 0 0 1 3.5 8H13l3.4 3H20a2 2 0 0 1 2 2v2z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>' +
      '<circle cx="7" cy="16.6" r="2.2" fill="currentColor"/><circle cx="17" cy="16.6" r="2.2" fill="currentColor"/>' +
      '<circle cx="8.4" cy="5.4" r="2" fill="currentColor"/>',
  ),
  wave: svg(
    '<path d="M2 9c2.6-2.4 5.3-2.4 7.9 0s5.3 2.4 7.9 0M2 14c2.6-2.4 5.3-2.4 7.9 0s5.3 2.4 7.9 0M2 19c2.6-2.4 5.3-2.4 7.9 0s5.3 2.4 7.9 0" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>',
  ),
  warning: svg(
    '<path d="M12 3.2 22 20H2z" fill="currentColor" opacity=".25"/>' +
      '<path d="M12 3.2 22 20H2z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>' +
      '<path d="M11.1 9h1.8v5h-1.8zM11.1 15.4h1.8v1.8h-1.8z" fill="currentColor"/>',
  ),
  flame: svg(
    '<path d="M12 2.5c3 4 6.5 5.6 6.5 10a6.5 6.5 0 1 1-13 0c0-2.6 1.6-4.2 3-6.2.5 1.4 1.4 2.2 2.3 2.4-.6-2.4-.4-4.4 1.2-6.2z" fill="currentColor"/>',
  ),
  slope: svg(
    '<path d="M2 20 13 6l9 14z" fill="currentColor" opacity=".25"/>' +
      '<path d="M2 20 13 6l9 14z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>' +
      '<path d="M9 13.5 15.5 20M12.5 11 19 18.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>',
  ),
  cracked: svg(
    '<path d="M4 21V6l8-3 8 3v15z" fill="currentColor" opacity=".22"/>' +
      '<path d="M4 21V6l8-3 8 3v15z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>' +
      '<path d="m11 5 1.9 5.4-3.1 1.4 3 2.2-1.4 6.9" fill="none" stroke="currentColor" stroke-width="1.5"/>',
  ),
} as const;

function hazardGlyph(kind: WorldHazard["hazardType"]): string {
  switch (kind) {
    case "flood":
      return GLYPH.wave;
    case "fire":
      return GLYPH.flame;
    case "landslide":
      return GLYPH.slope;
    case "structural":
      return GLYPH.cracked;
    default:
      return GLYPH.warning;
  }
}

/* ------------------------------------------------------------------ */
/* Factories                                                           */
/* ------------------------------------------------------------------ */

/**
 * Low-key place name, sitting BELOW the point so POI pins can occupy the point.
 * Where a shelter or clinic already names the place, `showName` is false and
 * only the junction dot is drawn — two labels on one point is just clutter.
 */
export function createLocationMarker(loc: WorldLocation, showName = true): MarkerSpec {
  const el = root(
    "location",
    loc.id,
    `${loc.name}, elevation ${loc.elevation} metres`,
    showName ? "" : "lfl-marker--location-dot",
  );
  el.classList.add(`lfl-loc--${loc.status}`);
  el.innerHTML =
    `<span class="lfl-loc-dot" aria-hidden="true"></span>` +
    (showName ? `<span class="lfl-loc-name">${escapeHtml(loc.name)}</span>` : "");
  return {
    id: loc.id,
    kind: "location",
    el,
    lngLat: [loc.lng, loc.lat],
    anchor: showName ? "top" : "center",
    offset: showName ? [0, 7] : [0, 0],
    label: loc.name,
  };
}

/** The household we are routing. Distinct pin plus a slow pulsing ring. */
/**
 * The map shows every monitored household, but only ONE of them is the subject
 * of the current plan. Without a distinction the routed home is visually
 * identical to its neighbours and a viewer cannot tell whose route they are
 * looking at, which is exactly the confusion this marks away.
 */
export function createFamilyMarker(family: WorldFamily, subjectId?: string): MarkerSpec | null {
  const loc = locationById.get(family.locationId);
  if (!loc) return null;
  const isSubject = subjectId === family.id;
  const el = root(
    "family",
    family.id,
    `${family.name}, ${family.size} people, at ${loc.name}${isSubject ? " — household this plan is for" : ""}`,
    isSubject ? "is-subject" : "",
  );
  el.innerHTML =
    `<span class="lfl-pulse-ring" aria-hidden="true"></span>` +
    `<span class="lfl-pin lfl-pin--family">${GLYPH.home}</span>` +
    `<span class="lfl-chip">${escapeHtml(family.name)} · ${family.size}` +
    (isSubject ? `<span class="lfl-chip-tag">this plan</span>` : "") +
    `</span>`;
  return {
    id: family.id,
    kind: "family",
    el,
    lngLat: [loc.lng, loc.lat],
    anchor: "bottom",
    offset: [0, -4],
    label: family.name,
  };
}

/** Shield glyph, capacity bar, and a literal FULL badge when there is no room. */
export function createShelterMarker(shelter: WorldShelter): MarkerSpec | null {
  const loc = locationById.get(shelter.locationId);
  if (!loc) return null;
  const pct = shelter.capacity > 0 ? Math.min(1, shelter.occupancy / shelter.capacity) : 1;
  const isFull = shelter.status === "full" || pct >= 1;
  const el = root(
    "shelter",
    shelter.id,
    `${shelter.name}, ${shelter.occupancy} of ${shelter.capacity} places used${isFull ? ", full" : ""}`,
    isFull ? "is-full" : shelter.status === "closed" ? "is-closed" : "",
  );
  el.innerHTML =
    `<span class="lfl-pin lfl-pin--shelter">${GLYPH.shield}` +
    (shelter.wheelchairAccessible ? `<span class="lfl-badge lfl-badge--wheelchair" title="Step-free">&#9855;</span>` : "") +
    `</span>` +
    `<span class="lfl-card">` +
    `<span class="lfl-card-title">${escapeHtml(shelter.name)}</span>` +
    `<span class="lfl-capacity"><span class="lfl-capacity-fill" style="width:${Math.round(pct * 100)}%"></span></span>` +
    `<span class="lfl-card-meta">${shelter.occupancy}/${shelter.capacity}${isFull ? ' <b class="lfl-flag">FULL</b>' : ""}</span>` +
    `</span>`;
  return {
    id: shelter.id,
    kind: "shelter",
    el,
    lngLat: [loc.lng, loc.lat],
    anchor: "bottom",
    offset: [0, -4],
    label: shelter.name,
  };
}

/** Medical cross, with a C/H letter so clinic vs hospital is not a colour. */
export function createCareSiteMarker(site: WorldCareSite): MarkerSpec | null {
  const loc = locationById.get(site.locationId);
  if (!loc) return null;
  const el = root(
    "care",
    site.id,
    `${site.name}, ${site.kind.toLowerCase()}, ${site.status}`,
    site.status === "closed" ? "is-closed" : site.status === "limited" ? "is-limited" : "",
  );
  el.innerHTML =
    `<span class="lfl-pin lfl-pin--care">${GLYPH.cross}` +
    `<span class="lfl-badge lfl-badge--letter">${site.kind === "Hospital" ? "H" : "C"}</span>` +
    `</span>` +
    `<span class="lfl-chip">${escapeHtml(site.name)}</span>`;
  return {
    id: site.id,
    kind: "care",
    el,
    lngLat: [loc.lng, loc.lat],
    anchor: "bottom",
    offset: [0, -4],
    label: site.name,
  };
}

/** Person-in-vehicle. Unavailable responders dim AND gain a struck-through ring. */
export function createVolunteerMarker(vol: WorldVolunteer): MarkerSpec | null {
  const loc = locationById.get(vol.locationId);
  if (!loc) return null;
  const vehicle: WorldVehicle | undefined = vehicleById.get(vol.vehicleId);
  const idle = vol.status !== "available";
  const el = root(
    "volunteer",
    vol.id,
    `${vol.name}, responder, ${vol.status.replace(/_/g, " ")}`,
    idle ? "is-idle" : "",
  );
  el.innerHTML =
    `<span class="lfl-pin lfl-pin--volunteer">${GLYPH.van}` +
    (idle ? `<span class="lfl-strike" aria-hidden="true"></span>` : "") +
    (vehicle?.wheelchairAccessible ? `<span class="lfl-badge lfl-badge--wheelchair" title="Accessible vehicle">&#9855;</span>` : "") +
    `</span>` +
    `<span class="lfl-chip">${escapeHtml(vol.name.split(" ")[0])}</span>`;
  return {
    id: vol.id,
    kind: "volunteer",
    el,
    lngLat: [loc.lng, loc.lat],
    anchor: "left",
    offset: [11, 2],
    label: vol.name,
  };
}

/** ✕ at the true arc-length midpoint of a blocked segment. */
export function createBlockedMarker(seg: WorldSegment): MarkerSpec | null {
  const coords = segmentCoords(seg);
  if (coords.length < 2) return null;
  const el = root("blocked", seg.id, `${seg.name} is impassable`);
  el.innerHTML = `<span class="lfl-x" aria-hidden="true">&#10006;</span>`;
  return {
    id: seg.id,
    kind: "blocked",
    el,
    lngLat: midpointAlong(coords),
    anchor: "center",
    offset: [0, 0],
    label: seg.name,
  };
}

/** Hazard name + type glyph, placed at the footprint centroid. */
export function createHazardMarker(hazard: WorldHazard, at: Pos): MarkerSpec {
  const el = root("hazard", hazard.id, `${hazard.name}, ${hazard.hazardType} hazard`);
  el.classList.add(`lfl-hz--${hazard.hazardType}`);
  el.innerHTML =
    `<span class="lfl-hz-glyph">${hazardGlyph(hazard.hazardType)}</span>` +
    `<span class="lfl-hz-name">${escapeHtml(hazard.name)}</span>`;
  return {
    id: hazard.id,
    kind: "hazard",
    el,
    lngLat: at,
    anchor: "center",
    offset: [0, 0],
    label: hazard.name,
  };
}

/** Every marker that exists regardless of the current scenario. */
export function buildStaticMarkers(subjectFamilyId?: string): MarkerSpec[] {
  const specs: MarkerSpec[] = [];
  // Locations whose name is already printed by a shelter/clinic card.
  const alreadyNamed = new Set<string>([
    ...world.shelters.map((s) => s.locationId),
    ...world.careSites.map((c) => c.locationId),
  ]);
  for (const loc of world.locations) {
    specs.push(createLocationMarker(loc, !alreadyNamed.has(loc.id)));
  }
  for (const site of world.careSites) {
    const spec = createCareSiteMarker(site);
    if (spec) specs.push(spec);
  }
  for (const shelter of world.shelters) {
    const spec = createShelterMarker(shelter);
    if (spec) specs.push(spec);
  }
  for (const vol of world.volunteers) {
    const spec = createVolunteerMarker(vol);
    if (spec) specs.push(spec);
  }
  for (const family of world.families) {
    const spec = createFamilyMarker(family, subjectFamilyId);
    if (spec) specs.push(spec);
  }
  return specs;
}
