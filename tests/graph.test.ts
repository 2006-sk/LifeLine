import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDriver } from "@/lib/neo4j/client";
import { resetToBaseline } from "@/lib/neo4j/seed";
import { recommendForFamily } from "@/lib/service/recommendation";
import { activateHazard, fillShelter, setVolunteerStatus } from "@/lib/service/scenario";
import {
  DEMO_FAMILY_ID,
  DEMO_FLOOD_HAZARD_ID,
  DEMO_PRIMARY_SHELTER_ID,
  DEMO_PRIMARY_VOLUNTEER_ID,
  hazardById,
} from "@/lib/world/world";
import type { PlanCandidate, RecommendationResponse } from "@/lib/types";

/**
 * =========================================================================
 * LIFELINE — INTEGRATION TESTS AGAINST THE LIVE NEO4J AURA GRAPH
 * =========================================================================
 * These are NOT unit tests with a stubbed database. Every assertion below is
 * a claim about what Neo4j returns when the seeded district is traversed, so
 * a regression in the Cypher, the schema or the seed fails here.
 *
 * Determinism comes from `resetToBaseline()` in `beforeEach`: every test
 * begins from the exact seeded state, mutates the graph through the SAME
 * service functions the API routes call, and asserts on the result. The suite
 * is therefore safe to run repeatedly, in any order, against a shared
 * instance.
 *
 * Requires: .env.local with NEO4J_* credentials, `npm run seed` already run.
 * =========================================================================
 */

const FAMILY = DEMO_FAMILY_ID; // family_sharma
const FLOOD = DEMO_FLOOD_HAZARD_ID; // hz_riverside_flood

/** The three segments hz_riverside_flood severs. Read from the world, not typed twice. */
const RIVERSIDE_CORRIDOR = ["seg_chowk_bend", "seg_riverside_road", "seg_depot_chowk_link"];

const BASELINE = {
  destinationId: DEMO_PRIMARY_SHELTER_ID, // shelter_patan_relief
  destinationName: "Patan Community Relief Center",
  volunteerId: DEMO_PRIMARY_VOLUNTEER_ID, // vol_maya
  volunteerStagedAt: "loc_ward4_depot",
  score: 38.7,
} as const;

const AFTER_FLOOD = {
  destinationName: "Hillcrest School Relief Point",
  volunteerId: "vol_arun",
  volunteerStagedAt: "loc_south_transit_yard",
} as const;

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Best + every alternative, so "never appears" really means never. */
function allPlans(result: RecommendationResponse): PlanCandidate[] {
  return result.best ? [result.best, ...result.alternatives] : [...result.alternatives];
}

/** Every segment a plan relies on: the family's route AND the responder's pickup leg. */
function segmentsUsed(plan: PlanCandidate): string[] {
  const fromRoute = plan.route.steps.map((s) => s.viaSegmentId);
  const fromPickup = plan.transport.pickupSteps.map((s) => s.viaSegmentId);
  return [...fromRoute, ...fromPickup].filter((id): id is string => Boolean(id));
}

/** The segment ids the map and the graph view actually draw for this plan. */
function segmentsRendered(plan: PlanCandidate): string[] {
  return plan.route.nodes.filter((n) => n.type === "road" || n.type === "bridge").map((n) => n.id);
}

function recommend() {
  // persist:false mirrors GET /api/recommendation/[familyId]; the tests assert
  // on the traversal result, not on (:Plan) bookkeeping.
  return recommendForFamily(FAMILY, { persist: false });
}

/* ------------------------------------------------------------------ */

beforeEach(async () => {
  // Deterministic starting point for EVERY test. Reset is itself a graph
  // operation (see resetToBaseline in src/lib/neo4j/seed.ts).
  await resetToBaseline();
}, 30_000);

afterAll(async () => {
  // Leave the shared Aura instance demo-ready, then release the driver.
  await resetToBaseline();
  await closeDriver();
}, 30_000);

/* ================================================================== */
/* 1. A blocked road never appears in a returned safe route            */
/* ================================================================== */

describe("blocked roads", () => {
  it("never returns a route that uses a segment blocked by an active hazard", async () => {
    // Guard: the corridor under test is the one the hazard actually blocks.
    expect(hazardById.get(FLOOD)?.blocks.slice().sort()).toEqual([...RIVERSIDE_CORRIDOR].sort());

    const before = await recommend();
    const usedBefore = allPlans(before).flatMap(segmentsUsed);
    // Sanity: at baseline the corridor IS in play, so its absence later means something.
    expect(usedBefore).toContain("seg_riverside_road");

    await activateHazard(FLOOD);
    const after = await recommend();

    expect(after.status).toBe("success");
    expect(after.best).not.toBeNull();

    for (const plan of allPlans(after)) {
      const used = segmentsUsed(plan);
      const rendered = segmentsRendered(plan);
      for (const blocked of RIVERSIDE_CORRIDOR) {
        expect(used, `plan to ${plan.destination.name} traverses blocked ${blocked}`).not.toContain(blocked);
        expect(rendered, `plan to ${plan.destination.name} renders blocked ${blocked}`).not.toContain(blocked);
      }
    }
  });

  it("keeps the baseline-blocked segments out of every plan too", async () => {
    // hz_ward3_flood and hz_bagmati_scour are active in the seed itself.
    const result = await recommend();
    for (const plan of allPlans(result)) {
      expect(segmentsUsed(plan)).not.toContain("seg_ward3_riverwalk");
      expect(segmentsUsed(plan)).not.toContain("seg_bagmati_crossing");
    }
  });
});

