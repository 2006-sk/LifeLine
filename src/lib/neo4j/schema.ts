/**
 * Constraints + indexes for the Lifeline graph.
 *
 * Every node label that is addressed by id gets a uniqueness constraint, which
 * also creates the backing index that keeps the path-enumeration queries fast.
 */
export const CONSTRAINTS: string[] = [
  "CREATE CONSTRAINT location_id IF NOT EXISTS FOR (n:Location) REQUIRE n.id IS UNIQUE",
  "CREATE CONSTRAINT segment_id IF NOT EXISTS FOR (n:Segment) REQUIRE n.id IS UNIQUE",
  "CREATE CONSTRAINT shelter_id IF NOT EXISTS FOR (n:Shelter) REQUIRE n.id IS UNIQUE",
  "CREATE CONSTRAINT clinic_id IF NOT EXISTS FOR (n:Clinic) REQUIRE n.id IS UNIQUE",
  "CREATE CONSTRAINT hospital_id IF NOT EXISTS FOR (n:Hospital) REQUIRE n.id IS UNIQUE",
  "CREATE CONSTRAINT resource_id IF NOT EXISTS FOR (n:Resource) REQUIRE n.id IS UNIQUE",
  "CREATE CONSTRAINT vehicle_id IF NOT EXISTS FOR (n:Vehicle) REQUIRE n.id IS UNIQUE",
  "CREATE CONSTRAINT volunteer_id IF NOT EXISTS FOR (n:Volunteer) REQUIRE n.id IS UNIQUE",
  "CREATE CONSTRAINT need_id IF NOT EXISTS FOR (n:Need) REQUIRE n.id IS UNIQUE",
  "CREATE CONSTRAINT person_id IF NOT EXISTS FOR (n:Person) REQUIRE n.id IS UNIQUE",
  "CREATE CONSTRAINT family_id IF NOT EXISTS FOR (n:Family) REQUIRE n.id IS UNIQUE",
  "CREATE CONSTRAINT hazard_id IF NOT EXISTS FOR (n:Hazard) REQUIRE n.id IS UNIQUE",
  "CREATE CONSTRAINT alert_id IF NOT EXISTS FOR (n:Alert) REQUIRE n.id IS UNIQUE",
  "CREATE CONSTRAINT plan_id IF NOT EXISTS FOR (n:Plan) REQUIRE n.id IS UNIQUE",
];

export const INDEXES: string[] = [
  "CREATE INDEX segment_status IF NOT EXISTS FOR (n:Segment) ON (n.status)",
  "CREATE INDEX hazard_active IF NOT EXISTS FOR (n:Hazard) ON (n.active)",
  "CREATE INDEX volunteer_status IF NOT EXISTS FOR (n:Volunteer) ON (n.status)",
  "CREATE INDEX shelter_status IF NOT EXISTS FOR (n:Shelter) ON (n.status)",
  "CREATE INDEX need_kind IF NOT EXISTS FOR (n:Need) ON (n.kind)",
  "CREATE INDEX resource_type IF NOT EXISTS FOR (n:Resource) ON (n.type)",
  "CREATE INDEX plan_family IF NOT EXISTS FOR (n:Plan) ON (n.familyId)",
];

/**
 * THE GRAPH MODEL — and why it is shaped this way.
 *
 * Roads and bridges are NODES (:Segment:Road / :Segment:Bridge), not
 * relationships, and each one carries two [:CONNECTS] relationships to the
 * Locations at its ends:
 *
 *     (:Location)<-[:CONNECTS]-(:Segment)-[:CONNECTS]->(:Location)
 *
 * The physical network is therefore a bipartite Location/Segment graph, and a
 * journey is an undirected variable-length walk that alternates between them:
 *
 *     MATCH p = (origin:Location)-[:CONNECTS*2..14]-(dest:Location)
 *
 * WHY NOT put road properties on the relationship?  Because a hazard has to be
 * able to point AT a road:  (:Segment)-[:BLOCKED_BY]->(:Hazard).  Neo4j has no
 * relationship-to-node edges, so a road modelled as a relationship could never
 * be the target of a hazard, an alert or a plan. Segment-as-node keeps ONE
 * representation of the world: blocking a road is a single MERGE of a
 * BLOCKED_BY edge, and the path predicate that rejects it reads that edge
 * directly during traversal. There is no derived copy of the network to keep
 * in sync, and therefore no way for the map, the graph and the router to
 * disagree about which roads are open.
 */
export const RELATIONSHIP_TYPES = [
  "HAS_MEMBER",
  "HAS_NEED",
  "LOCATED_AT",
  "CONNECTS",
  "BLOCKED_BY",
  "AFFECTED_BY",
  "HAS_RESOURCE",
  "SATISFIES",
  "HAS_VEHICLE",
  "AVAILABLE_AT",
  "SUPPORTS_NEED",
  "CAN_ASSIST",
  "NEAR",
  "AFFECTS",
  "USES",
  "FOR_FAMILY",
] as const;
