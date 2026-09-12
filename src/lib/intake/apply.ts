/**
 * Controlled graph writes.
 *
 * EVERY statement in this file is a literal, hand-written, parameterised Cypher
 * string. Nothing here is assembled from model output, and nothing here creates
 * infrastructure: roads, bridges, shelters and volunteers are MATCHed by the id
 * the seed gave them, never MERGEd into existence. A bulletin can change the
 * STATE of the district; it can never invent a bridge.
 *
 * The one exception is deliberate and bounded: `(:Hazard)` and `(:Alert)` nodes
 * ARE created, because a newly reported hazard is by definition not in the seed.
 * Both are created with `baseActive = false`, which is exactly what
 * `resetToBaseline()` looks for when it tears demo state back down — so every
 * write below is reversible by the existing reset path.
 *
 * All writes are idempotent: re-submitting the same intake or the same bulletin
 * converges on the same graph.
 */

import { read, writeTx } from "../neo4j/client";
import type { ExtractedSituation, HazardType, NeedKind } from "../types";
import { segmentById } from "../world/world";
import { parseBulletin, resolveBulletin, type BulletinAction } from "./bulletin";

/** Thrown when the caller names a family the graph does not have. */
export class FamilyNotFoundError extends Error {
  readonly code = "FAMILY_NOT_FOUND";
  constructor(readonly familyId: string) {
    super(`No family with id "${familyId}" exists in the graph.`);
    this.name = "FamilyNotFoundError";
  }
}

/* ------------------------------------------------------------------ */
/* Need vocabulary                                                     */
/* ------------------------------------------------------------------ */

/**
 * Canonical (:Need) rows. The five seeded kinds MERGE onto the existing nodes
 * (MERGE is by `kind`, so no duplicates); insulin and oxygen are not in the
 * seed and get deterministic ids so a second submission reuses the same node.
 */
const NEED_CATALOGUE: Record<NeedKind, { id: string; label: string; critical: boolean }> = {
  mobility_assistance: { id: "need_mobility", label: "Wheelchair-level mobility assistance", critical: true },
  asthma_medication: { id: "need_asthma", label: "Asthma rescue medication", critical: true },
  transportation: { id: "need_transport", label: "Accessible transportation", critical: true },
  shelter: { id: "need_shelter", label: "Safe shelter space", critical: true },
  infant_formula: { id: "need_formula", label: "Infant formula", critical: true },
  insulin: { id: "need_insulin", label: "Insulin (cold chain)", critical: true },
  oxygen: { id: "need_oxygen", label: "Supplemental oxygen", critical: true },
};

/* ------------------------------------------------------------------ */
/* Intake -> family                                                    */
/* ------------------------------------------------------------------ */

export interface AppliedNeed {
  id: string;
  kind: NeedKind;
  label: string;
  critical: boolean;
}

export interface AppliedSituation {
  familyId: string;
  familyName: string;
  /** Household size AFTER the write. */
  size: number;
  hasVehicle: boolean;
  /** Family-level needs now asserted, read back from the graph. */
  needs: AppliedNeed[];
  /** Need kinds whose HAS_NEED edge this submission removed. */
  needsRemoved: NeedKind[];
  /** Hazards the household reported, split by whether they ground on a real segment. */
  hazardsMatched: { type: HazardType; segmentId: string; segmentName: string }[];
  hazardsUnmatched: { type: HazardType; phrase: string }[];
  constraints: string[];
}

export const NEED_CATALOGUE_CYPHER = `
UNWIND $needs AS row
MERGE (n:Need {kind: row.kind})
  ON CREATE SET n.id = row.id, n.label = row.label, n.critical = row.critical
`;

export const PRUNE_NEEDS_CYPHER = `
MATCH (f:Family {id: $familyId})-[r:HAS_NEED]->(n:Need)
WHERE NOT n.kind IN $kinds
DELETE r
`;

export const ATTACH_NEEDS_CYPHER = `
MATCH (f:Family {id: $familyId})
UNWIND $kinds AS kind
MATCH (n:Need {kind: kind})
MERGE (f)-[:HAS_NEED]->(n)
`;

export const UPDATE_FAMILY_CYPHER = `
MATCH (f:Family {id: $familyId})
SET f.size       = CASE WHEN $size       IS NULL THEN f.size       ELSE $size       END,
    f.hasVehicle = CASE WHEN $hasVehicle IS NULL THEN f.hasVehicle ELSE $hasVehicle END,
    f.intakeUpdatedAt   = $now,
    f.intakeSource      = $source,
    f.intakeConfidence  = $confidence,
    f.intakeConstraints = $constraints
`;

