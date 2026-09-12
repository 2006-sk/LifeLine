import { randomUUID } from "node:crypto";
import { read, readTimed, write } from "@/lib/neo4j/client";
import {
  ACTIVATE_HAZARD_CYPHER,
  DEACTIVATE_HAZARD_CYPHER,
  BLOCK_SEGMENT_CYPHER,
  SET_SHELTER_FULL_CYPHER,
  SET_VOLUNTEER_STATUS_CYPHER,
  HAZARD_RIPPLE_CYPHER,
} from "@/lib/neo4j/queries/events";
import { GRAPH_SNAPSHOT_CYPHER, GRAPH_EDGES_CYPHER, SCENARIO_STATE_CYPHER } from "@/lib/neo4j/queries/graphSnapshot";
import { PLANS_INVALIDATED_BY_HAZARD_CYPHER, PLANS_COMPROMISED_CYPHER, EXPLAIN_PLAN_CYPHER } from "@/lib/neo4j/queries/plans";
import { resetToBaseline } from "@/lib/neo4j/seed";
import { world, hazardById } from "@/lib/world/world";
import type { GraphPayload, ScenarioState } from "@/lib/types";

export async function getScenarioState(): Promise<ScenarioState> {
  const rows = await read<{
    activeHazards: { id: string; name: string; hazardType: string; severity: number }[];
    blockedSegments: string[];
    fullShelters: string[];
    unavailableVolunteers: string[];
    openShelters: number;
    availableVolunteers: number;
    familiesMonitored: number;
    alerts: { id: string; title: string; body: string; severity: number }[];
  }>(SCENARIO_STATE_CYPHER);
  const r = rows[0];
  return {
    activeHazards: (r?.activeHazards ?? []) as ScenarioState["activeHazards"],
    blockedSegments: r?.blockedSegments ?? [],
    fullShelters: r?.fullShelters ?? [],
    unavailableVolunteers: r?.unavailableVolunteers ?? [],
    counts: {
      activeHazards: r?.activeHazards?.length ?? 0,
      openShelters: r?.openShelters ?? 0,
      availableVolunteers: r?.availableVolunteers ?? 0,
      familiesMonitored: r?.familiesMonitored ?? 0,
    },
    events: [],
  };
}

export async function getGraphPayload(): Promise<GraphPayload> {
  const [nodeRows, edgeRows] = await Promise.all([
    read<{ nodes: GraphPayload["nodes"] }>(GRAPH_SNAPSHOT_CYPHER),
    read<{ edges: GraphPayload["edges"] }>(GRAPH_EDGES_CYPHER),
  ]);
  const nodes = nodeRows[0]?.nodes ?? [];
  const ids = new Set(nodes.map((n) => n.id));
  // Drop dangling edges (e.g. to an inactive hazard we deliberately omitted).
  const edges = (edgeRows[0]?.edges ?? []).filter((e) => ids.has(e.source) && ids.has(e.target));
  return { nodes, edges };
}

export interface DisruptionResult {
  ok: true;
  kind: string;
  label: string;
  /** Ids that should pulse/break in the visualisations. */
  impacted: { segments: string[]; locations: string[]; shelters: string[]; volunteers: string[] };
  invalidatedPlans: { planId: string; familyId: string; familyName: string; summary: string }[];
  alert: { id: string; title: string; body: string; severity: number } | null;
}

export async function activateHazard(hazardId: string): Promise<DisruptionResult> {
  const hazard = hazardById.get(hazardId);
  if (!hazard) throw new Error(`Unknown hazard: ${hazardId}`);
  const alertId = `alert_${hazardId}_${randomUUID().slice(0, 6)}`;

  const rows = await write<{
    hazard: { id: string; name: string; description: string; severity: number };
    blocked: { id: string; name: string }[];
    affected: { id: string; name: string }[];
    alertId: string;
  }>(ACTIVATE_HAZARD_CYPHER, {
    hazardId,
    blockSegmentIds: hazard.blocks,
    affectLocationIds: hazard.affects,
    alertId,
  });
  const r = rows[0];

  // Ask the graph which plans this just broke — a traversal, not a client diff.
  const invalidated = await write<{ planId: string; familyId: string; familyName: string; summary: string }>(
    PLANS_INVALIDATED_BY_HAZARD_CYPHER,
    { hazardId },
  );

  const ripple = await read<{
    segments: { id: string }[]; locations: { id: string }[];
    families: { id: string }[]; volunteers: { id: string }[]; shelters: { id: string }[];
  }>(HAZARD_RIPPLE_CYPHER, { hazardId });

  return {
    ok: true,
    kind: "hazard_activate",
    label: hazard.name,
    impacted: {
      segments: (r?.blocked ?? []).map((s) => s.id),
      locations: (r?.affected ?? []).map((l) => l.id),
      shelters: (ripple[0]?.shelters ?? []).map((s) => s.id).filter(Boolean),
      volunteers: (ripple[0]?.volunteers ?? []).map((v) => v.id).filter(Boolean),
    },
    invalidatedPlans: invalidated,
    alert: { id: alertId, title: hazard.name, body: hazard.description, severity: hazard.severity },
  };
}

