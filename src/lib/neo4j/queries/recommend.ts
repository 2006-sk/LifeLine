/**
 * THE core query. Everything Lifeline claims about safety is decided here, in
 * Cypher, inside Neo4j.
 *
 * What Neo4j does (not the application):
 *   1. reads the family's needs by traversing Family -> Person -> Need
 *   2. enumerates every physical walk from the family to every shelter
 *   3. rejects walks mid-traversal using graph predicates -- a segment is
 *      dropped because a BLOCKED_BY edge to an active hazard exists, not
 *      because a flag was copied somewhere
 *   4. enumerates pickup walks from every qualifying responder to the family
 *   5. matches medical resources through Shelter -> NEAR -> CareSite ->
 *      HAS_RESOURCE -> Resource -> SATISFIES -> Need
 *   6. scores and ranks the surviving combinations
 *
 * The application receives an ordered list of viable plans and renders them.
 * It never decides which one is safe.
 */

export const WEIGHTS = {
  /** per minute the family itself is travelling */
  wTime: 1.0,
  /** per minute a responder needs to reach the family */
  wPickup: 0.6,
  /** per unit of summed per-segment flood exposure along the route */
  wRiskSum: 12.0,
  /** per unit of the single worst segment on the route */
  wMaxRisk: 10.0,
  /** per route node that sits inside an ACTIVE hazard footprint */
  wHazardNode: 30.0,
  /** credit per free bed at the destination, capped by headroomCap */
  wHeadroom: -0.25,
  headroomCap: 60,
  /** per 100m from the shelter to a care site holding the needed medicine */
  wClinicPer100m: 1.2,
  /** applied when a required medical resource has no reachable care site */
  wNoClinic: 60.0,
  /** maximum segments in a route (relationship hops = 2x) */
  maxHops: 12,
} as const;

export type Weights = typeof WEIGHTS;

/**
 * Ordered element of a path as returned by Cypher: alternating Location and
 * Segment nodes, starting and ending at a Location.
 */
export interface RawPathElement {
  id: string;
  name: string;
  labels: string[];
  lat: number | null;
  lng: number | null;
  travelMinutes: number | null;
  floodRisk: number | null;
  accessibility: string | null;
  status: string | null;
  kind: string | null;
  inHazardZone: boolean;
}

export interface RawPlanRow {
  shelterId: string;
  shelterName: string;
  shelterCapacity: number;
  shelterOccupancy: number;
  shelterWheelchair: boolean;
  destLocationId: string;
  destLocationName: string;
  elements: RawPathElement[];
  travelMinutes: number;
  riskSum: number;
  maxRisk: number;
  hazardNodes: number;
  pathOptions: number;
  headroom: number;
  careSiteId: string | null;
  careSiteName: string | null;
  careSiteKind: string | null;
  careMeters: number | null;
  careResources: { id: string; name: string; type: string; quantity: number }[];
  medicalKinds: string[];
  needsMetKinds: string[];
  requireStepFree: boolean;
  requireTransport: boolean;
  familySize: number;
  transport: {
    volunteerId: string;
    volunteerName: string;
    vehicleId: string;
    vehicleName: string;
    vehicleType: string;
    wheelchairAccessible: boolean;
    capacity: number;
    stagedAtId: string;
    stagedAtName: string;
    pickupMinutes: number;
    elements: RawPathElement[];
  } | null;
  totalScore: number;
}

/**
 * A single traversal predicate, reused for both the family's route and the
 * responder's pickup route. A Segment survives only if:
 *   - it is not marked blocked, AND
 *   - it has no BLOCKED_BY edge to a currently active hazard, AND
 *   - it admits a vehicle when the family needs to be driven, AND
 *   - it is fully step-free when someone in the family needs that.
 */
const SEGMENT_PREDICATE = `
        NOT n:Segment OR (
          n.status <> 'blocked'
          AND NOT exists((n)-[:BLOCKED_BY]->(:Hazard {active: true}))
          AND (requireTransport = false OR n.accessibility <> 'foot_only')
          AND (requireStepFree  = false OR n.accessibility = 'full')
        )`;