/* ================================================================== */
/* 2. An inaccessible shelter is rejected for a mobility-constrained    */
/*    family                                                           */
/* ================================================================== */

describe("accessibility", () => {
  it("never routes the Sharma family to the shelter without step-free access", async () => {
    const result = await recommend();

    const rejection = result.rejected.find((r) => r.destinationId === "shelter_thapa_ground");
    expect(rejection, "shelter_thapa_ground must be explicitly rejected").toBeDefined();
    expect(rejection?.reasonCode).toBe("not_step_free");

    expect(result.best?.destination.id).not.toBe("shelter_thapa_ground");
    for (const plan of allPlans(result)) {
      expect(plan.destination.id).not.toBe("shelter_thapa_ground");
      // Anything the family is sent to must itself be step-free.
      expect(plan.destination.wheelchairAccessible).toBe(true);
      // ...and so must the vehicle, because Kamala uses a wheelchair.
      expect(plan.transport.wheelchairAccessible).toBe(true);
    }
  });

  it("never uses the foot-only footbridge when the family must be driven", async () => {
    const result = await recommend();
    for (const plan of allPlans(result)) {
      expect(segmentsUsed(plan)).not.toContain("seg_khola_footbridge");
    }
  });
});

/* ================================================================== */
/* 3. A shelter at capacity is rejected                                */
/* ================================================================== */

describe("capacity", () => {
  it("rejects the shelter that is already full at baseline", async () => {
    const result = await recommend();

    const rejection = result.rejected.find((r) => r.destinationId === "shelter_market_hall");
    expect(rejection, "shelter_market_hall is 60/60 in the seed").toBeDefined();
    expect(rejection?.reasonCode).toBe("at_capacity");
    expect(rejection?.detail).toContain("60/60");

    expect(allPlans(result).map((p) => p.destination.id)).not.toContain("shelter_market_hall");
  });

  it("stops recommending Patan Relief Center once it fills up", async () => {
    const before = await recommend();
    expect(before.best?.destination.id).toBe(BASELINE.destinationId);

    await fillShelter(BASELINE.destinationId);
    const after = await recommend();

    expect(after.status).toBe("success");
    expect(after.best?.destination.id).not.toBe(BASELINE.destinationId);
    expect(allPlans(after).map((p) => p.destination.id)).not.toContain(BASELINE.destinationId);

    const rejection = after.rejected.find((r) => r.destinationId === BASELINE.destinationId);
    expect(rejection?.reasonCode).toBe("at_capacity");

    // The graph still has an answer — that is the point.
    expect(after.best?.destination.name).toBe(AFTER_FLOOD.destinationName);
  });
});

/* ================================================================== */
/* 4. Removing the recommended road triggers a DIFFERENT viable route  */
/* ================================================================== */

describe("alternative discovery", () => {
  it("finds a different destination when the recommended corridor floods", async () => {
    const before = await recommend();
    expect(before.best?.destination.name).toBe(BASELINE.destinationName);

    await activateHazard(FLOOD);
    const after = await recommend();

    expect(after.status).toBe("success");
    expect(after.best?.destination.name).toBe(AFTER_FLOOD.destinationName);
    expect(after.best?.destination.name).not.toBe(before.best?.destination.name);
    // A genuinely different walk, not the same road list re-scored.
    expect(segmentsUsed(after.best!)).not.toEqual(segmentsUsed(before.best!));
  });
});

/* ================================================================== */
/* 4b. SECOND-ORDER EFFECT: the responder changes too, because Maya's   */
/*     depot is severed from the family by the same flood               */
/* ================================================================== */

describe("second-order effects", () => {
  it("changes BOTH the destination and the responder when the flood cuts off Maya's depot", async () => {
    const before = await recommend();
    expect(before.best?.destination.name).toBe(BASELINE.destinationName);
    expect(before.best?.transport.volunteerId).toBe(BASELINE.volunteerId);
    expect(before.best?.transport.stagedAtId).toBe(BASELINE.volunteerStagedAt);

    await activateHazard(FLOOD);
    const after = await recommend();

    // The road half of the plan changed...
    expect(after.best?.destination.name).not.toBe(before.best?.destination.name);
    expect(after.best?.destination.name).toBe(AFTER_FLOOD.destinationName);

    // ...and so did the transport half, without anyone marking Maya unavailable.
    expect(after.best?.transport.volunteerId).not.toBe(before.best?.transport.volunteerId);
    expect(after.best?.transport.volunteerId).toBe(AFTER_FLOOD.volunteerId);
    // Arun is staged at the South Transit Yard, on the far side of the flood.
    expect(after.best?.transport.stagedAtId).toBe(AFTER_FLOOD.volunteerStagedAt);

    // Maya is still "available" in the graph — she is simply unreachable now.
    expect(allPlans(after).map((p) => p.transport.volunteerId)).not.toContain(BASELINE.volunteerId);
    // The depot access road is exactly what was severed.
    expect(hazardById.get(FLOOD)?.blocks).toContain("seg_depot_chowk_link");
  });
});

