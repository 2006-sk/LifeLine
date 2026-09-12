import { randomUUID } from "node:crypto";
import { readTimed, write } from "@/lib/neo4j/client";
import {
  RECOMMEND_CYPHER,
  recommendParams,
  WEIGHTS,
  type RawPlanRow,
  type RawPathElement,
} from "@/lib/neo4j/queries/recommend";
import { REJECTED_CYPHER } from "@/lib/neo4j/queries/rejected";
import {
  RELAXED_FEASIBILITY_CYPHER,
  NEAREST_ACCESSIBLE_RESPONDER_CYPHER,
  NEAREST_SAFE_WAIT_POINT_CYPHER,
} from "@/lib/neo4j/queries/missingLink";
import { PERSIST_PLAN_CYPHER } from "@/lib/neo4j/queries/plans";
import type {
  GraphEdge,
  GraphNode,
  GraphTrace,
  MissingLink,
  PlanCandidate,
  RecommendationResponse,
  RejectedPath,
  RouteStep,
  ScoreBreakdown,
} from "@/lib/types";

const MEDICAL_KINDS = ["asthma_medication", "insulin", "oxygen", "infant_formula"];

type TransportVehicleType = PlanCandidate["transport"]["vehicleType"];
type ResourceTypeAlias = NonNullable<PlanCandidate["careSite"]>["resources"][number]["type"];

function isSegment(el: RawPathElement) {
  return el.labels.includes("Segment");
}

/** Turn Cypher's alternating [Location, Segment, Location, ...] list into ordered steps. */
function toSteps(elements: RawPathElement[]): RouteStep[] {
  const steps: RouteStep[] = [];
  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    if (isSegment(el)) continue;
    const via = i > 0 ? elements[i - 1] : undefined;
    steps.push({
      locationId: el.id,
      locationName: el.name,
      lat: el.lat ?? 0,
      lng: el.lng ?? 0,
      viaSegmentId: via?.id,
      viaSegmentName: via?.name,
      viaSegmentKind: (via?.kind as "Road" | "Bridge") ?? undefined,
      travelMinutes: via?.travelMinutes ?? undefined,
      floodRisk: via?.floodRisk ?? undefined,
      inHazardZone: el.inHazardZone,
    });
  }
  return steps;
}

function elementToGraphNode(el: RawPathElement): GraphNode {
  const type = isSegment(el) ? (el.kind === "Bridge" ? "bridge" : "road") : "location";
  return {
    id: el.id,
    type,
    label: el.name,
    lat: el.lat ?? undefined,
    lng: el.lng ?? undefined,
    properties: {
      status: el.status,
      travelMinutes: el.travelMinutes,
      floodRisk: el.floodRisk,
      accessibility: el.accessibility,
      inHazardZone: el.inHazardZone,
    },
  };
}

function buildScore(row: RawPlanRow): ScoreBreakdown {
  const terms: ScoreBreakdown["terms"] = [];
  const push = (label: string, value: number, detail: string) => {
    if (Math.abs(value) > 0.001) terms.push({ label, value: Number(value.toFixed(2)), detail });
  };

  push("Travel time", row.travelMinutes * WEIGHTS.wTime, `${row.travelMinutes} min of travel for the family`);
  push(
    "Route flood exposure",
    row.riskSum * WEIGHTS.wRiskSum,
    `summed forecast exposure across ${row.elements.filter(isSegment).length} segments`,
  );
  push(
    "Worst single segment",
    row.maxRisk * WEIGHTS.wMaxRisk,
    `highest segment risk on the route is ${Math.round(row.maxRisk * 100)}%`,
  );
  push(
    "Active hazard zones crossed",
    row.hazardNodes * WEIGHTS.wHazardNode,
    row.hazardNodes === 0
      ? "route stays outside every active hazard footprint"
      : `${row.hazardNodes} point(s) inside an active hazard footprint`,
  );

  const cappedHeadroom = Math.min(row.headroom, WEIGHTS.headroomCap);
  push(
    "Destination capacity",
    cappedHeadroom * WEIGHTS.wHeadroom,
    `${row.headroom} spaces free after this family arrives`,
  );

  if (row.medicalKinds.length > 0) {
    if (row.careMeters == null) {
      push("No reachable clinic", WEIGHTS.wNoClinic, "no open care site nearby stocks the required medication");
    } else {
      push(
        "Distance to medicine",
        (row.careMeters / 100) * WEIGHTS.wClinicPer100m,
        `${row.careSiteName} is ${row.careMeters}m from the shelter`,
      );
    }
  }
  if (row.transport) {
    push(
      "Responder pickup",
      row.transport.pickupMinutes * WEIGHTS.wPickup,
      `${row.transport.volunteerName} is ${row.transport.pickupMinutes} min away`,
    );
  }

  return {
    total: Number(row.totalScore.toFixed(1)),
    travelMinutes: row.travelMinutes,
    riskSum: Number(row.riskSum.toFixed(2)),
    maxSegmentRisk: Number(row.maxRisk.toFixed(2)),
    hazardZoneNodes: row.hazardNodes,
    pickupMinutes: row.transport?.pickupMinutes ?? 0,
    capacityHeadroom: row.headroom,
    clinicMeters: row.careMeters,
    terms,
  };
}

