/**
 * Plans live IN the graph.
 *
 * Persisting a recommendation as (:Plan)-[:USES]->(Segment|Shelter|Volunteer)
 * turns "is the current plan still valid?" into a one-hop traversal from the
 * hazard rather than a diff computed on the client. When a hazard activates we
 * ask the graph which plans it just broke, and it answers by walking the edges
 * the plan depends on.
 */

export const PERSIST_PLAN_CYPHER = `
MATCH (fam:Family {id: $familyId})
MERGE (plan:Plan {id: $planId})
SET plan.familyId = $familyId,
    plan.createdAt = datetime(),
    plan.status = 'active',
    plan.score = $score,
    plan.destinationId = $shelterId,
    plan.summary = $summary
MERGE (plan)-[:FOR_FAMILY]->(fam)
WITH plan
// supersede any earlier plan for this family.
// OPTIONAL: on the very first plan there is nothing to supersede, and a plain
// MATCH here would eliminate the row and silently skip every USES edge below.
OPTIONAL MATCH (old:Plan {familyId: $familyId})
WHERE old.id <> plan.id AND old.status = 'active'
SET old.status = 'superseded'
WITH DISTINCT plan
UNWIND $usesIds AS usedId
MATCH (used) WHERE used.id = usedId
  AND (used:Segment OR used:Shelter OR used:Volunteer OR used:Vehicle OR used:CareSite)
MERGE (plan)-[:USES]->(used)
RETURN plan.id AS planId
`;

/**
 * Which active plans does this hazard invalidate?
 * Hazard -> (blocked) Segment <- USES - Plan -> FOR_FAMILY -> Family
 */
export const PLANS_INVALIDATED_BY_HAZARD_CYPHER = `
MATCH (h:Hazard {id: $hazardId})<-[:BLOCKED_BY]-(seg:Segment)<-[:USES]-(plan:Plan)-[:FOR_FAMILY]->(fam:Family)
WHERE plan.status = 'active' AND h.active = true
WITH plan, fam, collect(DISTINCT seg {.id, .name}) AS brokenSegments
SET plan.status = 'compromised'
RETURN plan.id AS planId, fam.id AS familyId, fam.name AS familyName,
       plan.summary AS summary, brokenSegments
`;

/** Any plan that depends on a resource that is no longer usable. */
export const PLANS_COMPROMISED_CYPHER = `
MATCH (plan:Plan)-[:FOR_FAMILY]->(fam:Family)
WHERE plan.status = 'active'
OPTIONAL MATCH (plan)-[:USES]->(seg:Segment)
  WHERE seg.status = 'blocked' OR exists((seg)-[:BLOCKED_BY]->(:Hazard {active: true}))
OPTIONAL MATCH (plan)-[:USES]->(sh:Shelter)
  WHERE sh.status = 'full' OR sh.occupancy >= sh.capacity
OPTIONAL MATCH (plan)-[:USES]->(vol:Volunteer)
  WHERE vol.status <> 'available'
WITH plan, fam,
     collect(DISTINCT seg {.id, .name, reason: 'segment_blocked'}) AS segs,
     collect(DISTINCT sh  {.id, .name, reason: 'shelter_full'})    AS shelters,
     collect(DISTINCT vol {.id, .name, reason: 'responder_unavailable'}) AS vols
WITH plan, fam, segs + shelters + vols AS broken
WHERE size(broken) > 0
RETURN plan.id AS planId, fam.id AS familyId, fam.name AS familyName,
       plan.summary AS summary, broken
`;

/**
 * Query 7 from the brief: explain the chosen plan as an ORDERED traversal.
 * Each row is one link in the chain of relationships that has to hold for the
 * recommendation to be true.
 */
export const EXPLAIN_PLAN_CYPHER = `
MATCH (plan:Plan {id: $planId})-[:FOR_FAMILY]->(fam:Family)
OPTIONAL MATCH (fam)-[:HAS_MEMBER]->(person:Person)-[:HAS_NEED]->(need:Need)
WITH plan, fam, [x IN collect(DISTINCT {
  step: 'need',
  fromId: person.id, fromLabel: person.name, fromType: 'person',
  rel: 'HAS_NEED',
  toId: need.id, toLabel: need.label, toType: 'need',
  sentence: person.name + ' (' + person.role + ') needs ' + need.label
}) WHERE x.fromId IS NOT NULL] AS needLinks

OPTIONAL MATCH (plan)-[:USES]->(vol:Volunteer)-[:HAS_VEHICLE]->(veh:Vehicle)
WITH plan, fam, needLinks, [x IN collect(DISTINCT {
  step: 'transport',
  fromId: vol.id, fromLabel: vol.name, fromType: 'volunteer',
  rel: 'HAS_VEHICLE',
  toId: veh.id, toLabel: veh.name, toType: 'vehicle',
  sentence: vol.name + ' is available with ' + veh.name +
            (CASE WHEN veh.wheelchairAccessible THEN ', which is wheelchair accessible' ELSE '' END)
}) WHERE x.fromId IS NOT NULL] AS transportLinks

OPTIONAL MATCH (plan)-[:USES]->(seg:Segment)
WITH plan, fam, needLinks, transportLinks, [x IN collect(DISTINCT {
  step: 'route',
  fromId: seg.id, fromLabel: seg.name, fromType: toLower(seg.kind),
  rel: 'CONNECTS',
  toId: seg.toId, toLabel: seg.name, toType: 'location',
  sentence: seg.name + ' is ' + seg.status + ' (' + toString(seg.travelMinutes) +
            ' min, flood risk ' + toString(round(seg.floodRisk * 100)) + '%)'
}) WHERE x.fromId IS NOT NULL] AS routeLinks

OPTIONAL MATCH (plan)-[:USES]->(shelter:Shelter)-[:LOCATED_AT]->(shLoc:Location)
OPTIONAL MATCH (shLoc)-[near:NEAR]->(careLoc:Location)<-[:LOCATED_AT]-(care:CareSite)
OPTIONAL MATCH (care)-[:HAS_RESOURCE]->(res:Resource)-[:SATISFIES]->(rneed:Need)
RETURN needLinks, transportLinks, routeLinks,
       [x IN collect(DISTINCT {
         step: 'destination',
         fromId: shelter.id, fromLabel: shelter.name, fromType: 'shelter',
         rel: 'HAS_CAPACITY',
         toId: shLoc.id, toLabel: shLoc.name, toType: 'location',
         sentence: shelter.name + ' has ' + toString(shelter.capacity - shelter.occupancy) +
                   ' spaces left' +
                   (CASE WHEN shelter.wheelchairAccessible THEN ' and is wheelchair accessible' ELSE '' END)
       }) WHERE x.fromId IS NOT NULL] AS destinationLinks,
       [x IN collect(DISTINCT CASE WHEN care IS NULL THEN NULL ELSE {
         step: 'resource',
         fromId: care.id, fromLabel: care.name, fromType: toLower(care.kind),
         rel: 'HAS_RESOURCE',
         toId: res.id, toLabel: res.name, toType: 'resource',
         sentence: care.name + ' is ' + toString(near.meters) + 'm away and holds ' +
                   res.name + ' (' + toString(res.quantity) + ' in stock)'
       } END) WHERE x IS NOT NULL] AS resourceLinks
`;
