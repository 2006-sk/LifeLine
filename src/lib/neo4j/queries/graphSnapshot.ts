/**
 * The whole world as a visualisation-friendly {nodes, edges} payload, read
 * straight out of Neo4j. The graph view and the map both consume this — there
 * is no second copy of the world maintained on the client.
 */
export const GRAPH_SNAPSHOT_CYPHER = `
CALL () {
  MATCH (n:Family)
  RETURN n.id AS id, 'family' AS type, n.name AS label, null AS lat, null AS lng,
         n {.size, .hasVehicle, .note} AS properties
UNION ALL
  MATCH (n:Person)
  RETURN n.id AS id, 'person' AS type, n.name AS label, null AS lat, null AS lng,
         n {.role, .age} AS properties
UNION ALL
  MATCH (n:Need)
  RETURN n.id AS id, 'need' AS type, n.label AS label, null AS lat, null AS lng,
         n {.kind, .critical} AS properties
UNION ALL
  MATCH (n:Location)
  RETURN n.id AS id, 'location' AS type, n.name AS label, n.lat AS lat, n.lng AS lng,
         n {.safetyScore, .elevation, .zone, .status} AS properties
UNION ALL
  MATCH (n:Segment)
  RETURN n.id AS id, toLower(n.kind) AS type, n.name AS label, null AS lat, null AS lng,
         n {.status, .travelMinutes, .floodRisk, .accessibility, .kind, .fromId, .toId} AS properties
UNION ALL
  MATCH (n:Shelter)
  RETURN n.id AS id, 'shelter' AS type, n.name AS label, null AS lat, null AS lng,
         n {.capacity, .occupancy, .wheelchairAccessible, .status} AS properties
UNION ALL
  MATCH (n:CareSite)
  RETURN n.id AS id, toLower(n.kind) AS type, n.name AS label, null AS lat, null AS lng,
         n {.status, .kind} AS properties
UNION ALL
  MATCH (n:Volunteer)
  RETURN n.id AS id, 'volunteer' AS type, n.name AS label, null AS lat, null AS lng,
         n {.status, .skills, .distanceOutsideZoneKm} AS properties
UNION ALL
  MATCH (n:Vehicle)
  RETURN n.id AS id, 'vehicle' AS type, n.name AS label, null AS lat, null AS lng,
         n {.type, .capacity, .wheelchairAccessible, .status} AS properties
UNION ALL
  MATCH (n:Resource)
  RETURN n.id AS id, 'resource' AS type, n.name AS label, null AS lat, null AS lng,
         n {.type, .quantity, .status} AS properties
UNION ALL
  MATCH (n:Hazard) WHERE n.active = true
  RETURN n.id AS id, 'hazard' AS type, n.name AS label, null AS lat, null AS lng,
         n {.hazardType, .severity, .active, .description} AS properties
UNION ALL
  MATCH (n:Alert)
  RETURN n.id AS id, 'alert' AS type, n.title AS label, null AS lat, null AS lng,
         n {.severity, .body} AS properties
}
RETURN collect({id: id, type: type, label: label, lat: lat, lng: lng, properties: properties}) AS nodes
`;

export const GRAPH_EDGES_CYPHER = `
MATCH (a)-[r]->(b)
WHERE a.id IS NOT NULL AND b.id IS NOT NULL
  AND NOT (a:Hazard AND a.active = false)
  AND NOT (b:Hazard AND b.active = false)
RETURN collect({
  id: a.id + '__' + type(r) + '__' + b.id,
  source: a.id,
  target: b.id,
  type: type(r),
  properties: properties(r)
}) AS edges
`;

/** Header counters — all read from the graph, never from client state. */
export const SCENARIO_STATE_CYPHER = `
CALL () { MATCH (h:Hazard {active: true}) RETURN collect(h {.id, .name, .hazardType, .severity}) AS activeHazards }
CALL () { MATCH (s:Segment) WHERE s.status = 'blocked' OR exists((s)-[:BLOCKED_BY]->(:Hazard {active: true}))
          RETURN collect(s.id) AS blockedSegments }
CALL () { MATCH (s:Shelter) WHERE s.status = 'full' OR s.occupancy >= s.capacity
          RETURN collect(s.id) AS fullShelters }
CALL () { MATCH (v:Volunteer) WHERE v.status <> 'available' RETURN collect(v.id) AS unavailableVolunteers }
CALL () { MATCH (s:Shelter) WHERE s.status = 'open' AND s.occupancy < s.capacity RETURN count(s) AS openShelters }
CALL () { MATCH (v:Volunteer {status: 'available'}) RETURN count(v) AS availableVolunteers }
CALL () { MATCH (f:Family) RETURN count(f) AS familiesMonitored }
CALL () { MATCH (a:Alert) RETURN collect(a {.id, .title, .body, .severity}) AS alerts }
RETURN activeHazards, blockedSegments, fullShelters, unavailableVolunteers,
       openShelters, availableVolunteers, familiesMonitored, alerts
`;