/**
 * Write a VALIDATED situation onto one family.
 *
 * Idempotent by construction: needs are MERGEd by kind, and family-level
 * HAS_NEED edges the new situation no longer asserts are deleted first, so
 * submitting the same text twice leaves the graph in the same state as once.
 * Person-level needs (the grandmother's own mobility need) are never touched —
 * a household update must not erase what was recorded about an individual.
 */
export async function applySituationToFamily(
  familyId: string,
  situation: ExtractedSituation,
): Promise<AppliedSituation> {
  const existing = await read<{ id: string; name: string; needKinds: NeedKind[] }>(
    `MATCH (f:Family {id: $familyId})
     OPTIONAL MATCH (f)-[:HAS_NEED]->(n:Need)
     RETURN f.id AS id, f.name AS name, collect(DISTINCT n.kind) AS needKinds`,
    { familyId },
  );
  if (existing.length === 0) throw new FamilyNotFoundError(familyId);

  const before = new Set((existing[0].needKinds ?? []).filter(Boolean));
  const kinds = [...new Set(situation.needs)].filter((k): k is NeedKind => k in NEED_CATALOGUE);
  const needRows = kinds.map((kind) => ({ kind, ...NEED_CATALOGUE[kind] }));

  const hasVehicle = situation.constraints.includes("no_vehicle") ? false : null;
  const size = situation.familySize > 0 ? situation.familySize : null;
  const now = new Date().toISOString();

  const statements: { cypher: string; params?: Record<string, unknown> }[] = [];
  if (needRows.length > 0) {
    statements.push({ cypher: NEED_CATALOGUE_CYPHER, params: { needs: needRows } });
    // Only prune when the submission actually asserts needs — a bare "we are 4"
    // must not strip the household's seeded needs.
    statements.push({ cypher: PRUNE_NEEDS_CYPHER, params: { familyId, kinds } });
    statements.push({ cypher: ATTACH_NEEDS_CYPHER, params: { familyId, kinds } });
  }
  statements.push({
    cypher: UPDATE_FAMILY_CYPHER,
    params: {
      familyId,
      size,
      hasVehicle,
      now,
      source: situation.source,
      confidence: situation.confidence,
      constraints: situation.constraints,
    },
  });

  await writeTx(statements);

  const after = await read<{
    name: string;
    size: number;
    hasVehicle: boolean;
    needs: AppliedNeed[];
  }>(
    `MATCH (f:Family {id: $familyId})
     OPTIONAL MATCH (f)-[:HAS_NEED]->(n:Need)
     RETURN f.name AS name, f.size AS size, f.hasVehicle AS hasVehicle,
            [x IN collect(DISTINCT n) WHERE x IS NOT NULL |
              {id: x.id, kind: x.kind, label: x.label, critical: x.critical}] AS needs`,
    { familyId },
  );

  const row = after[0];
  const hazardsMatched: AppliedSituation["hazardsMatched"] = [];
  const hazardsUnmatched: AppliedSituation["hazardsUnmatched"] = [];
  for (const hazard of situation.reportedHazards) {
    const segment = segmentById.get(hazard.target);
    if (segment) hazardsMatched.push({ type: hazard.type, segmentId: segment.id, segmentName: segment.name });
    else hazardsUnmatched.push({ type: hazard.type, phrase: hazard.target });
  }

  return {
    familyId,
    familyName: row?.name ?? existing[0].name,
    size: row?.size ?? situation.familySize,
    hasVehicle: row?.hasVehicle ?? true,
    needs: row?.needs ?? [],
    needsRemoved: needRows.length > 0 ? [...before].filter((k) => !kinds.includes(k)) : [],
    hazardsMatched,
    hazardsUnmatched,
    constraints: situation.constraints,
  };
}

/* ------------------------------------------------------------------ */
/* Bulletin -> district                                                */
/* ------------------------------------------------------------------ */

export type BulletinApplyAction =
  | "hazard_reported"
  | "segment_status_changed"
  | "alert_raised"
  | "shelter_full"
  | "volunteer_available";

export interface BulletinDiffEntry {
  action: BulletinApplyAction;
  targetId: string;
  targetName: string;
  detail: string;
}

export interface BulletinDiff {
  applied: BulletinDiffEntry[];
  unmatched: string[];
}

/**
 * `baseActive: false` on create is load-bearing: `resetToBaseline()` deletes
 * every BLOCKED_BY edge pointing at a hazard with `baseActive = false`, and
 * DETACH DELETEs every :Alert. Bulletin writes are therefore undone by the
 * existing reset with no special-casing.
 */
export const HAZARD_CYPHER = `
MATCH (s:Segment {id: $segmentId})
MERGE (h:Hazard {id: $hazardId})
  ON CREATE SET h.baseActive = false, h.footprint = []
SET h.name = $hazardName, h.hazardType = $hazardType, h.severity = $severity,
    h.active = true, h.description = $description, h.reportedAt = $now,
    h.source = 'field_bulletin'
MERGE (s)-[:BLOCKED_BY]->(h)
SET s.status = $segmentStatus
`;