function buildReasons(row: RawPlanRow): string[] {
  const reasons: string[] = [];
  const segs = row.elements.filter(isSegment);

  if (row.hazardNodes === 0) {
    reasons.push(`Stays clear of every active hazard footprint (${segs.length} segments, all currently open).`);
  } else {
    reasons.push(`Crosses ${row.hazardNodes} point(s) inside an active hazard footprint — treat with caution.`);
  }

  if (row.transport) {
    const t = row.transport;
    reasons.push(
      `${t.volunteerName} can reach you in ${t.pickupMinutes} min from ${t.stagedAtName} with ${t.vehicleName}` +
        `${t.wheelchairAccessible ? ", which is wheelchair accessible" : ""} (seats ${t.capacity}).`,
    );
  }

  reasons.push(
    `${row.shelterName} has ${row.headroom} space(s) remaining after your household arrives` +
      `${row.shelterWheelchair ? " and is step-free" : ""}.`,
  );

  if (row.careSiteName && row.careResources.length > 0) {
    reasons.push(
      `${row.careSiteName} is ${row.careMeters}m away and holds ${row.careResources
        .map((r) => `${r.name} (${r.quantity} in stock)`)
        .join(", ")}.`,
    );
  }

  const worst = segs.reduce<RawPathElement | null>(
    (acc, s) => (!acc || (s.floodRisk ?? 0) > (acc.floodRisk ?? 0) ? s : acc),
    null,
  );
  if (worst) {
    reasons.push(
      `Highest-risk leg is ${worst.name} at ${Math.round((worst.floodRisk ?? 0) * 100)}% forecast flood exposure.`,
    );
  }
  return reasons;
}

