/**
 * Disruptions are GRAPH WRITES, not UI state.
 *
 * "Flood Riverside Road" does not set a flag the frontend reads. It MERGEs
 * BLOCKED_BY relationships between segments and a hazard node inside Neo4j.
 * Every subsequent traversal sees a different world because the world itself
 * changed. That is the whole point of the demo.
 */

export const ACTIVATE_HAZARD_CYPHER = `
MATCH (h:Hazard {id: $hazardId})
SET h.active = true
WITH h
CALL {
  WITH h
  UNWIND $blockSegmentIds AS segId
  MATCH (s:Segment {id: segId})
  MERGE (s)-[:BLOCKED_BY]->(h)
  SET s.status = 'blocked'
  RETURN collect(s {.id, .name, .kind}) AS blocked
}
CALL {
  WITH h
  UNWIND $affectLocationIds AS locId
  MATCH (l:Location {id: locId})
  MERGE (l)-[:AFFECTED_BY]->(h)
  RETURN collect(l {.id, .name}) AS affected
}
MERGE (a:Alert {id: $alertId})
SET a.title = h.name, a.severity = h.severity, a.issuedAt = datetime(),
    a.body = h.description, a.hazardType = h.hazardType
WITH h, blocked, affected, a
UNWIND (CASE WHEN size($blockSegmentIds) = 0 THEN [null] ELSE $blockSegmentIds END) AS segId
OPTIONAL MATCH (s:Segment {id: segId})
FOREACH (_ IN CASE WHEN s IS NULL THEN [] ELSE [1] END | MERGE (a)-[:AFFECTS]->(s))
RETURN h {.id, .name, .hazardType, .severity, .description} AS hazard,
       blocked, affected, a.id AS alertId
`;

export const DEACTIVATE_HAZARD_CYPHER = `
MATCH (h:Hazard {id: $hazardId})
SET h.active = false
WITH h
OPTIONAL MATCH (s:Segment)-[r:BLOCKED_BY]->(h)
DELETE r
WITH h, collect(s) AS segs
FOREACH (s IN segs |
  SET s.status = CASE
    WHEN exists((s)-[:BLOCKED_BY]->(:Hazard {active: true})) THEN 'blocked'
    ELSE s.baseStatus END)
WITH h
OPTIONAL MATCH (:Location)-[ar:AFFECTED_BY]->(h)
DELETE ar
RETURN h.id AS hazardId
`;

export const BLOCK_SEGMENT_CYPHER = `
MATCH (s:Segment {id: $segmentId})
MERGE (h:Hazard {id: $hazardId})
ON CREATE SET h.name = $hazardName, h.hazardType = $hazardType, h.severity = $severity,
              h.description = $description, h.baseActive = false, h.footprint = []
SET h.active = true
MERGE (s)-[:BLOCKED_BY]->(h)
SET s.status = 'blocked'
MERGE (a:Alert {id: $alertId})
SET a.title = $hazardName, a.body = $description, a.severity = $severity, a.issuedAt = datetime()
MERGE (a)-[:AFFECTS]->(s)
RETURN s {.id, .name, .kind, .status} AS segment, h {.id, .name, .severity} AS hazard
`;

export const SET_SHELTER_FULL_CYPHER = `
MATCH (s:Shelter {id: $shelterId})
SET s.occupancy = s.capacity, s.status = 'full'
MERGE (a:Alert {id: $alertId})
SET a.title = s.name + ' has reached capacity',
    a.body = s.name + ' is no longer accepting arrivals.',
    a.severity = 0.6, a.issuedAt = datetime()
MERGE (a)-[:AFFECTS]->(s)
RETURN s {.id, .name, .capacity, .occupancy, .status} AS shelter
`;

export const SET_VOLUNTEER_STATUS_CYPHER = `
MATCH (v:Volunteer {id: $volunteerId})
SET v.status = $status
WITH v
OPTIONAL MATCH (v)-[:HAS_VEHICLE]->(veh:Vehicle)
RETURN v {.id, .name, .status} AS volunteer, veh {.id, .name} AS vehicle
`;

/** Ripple: what does this hazard touch, one hop at a time? Used for the impact animation. */
export const HAZARD_RIPPLE_CYPHER = `
MATCH (h:Hazard {id: $hazardId})
OPTIONAL MATCH (h)<-[:BLOCKED_BY]-(seg:Segment)
OPTIONAL MATCH (seg)-[:CONNECTS]->(loc:Location)
OPTIONAL MATCH (loc)<-[:LOCATED_AT]-(fam:Family)
OPTIONAL MATCH (loc)<-[:AVAILABLE_AT]-(vol:Volunteer)
OPTIONAL MATCH (loc)<-[:LOCATED_AT]-(sh:Shelter)
RETURN h {.id, .name, .hazardType, .severity} AS hazard,
       collect(DISTINCT seg {.id, .name})  AS segments,
       collect(DISTINCT loc {.id, .name})  AS locations,
       collect(DISTINCT fam {.id, .name})  AS families,
       collect(DISTINCT vol {.id, .name})  AS volunteers,
       collect(DISTINCT sh  {.id, .name})  AS shelters
`;
