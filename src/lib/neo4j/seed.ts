import { world } from "@/lib/world/world";
import { CONSTRAINTS, INDEXES } from "@/lib/neo4j/schema";
import { write, writeTx } from "@/lib/neo4j/client";

/**
 * Seeds the synthetic district into Neo4j.
 *
 * The seed is idempotent and deterministic: running it twice produces exactly
 * the same graph, which is what makes "Reset scenario" trustworthy mid-demo.
 */

export async function applySchema(): Promise<void> {
  for (const statement of [...CONSTRAINTS, ...INDEXES]) {
    await write(statement);
  }
}

export async function wipe(): Promise<void> {
  // Batched delete keeps Aura Free inside its transaction memory budget.
  let deleted = 0;
  do {
    const rows = await write<{ count: number }>(
      "MATCH (n) WITH n LIMIT 10000 DETACH DELETE n RETURN count(*) AS count",
    );
    deleted = rows[0]?.count ?? 0;
  } while (deleted > 0);
}

export async function seed(): Promise<void> {
  const w = world;

  await writeTx([
    {
      cypher: `
        UNWIND $rows AS row
        MERGE (n:Location {id: row.id})
        SET n.name = row.name, n.lat = row.lat, n.lng = row.lng,
            n.safetyScore = row.safetyScore, n.elevation = row.elevation,
            n.zone = row.zone, n.status = row.status
      `,
      params: { rows: w.locations },
    },
    {
      cypher: `
        UNWIND $rows AS row
        MERGE (s:Segment {id: row.id})
        SET s.name = row.name, s.kind = row.kind, s.travelMinutes = row.travelMinutes,
            s.floodRisk = row.floodRisk, s.accessibility = row.accessibility,
            s.status = row.status, s.baseStatus = row.status,
            s.fromId = row.from, s.toId = row.to
        WITH s, row
        CALL apoc.create.addLabels(s, [row.kind]) YIELD node
        WITH node AS s, row
        MATCH (a:Location {id: row.from}), (b:Location {id: row.to})
        MERGE (s)-[:CONNECTS]->(a)
        MERGE (s)-[:CONNECTS]->(b)
      `,
      params: { rows: w.segments },
    },
  ]);

  await writeTx([
    {
      cypher: `
        UNWIND $rows AS row
        MERGE (s:Shelter {id: row.id})
        SET s.name = row.name, s.capacity = row.capacity, s.occupancy = row.occupancy,
            s.baseOccupancy = row.occupancy,
            s.wheelchairAccessible = row.wheelchairAccessible, s.status = row.status
        WITH s, row MATCH (l:Location {id: row.locationId})
        MERGE (s)-[:LOCATED_AT]->(l)
      `,
      params: { rows: w.shelters },
    },
    {
      cypher: `
        UNWIND $rows AS row
        MERGE (c:CareSite {id: row.id})
        SET c.name = row.name, c.kind = row.kind, c.status = row.status
        WITH c, row
        CALL apoc.create.addLabels(c, [row.kind]) YIELD node
        WITH node AS c, row
        MATCH (l:Location {id: row.locationId})
        MERGE (c)-[:LOCATED_AT]->(l)
      `,
      params: { rows: w.careSites },
    },
    {
      cypher: `
        UNWIND $rows AS row
        MERGE (r:Resource {id: row.id})
        SET r.name = row.name, r.type = row.type, r.quantity = row.quantity,
            r.baseQuantity = row.quantity, r.status = row.status
        WITH r, row
        MATCH (holder) WHERE holder.id = row.holderId AND (holder:Shelter OR holder:CareSite)
        MERGE (holder)-[:HAS_RESOURCE]->(r)
      `,
      params: { rows: w.resources },
    },
    {
      cypher: `
        UNWIND $rows AS row
        MERGE (n:Need {id: row.id})
        SET n.kind = row.kind, n.label = row.label, n.critical = row.critical
      `,
      params: { rows: w.needs },
    },
    {
      cypher: `
        UNWIND $rows AS row
        UNWIND row.satisfies AS needKind
        MATCH (r:Resource {id: row.id}), (n:Need {kind: needKind})
        MERGE (r)-[:SATISFIES]->(n)
      `,
      params: { rows: w.resources.filter((r) => r.satisfies.length > 0) },
    },
  ]);

  await writeTx([
    {
      cypher: `
        UNWIND $rows AS row
        MERGE (v:Vehicle {id: row.id})
        SET v.name = row.name, v.type = row.type, v.capacity = row.capacity,
            v.wheelchairAccessible = row.wheelchairAccessible,
            v.status = row.status, v.baseStatus = row.status
        WITH v, row
        UNWIND row.supportsNeeds AS needKind
        MATCH (n:Need {kind: needKind})
        MERGE (v)-[:SUPPORTS_NEED]->(n)
      `,
      params: { rows: w.vehicles },
    },
    {
      cypher: `
        UNWIND $rows AS row
        MERGE (v:Volunteer {id: row.id})
        SET v.name = row.name, v.status = row.status, v.baseStatus = row.status,
            v.skills = row.skills,
            v.distanceOutsideZoneKm = row.distanceOutsideZoneKm
        WITH v, row
        MATCH (l:Location {id: row.locationId})
        MERGE (v)-[:AVAILABLE_AT]->(l)
        WITH v, row
        MATCH (veh:Vehicle {id: row.vehicleId})
        MERGE (v)-[:HAS_VEHICLE]->(veh)
        WITH v, row
        UNWIND row.canAssist AS needKind
        MATCH (n:Need {kind: needKind})
        MERGE (v)-[:CAN_ASSIST]->(n)
      `,
      params: { rows: w.volunteers },
    },
  ]);

  await writeTx([
    {
      cypher: `
        UNWIND $rows AS row
        MERGE (f:Family {id: row.id})
        SET f.name = row.name, f.size = row.size, f.hasVehicle = row.hasVehicle, f.note = row.note
        WITH f, row
        MATCH (l:Location {id: row.locationId})
        MERGE (f)-[:LOCATED_AT]->(l)
        WITH f, row
        UNWIND row.needIds AS needId
        MATCH (n:Need {id: needId})
        MERGE (f)-[:HAS_NEED]->(n)
      `,
      params: { rows: w.families },
    },
    {
      cypher: `
        UNWIND $families AS fam
        UNWIND fam.members AS member
        MATCH (f:Family {id: fam.id})
        MERGE (p:Person {id: member.id})
        SET p.name = member.name, p.role = member.role, p.age = member.age
        MERGE (f)-[:HAS_MEMBER]->(p)
      `,
      params: { families: w.families },
    },
    {
      cypher: `
        UNWIND $rows AS row
        MATCH (p:Person {id: row.personId}), (n:Need {id: row.needId})
        MERGE (p)-[:HAS_NEED]->(n)
      `,
      params: {
        rows: w.families.flatMap((f) =>
          f.members.flatMap((m) => m.needIds.map((needId) => ({ personId: m.id, needId }))),
        ),
      },
    },
  ]);

  await writeTx([
    {
      cypher: `
        UNWIND $rows AS row
        MERGE (h:Hazard {id: row.id})
        SET h.name = row.name, h.hazardType = row.hazardType, h.severity = row.severity,
            h.active = row.active, h.baseActive = row.active, h.description = row.description,
            h.footprint = row.footprintFlat
      `,
      params: {
        rows: w.hazards.map((h) => ({ ...h, footprintFlat: h.footprint.flat() })),
      },
    },
    {
      // Only ACTIVE hazards get their blocking edges at seed time. Activating a
      // hazard later is exactly this MERGE, which is what makes the disruption
      // a graph write rather than a UI state flag.
      cypher: `
        UNWIND $rows AS row
        MATCH (h:Hazard {id: row.hazardId}), (s:Segment {id: row.segmentId})
        MERGE (s)-[:BLOCKED_BY]->(h)
        SET s.status = 'blocked'
      `,
      params: {
        rows: w.hazards
          .filter((h) => h.active)
          .flatMap((h) => h.blocks.map((segmentId) => ({ hazardId: h.id, segmentId }))),
      },
    },
    {
      cypher: `
        UNWIND $rows AS row
        MATCH (h:Hazard {id: row.hazardId}), (l:Location {id: row.locationId})
        MERGE (l)-[:AFFECTED_BY]->(h)
      `,
      params: {
        rows: w.hazards
          .filter((h) => h.active)
          .flatMap((h) => h.affects.map((locationId) => ({ hazardId: h.id, locationId }))),
      },
    },
    {
      cypher: `
        UNWIND $rows AS row
        MATCH (a:Location {id: row.from}), (b:Location {id: row.to})
        MERGE (a)-[r:NEAR]->(b)
        SET r.meters = row.meters
        MERGE (b)-[r2:NEAR]->(a)
        SET r2.meters = row.meters
      `,
      params: { rows: w.near },
    },
  ]);
}