function buildPlan(row: RawPlanRow, familyId: string, index: number): PlanCandidate {
  const steps = toSteps(row.elements);
  const pickupSteps = row.transport ? toSteps(row.transport.elements) : [];

  const nodes: GraphNode[] = row.elements.map(elementToGraphNode);
  const edges: GraphEdge[] = [];
  for (let i = 0; i < row.elements.length - 1; i++) {
    const a = row.elements[i];
    const b = row.elements[i + 1];
    const [segEl, locEl] = isSegment(a) ? [a, b] : [b, a];
    edges.push({
      id: `${segEl.id}__CONNECTS__${locEl.id}`,
      source: segEl.id,
      target: locEl.id,
      type: "CONNECTS",
      properties: { travelMinutes: segEl.travelMinutes, floodRisk: segEl.floodRisk },
    });
  }

  // Ordered reasoning chain: who -> what they need -> who helps -> how -> where.
  const chain: string[] = [familyId];
  if (row.requireStepFree) chain.push("need_mobility");
  if (row.medicalKinds.includes("asthma_medication")) chain.push("need_asthma");
  if (row.transport) {
    chain.push(row.transport.volunteerId, row.transport.vehicleId);
    nodes.push(
      {
        id: row.transport.volunteerId,
        type: "volunteer",
        label: row.transport.volunteerName,
        properties: { pickupMinutes: row.transport.pickupMinutes, stagedAt: row.transport.stagedAtName },
      },
      {
        id: row.transport.vehicleId,
        type: "vehicle",
        label: row.transport.vehicleName,
        properties: {
          wheelchairAccessible: row.transport.wheelchairAccessible,
          capacity: row.transport.capacity,
        },
      },
    );
    edges.push({
      id: `${row.transport.volunteerId}__HAS_VEHICLE__${row.transport.vehicleId}`,
      source: row.transport.volunteerId,
      target: row.transport.vehicleId,
      type: "HAS_VEHICLE",
      properties: {},
    });
  }
  chain.push(...row.elements.map((e) => e.id));
  chain.push(row.shelterId);

  nodes.push({
    id: row.shelterId,
    type: "shelter",
    label: row.shelterName,
    properties: {
      capacity: row.shelterCapacity,
      occupancy: row.shelterOccupancy,
      wheelchairAccessible: row.shelterWheelchair,
    },
  });
  edges.push({
    id: `${row.shelterId}__LOCATED_AT__${row.destLocationId}`,
    source: row.shelterId,
    target: row.destLocationId,
    type: "LOCATED_AT",
    properties: {},
  });

  if (row.careSiteId) {
    chain.push(row.careSiteId);
    nodes.push({
      id: row.careSiteId,
      type: row.careSiteKind === "Hospital" ? "hospital" : "clinic",
      label: row.careSiteName ?? row.careSiteId,
      properties: { meters: row.careMeters },
    });
    edges.push({
      id: `${row.shelterId}__NEAR__${row.careSiteId}`,
      source: row.shelterId,
      target: row.careSiteId,
      type: "NEAR",
      properties: { meters: row.careMeters },
    });
    for (const res of row.careResources) {
      chain.push(res.id);
      nodes.push({
        id: res.id,
        type: "resource",
        label: res.name,
        properties: { type: res.type, quantity: res.quantity },
      });
      edges.push({
        id: `${row.careSiteId}__HAS_RESOURCE__${res.id}`,
        source: row.careSiteId,
        target: res.id,
        type: "HAS_RESOURCE",
        properties: {},
      });
    }
  }

  const needsMet: string[] = [];
  const needsUnmet: string[] = [];
  if (row.requireTransport) (row.transport ? needsMet : needsUnmet).push("need_transport");
  if (row.requireStepFree) {
    (row.transport?.wheelchairAccessible && row.shelterWheelchair ? needsMet : needsUnmet).push("need_mobility");
  }
  if (row.medicalKinds.includes("asthma_medication")) {
    (row.careResources.some((r) => r.type === "asthma_medication") ? needsMet : needsUnmet).push("need_asthma");
  }
  needsMet.push("need_shelter");

  return {
    id: `plan_${familyId}_${row.shelterId}_${index}`,
    destination: {
      id: row.shelterId,
      name: row.shelterName,
      locationId: row.destLocationId,
      locationName: row.destLocationName,
      capacity: row.shelterCapacity,
      occupancy: row.shelterOccupancy,
      headroom: row.headroom,
      wheelchairAccessible: row.shelterWheelchair,
    },
    transport: row.transport
      ? {
          volunteerId: row.transport.volunteerId,
          volunteerName: row.transport.volunteerName,
          vehicleId: row.transport.vehicleId,
          vehicleName: row.transport.vehicleName,
          vehicleType: row.transport.vehicleType as TransportVehicleType,
          wheelchairAccessible: row.transport.wheelchairAccessible,
          capacity: row.transport.capacity,
          stagedAtId: row.transport.stagedAtId,
          stagedAtName: row.transport.stagedAtName,
          pickupMinutes: row.transport.pickupMinutes,
          pickupSteps,
        }
      : {
          volunteerId: "",
          volunteerName: "Own transport",
          vehicleId: "",
          vehicleName: "Household vehicle",
          vehicleType: "car",
          wheelchairAccessible: false,
          capacity: 0,
          stagedAtId: "",
          stagedAtName: "",
          pickupMinutes: 0,
          pickupSteps: [],
        },
    route: { steps, estimatedMinutes: row.travelMinutes, nodes, edges },
    chain,
    careSite: row.careSiteId
      ? {
          id: row.careSiteId,
          name: row.careSiteName ?? "",
          kind: (row.careSiteKind as "Clinic" | "Hospital") ?? "Clinic",
          meters: row.careMeters ?? 0,
          resources: row.careResources.map((r) => ({
            id: r.id,
            name: r.name,
            type: r.type as ResourceTypeAlias,
            quantity: r.quantity,
          })),
        }
      : null,
    needsMet,
    needsUnmet,
    score: buildScore(row),
    reasons: buildReasons(row),
  };
}

