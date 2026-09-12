import { describe, expect, it } from "vitest";
import { world } from "@/lib/world/world";
import { WEIGHTS } from "@/lib/neo4j/queries/recommend";

/**
 * =========================================================================
 * LIFELINE — TOPOLOGY + SCORING INVARIANTS (NO DATABASE)
 * =========================================================================
 * `src/lib/world/world.ts` is the single source of truth for BOTH the Neo4j
 * seed and the map geometry. If a reference in it dangles, the seed silently
 * drops a relationship (every seed statement is `MATCH ... MERGE`), the graph
 * quietly loses an edge, and the demo's outcome changes for a reason nobody
 * can see.
 *
 * Everything here is pure: `world.ts` imports only types, so these tests need
 * no Neo4j, no network and no credentials. They are the fast guard that runs
 * before anything is written to a database.
 * =========================================================================
 */

const locationIds = new Set(world.locations.map((l) => l.id));
const segmentIds = new Set(world.segments.map((s) => s.id));
const shelterIds = new Set(world.shelters.map((s) => s.id));
const careSiteIds = new Set(world.careSites.map((c) => c.id));
const vehicleIds = new Set(world.vehicles.map((v) => v.id));
const needIds = new Set(world.needs.map((n) => n.id));
const needKinds = new Set(world.needs.map((n) => n.kind));

/* ------------------------------------------------------------------ */
/* Identity                                                            */
/* ------------------------------------------------------------------ */