/** Projects a path into an ordered, JSON-friendly element list. */
const PATH_ELEMENTS = `
      [x IN nodes(__path__) | {
        id: x.id,
        name: x.name,
        labels: labels(x),
        lat: x.lat,
        lng: x.lng,
        travelMinutes: x.travelMinutes,
        floodRisk: x.floodRisk,
        accessibility: x.accessibility,
        status: x.status,
        kind: x.kind,
        inHazardZone: exists((x)-[:AFFECTED_BY]->(:Hazard {active: true}))
      }]`;

export const RECOMMEND_CYPHER = `
// ---------------------------------------------------------------------------
// 1. WHO are we routing, WHERE are they, and WHAT do they need?
//    Needs are read from the graph -- both the household's own needs and the
//    needs attached to individual members.
// ---------------------------------------------------------------------------
MATCH (fam:Family {id: $familyId})-[:LOCATED_AT]->(origin:Location)
OPTIONAL MATCH (fam)-[:HAS_MEMBER]->(:Person)-[:HAS_NEED]->(personNeed:Need)
OPTIONAL MATCH (fam)-[:HAS_NEED]->(familyNeed:Need)
WITH fam, origin,
     [n IN collect(DISTINCT personNeed) + collect(DISTINCT familyNeed) WHERE n IS NOT NULL] AS needs
WITH fam, origin, needs,
     any(n IN needs WHERE n.kind = 'mobility_assistance')                                   AS requireStepFree,
     (fam.hasVehicle = false)                                                               AS requireTransport,
     [n IN needs WHERE n.kind IN $medicalNeedKinds | n.kind]                                AS medicalKinds

// ---------------------------------------------------------------------------
// 2. TRANSPORT. Which responder can physically reach this family right now,
//    with a vehicle that fits them and supports their mobility need?
//    The pickup leg is itself a hazard-aware traversal, so a responder who is
//    cut off by the flood silently stops being an option.
// ---------------------------------------------------------------------------
CALL {
  WITH fam, origin, requireStepFree, requireTransport
  MATCH (vol:Volunteer)-[:AVAILABLE_AT]->(volLoc:Location)
  MATCH (vol)-[:HAS_VEHICLE]->(veh:Vehicle)
  WHERE requireTransport = true
    AND vol.status = 'available'
    AND veh.status = 'ready'
    AND veh.capacity >= fam.size
    AND (requireStepFree = false OR veh.wheelchairAccessible = true)
  MATCH pickupPath = (volLoc)-[:CONNECTS*0..${WEIGHTS.maxHops * 2}]-(origin)
  WHERE all(n IN nodes(pickupPath) WHERE ${SEGMENT_PREDICATE.replace(/\bn\b(?=:Segment)/g, "n")})
  WITH vol, veh, volLoc, pickupPath,
       [x IN nodes(pickupPath) WHERE x:Segment]  AS psegs,
       [x IN nodes(pickupPath) WHERE x:Location] AS plocs
  WHERE size(plocs) = size(apoc.coll.toSet(plocs))
  WITH vol, veh, volLoc, pickupPath, psegs,
       reduce(t = 0.0, s IN psegs | t + s.travelMinutes) AS pickupMinutes,
       reduce(t = 0.0, s IN psegs | t + s.floodRisk)     AS pickupRisk
  ORDER BY pickupMinutes ASC, pickupRisk ASC
  WITH collect({
        volunteerId: vol.id, volunteerName: vol.name,
        vehicleId: veh.id, vehicleName: veh.name, vehicleType: veh.type,
        wheelchairAccessible: veh.wheelchairAccessible, capacity: veh.capacity,
        stagedAtId: volLoc.id, stagedAtName: volLoc.name,
        pickupMinutes: pickupMinutes,
        elements: ${PATH_ELEMENTS.replace(/__path__/g, "pickupPath")}
      }) AS options
  RETURN options[0] AS transport
}
// A family that cannot be reached has no viable plan at all: drop every
// candidate so the caller falls through to missing-link diagnosis.
WITH fam, origin, needs, requireStepFree, requireTransport, medicalKinds, transport
WHERE requireTransport = false OR transport IS NOT NULL

// ---------------------------------------------------------------------------
// 3. DESTINATIONS. Structural filters first: a shelter that is closed, out of
//    room for this household, or not step-free for a wheelchair user is not a
//    destination at all.
// ---------------------------------------------------------------------------
MATCH (shelter:Shelter)-[:LOCATED_AT]->(destLoc:Location)
WHERE shelter.status <> 'closed'
  AND shelter.occupancy + fam.size <= shelter.capacity
  AND (requireStepFree = false OR shelter.wheelchairAccessible = true)

// ---------------------------------------------------------------------------
// 4. THE TRAVERSAL. Every walk from the family to that shelter, with unusable
//    segments rejected as the path is built.
// ---------------------------------------------------------------------------
MATCH routePath = (origin)-[:CONNECTS*2..${WEIGHTS.maxHops * 2}]-(destLoc)
WHERE all(n IN nodes(routePath) WHERE ${SEGMENT_PREDICATE})
WITH fam, origin, needs, requireStepFree, requireTransport, medicalKinds, transport,
     shelter, destLoc, routePath,
     [x IN nodes(routePath) WHERE x:Segment]  AS segs,
     [x IN nodes(routePath) WHERE x:Location] AS locs
// no doubling back through a location we have already passed
WHERE size(locs) = size(apoc.coll.toSet(locs))

// ---------------------------------------------------------------------------
// 5. PATH METRICS, computed by Neo4j over the traversed relationships.
// ---------------------------------------------------------------------------
WITH fam, origin, needs, requireStepFree, requireTransport, medicalKinds, transport,
     shelter, destLoc, routePath, segs, locs,
     reduce(t = 0.0, s IN segs | t + s.travelMinutes) AS travelMinutes,
     reduce(t = 0.0, s IN segs | t + s.floodRisk)     AS riskSum,
     reduce(m = 0.0, s IN segs | CASE WHEN s.floodRisk > m THEN s.floodRisk ELSE m END) AS maxRisk,
     size([l IN locs WHERE l <> origin
           AND exists((l)-[:AFFECTED_BY]->(:Hazard {active: true}))]) AS hazardNodes
WITH fam, origin, needs, requireStepFree, requireTransport, medicalKinds, transport,
     shelter, destLoc, routePath, travelMinutes, riskSum, maxRisk, hazardNodes,
     (travelMinutes * $wTime)
       + (riskSum * $wRiskSum)
       + (maxRisk * $wMaxRisk)
       + (hazardNodes * $wHazardNode) AS pathCost

// keep only the best walk to each shelter, but remember how many we considered
ORDER BY pathCost ASC
WITH fam, origin, needs, requireStepFree, requireTransport, medicalKinds, transport,
     shelter, destLoc,
     collect({
       path: routePath, travelMinutes: travelMinutes, riskSum: riskSum,
       maxRisk: maxRisk, hazardNodes: hazardNodes, pathCost: pathCost
     }) AS walks
WITH fam, origin, needs, requireStepFree, requireTransport, medicalKinds, transport,
     shelter, destLoc, walks[0] AS best, size(walks) AS pathOptions

// ---------------------------------------------------------------------------
// 6. RESOURCE MATCHING through the graph:
//      Shelter -> NEAR -> CareSite -> HAS_RESOURCE -> Resource -> SATISFIES -> Need
//    A care site only counts if it is open, outside the active hazard
//    footprint, and actually stocks something that satisfies a medical need
//    this family has.
// ---------------------------------------------------------------------------
CALL {
  WITH destLoc, medicalKinds
  OPTIONAL MATCH (destLoc)-[near:NEAR]->(careLoc:Location)<-[:LOCATED_AT]-(care:CareSite)
  WHERE care.status <> 'closed'
    AND NOT exists((careLoc)-[:AFFECTED_BY]->(:Hazard {active: true}))
    AND (size(medicalKinds) = 0 OR exists {
          MATCH (care)-[:HAS_RESOURCE]->(r:Resource)-[:SATISFIES]->(need:Need)
          WHERE need.kind IN medicalKinds AND r.status <> 'out'
        })
  WITH care, careLoc, near,
       [(care)-[:HAS_RESOURCE]->(r:Resource)-[:SATISFIES]->(need:Need)
         WHERE need.kind IN medicalKinds AND r.status <> 'out'
         | {id: r.id, name: r.name, type: r.type, quantity: r.quantity}] AS matched
  ORDER BY near.meters ASC
  WITH collect({
        id: care.id, name: care.name, kind: care.kind,
        meters: near.meters, resources: matched
      }) AS sites
  RETURN [s IN sites WHERE s.id IS NOT NULL][0] AS careSite
}

// on-site resources at the shelter itself (step-free ward, cots, formula)
CALL {
  WITH shelter, medicalKinds
  MATCH (shelter)-[:HAS_RESOURCE]->(r:Resource)-[:SATISFIES]->(need:Need)
  WHERE r.status <> 'out'
  RETURN collect(DISTINCT need.kind) AS onSiteNeedKinds
}

// ---------------------------------------------------------------------------
// 7. FINAL SCORE. Lower is safer. Ordering is done by Neo4j.
// ---------------------------------------------------------------------------
WITH fam, origin, needs, requireStepFree, requireTransport, medicalKinds, transport,
     shelter, destLoc, best, pathOptions, careSite, onSiteNeedKinds,
     (shelter.capacity - shelter.occupancy - fam.size) AS headroom
WITH fam, origin, needs, requireStepFree, requireTransport, medicalKinds, transport,
     shelter, destLoc, best, pathOptions, careSite, onSiteNeedKinds, headroom,
     CASE
       WHEN size(medicalKinds) = 0 THEN 0.0
       WHEN careSite IS NULL       THEN $wNoClinic
       ELSE (careSite.meters / 100.0) * $wClinicPer100m
     END AS careCost,
     (CASE WHEN headroom > $headroomCap THEN $headroomCap ELSE headroom END) * $wHeadroom AS headroomCredit,
     coalesce(transport.pickupMinutes, 0.0) * $wPickup AS pickupCost
WITH fam, origin, requireStepFree, requireTransport, medicalKinds, transport,
     shelter, destLoc, best, pathOptions, careSite, onSiteNeedKinds, headroom,
     careCost, headroomCredit, pickupCost,
     best.pathCost + careCost + headroomCredit + pickupCost AS totalScore
ORDER BY totalScore ASC

RETURN
  shelter.id                   AS shelterId,
  shelter.name                 AS shelterName,
  shelter.capacity             AS shelterCapacity,
  shelter.occupancy            AS shelterOccupancy,
  shelter.wheelchairAccessible AS shelterWheelchair,
  destLoc.id                   AS destLocationId,
  destLoc.name                 AS destLocationName,
  ${PATH_ELEMENTS.replace(/__path__/g, "best.path")} AS elements,
  best.travelMinutes AS travelMinutes,
  best.riskSum       AS riskSum,
  best.maxRisk       AS maxRisk,
  best.hazardNodes   AS hazardNodes,
  pathOptions        AS pathOptions,
  headroom           AS headroom,
  careSite.id        AS careSiteId,
  careSite.name      AS careSiteName,
  careSite.kind      AS careSiteKind,
  careSite.meters    AS careMeters,
  coalesce(careSite.resources, []) AS careResources,
  medicalKinds       AS medicalKinds,
  onSiteNeedKinds    AS needsMetKinds,
  requireStepFree    AS requireStepFree,
  requireTransport   AS requireTransport,
  fam.size           AS familySize,
  transport          AS transport,
  totalScore         AS totalScore
`;

export function recommendParams(familyId: string, weights: Weights = WEIGHTS) {
  return {
    familyId,
    medicalNeedKinds: ["asthma_medication", "insulin", "oxygen", "infant_formula"],
    wTime: weights.wTime,
    wPickup: weights.wPickup,
    wRiskSum: weights.wRiskSum,
    wMaxRisk: weights.wMaxRisk,
    wHazardNode: weights.wHazardNode,
    wHeadroom: weights.wHeadroom,
    headroomCap: weights.headroomCap,
    wClinicPer100m: weights.wClinicPer100m,
    wNoClinic: weights.wNoClinic,
  };
}