const REJECTION_COPY: Record<string, string> = {
  at_capacity: "At capacity",
  not_step_free: "Not wheelchair accessible",
  closed: "Closed",
  blocked_by_hazard: "Every route blocked by an active hazard",
  unreachable: "No route currently exists",
  viable: "Viable, but scored lower",
};

async function diagnoseMissingLinks(familyId: string, trace: GraphTrace): Promise<MissingLink[]> {
  const links: MissingLink[] = [];

  const relax = async (
    name: string,
    flags: { relaxStepFree: boolean; relaxTransport: boolean; relaxCapacity: boolean },
  ) => {
    const { rows, ms } = await readTimed<{ feasibleShelters: number }>(RELAXED_FEASIBILITY_CYPHER, {
      familyId,
      ...flags,
    });
    trace.queries.push({
      name: `relax:${name}`,
      purpose: `Would relaxing "${name}" make a plan possible?`,
      cypher: RELAXED_FEASIBILITY_CYPHER,
      params: { familyId, ...flags },
      ms,
      rows: rows.length,
    });
    return rows[0]?.feasibleShelters ?? 0;
  };

  const noRelax = { relaxStepFree: false, relaxTransport: false, relaxCapacity: false };

  if ((await relax("accessible transport", { ...noRelax, relaxTransport: true })) > 0) {
    const { rows } = await readTimed<{
      volunteerId: string;
      volunteerName: string;
      status: string;
      distanceOutsideZoneKm: number | null;
      vehicleName: string;
      locationName: string | null;
    }>(NEAREST_ACCESSIBLE_RESPONDER_CYPHER);
    const candidate = rows[0];
    links.push({
      needId: "need_transport",
      needLabel: "Wheelchair-accessible transport",
      missing: "A wheelchair-accessible vehicle that can reach this family",
      nearestCandidate: candidate
        ? {
            id: candidate.volunteerId,
            name: `${candidate.volunteerName} · ${candidate.vehicleName}`,
            why:
              candidate.status === "out_of_zone" && candidate.distanceOutsideZoneKm
                ? `Has an accessible vehicle but is ${candidate.distanceOutsideZoneKm} km outside the response zone${
                    candidate.locationName ? ` at ${candidate.locationName}` : ""
                  }.`
                : `Has an accessible vehicle but is currently ${candidate.status.replace(/_/g, " ")}.`,
          }
        : undefined,
    });
  }

  if ((await relax("step-free routing", { ...noRelax, relaxStepFree: true })) > 0) {
    links.push({
      needId: "need_mobility",
      needLabel: "Step-free transport and shelter",
      missing:
        "Step-free capacity. A plan only reappears if the step-free requirement is dropped — " +
        "the vehicles and shelters still reachable are ones a wheelchair user cannot use.",
    });
  }

  if ((await relax("shelter capacity", { ...noRelax, relaxCapacity: true })) > 0) {
    links.push({
      needId: "need_shelter",
      needLabel: "Shelter space",
      missing: "Open capacity — every reachable shelter is full",
    });
  }

  return links;
}

export interface RecommendOptions {
  /** Persist the winning plan as a (:Plan) so hazards can invalidate it later. */
  persist?: boolean;
}

