/**
 * Why was every OTHER destination rejected?
 *
 * A recommendation is only trustworthy if the system can say what it ruled out
 * and why. Every reason below is derived from the graph, including the count of
 * candidate walks that were eliminated specifically because they crossed a
 * segment with a BLOCKED_BY edge to an active hazard.
 */
export const REJECTED_CYPHER = `
MATCH (fam:Family {id: $familyId})-[:LOCATED_AT]->(origin:Location)
OPTIONAL MATCH (fam)-[:HAS_MEMBER]->(:Person)-[:HAS_NEED]->(personNeed:Need)
OPTIONAL MATCH (fam)-[:HAS_NEED]->(familyNeed:Need)
WITH fam, origin,
     [n IN collect(DISTINCT personNeed) + collect(DISTINCT familyNeed) WHERE n IS NOT NULL] AS needs
WITH fam, origin,
     any(n IN needs WHERE n.kind = 'mobility_assistance') AS requireStepFree,
     (fam.hasVehicle = false)                             AS requireTransport,
     [n IN needs WHERE n.kind IN $medicalNeedKinds | n.kind] AS medicalKinds

MATCH (shelter:Shelter)-[:LOCATED_AT]->(destLoc:Location)

// Every walk that exists if we ignore hazards entirely...
CALL {
  WITH origin, destLoc
  MATCH p = (origin)-[:CONNECTS*2..14]-(destLoc)
  WITH p, [x IN nodes(p) WHERE x:Location] AS locs
  WHERE size(locs) = size(apoc.coll.toSet(locs))
  RETURN count(p) AS totalWalks
}
// ...versus the walks that survive the live hazard state.
CALL {
  WITH origin, destLoc, requireStepFree, requireTransport
  MATCH p = (origin)-[:CONNECTS*2..14]-(destLoc)
  WHERE all(n IN nodes(p) WHERE
        NOT n:Segment OR (
          n.status <> 'blocked'
          AND NOT exists((n)-[:BLOCKED_BY]->(:Hazard {active: true}))
          AND (requireTransport = false OR n.accessibility <> 'foot_only')
          AND (requireStepFree  = false OR n.accessibility = 'full')))
  WITH p, [x IN nodes(p) WHERE x:Location] AS locs
  WHERE size(locs) = size(apoc.coll.toSet(locs))
  RETURN count(p) AS viableWalks
}
// How many were killed by an ACTIVE HAZARD specifically (vs accessibility)?
CALL {
  WITH origin, destLoc
  MATCH p = (origin)-[:CONNECTS*2..14]-(destLoc)
  WITH p, [x IN nodes(p) WHERE x:Location] AS locs,
       [x IN nodes(p) WHERE x:Segment AND exists((x)-[:BLOCKED_BY]->(:Hazard {active: true}))] AS blockedSegs
  WHERE size(locs) = size(apoc.coll.toSet(locs)) AND size(blockedSegs) > 0
  RETURN count(p) AS hazardBlockedWalks,
         collect(DISTINCT [s IN blockedSegs | s.name]) AS blockedNameLists
}

WITH fam, shelter, destLoc, requireStepFree, medicalKinds,
     totalWalks, viableWalks, hazardBlockedWalks,
     apoc.coll.toSet(apoc.coll.flatten(blockedNameLists)) AS blockedNames
WITH fam, shelter, destLoc, requireStepFree, medicalKinds,
     totalWalks, viableWalks, hazardBlockedWalks, blockedNames,
     CASE
       WHEN shelter.status = 'closed'                                     THEN 'closed'
       WHEN shelter.occupancy + fam.size > shelter.capacity               THEN 'at_capacity'
       WHEN requireStepFree AND shelter.wheelchairAccessible = false      THEN 'not_step_free'
       WHEN viableWalks = 0 AND hazardBlockedWalks > 0                    THEN 'blocked_by_hazard'
       WHEN viableWalks = 0                                               THEN 'unreachable'
       ELSE 'viable'
     END AS reasonCode
WHERE reasonCode <> 'viable' OR hazardBlockedWalks > 0
RETURN shelter.id   AS shelterId,
       shelter.name AS shelterName,
       shelter.capacity AS capacity,
       shelter.occupancy AS occupancy,
       shelter.wheelchairAccessible AS wheelchairAccessible,
       reasonCode,
       totalWalks, viableWalks, hazardBlockedWalks,
       blockedNames
ORDER BY reasonCode, shelterName
`;