export async function resetToBaseline(): Promise<void> {
  // Reset is itself a graph operation: statuses return to their seeded values
  // and every hazard edge that was added mid-demo is removed.
  await writeTx([
    { cypher: "MATCH (s:Segment) SET s.status = s.baseStatus" },
    { cypher: "MATCH (v:Volunteer) SET v.status = v.baseStatus" },
    { cypher: "MATCH (v:Vehicle) SET v.status = v.baseStatus" },
    { cypher: "MATCH (s:Shelter) SET s.occupancy = s.baseOccupancy, s.status = CASE WHEN s.baseOccupancy >= s.capacity THEN 'full' ELSE 'open' END" },
    { cypher: "MATCH (r:Resource) SET r.quantity = r.baseQuantity" },
    { cypher: "MATCH (h:Hazard) SET h.active = h.baseActive" },
    { cypher: "MATCH (s:Segment)-[r:BLOCKED_BY]->(h:Hazard) WHERE h.baseActive = false DELETE r" },
    { cypher: "MATCH (l:Location)-[r:AFFECTED_BY]->(h:Hazard) WHERE h.baseActive = false DELETE r" },
    { cypher: "MATCH (a:Alert) DETACH DELETE a" },
    // Intake writes household-level needs and size onto the Family; reset has to
    // undo those too or a second demo run starts from a mutated household.
    {
      cypher: `
        UNWIND $families AS fam
        MATCH (f:Family {id: fam.id})
        SET f.size = fam.size, f.hasVehicle = fam.hasVehicle
        REMOVE f.intakeUpdatedAt, f.intakeSource, f.intakeConfidence, f.intakeConstraints
        WITH f, fam
        MATCH (f)-[r:HAS_NEED]->(n:Need)
        WHERE NOT n.id IN fam.needIds
        DELETE r
      `,
      params: { families: world.families.map((f) => ({ id: f.id, size: f.size, hasVehicle: f.hasVehicle, needIds: f.needIds })) },
    },
    // Bulletin-created hazards are not part of the seeded world at all.
    { cypher: "MATCH (h:Hazard) WHERE h.id STARTS WITH 'hz_bulletin' OR h.id STARTS WITH 'hz_manual' DETACH DELETE h" },
    { cypher: "MATCH (p:Plan) DETACH DELETE p" },
    {
      // Re-assert the blocking edges of baseline-active hazards in case a demo
      // step cleared them.
      cypher: `
        MATCH (h:Hazard) WHERE h.baseActive = true
        WITH h, $blocks AS blocks
        UNWIND [b IN blocks WHERE b.hazardId = h.id] AS b
        MATCH (s:Segment {id: b.segmentId})
        MERGE (s)-[:BLOCKED_BY]->(h)
        SET s.status = 'blocked'
      `,
      params: {
        blocks: world.hazards
          .filter((h) => h.active)
          .flatMap((h) => h.blocks.map((segmentId) => ({ hazardId: h.id, segmentId }))),
      },
    },
  ]);
}

export async function seedAll(): Promise<void> {
  await applySchema();
  await wipe();
  await seed();
}