/* ================================================================== */
/* 5. An unavailable volunteer is never used                           */
/* ================================================================== */

describe("responder availability", () => {
  it("never assigns a volunteer who has been stood down", async () => {
    await setVolunteerStatus(BASELINE.volunteerId, "unavailable");
    const result = await recommend();

    expect(result.status).toBe("success");
    expect(result.best?.transport.volunteerId).not.toBe(BASELINE.volunteerId);
    expect(result.best?.transport.volunteerId).toBe("vol_arun");
    for (const plan of allPlans(result)) {
      expect(plan.transport.volunteerId).not.toBe(BASELINE.volunteerId);
    }
    // The destination is unchanged: only the transport half of the plan moved.
    expect(result.best?.destination.name).toBe(BASELINE.destinationName);
  });
});

/* ================================================================== */
/* 6. A required medical resource is satisfied                         */
/* ================================================================== */

describe("medical needs", () => {
  it("matches Nirajan's asthma medication through NEAR -> CareSite -> Resource -> SATISFIES", async () => {
    const result = await recommend();

    const careSite = result.best?.careSite;
    expect(careSite, "the winning plan must reach a care site").not.toBeNull();
    expect(careSite?.resources.map((r) => r.type)).toContain("asthma_medication");
    expect(careSite?.resources.some((r) => r.quantity > 0)).toBe(true);
    expect(careSite?.meters).toBeGreaterThan(0);

    // The need is reported as met, and the score records the distance term.
    expect(result.best?.needsMet).toContain("need_asthma");
    expect(result.best?.needsUnmet).not.toContain("need_asthma");
    expect(result.best?.score.clinicMeters).toBe(careSite?.meters);

    // Every alternative that is offered must also cover the medication.
    for (const plan of allPlans(result)) {
      expect(
        plan.careSite?.resources.map((r) => r.type),
        `${plan.destination.name} has no asthma medication in reach`,
      ).toContain("asthma_medication");
    }
  });
});

/* ================================================================== */
/* 7. No-route scenario identifies the unmet link                      */
/* ================================================================== */

describe("missing links", () => {
  it("names the single missing relationship when no plan exists at all", async () => {
    await setVolunteerStatus("vol_maya", "unavailable");
    await setVolunteerStatus("vol_arun", "unavailable");

    const result = await recommend();

    expect(result.status).toBe("no_route");
    expect(result.best).toBeNull();
    expect(result.alternatives).toHaveLength(0);

    const transportGap = result.missingLinks.find((l) => l.needId === "need_transport");
    expect(transportGap, "the unmet link must be transport").toBeDefined();
    expect(transportGap?.missing).toMatch(/wheelchair-accessible vehicle/i);

    // The graph knows WHO would fix it and WHY they currently cannot.
    expect(transportGap?.nearestCandidate?.id).toBe("vol_sunita");
    expect(transportGap?.nearestCandidate?.name).toContain("Sunita Lama");
    expect(transportGap?.nearestCandidate?.why).toMatch(/outside the response zone/i);
    expect(transportGap?.nearestCandidate?.why).toContain("3.2 km");
  });
});

/* ================================================================== */
/* 8. Reset restores deterministic state                               */
/* ================================================================== */

describe("reset", () => {
  it("returns the graph to an identical recommendation after three disruptions", async () => {
    const baseline = await recommend();

    // Pin the literals too, so a drifted seed fails here rather than silently
    // agreeing with itself.
    expect(baseline.best?.destination.id).toBe(BASELINE.destinationId);
    expect(baseline.best?.transport.volunteerId).toBe(BASELINE.volunteerId);
    expect(baseline.best?.score.total).toBeCloseTo(BASELINE.score, 1);

    const baselineShape = {
      destinationId: baseline.best?.destination.id,
      volunteerId: baseline.best?.transport.volunteerId,
      score: baseline.best?.score.total,
      route: segmentsUsed(baseline.best!),
      alternatives: baseline.alternatives.map((a) => a.destination.id),
    };

    // Wreck the world three different ways.
    await activateHazard(FLOOD);
    await fillShelter("shelter_hillcrest");
    await setVolunteerStatus("vol_arun", "unavailable");
    const disrupted = await recommend();
    expect(disrupted.best?.destination.id).not.toBe(BASELINE.destinationId);

    await resetToBaseline();
    const restored = await recommend();

    expect({
      destinationId: restored.best?.destination.id,
      volunteerId: restored.best?.transport.volunteerId,
      score: restored.best?.score.total,
      route: segmentsUsed(restored.best!),
      alternatives: restored.alternatives.map((a) => a.destination.id),
    }).toEqual(baselineShape);
  });
});