export async function deactivateHazard(hazardId: string) {
  await write(DEACTIVATE_HAZARD_CYPHER, { hazardId });
  return { ok: true as const, hazardId };
}

export async function blockSegment(segmentId: string): Promise<DisruptionResult> {
  const segment = world.segments.find((s) => s.id === segmentId);
  if (!segment) throw new Error(`Unknown segment: ${segmentId}`);
  const hazardId = `hz_manual_${segmentId}`;
  const alertId = `alert_${hazardId}_${randomUUID().slice(0, 6)}`;
  const description = `${segment.name} reported impassable by field teams.`;
  await write(BLOCK_SEGMENT_CYPHER, {
    segmentId,
    hazardId,
    hazardName: `${segment.name} closed`,
    hazardType: segment.kind === "Bridge" ? "structural" : "flood",
    severity: 0.8,
    description,
    alertId,
  });
  const invalidated = await write<{ planId: string; familyId: string; familyName: string; summary: string }>(
    PLANS_INVALIDATED_BY_HAZARD_CYPHER,
    { hazardId },
  );
  return {
    ok: true,
    kind: "segment_block",
    label: `${segment.name} closed`,
    impacted: { segments: [segmentId], locations: [segment.from, segment.to], shelters: [], volunteers: [] },
    invalidatedPlans: invalidated,
    alert: { id: alertId, title: `${segment.name} closed`, body: description, severity: 0.8 },
  };
}

export async function fillShelter(shelterId: string): Promise<DisruptionResult> {
  const alertId = `alert_full_${shelterId}_${randomUUID().slice(0, 6)}`;
  const rows = await write<{ shelter: { id: string; name: string; capacity: number } }>(SET_SHELTER_FULL_CYPHER, {
    shelterId,
    alertId,
  });
  const name = rows[0]?.shelter?.name ?? shelterId;
  const compromised = await read<{ planId: string; familyId: string; familyName: string; summary: string }>(
    PLANS_COMPROMISED_CYPHER,
  );
  return {
    ok: true,
    kind: "shelter_full",
    label: `${name} at capacity`,
    impacted: { segments: [], locations: [], shelters: [shelterId], volunteers: [] },
    invalidatedPlans: compromised,
    alert: { id: alertId, title: `${name} has reached capacity`, body: `${name} is no longer accepting arrivals.`, severity: 0.6 },
  };
}

export async function setVolunteerStatus(volunteerId: string, status: string): Promise<DisruptionResult> {
  const rows = await write<{ volunteer: { id: string; name: string; status: string } }>(SET_VOLUNTEER_STATUS_CYPHER, {
    volunteerId,
    status,
  });
  const name = rows[0]?.volunteer?.name ?? volunteerId;
  const compromised = await read<{ planId: string; familyId: string; familyName: string; summary: string }>(
    PLANS_COMPROMISED_CYPHER,
  );
  const unavailable = status !== "available";
  return {
    ok: true,
    kind: "volunteer_unavailable",
    label: unavailable ? `${name} unavailable` : `${name} back on duty`,
    impacted: { segments: [], locations: [], shelters: [], volunteers: [volunteerId] },
    invalidatedPlans: unavailable ? compromised : [],
    alert: unavailable
      ? { id: `alert_vol_${volunteerId}`, title: `${name} is no longer available`, body: `${name} has been stood down from this response.`, severity: 0.5 }
      : null,
  };
}

export async function resetScenario() {
  await resetToBaseline();
  return { ok: true as const };
}

export interface ExplanationLink {
  step: string;
  fromId: string; fromLabel: string; fromType: string;
  rel: string;
  toId: string; toLabel: string; toType: string;
  sentence: string;
}

export async function explainPlan(planId: string) {
  const { rows, ms } = await readTimed<{
    needLinks: ExplanationLink[];
    transportLinks: ExplanationLink[];
    routeLinks: ExplanationLink[];
    destinationLinks: ExplanationLink[];
    resourceLinks: ExplanationLink[];
  }>(EXPLAIN_PLAN_CYPHER, { planId });
  const r = rows[0];
  if (!r) return null;
  const links = [
    ...(r.needLinks ?? []),
    ...(r.transportLinks ?? []),
    ...(r.routeLinks ?? []),
    ...(r.destinationLinks ?? []),
    ...(r.resourceLinks ?? []),
  ].filter(Boolean);
  return {
    planId,
    links,
    ms,
    cypher: EXPLAIN_PLAN_CYPHER,
    statement:
      "This recommendation exists because these relationships remain valid right now. If any one of them breaks, the plan is recomputed.",
  };
}
