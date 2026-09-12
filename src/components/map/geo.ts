/**
 * Lifeline — synthetic cartography helpers.
 *
 * Pure functions only: every GeoJSON payload the map renders is derived here
 * from `world`, so the map can never drift from the graph. Nothing in this
 * module touches maplibre, the DOM or React — it is unit-testable as-is.
 *
 * There is deliberately NO basemap. The district is fictional, so a real tile
 * source would draw real streets straight through our road graph. Everything
 * below is the entire visible world.
 */

import type { Feature, FeatureCollection, LineString, Point, Polygon } from "geojson";
import type { RouteStep, WorldHazard, WorldSegment } from "@/lib/types";
import { locationById, segmentById, world } from "@/lib/world/world";

/** [lng, lat] — GeoJSON axis order, the opposite of the World*.lat/lng fields. */
export type Pos = [number, number];

/* ------------------------------------------------------------------ */
/* Metric helpers (equirectangular — exact enough over a ~5km district) */
/* ------------------------------------------------------------------ */

const EARTH_R = 6371000;
const RAD = Math.PI / 180;

export function metersBetween(a: Pos, b: Pos): number {
  const midLat = ((a[1] + b[1]) / 2) * RAD;
  const dy = (b[1] - a[1]) * RAD;
  const dx = (b[0] - a[0]) * RAD * Math.cos(midLat);
  return Math.sqrt(dx * dx + dy * dy) * EARTH_R;
}

/** Cumulative distance at each vertex, plus the total. */
function cumulative(coords: Pos[]): { at: number[]; total: number } {
  const at: number[] = [0];
  let total = 0;
  for (let i = 1; i < coords.length; i++) {
    total += metersBetween(coords[i - 1], coords[i]);
    at.push(total);
  }
  return { at, total };
}

/** Drop consecutive duplicate vertices — they break dash + trace maths. */
export function dedupe(coords: Pos[]): Pos[] {
  const out: Pos[] = [];
  for (const c of coords) {
    const prev = out[out.length - 1];
    if (!prev || Math.abs(prev[0] - c[0]) > 1e-9 || Math.abs(prev[1] - c[1]) > 1e-9) out.push(c);
  }
  return out;
}

function lerp(a: Pos, b: Pos, f: number): Pos {
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
}

/**
 * The prefix of `coords` covering the first `t` (0..1) of its *length*.
 * Used by the animated route trace — interpolating by index instead would
 * make long segments whip past and short ones crawl.
 */
export function interpolateAlong(coords: Pos[], t: number): Pos[] {
  if (coords.length < 2) return coords.slice();
  const clamped = Math.max(0, Math.min(1, t));
  if (clamped <= 0) return [];
  if (clamped >= 1) return coords.slice();

  const { at, total } = cumulative(coords);
  if (total === 0) return coords.slice();
  const target = total * clamped;

  const out: Pos[] = [coords[0]];
  for (let i = 1; i < coords.length; i++) {
    if (at[i] >= target) {
      const spanStart = at[i - 1];
      const span = at[i] - spanStart;
      const f = span === 0 ? 0 : (target - spanStart) / span;
      out.push(lerp(coords[i - 1], coords[i], f));
      break;
    }
    out.push(coords[i]);
  }
  return out;
}

/** The point at fraction `t` of the polyline's length. */
export function pointAlong(coords: Pos[], t: number): Pos {
  const prefix = interpolateAlong(coords, t);
  return prefix[prefix.length - 1] ?? coords[0];
}

/** True midpoint by arc length — `via` waypoints make endpoint-averaging wrong. */
export function midpointAlong(coords: Pos[]): Pos {
  return pointAlong(coords, 0.5);
}

export function centroidOfRing(ring: Pos[]): Pos {
  // Drop the closing vertex if the ring repeats its first point.
  const pts =
    ring.length > 2 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]
      ? ring.slice(0, -1)
      : ring;
  if (pts.length === 0) return [world.district.center[0], world.district.center[1]];
  let x = 0;
  let y = 0;
  for (const p of pts) {
    x += p[0];
    y += p[1];
  }
  return [x / pts.length, y / pts.length];
}

/** Scale a polygon ring about its centroid — drives the hazard "grow in" animation. */
export function scaleRing(ring: Pos[], k: number): Pos[] {
  const [cx, cy] = centroidOfRing(ring);
  return ring.map(([x, y]) => [cx + (x - cx) * k, cy + (y - cy) * k] as Pos);
}

/** Closes a ring if the source data left it open. */
function closeRing(ring: Pos[]): Pos[] {
  if (ring.length < 3) return ring;
  const first = ring[0];
  const last = ring[ring.length - 1];
  return first[0] === last[0] && first[1] === last[1] ? ring : [...ring, first];
}