export const ALERT_CYPHER = `
MATCH (s:Segment {id: $segmentId}), (h:Hazard {id: $hazardId})
MERGE (a:Alert {id: $alertId})
  ON CREATE SET a.createdAt = $now
SET a.kind = 'field_bulletin', a.message = $message, a.severity = $severity, a.updatedAt = $now
MERGE (a)-[:AFFECTS]->(s)
MERGE (a)-[:AFFECTS]->(h)
`;

export const SHELTER_FULL_CYPHER = `
MATCH (s:Shelter {id: $shelterId})
SET s.occupancy = s.capacity, s.status = 'full'
`;

export const VOLUNTEER_AVAILABLE_CYPHER = `
MATCH (v:Volunteer {id: $volunteerId})
SET v.status = 'available'
WITH v
OPTIONAL MATCH (v)-[:HAS_VEHICLE]->(veh:Vehicle)
FOREACH (_ IN CASE WHEN veh IS NULL THEN [] ELSE [1] END | SET veh.status = 'ready')
`;

const SEVERITY_BY_TYPE: Record<HazardType, number> = {
  flood: 0.85,
  landslide: 0.7,
  structural: 0.8,
  fire: 0.9,
  debris: 0.5,
};

/**
 * Parse a field bulletin and apply it to the district.
 *
 * Returns a structured diff so the UI can animate exactly the nodes and edges
 * that changed, and so every phrase the parser could NOT ground is shown rather
 * than quietly discarded.
 */
export async function applyBulletin(text: string): Promise<BulletinDiff> {
  const actions: BulletinAction[] = parseBulletin(text);
  const { resolved, unmatched } = resolveBulletin(actions);

  const applied: BulletinDiffEntry[] = [];
  const statements: { cypher: string; params?: Record<string, unknown> }[] = [];
  const now = new Date().toISOString();

  for (const item of resolved) {
    if (item.kind === "segment_hazard") {
      const { segment, hazardType, segmentStatus } = item;
      const hazardId = `hz_bulletin_${segment.id}`;
      const alertId = `alert_bulletin_${segment.id}`;
      const hazardName = `${segment.name} — reported ${hazardType}`;
      const description = item.action.sentence;
      const severity = SEVERITY_BY_TYPE[hazardType];

      statements.push({
        cypher: HAZARD_CYPHER,
        params: { segmentId: segment.id, hazardId, hazardName, hazardType, severity, description, now, segmentStatus },
      });
      statements.push({
        cypher: ALERT_CYPHER,
        params: { segmentId: segment.id, hazardId, alertId, message: description, severity, now },
      });

      applied.push({
        action: "hazard_reported",
        targetId: hazardId,
        targetName: hazardName,
        detail: `Created an active ${hazardType} hazard and a BLOCKED_BY edge from ${segment.name}.`,
      });
      applied.push({
        action: "segment_status_changed",
        targetId: segment.id,
        targetName: segment.name,
        // Stated as the RESULT, not a before->after: the seeded status in
        // world.ts is not necessarily the live one (a scenario step may already
        // have moved it), and a diff line must never assert something untrue.
        detail: `Segment status set to ${segmentStatus}; traversal now rejects this ${segment.kind.toLowerCase()}.`,
      });
      applied.push({
        action: "alert_raised",
        targetId: alertId,
        targetName: `Alert — ${segment.name}`,
        detail: `AFFECTS ${segment.name}: "${description}"`,
      });
      continue;
    }

    if (item.kind === "shelter_full") {
      statements.push({ cypher: SHELTER_FULL_CYPHER, params: { shelterId: item.shelter.id } });
      applied.push({
        action: "shelter_full",
        targetId: item.shelter.id,
        targetName: item.shelter.name,
        detail: `Occupancy set to capacity (${item.shelter.capacity}), status -> full. It is no longer a viable destination.`,
      });
      continue;
    }

    for (const volunteer of item.volunteers) {
      statements.push({ cypher: VOLUNTEER_AVAILABLE_CYPHER, params: { volunteerId: volunteer.id } });
      applied.push({
        action: "volunteer_available",
        targetId: volunteer.id,
        targetName: volunteer.name,
        detail: `Status ${volunteer.status} -> available near ${item.placeNames.join(", ")}; vehicle marked ready.`,
      });
    }
  }

  if (statements.length > 0) await writeTx(statements);

  if (actions.length === 0 && (text ?? "").trim().length > 0) {
    unmatched.push(
      `No actionable state change found in this bulletin. Supported forms: "<road or bridge> is now unsafe/blocked/flooded", "<shelter> has reached capacity", "<n> vans are available near <place>".`,
    );
  }

  return { applied, unmatched };
}