export async function recommendForFamily(
  familyId: string,
  options: RecommendOptions = {},
): Promise<RecommendationResponse> {
  const trace: GraphTrace = {
    queries: [],
    pathsEnumerated: 0,
    pathsSurviving: 0,
    nodesTraversed: 0,
    relationshipsTraversed: 0,
  };

  const params = recommendParams(familyId);
  const { rows, ms } = await readTimed<RawPlanRow>(RECOMMEND_CYPHER, params);
  trace.queries.push({
    name: "findViablePlans",
    purpose:
      "Enumerate every hazard-aware walk from the family to every qualifying shelter, match transport and medicine, and rank what survives.",
    cypher: RECOMMEND_CYPHER,
    params,
    ms,
    rows: rows.length,
  });

  const plans = rows.map((row, i) => buildPlan(row, familyId, i));
  trace.pathsSurviving = rows.reduce((sum, r) => sum + r.pathOptions, 0);
  trace.nodesTraversed = new Set(rows.flatMap((r) => r.elements.map((e) => e.id))).size;
  trace.relationshipsTraversed = rows.reduce((sum, r) => sum + Math.max(r.elements.length - 1, 0), 0);

  const rejectedParams = { familyId, medicalNeedKinds: MEDICAL_KINDS };
  const { rows: rejectedRows, ms: rejectedMs } = await readTimed<{
    shelterId: string;
    shelterName: string;
    reasonCode: string;
    capacity: number;
    occupancy: number;
    wheelchairAccessible: boolean;
    totalWalks: number;
    viableWalks: number;
    hazardBlockedWalks: number;
    blockedNames: string[];
  }>(REJECTED_CYPHER, rejectedParams);
  trace.queries.push({
    name: "explainRejections",
    purpose:
      "For every destination NOT recommended, determine from the graph why: capacity, accessibility, or hazard-blocked connectivity.",
    cypher: REJECTED_CYPHER,
    params: rejectedParams,
    ms: rejectedMs,
    rows: rejectedRows.length,
  });
  trace.pathsEnumerated = rejectedRows.reduce((sum, r) => sum + r.totalWalks, 0);

  const rejected: RejectedPath[] = rejectedRows
    .filter((r) => r.reasonCode !== "viable")
    .map((r) => ({
      destinationId: r.shelterId,
      destinationName: r.shelterName,
      reasonCode: r.reasonCode,
      reason: REJECTION_COPY[r.reasonCode] ?? r.reasonCode,
      detail:
        r.reasonCode === "at_capacity"
          ? `${r.occupancy}/${r.capacity} occupied.`
          : r.reasonCode === "not_step_free"
            ? "No step-free access for a wheelchair user."
            : r.hazardBlockedWalks > 0
              ? `${r.hazardBlockedWalks} of ${r.totalWalks} candidate routes cross ${
                  r.blockedNames.join(", ") || "a blocked segment"
                }.`
              : "No connected route in the current network.",
    }));

  const hazardEliminated = rejectedRows.reduce((sum, r) => sum + r.hazardBlockedWalks, 0);
  if (hazardEliminated > 0) {
    rejected.push({
      destinationId: "__hazard_summary__",
      destinationName: "Routes eliminated by active hazards",
      reasonCode: "blocked_by_hazard",
      reason: `${hazardEliminated} candidate routes discarded`,
      detail: "Each crossed at least one segment with a live BLOCKED_BY relationship to an active hazard.",
    });
  }

  const missingLinks = plans.length === 0 ? await diagnoseMissingLinks(familyId, trace) : [];

  const best = plans[0] ?? null;
  let planId: string | null = null;
  if (best && options.persist !== false) {
    planId = `plan_${familyId}_${randomUUID().slice(0, 8)}`;
    const usesIds = [
      ...best.route.steps.map((s) => s.viaSegmentId).filter((x): x is string => Boolean(x)),
      best.destination.id,
      best.transport.volunteerId,
      best.transport.vehicleId,
      best.careSite?.id,
    ].filter((x): x is string => Boolean(x));
    await write(PERSIST_PLAN_CYPHER, {
      familyId,
      planId,
      score: best.score.total,
      shelterId: best.destination.id,
      summary: `${best.transport.volunteerName} → ${best.route.steps
        .map((s) => s.viaSegmentName)
        .filter(Boolean)
        .join(" → ")} → ${best.destination.name}`,
      usesIds,
    });
  }

  const familyName =
    familyId
      .replace(/^family_/, "")
      .replace(/(^|_)([a-z])/g, (_, p, c: string) => (p ? " " : "") + c.toUpperCase()) + " Family";

  const criticalNeedsTotal = best ? best.needsMet.length + best.needsUnmet.length : 0;

  return {
    status: best ? "success" : "no_route",
    familyId,
    familyName,
    generatedAt: new Date().toISOString(),
    planId,
    best,
    alternatives: plans.slice(1),
    rejected,
    missingLinks,
    graphTrace: trace,
    peopleCovered: best ? (rows[0]?.familySize ?? 0) : 0,
    criticalNeedsCovered: best ? best.needsMet.length : 0,
    criticalNeedsTotal,
  };
}

export async function nearestSafeWaitPoints(familyId: string) {
  const { rows } = await readTimed<{
    locationId: string;
    locationName: string;
    safetyScore: number;
    elevation: number;
    minutes: number;
  }>(NEAREST_SAFE_WAIT_POINT_CYPHER, { familyId });
  return rows;
}
