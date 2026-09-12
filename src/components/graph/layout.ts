import type { GraphNode, GraphNodeType } from "@/lib/types";
import { world } from "@/lib/world/world";
import { hash01, type GraphIndex } from "./elements";

/**
 * DETERMINISTIC PRESET LAYOUT
 * ===========================
 * The demo must look pixel-identical on every run, so there is no force /
 * cose / fcose layout anywhere in this component. Positions are computed
 * here and handed to cytoscape as `layout: { name: 'preset' }`.
 *
 * The board reads left to right along the narrative the judges are told:
 *
 *   plan · family · people · needs · volunteers · vehicles
 *        · [ Location / Segment lattice ] · shelters · care sites · resources
 *
 * The middle lattice is a real (equirectangular) projection of the district's
 * lat/lng, so the graph's road network is geographically recognisable next to
 * the map. Crucially the projection bounds come from `world.district.boundary`
 * — a FIXED constant — not from the payload. If `/api/graph` ever returns a
 * subset of the world the lattice must not re-scale, or the "same every time"
 * guarantee dies.
 *
 * Every remaining degree of freedom (ordering inside a column, de-overlap
 * nudges, positions for nodes with no geography) is resolved either by sorting
 * on a stable key or by `hash01(node.id)`. Math.random() is never called.
 */

export interface Point {
  x: number;
  y: number;
}

/* ------------------------------------------------------------------ */
/* Fixed geometry                                                      */
/* ------------------------------------------------------------------ */

/**
 * Lattice box, in model pixels.
 *
 * Latitude and longitude are scaled INDEPENDENTLY. North is still up and east
 * is still right and every relative position is preserved — which is what
 * "roughly mirroring the real geography" has to mean inside a side panel.
 *
 * The whole board is tuned to a ~2.2 landscape aspect on purpose. The host
 * panel swings between roughly 379x490 (no plan yet) and 379x164 (plan and
 * score breakdown showing), i.e. viewport aspects 0.8 to 2.3. A board wider
 * than the tallest viewport aspect keeps `fit()` width-bound in BOTH states,
 * so the graph does not collapse to a smudge the moment a plan appears.
 */
const LATTICE = { x0: 296, y0: -165, width: 320, height: 330 };

/**
 * X position of each vertical band — the left-to-right narrative
 * Family -> Need -> Volunteer -> Vehicle -> Segment/Location -> Shelter ->
 * CareSite -> Resource. Gaps are as tight as the widest node in each band
 * allows, for the same panel-width reason as above.
 */
const BAND_X: Record<string, number> = {
  plan: -62,
  family: 0,
  person: 60,
  need: 118,
  volunteer: 176,
  vehicle: 232,
  destination: LATTICE.x0 + LATTICE.width + 64,
  care: LATTICE.x0 + LATTICE.width + 134,
  resource: LATTICE.x0 + LATTICE.width + 200,
};

/** Minimum vertical gap inside each column. Tuned to the ~2.2 board aspect. */
const GAP = {
  family: 122,
  person: 26,
  need: 30,
  volunteer: 34,
  vehicle: 30,
  destination: 40,
  care: 34,
  resource: 22,
  hazard: 34,
  alert: 30,
};

const HAZARD_LIFT = 46;
const ALERT_ROW_Y = LATTICE.y0 - 86;

/** Segments are pushed at least this far from any Location node. */
const LATTICE_MIN_SEPARATION = 21;
/** ...and this far from each other. */
const SEGMENT_MIN_SEPARATION = 17;
/** Locations may be nudged apart by at most this much from their true projection. */
const LOCATION_MIN_SEPARATION = 24;
const LOCATION_MAX_DRIFT = 18;
/** Relaxation step size. Below 1 so wedged nodes settle instead of oscillating. */
const RELAX_DAMPING = 0.55;
/** How far a Segment sits off the straight line between its two Locations. */
const SEGMENT_PERPENDICULAR_OFFSET = 13;

