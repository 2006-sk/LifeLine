import "./env";
import { resetToBaseline } from "@/lib/neo4j/seed";
import { closeDriver } from "@/lib/neo4j/client";

async function main() {
  await resetToBaseline();
  console.log("✔ Scenario reset to baseline");
  await closeDriver();
}

main().catch(async (error) => {
  console.error(error);
  await closeDriver();
  process.exit(1);
});