/* ------------------------------------------------------------------ */
/* World -> geometry                                                   */
/* ------------------------------------------------------------------ */

export function locationPos(locationId: string): Pos | null {
  const loc = locationById.get(locationId);
  return loc ? [loc.lng, loc.lat] : null;
}

/** Full drawn geometry of a segment: from -> optional bend waypoints -> to. */
export function segmentCoords(seg: WorldSegment): Pos[] {
  const a = locationPos(seg.from);
  const b = locationPos(seg.to);
  if (!a || !b) return [];
  const via = (seg.via ?? []).map((v) => [v[0], v[1]] as Pos);
  return dedupe([a, ...via, b]);
}

/**
 * Turn an ordered Cypher traversal into drawable coordinates.
 *
 * Assumptions about the step shape (documented, not guessed at runtime):
 *  - steps[0] is the ORIGIN and carries no `viaSegmentId`.
 *  - every later step names the segment used to ARRIVE at it.
 *  - a segment may be traversed in either direction, so its `via` bend
 *    waypoints are reversed when the previous step sits at `seg.to`.
 *  - step.lat/lng is authoritative for the vertex itself; `via` only bends
 *    the line between two vertices.
 */
export function routeCoords(steps: RouteStep[] | null | undefined): Pos[] {
  if (!steps || steps.length === 0) return [];
  const out: Pos[] = [];
  steps.forEach((step, i) => {
    if (i > 0) {
      const prev = steps[i - 1];
      const seg = step.viaSegmentId ? segmentById.get(step.viaSegmentId) : undefined;
      if (seg?.via?.length) {
        const travellingBackwards = seg.to === prev.locationId;
        const via = travellingBackwards ? [...seg.via].reverse() : seg.via;
        for (const v of via) out.push([v[0], v[1]]);
      }
    }
    out.push([step.lng, step.lat]);
  });
  return dedupe(out);
}

/* ------------------------------------------------------------------ */
/* FeatureCollection builders                                          */
/* ------------------------------------------------------------------ */

export function emptyLines(): FeatureCollection<LineString> {
  return { type: "FeatureCollection", features: [] };
}

export function emptyPolygons(): FeatureCollection<Polygon> {
  return { type: "FeatureCollection", features: [] };
}

function lineFeature(
  id: string,
  coords: Pos[],
  properties: Record<string, unknown>,
): Feature<LineString> {
  return { type: "Feature", id, geometry: { type: "LineString", coordinates: coords }, properties };
}

export function lineCollection(
  features: { id: string; coords: Pos[]; properties: Record<string, unknown> }[],
): FeatureCollection<LineString> {
  return {
    type: "FeatureCollection",
    features: features
      .filter((f) => f.coords.length >= 2)
      .map((f) => lineFeature(f.id, f.coords, { id: f.id, ...f.properties })),
  };
}

/** District boundary — a subtle "inside the response perimeter" wash. */
export function buildBoundary(): FeatureCollection<Polygon> {
  const ring = closeRing(world.district.boundary.map((p) => [p[0], p[1]] as Pos));
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        id: "district",
        geometry: { type: "Polygon", coordinates: [ring] },
        properties: { id: "district", name: world.district.name },
      },
    ],
  };
}

export function buildRiver(): FeatureCollection<LineString> {
  const coords = world.district.river.map((p) => [p[0], p[1]] as Pos);
  return {
    type: "FeatureCollection",
    features: [lineFeature("river", coords, { id: "river", name: "Bagmati (synthetic reach)" })],
  };
}

/**
 * Faint graticule. Not a real grid reference — it is a cue that this is a
 * plotted operations surface rather than a photograph of a place.
 */
export function buildGraticule(stepDeg = 0.005): FeatureCollection<LineString> {
  const ring = world.district.boundary;
  const lngs = ring.map((p) => p[0]);
  const lats = ring.map((p) => p[1]);
  const pad = stepDeg * 2;
  const minLng = Math.min(...lngs) - pad;
  const maxLng = Math.max(...lngs) + pad;
  const minLat = Math.min(...lats) - pad;
  const maxLat = Math.max(...lats) + pad;

  const features: Feature<LineString>[] = [];
  const start = (v: number) => Math.ceil(v / stepDeg) * stepDeg;

  for (let lng = start(minLng); lng <= maxLng; lng += stepDeg) {
    const x = Number(lng.toFixed(6));
    features.push(
      lineFeature(`grat-v-${x}`, [
        [x, minLat],
        [x, maxLat],
      ], { id: `grat-v-${x}` }),
    );
  }
  for (let lat = start(minLat); lat <= maxLat; lat += stepDeg) {
    const y = Number(lat.toFixed(6));
    features.push(
      lineFeature(`grat-h-${y}`, [
        [minLng, y],
        [maxLng, y],
      ], { id: `grat-h-${y}` }),
    );
  }
  return { type: "FeatureCollection", features };
}