describe("identity", () => {
  it("has no duplicate ids inside any collection", () => {
    const collections: [string, { id: string }[]][] = [
      ["locations", world.locations],
      ["segments", world.segments],
      ["shelters", world.shelters],
      ["careSites", world.careSites],
      ["resources", world.resources],
      ["vehicles", world.vehicles],
      ["volunteers", world.volunteers],
      ["needs", world.needs],
      ["families", world.families],
      ["hazards", world.hazards],
    ];
    for (const [name, rows] of collections) {
      const ids = rows.map((r) => r.id);
      expect(new Set(ids).size, `${name} contains a duplicate id`).toBe(ids.length);
    }
  });

  it("has globally unique ids, because Neo4j MATCHes several labels by id alone", () => {
    // e.g. the resource seed does `MATCH (holder) WHERE holder.id = row.holderId`.
    const all = [
      ...world.locations, ...world.segments, ...world.shelters, ...world.careSites,
      ...world.resources, ...world.vehicles, ...world.volunteers, ...world.needs,
      ...world.families, ...world.families.flatMap((f) => f.members), ...world.hazards,
    ].map((x) => x.id);
    const seen = new Set<string>();
    const clashes = all.filter((id) => (seen.has(id) ? true : (seen.add(id), false)));
    expect(clashes).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* Referential integrity                                               */
/* ------------------------------------------------------------------ */

describe("referential integrity", () => {
  it("every segment connects two real, distinct locations", () => {
    for (const segment of world.segments) {
      expect(locationIds.has(segment.from), `${segment.id}.from -> ${segment.from}`).toBe(true);
      expect(locationIds.has(segment.to), `${segment.id}.to -> ${segment.to}`).toBe(true);
      expect(segment.from, `${segment.id} is a self-loop`).not.toBe(segment.to);
    }
  });

  it("every shelter, care site and volunteer stands at a real location", () => {
    for (const shelter of world.shelters) {
      expect(locationIds.has(shelter.locationId), `${shelter.id} -> ${shelter.locationId}`).toBe(true);
    }
    for (const site of world.careSites) {
      expect(locationIds.has(site.locationId), `${site.id} -> ${site.locationId}`).toBe(true);
    }
    for (const volunteer of world.volunteers) {
      expect(locationIds.has(volunteer.locationId), `${volunteer.id} -> ${volunteer.locationId}`).toBe(true);
    }
    for (const family of world.families) {
      expect(locationIds.has(family.locationId), `${family.id} -> ${family.locationId}`).toBe(true);
    }
  });

  it("every resource is held by a real shelter or care site", () => {
    for (const resource of world.resources) {
      const resolved = shelterIds.has(resource.holderId) || careSiteIds.has(resource.holderId);
      expect(resolved, `${resource.id}.holderId -> ${resource.holderId} resolves to nothing`).toBe(true);
    }
  });

  it("resolves every need kind the demo families actually depend on", () => {
    const demanded = new Set(
      world.families.flatMap((f) => [
        ...f.needIds,
        ...f.members.flatMap((m) => m.needIds),
      ]),
    );
    for (const id of demanded) {
      const need = world.needs.find((n) => n.id === id)!;
      expect(need, id).toBeDefined();
      // Shelter and transport are satisfied by the destination and the
      // responder; every OTHER demanded need must be stocked somewhere.
      if (need.kind === "shelter" || need.kind === "transportation") continue;
      const suppliers = world.resources.filter((r) => r.satisfies.includes(need.kind));
      expect(suppliers.length, `nothing in the world satisfies ${need.kind}`).toBeGreaterThan(0);
      for (const supplier of suppliers) {
        expect(needKinds.has(need.kind), `${supplier.id} -> ${need.kind}`).toBe(true);
      }
    }
  });

  /**
   * Every kind a Resource claims to satisfy must have a matching (:Need) node,
   * because the seed writes SATISFIES with
   * `MATCH (r:Resource {id: row.id}), (n:Need {kind: needKind})`. A kind with no
   * Need node matches nothing and the edge is SILENTLY skipped — no error, just
   * a resource that can never be matched to the household that needs it.
   * This regression was real: `insulin` and `oxygen` were orphaned exactly this
   * way until `need_insulin` / `need_oxygen` were added to the world.
   */
  it("every resource kind has a Need node, so no SATISFIES edge is silently dropped", () => {
    const orphanKinds = [
      ...new Set(
        world.resources.flatMap((r) => r.satisfies).filter((kind) => !needKinds.has(kind)),
      ),
    ].sort();
    expect(orphanKinds).toEqual([]);
  });

  it("every volunteer drives a real vehicle and assists a real need kind", () => {
    for (const volunteer of world.volunteers) {
      expect(vehicleIds.has(volunteer.vehicleId), `${volunteer.id} -> ${volunteer.vehicleId}`).toBe(true);
      for (const kind of volunteer.canAssist) {
        expect(needKinds.has(kind), `${volunteer.id} canAssist unknown "${kind}"`).toBe(true);
      }
    }
    for (const vehicle of world.vehicles) {
      for (const kind of vehicle.supportsNeeds) {
        expect(needKinds.has(kind), `${vehicle.id} supportsNeeds unknown "${kind}"`).toBe(true);
      }
    }
  });

  it("every need referenced by a family or a person exists", () => {
    for (const family of world.families) {
      for (const id of family.needIds) {
        expect(needIds.has(id), `${family.id} -> ${id}`).toBe(true);
      }
      for (const member of family.members) {
        for (const id of member.needIds) {
          expect(needIds.has(id), `${member.id} -> ${id}`).toBe(true);
        }
      }
      expect(family.members.length, `${family.id}.size disagrees with its member list`).toBe(family.size);
    }
  });

  it("every hazard blocks real segments and affects real locations", () => {
    for (const hazard of world.hazards) {
      for (const segmentId of hazard.blocks) {
        expect(segmentIds.has(segmentId), `${hazard.id} blocks unknown segment ${segmentId}`).toBe(true);
      }
      for (const locationId of hazard.affects) {
        expect(locationIds.has(locationId), `${hazard.id} affects unknown location ${locationId}`).toBe(true);
      }
      // A closed polygon ring, so the map can fill the footprint.
      expect(hazard.footprint.length, `${hazard.id} footprint is not a ring`).toBeGreaterThanOrEqual(4);
      expect(hazard.footprint[0]).toEqual(hazard.footprint[hazard.footprint.length - 1]);
    }
  });

  it("every NEAR proximity link joins two real, distinct locations", () => {
    for (const link of world.near) {
      expect(locationIds.has(link.from), `near.from -> ${link.from}`).toBe(true);
      expect(locationIds.has(link.to), `near.to -> ${link.to}`).toBe(true);
      expect(link.from).not.toBe(link.to);
      expect(link.meters).toBeGreaterThan(0);
    }
  });
});

/* ------------------------------------------------------------------ */
/* Connectivity                                                        */
/* ------------------------------------------------------------------ */

describe("network connectivity", () => {
  /** Undirected adjacency over the physical network, ignoring hazard state. */
  function adjacency(segments = world.segments) {
    const graph = new Map<string, Set<string>>();
    for (const id of locationIds) graph.set(id, new Set());
    for (const segment of segments) {
      graph.get(segment.from)?.add(segment.to);
      graph.get(segment.to)?.add(segment.from);
    }
    return graph;
  }

  function reachableFrom(start: string, graph: Map<string, Set<string>>) {
    const seen = new Set([start]);
    const queue = [start];
    while (queue.length > 0) {
      for (const next of graph.get(queue.shift()!) ?? []) {
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    return seen;
  }

  it("is one connected component — no location is stranded", () => {
    const graph = adjacency();
    const start = world.locations[0].id;
    const reached = reachableFrom(start, graph);
    const stranded = [...locationIds].filter((id) => !reached.has(id));
    expect(stranded, `unreachable from ${start}`).toEqual([]);
    expect(reached.size).toBe(locationIds.size);
  });

  it("has no orphan location — every location carries at least one segment", () => {
    const graph = adjacency();
    for (const [id, neighbours] of graph) {
      expect(neighbours.size, `${id} has no segments attached`).toBeGreaterThan(0);
    }
  });

  it("still connects the family to a step-free shelter with every hazard active", () => {
    // The worst case the demo can reach: every hazard in the world firing at
    // once. A step-free, vehicle-usable route must survive, or the scenario
    // controls could strand the family with no possible answer.
    const blocked = new Set(world.hazards.flatMap((h) => h.blocks));
    const usable = world.segments.filter((s) => !blocked.has(s.id) && s.accessibility === "full");
    const reached = reachableFrom("loc_ward3_home", adjacency(usable));

    const reachableShelters = world.shelters.filter(
      (s) => s.wheelchairAccessible && reached.has(s.locationId),
    );
    expect(reachableShelters.length).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------------ */
/* The accessibility traps the demo depends on                          */
/* ------------------------------------------------------------------ */

describe("accessibility traps", () => {
  it("keeps at least one foot_only segment — the link a van can never use", () => {
    const footOnly = world.segments.filter((s) => s.accessibility === "foot_only");
    expect(footOnly.length).toBeGreaterThan(0);
    // Documented in world.ts as "the accessibility trap".
    expect(footOnly.map((s) => s.id)).toContain("seg_khola_footbridge");
  });

  it("keeps at least one shelter that is NOT wheelchair accessible", () => {
    const notStepFree = world.shelters.filter((s) => !s.wheelchairAccessible);
    expect(notStepFree.length).toBeGreaterThan(0);
    expect(notStepFree.map((s) => s.id)).toContain("shelter_thapa_ground");
  });

  it("keeps a shelter that is already at capacity at baseline", () => {
    const full = world.shelters.filter((s) => s.occupancy >= s.capacity);
    expect(full.map((s) => s.id)).toContain("shelter_market_hall");
  });

  it("gives the Sharma family the constraints the whole demo turns on", () => {
    const family = world.families.find((f) => f.id === "family_sharma")!;
    expect(family.hasVehicle).toBe(false); // => requireTransport
    const memberNeeds = family.members.flatMap((m) => m.needIds);
    expect(memberNeeds).toContain("need_mobility"); // => requireStepFree
    expect(memberNeeds).toContain("need_asthma"); // => medical resource matching
  });

  it("stages an accessible responder that is deliberately out of zone", () => {
    // The "missing link" answer when nobody else can reach the family.
    const sunita = world.volunteers.find((v) => v.id === "vol_sunita")!;
    expect(sunita.status).toBe("out_of_zone");
    expect(sunita.distanceOutsideZoneKm).toBeGreaterThan(0);
    const vehicle = world.vehicles.find((v) => v.id === sunita.vehicleId)!;
    expect(vehicle.wheelchairAccessible).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Value ranges + scoring weights                                      */
/* ------------------------------------------------------------------ */

describe("value ranges", () => {
  it("keeps every risk and safety score inside 0..1 and travel times positive", () => {
    for (const segment of world.segments) {
      expect(segment.floodRisk, segment.id).toBeGreaterThanOrEqual(0);
      expect(segment.floodRisk, segment.id).toBeLessThanOrEqual(1);
      expect(segment.travelMinutes, segment.id).toBeGreaterThan(0);
    }
    for (const location of world.locations) {
      expect(location.safetyScore, location.id).toBeGreaterThanOrEqual(0);
      expect(location.safetyScore, location.id).toBeLessThanOrEqual(1);
    }
    for (const hazard of world.hazards) {
      expect(hazard.severity, hazard.id).toBeGreaterThanOrEqual(0);
      expect(hazard.severity, hazard.id).toBeLessThanOrEqual(1);
    }
  });

  it("keeps shelter occupancy within capacity", () => {
    for (const shelter of world.shelters) {
      expect(shelter.occupancy, shelter.id).toBeGreaterThanOrEqual(0);
      expect(shelter.occupancy, shelter.id).toBeLessThanOrEqual(shelter.capacity);
      expect(shelter.status === "full", `${shelter.id}.status disagrees with its occupancy`)
        .toBe(shelter.occupancy >= shelter.capacity);
    }
  });
});

describe("scoring weights", () => {
  it("pins the published weights, so README and Cypher cannot drift apart", () => {
    expect(WEIGHTS).toEqual({
      wTime: 1.0,
      wPickup: 0.6,
      wRiskSum: 12.0,
      wMaxRisk: 10.0,
      wHazardNode: 30.0,
      wHeadroom: -0.25,
      headroomCap: 60,
      wClinicPer100m: 1.2,
      wNoClinic: 60.0,
      maxHops: 12,
    });
  });

  it("is a cost function: only destination capacity may reduce the score", () => {
    // Lower is safer. Every other term must penalise, or "safest" stops meaning
    // anything.
    expect(WEIGHTS.wHeadroom).toBeLessThan(0);
    for (const key of ["wTime", "wPickup", "wRiskSum", "wMaxRisk", "wHazardNode", "wClinicPer100m", "wNoClinic"] as const) {
      expect(WEIGHTS[key], `${key} must be a penalty`).toBeGreaterThan(0);
    }
    // Crossing an active hazard footprint must outweigh any plausible time saving.
    const longestRoute = world.segments.reduce((sum, s) => sum + s.travelMinutes, 0);
    expect(WEIGHTS.wHazardNode).toBeGreaterThan(WEIGHTS.wTime * 20);
    expect(WEIGHTS.maxHops * 2).toBeLessThan(longestRoute);
  });
});
