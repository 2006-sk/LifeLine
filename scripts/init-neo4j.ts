import "./env";
import { applySchema } from "@/lib/neo4j/schema-runner";
import { closeDriver, verifyGraph } from "@/lib/neo4j/client";

async function main() {
  const status = await verifyGraph();
  if (!status.ok) {
    console.error("✖ Cannot reach Neo4j:", status.error);
    process.exit(1);
  }
  console.log(`✔ Connected to ${status.version}`);
  await applySchema();
  console.log("✔ Constraints and indexes applied");
  await closeDriver();
}

main().catch(async (error) => {
  console.error(error);
  await closeDriver();
  process.exit(1);
});
