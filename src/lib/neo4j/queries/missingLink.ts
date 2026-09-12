/**
 * THE MISSING LINK.
 *
 * When no complete plan exists, the interesting question is not "no route
 * found" but WHICH SINGLE RELATIONSHIP would restore one. We answer that by
 * relaxing one constraint at a time against the live graph and seeing which
 * relaxation brings plans back. That is only cheap because the candidate space
 * is a graph traversal rather than a search over the whole world.
 */

/** Does a viable plan exist under a relaxed constraint set? */
export const RELAXED_FEASIBILITY_CYPHER = `
MATCH (fam:Family {id: $familyId})-[:LOCATED_AT]->(origin:Location)
OPTIONAL MATCH (fam)-[:HAS_MEMBER]->(:Person)-[:HAS_NEED]->(personNeed:Need)
OPTIONAL MATCH (fam)-[:HAS_NEED]->(familyNeed:Need)
WITH fam, origin,
     [n IN collect(DISTINCT personNeed) + collect(DISTINCT familyNeed) WHERE n IS NOT NULL] AS needs
WITH fam, origin,
     (any(n IN needs WHERE n.kind = 'mobility_assistance') AND NOT $relaxStepFree) AS requireStepFree,
     ((fam.hasVehicle = false) AND NOT $relaxTransport)                            AS requireTransport

CALL {
  WITH fam, origin, requireStepFree, requireTransport
  MATCH (vol:Volunteer)-[:AVAILABLE_AT]->(volLoc:Location)
  MATCH (vol)-[:HAS_VEHICLE]->(veh:Vehicle)
  WHERE requireTransport = true
    AND vol.status = 'available' AND veh.status = 'ready'
    AND veh.capacity >= fam.size
    AND (requireStepFree = false OR veh.wheelchairAccessible = true)
  MATCH pp = (volLoc)-[:CONNECTS*0..24]-(origin)
  WHERE all(n IN nodes(pp) WHERE NOT n:Segment OR (
          n.status <> 'blocked'
          AND NOT exists((n)-[:BLOCKED_BY]->(:Hazard {active: true}))
          AND n.accessibility <> 'foot_only'
          AND (requireStepFree = false OR n.accessibility = 'full')))
  RETURN count(pp) AS pickups
}
WITH fam, origin, requireStepFree, requireTransport, pickups
WHERE requireTransport = false OR pickups > 0

MATCH (shelter:Shelter)-[:LOCATED_AT]->(destLoc:Location)
WHERE shelter.status <> 'closed'
  AND ($relaxCapacity OR shelter.occupancy + fam.size <= shelter.capacity)
  AND (requireStepFree = false OR shelter.wheelchairAccessible = true)
MATCH p = (origin)-[:CONNECTS*2..24]-(destLoc)
WHERE all(n IN nodes(p) WHERE NOT n:Segment OR (
        n.status <> 'blocked'
        AND NOT exists((n)-[:BLOCKED_BY]->(:Hazard {active: true}))
        AND (requireTransport = false OR n.accessibility <> 'foot_only')
        AND (requireStepFree  = false OR n.accessibility = 'full')))
RETURN count(DISTINCT shelter) AS feasibleShelters
`;

/**
 * The responder who WOULD solve an accessible-transport gap, and why they
 * currently cannot. Ordered so the closest near-miss surfaces first.
 */
export const NEAREST_ACCESSIBLE_RESPONDER_CYPHER = `
MATCH (vol:Volunteer)-[:HAS_VEHICLE]->(veh:Vehicle)
WHERE veh.wheelchairAccessible = true AND vol.status <> 'available'
OPTIONAL MATCH (vol)-[:AVAILABLE_AT]->(loc:Location)
RETURN vol.id AS volunteerId, vol.name AS volunteerName, vol.status AS status,
       vol.distanceOutsideZoneKm AS distanceOutsideZoneKm,
       veh.id AS vehicleId, veh.name AS vehicleName,
       loc.id AS locationId, loc.name AS locationName
ORDER BY coalesce(vol.distanceOutsideZoneKm, 999) ASC, vol.name ASC
`;

/**
 * If the family truly cannot leave, where is the safest place they can still
 * reach on foot? Graph answer to "what do we tell them right now".
 */
export const NEAREST_SAFE_WAIT_POINT_CYPHER = `
MATCH (fam:Family {id: $familyId})-[:LOCATED_AT]->(origin:Location)
MATCH p = (origin)-[:CONNECTS*2..8]-(safe:Location)
WHERE safe <> origin
  AND all(n IN nodes(p) WHERE NOT n:Segment OR (
        n.status <> 'blocked'
        AND NOT exists((n)-[:BLOCKED_BY]->(:Hazard {active: true}))))
  AND NOT exists((safe)-[:AFFECTED_BY]->(:Hazard {active: true}))
WITH safe, p,
     reduce(t = 0.0, s IN [x IN nodes(p) WHERE x:Segment] | t + s.travelMinutes) AS minutes
ORDER BY safe.safetyScore DESC, minutes ASC
WITH safe, collect(minutes)[0] AS minutes
RETURN safe.id AS locationId, safe.name AS locationName,
       safe.safetyScore AS safetyScore, safe.elevation AS elevation, minutes
ORDER BY safetyScore DESC, minutes ASC
LIMIT 3
`;