/** District bbox — FIXED, from the world seed, never from the payload. */
const GEO_BOUNDS = (() => {
  const ring = world.district.boundary;
  let minLng = Infinity;
  let maxLng = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const [lng, lat] of ring) {
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  // Guard against a degenerate ring so we can never divide by zero.
  if (!Number.isFinite(minLng) || maxLng - minLng < 1e-9) {
    return { minLng: 85.29, maxLng: 85.35, minLat: 27.65, maxLat: 27.69 };
  }
  return { minLng, maxLng, minLat, maxLat };
})();

/** Equirectangular projection of a coordinate into the lattice box. */
function project(lat: number, lng: number): Point {
  const { minLng, maxLng, minLat, maxLat } = GEO_BOUNDS;
  const u = (lng - minLng) / (maxLng - minLng);
  const v = (maxLat - lat) / (maxLat - minLat); // north is up
  return {
    x: LATTICE.x0 + clamp(u, -0.15, 1.15) * LATTICE.width,
    y: LATTICE.y0 + clamp(v, -0.15, 1.15) * LATTICE.height,
  };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function hasGeo(node: GraphNode | undefined): node is GraphNode & { lat: number; lng: number } {
  return !!node && typeof node.lat === "number" && typeof node.lng === "number";
}

/* ------------------------------------------------------------------ */
/* Column packing                                                      */
/* ------------------------------------------------------------------ */

interface Seed {
  id: string;
  y: number;
}

/**
 * Enforces a minimum gap inside a column while preserving the seed ordering,
 * then re-centres the column on the seeds' midpoint so it stays balanced.
 * Ties break on id, so the result is identical on every run.
 */
function packColumn(seeds: Seed[], gap: number): Map<string, number> {
  const out = new Map<string, number>();
  if (seeds.length === 0) return out;

  const sorted = [...seeds].sort((a, b) => a.y - b.y || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  let prev = Number.NEGATIVE_INFINITY;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const seed of sorted) {
    const y = prev === Number.NEGATIVE_INFINITY ? seed.y : Math.max(seed.y, prev + gap);
    out.set(seed.id, y);
    prev = y;
    if (y < min) min = y;
    if (y > max) max = y;
  }

  const seedMid =
    (Math.min(...sorted.map((s) => s.y)) + Math.max(...sorted.map((s) => s.y))) / 2;
  const shift = seedMid - (min + max) / 2;
  if (shift !== 0) {
    for (const [id, y] of out) out.set(id, y + shift);
  }
  return out;
}

/** Stacks `ids` symmetrically around `anchor`, ordered by id. */
function stackAround(ids: string[], anchor: number, gap: number): Map<string, number> {
  const out = new Map<string, number>();
  const sorted = [...ids].sort();
  const span = (sorted.length - 1) * gap;
  sorted.forEach((id, i) => out.set(id, anchor - span / 2 + i * gap));
  return out;
}

/* ------------------------------------------------------------------ */
/* Layout                                                              */
/* ------------------------------------------------------------------ */

function nodesOfType(index: GraphIndex, ...types: GraphNodeType[]): GraphNode[] {
  const out: GraphNode[] = [];
  for (const type of types) out.push(...(index.byType.get(type) ?? []));
  return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** First neighbour of `id` whose type is in `types`, chosen by sorted id. */
function neighborOfType(
  index: GraphIndex,
  id: string,
  types: GraphNodeType[],
): GraphNode | undefined {
  const candidates: GraphNode[] = [];
  for (const other of index.neighbors.get(id) ?? []) {
    const node = index.nodeById.get(other);
    if (node && types.includes(node.type)) candidates.push(node);
  }
  candidates.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return candidates[0];
}

/**
 * Geographic y for anything that either carries coordinates itself or sits at
 * a Location that does. Returns `null` when the graph knows no geography.
 */
function geoY(index: GraphIndex, node: GraphNode): number | null {
  if (hasGeo(node)) return project(node.lat, node.lng).y;
  const at = neighborOfType(index, node.id, ["location"]);
  if (hasGeo(at)) return project(at.lat, at.lng).y;
  return null;
}

export function computeLayout(index: GraphIndex): Map<string, Point> {
  const pos = new Map<string, Point>();
  if (index.nodes.length === 0) return pos;

  const latticeMidY = LATTICE.y0 + LATTICE.height / 2;

  /* --- 1. Families anchor everything on the left ------------------- */
  const families = nodesOfType(index, "family");
  const familySeeds: Seed[] = families.map((f, i) => ({
    id: f.id,
    y: geoY(index, f) ?? latticeMidY + (i - (families.length - 1) / 2) * GAP.family,
  }));
  const familyY = packColumn(familySeeds, GAP.family);
  for (const family of families) {
    pos.set(family.id, { x: BAND_X.family, y: familyY.get(family.id) ?? 0 });
  }

  const anchorOf = (id: string | undefined): number =>
    (id !== undefined ? familyY.get(id) : undefined) ?? latticeMidY;

  /* --- 2. People cluster on their household ------------------------ */
  const people = nodesOfType(index, "person");
  const peopleByFamily = new Map<string, string[]>();
  const familyOfPerson = new Map<string, string>();
  const orphanPeople: string[] = [];
  for (const person of people) {
    const family = neighborOfType(index, person.id, ["family"]);
    if (family) {
      familyOfPerson.set(person.id, family.id);
      const list = peopleByFamily.get(family.id);
      if (list) list.push(person.id);
      else peopleByFamily.set(family.id, [person.id]);
    } else {
      orphanPeople.push(person.id);
    }
  }
  for (const [familyId, ids] of peopleByFamily) {
    for (const [id, y] of stackAround(ids, anchorOf(familyId), GAP.person)) {
      pos.set(id, { x: BAND_X.person, y });
    }
  }
  for (const [id, y] of stackAround(orphanPeople, latticeMidY, GAP.person)) {
    pos.set(id, { x: BAND_X.person, y });
  }

  /* --- 3. Needs sit beside whoever holds them ---------------------- */
  const needs = nodesOfType(index, "need");
  const needsByFamily = new Map<string, string[]>();
  const orphanNeeds: string[] = [];
  for (const need of needs) {
    const holderFamily = neighborOfType(index, need.id, ["family"]);
    const holderPerson = neighborOfType(index, need.id, ["person"]);
    const familyId =
      holderFamily?.id ?? (holderPerson ? familyOfPerson.get(holderPerson.id) : undefined);
    if (familyId) {
      const list = needsByFamily.get(familyId);
      if (list) list.push(need.id);
      else needsByFamily.set(familyId, [need.id]);
    } else {
      orphanNeeds.push(need.id);
    }
  }
  for (const [familyId, ids] of needsByFamily) {
    for (const [id, y] of stackAround(ids, anchorOf(familyId), GAP.need)) {
      pos.set(id, { x: BAND_X.need, y });
    }
  }
  for (const [id, y] of stackAround(orphanNeeds, latticeMidY, GAP.need)) {
    pos.set(id, { x: BAND_X.need, y });
  }

  /* --- 4. Responder band: volunteers, then their vehicles ---------- */
  const volunteers = nodesOfType(index, "volunteer");
  const volunteerY = packColumn(
    volunteers.map((v) => ({
      id: v.id,
      y: geoY(index, v) ?? LATTICE.y0 + hash01(v.id) * LATTICE.height,
    })),
    GAP.volunteer,
  );
  for (const volunteer of volunteers) {
    pos.set(volunteer.id, { x: BAND_X.volunteer, y: volunteerY.get(volunteer.id) ?? 0 });
  }

  const vehicles = nodesOfType(index, "vehicle");
  const vehicleY = packColumn(
    vehicles.map((vehicle) => {
      const driver = neighborOfType(index, vehicle.id, ["volunteer"]);
      const y =
        (driver ? volunteerY.get(driver.id) : undefined) ??
        LATTICE.y0 + hash01(vehicle.id) * LATTICE.height;
      return { id: vehicle.id, y };
    }),
    GAP.vehicle,
  );
  for (const vehicle of vehicles) {
    pos.set(vehicle.id, { x: BAND_X.vehicle, y: vehicleY.get(vehicle.id) ?? 0 });
  }

  /* --- 5. The physical lattice: Locations first, Segments between -- */
  const locations = nodesOfType(index, "location");
  for (const location of locations) {
    if (hasGeo(location)) {
      pos.set(location.id, project(location.lat, location.lng));
    } else {
      pos.set(location.id, {
        x: LATTICE.x0 + hash01(`${location.id}x`) * LATTICE.width,
        y: LATTICE.y0 + hash01(`${location.id}y`) * LATTICE.height,
      });
    }
  }
  // Two Locations 300m apart (a relief centre and its health post) project to
  // almost the same point at this scale. Nudge them apart, but tether each one
  // to within LOCATION_MAX_DRIFT of its true projection so the lattice still
  // reads as the district.
  relaxLocations(locations, pos);

  const segments = nodesOfType(index, "road", "bridge");
  for (const segment of segments) {
    let base: Point | null = null;
    if (hasGeo(segment)) {
      base = project(segment.lat, segment.lng);
    } else {
      // A Segment node is wired to its two end Locations by [:CONNECTS];
      // drawing it at their midpoint is what makes the lattice read as a map.
      const ends: Point[] = [];
      for (const other of index.neighbors.get(segment.id) ?? []) {
        const node = index.nodeById.get(other);
        if (node?.type === "location") {
          const p = pos.get(other);
          if (p) ends.push(p);
        }
      }
      ends.sort((a, b) => a.x - b.x || a.y - b.y);
      if (ends.length >= 2) {
        const midX = (ends[0].x + ends[1].x) / 2;
        const midY = (ends[0].y + ends[1].y) / 2;
        // Offset PERPENDICULAR to the road itself rather than sitting exactly
        // on the line between its two Locations: a third Location often lies
        // on that line, and the node would land straight on top of it. The
        // side is picked from the id hash, so it never changes between runs.
        const vx = ends[1].x - ends[0].x;
        const vy = ends[1].y - ends[0].y;
        const length = Math.hypot(vx, vy) || 1;
        const side = hash01(`${segment.id}side`) < 0.5 ? -1 : 1;
        const offset = SEGMENT_PERPENDICULAR_OFFSET * side;
        base = {
          x: midX + (-vy / length) * offset,
          y: midY + (vx / length) * offset,
        };
      } else if (ends.length === 1) {
        base = { x: ends[0].x + 24, y: ends[0].y + 20 };
      }
    }
    if (!base) {
      base = {
        x: LATTICE.x0 + hash01(`${segment.id}x`) * LATTICE.width,
        y: LATTICE.y0 + hash01(`${segment.id}y`) * LATTICE.height,
      };
    }
    // Seeded nudge so two segments between the same pair never fully overlap.
    pos.set(segment.id, {
      x: base.x + (hash01(`${segment.id}jx`) - 0.5) * 10,
      y: base.y + (hash01(`${segment.id}jy`) - 0.5) * 10,
    });
  }

  // A Segment drawn on top of an unrelated Location makes the lattice
  // unreadable. Locations hold their geographic truth; Segments are the ones
  // that move. Sorted iteration + a hashed fallback angle keep it reproducible.
  relaxSegments(segments, locations, pos);

  /* --- 6. Destination columns ------------------------------------- */
  const shelters = nodesOfType(index, "shelter");
  const shelterY = packColumn(
    shelters.map((s) => ({ id: s.id, y: geoY(index, s) ?? LATTICE.y0 + hash01(s.id) * LATTICE.height })),
    GAP.destination,
  );
  for (const shelter of shelters) {
    pos.set(shelter.id, { x: BAND_X.destination, y: shelterY.get(shelter.id) ?? 0 });
  }

  const careSites = nodesOfType(index, "clinic", "hospital");
  const careY = packColumn(
    careSites.map((c) => ({ id: c.id, y: geoY(index, c) ?? LATTICE.y0 + hash01(c.id) * LATTICE.height })),
    GAP.care,
  );
  for (const care of careSites) {
    pos.set(care.id, { x: BAND_X.care, y: careY.get(care.id) ?? 0 });
  }

  /* --- 7. Resources hang off whoever holds them -------------------- */
  const resources = nodesOfType(index, "resource");
  const resourceY = packColumn(
    resources.map((resource) => {
      const holder = neighborOfType(index, resource.id, ["shelter", "clinic", "hospital"]);
      const y =
        (holder ? (shelterY.get(holder.id) ?? careY.get(holder.id)) : undefined) ??
        LATTICE.y0 + hash01(resource.id) * LATTICE.height;
      return { id: resource.id, y };
    }),
    GAP.resource,
  );
  for (const resource of resources) {
    pos.set(resource.id, { x: BAND_X.resource, y: resourceY.get(resource.id) ?? 0 });
  }

  /* --- 8. Threats float above the lattice they act on -------------- */
  const hazards = nodesOfType(index, "hazard");
  const hazardSeeds: Seed[] = hazards.map((hazard) => {
    if (hasGeo(hazard)) return { id: hazard.id, y: project(hazard.lat, hazard.lng).y - HAZARD_LIFT };
    // Otherwise sit above the mean of whatever it blocks.
    const targets: number[] = [];
    for (const other of index.neighbors.get(hazard.id) ?? []) {
      const p = pos.get(other);
      if (p) targets.push(p.y);
    }
    const mid = targets.length
      ? targets.reduce((a, b) => a + b, 0) / targets.length
      : LATTICE.y0 + hash01(hazard.id) * LATTICE.height;
    return { id: hazard.id, y: mid - HAZARD_LIFT };
  });
  const hazardY = packColumn(hazardSeeds, GAP.hazard);
  for (const hazard of hazards) {
    let x: number;
    if (hasGeo(hazard)) {
      x = project(hazard.lat, hazard.lng).x;
    } else {
      const xs: number[] = [];
      for (const other of index.neighbors.get(hazard.id) ?? []) {
        const p = pos.get(other);
        if (p) xs.push(p.x);
      }
      x = xs.length
        ? xs.reduce((a, b) => a + b, 0) / xs.length
        : LATTICE.x0 + hash01(`${hazard.id}hx`) * LATTICE.width;
    }
    pos.set(hazard.id, { x, y: hazardY.get(hazard.id) ?? LATTICE.y0 - HAZARD_LIFT });
  }

  const alerts = nodesOfType(index, "alert");
  alerts.forEach((alert, i) => {
    const related = neighborOfType(index, alert.id, ["hazard", "road", "bridge", "location"]);
    const relatedPos = related ? pos.get(related.id) : undefined;
    pos.set(alert.id, {
      x: relatedPos?.x ?? LATTICE.x0 + ((i + 0.5) / Math.max(1, alerts.length)) * LATTICE.width,
      y: ALERT_ROW_Y - (i % 2) * GAP.alert,
    });
  });

  /* --- 9. Plan nodes sit at the far left, beside their family ------ */
  const plans = nodesOfType(index, "plan");
  const planY = packColumn(
    plans.map((plan) => {
      const family = neighborOfType(index, plan.id, ["family"]);
      return { id: plan.id, y: anchorOf(family?.id) - 96 };
    }),
    GAP.volunteer,
  );
  for (const plan of plans) {
    pos.set(plan.id, { x: BAND_X.plan, y: planY.get(plan.id) ?? latticeMidY });
  }

  /* --- 10. Anything the vocabulary grew since this file was written - */
  for (const node of index.nodes) {
    if (pos.has(node.id)) continue;
    pos.set(
      node.id,
      hasGeo(node)
        ? project(node.lat, node.lng)
        : {
            x: LATTICE.x0 + hash01(`${node.id}fx`) * LATTICE.width,
            y: LATTICE.y0 + LATTICE.height + 120 + hash01(`${node.id}fy`) * 80,
          },
    );
  }

  return pos;
}

/**
 * Separates Locations that project onto nearly the same point, while tethering
 * each to its true position so the lattice keeps mirroring the district.
 */
function relaxLocations(locations: GraphNode[], pos: Map<string, Point>): void {
  const anchors = new Map<string, Point>();
  const points: { id: string; point: Point }[] = [];
  for (const location of locations) {
    const point = pos.get(location.id);
    if (!point) continue;
    anchors.set(location.id, { x: point.x, y: point.y });
    points.push({ id: location.id, point });
  }
  if (points.length < 2) return;

  for (let pass = 0; pass < 6; pass++) {
    let settled = true;

    for (const { id, point } of points) {
      let dx = 0;
      let dy = 0;
      for (const other of points) {
        if (other.id === id) continue;
        const ox = point.x - other.point.x;
        const oy = point.y - other.point.y;
        const distance = Math.hypot(ox, oy);
        if (distance >= LOCATION_MIN_SEPARATION) continue;
        settled = false;
        if (distance < 1e-6) {
          const angle = hash01(`${id}sep`) * Math.PI * 2;
          dx += Math.cos(angle) * LOCATION_MIN_SEPARATION * 0.5;
          dy += Math.sin(angle) * LOCATION_MIN_SEPARATION * 0.5;
          continue;
        }
        const push = ((LOCATION_MIN_SEPARATION - distance) / distance) * 0.5;
        dx += ox * push;
        dy += oy * push;
      }

      const anchor = anchors.get(id);
      if (!anchor) continue;
      let nx = point.x + dx;
      let ny = point.y + dy;
      // Tether: never drift further than LOCATION_MAX_DRIFT from the truth.
      const driftX = nx - anchor.x;
      const driftY = ny - anchor.y;
      const drift = Math.hypot(driftX, driftY);
      if (drift > LOCATION_MAX_DRIFT) {
        const scale = LOCATION_MAX_DRIFT / drift;
        nx = anchor.x + driftX * scale;
        ny = anchor.y + driftY * scale;
      }
      point.x = nx;
      point.y = ny;
    }

    if (settled) break;
  }
}

/**
 * Pushes Segment nodes off anything they landed on top of.
 *
 * Locations keep their geographic truth — only Segments move. Each pass sums
 * the repulsion from every overlapping neighbour before applying it, which
 * settles a segment squeezed between two Locations instead of ping-ponging it
 * between them. Fixed iteration order and a seeded angle for exact
 * coincidences keep the result byte-identical on every run.
 */
function relaxSegments(
  segments: GraphNode[],
  locations: GraphNode[],
  pos: Map<string, Point>,
): void {
  const fixed = locations
    .map((location) => pos.get(location.id))
    .filter((point): point is Point => !!point);
  const moving = segments
    .map((segment) => ({ id: segment.id, point: pos.get(segment.id) }))
    .filter((entry): entry is { id: string; point: Point } => !!entry.point);
  if (moving.length === 0) return;

  for (let pass = 0; pass < 30; pass++) {
    let settled = true;

    for (const { id, point } of moving) {
      let dx = 0;
      let dy = 0;

      const repel = (other: Point, minimum: number) => {
        const ox = point.x - other.x;
        const oy = point.y - other.y;
        const distance = Math.hypot(ox, oy);
        if (distance >= minimum) return;
        settled = false;
        if (distance < 1e-6) {
          const angle = hash01(`${id}angle${Math.round(other.x)}`) * Math.PI * 2;
          dx += Math.cos(angle) * minimum;
          dy += Math.sin(angle) * minimum;
          return;
        }
        const push = (minimum - distance) / distance;
        dx += ox * push;
        dy += oy * push;
      };

      for (const other of fixed) repel(other, LATTICE_MIN_SEPARATION);
      for (const other of moving) {
        if (other.id !== id) repel(other.point, SEGMENT_MIN_SEPARATION);
      }

      // Damped: undamped summed pushes oscillate for a node wedged between
      // three neighbours instead of settling.
      point.x += dx * RELAX_DAMPING;
      point.y += dy * RELAX_DAMPING;
    }

    if (settled) break;
  }
}

/** Exported for the legend + tests: the band a type is drawn in. */
export const LAYOUT_BANDS = BAND_X;
export const LAYOUT_LATTICE = LATTICE;