/**
 * Relief hint. Graduated, heavily blurred circles keyed off `elevation`, so the
 * eastern uplands read as high ground and the riverside reads as the valley
 * floor — without pretending to be a real DEM.
 */
export function buildRelief(): FeatureCollection<Point> {
  return {
    type: "FeatureCollection",
    features: world.locations.map((loc) => ({
      type: "Feature" as const,
      id: loc.id,
      geometry: { type: "Point" as const, coordinates: [loc.lng, loc.lat] },
      properties: {
        id: loc.id,
        elevation: loc.elevation,
        safetyScore: loc.safetyScore,
      },
    })),
  };
}

/** One LineString per segment, carrying everything the hover card needs. */
export function buildRoads(): FeatureCollection<LineString> {
  return lineCollection(
    world.segments.map((seg) => ({
      id: seg.id,
      coords: segmentCoords(seg),
      properties: {
        name: seg.name,
        kind: seg.kind,
        status: seg.status,
        travelMinutes: seg.travelMinutes,
        floodRisk: seg.floodRisk,
        accessibility: seg.accessibility,
        from: seg.from,
        to: seg.to,
        isBridge: seg.kind === "Bridge",
      },
    })),
  );
}

/** Segments currently impassable, drawn on their own layer above the roads. */
export function buildBlocked(blockedIds: readonly string[]): FeatureCollection<LineString> {
  return lineCollection(
    blockedIds
      .map((id) => segmentById.get(id))
      .filter((seg): seg is WorldSegment => Boolean(seg))
      .map((seg) => ({
        id: seg.id,
        coords: segmentCoords(seg),
        properties: { name: seg.name, kind: seg.kind, status: "blocked" },
      })),
  );
}

/**
 * Hazard footprints. `scales` lets the caller shrink individual rings toward
 * their centroid so a newly-activated hazard can grow into place.
 */
export function buildHazards(
  activeIds: readonly string[],
  scales?: ReadonlyMap<string, number>,
): FeatureCollection<Polygon> {
  const wanted = new Set(activeIds);
  const features = world.hazards
    .filter((h: WorldHazard) => wanted.has(h.id))
    .map((h) => {
      const ring = closeRing(h.footprint.map((p) => [p[0], p[1]] as Pos));
      const k = scales?.get(h.id);
      const scaled = k === undefined || k >= 1 ? ring : scaleRing(ring, Math.max(k, 0.001));
      return {
        type: "Feature" as const,
        id: h.id,
        geometry: { type: "Polygon" as const, coordinates: [scaled] },
        properties: {
          id: h.id,
          name: h.name,
          hazardType: h.hazardType,
          severity: h.severity,
          description: h.description,
          blocks: h.blocks.length,
        },
      };
    });
  return { type: "FeatureCollection", features };
}

/** Where should the camera go for an arbitrary entity id from anywhere in the app? */
export function resolveEntityPosition(id: string | null): Pos | null {
  if (!id) return null;

  const loc = locationById.get(id);
  if (loc) return [loc.lng, loc.lat];

  const seg = segmentById.get(id);
  if (seg) {
    const coords = segmentCoords(seg);
    return coords.length >= 2 ? midpointAlong(coords) : null;
  }

  const hazard = world.hazards.find((h) => h.id === id);
  if (hazard) return centroidOfRing(hazard.footprint.map((p) => [p[0], p[1]] as Pos));

  const shelter = world.shelters.find((s) => s.id === id);
  if (shelter) return locationPos(shelter.locationId);

  const care = world.careSites.find((c) => c.id === id);
  if (care) return locationPos(care.locationId);

  const volunteer = world.volunteers.find((v) => v.id === id);
  if (volunteer) return locationPos(volunteer.locationId);

  const family = world.families.find((f) => f.id === id);
  if (family) return locationPos(family.locationId);

  // A vehicle is wherever its assigned responder is standing.
  const driver = world.volunteers.find((v) => v.vehicleId === id);
  if (driver) return locationPos(driver.locationId);

  // A person is wherever their household is.
  const household = world.families.find((f) => f.members.some((m) => m.id === id));
  if (household) return locationPos(household.locationId);

  const resource = world.resources.find((r) => r.id === id);
  if (resource) return resolveEntityPosition(resource.holderId);

  // Needs, plans and alerts have no position — that is fine, not an error.
  return null;
}
