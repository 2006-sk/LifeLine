import "./env";
import { seedAll } from "@/lib/neo4j/seed";
import { closeDriver, read, verifyGraph } from "@/lib/neo4j/client";

async function main() {
  const status = await verifyGraph();
  if (!status.ok) {
    console.error("✖ Cannot reach Neo4j:", status.error);
    process.exit(1);
  }
  console.log(`✔ Connected to ${status.version}`);
  console.log("… wiping and seeding the synthetic district");
  await seedAll();

  const counts = await read<{ label: string; count: number }>(`
    CALL () {
      MATCH (n:Location) RETURN 'Location' AS label, count(n) AS count
      UNION ALL MATCH (n:Segment) RETURN 'Segment' AS label, count(n) AS count
      UNION ALL MATCH (n:Shelter) RETURN 'Shelter' AS label, count(n) AS count
      UNION ALL MATCH (n:CareSite) RETURN 'CareSite' AS label, count(n) AS count
      UNION ALL MATCH (n:Resource) RETURN 'Resource' AS label, count(n) AS count
      UNION ALL MATCH (n:Volunteer) RETURN 'Volunteer' AS label, count(n) AS count
      UNION ALL MATCH (n:Vehicle) RETURN 'Vehicle' AS label, count(n) AS count
      UNION ALL MATCH (n:Family) RETURN 'Family' AS label, count(n) AS count
      UNION ALL MATCH (n:Person) RETURN 'Person' AS label, count(n) AS count
      UNION ALL MATCH (n:Need) RETURN 'Need' AS label, count(n) AS count
      UNION ALL MATCH (n:Hazard) RETURN 'Hazard' AS label, count(n) AS count
    }
    RETURN label, count ORDER BY label
  `);
  const rels = await read<{ type: string; count: number }>(
    "MATCH ()-[r]->() RETURN type(r) AS type, count(r) AS count ORDER BY type",
  );

  console.log("\n  Nodes");
  for (const row of counts) console.log(`    ${row.label.padEnd(12)} ${row.count}`);
  console.log("\n  Relationships");
  for (const row of rels) console.log(`    ${row.type.padEnd(14)} ${row.count}`);
  console.log("\n✔ Seed complete");
  await closeDriver();
}

main().catch(async (error) => {
  console.error(error);
  await closeDriver();
  process.exit(1);
});
