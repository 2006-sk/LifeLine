import "./env";
import { read, write, closeDriver } from "@/lib/neo4j/client";
import { RECOMMEND_CYPHER, recommendParams, type RawPlanRow } from "@/lib/neo4j/queries/recommend";
import { resetToBaseline } from "@/lib/neo4j/seed";
import { world } from "@/lib/world/world";

async function activateHazard(hazardId: string) {
  const hz = world.hazards.find((h) => h.id === hazardId)!;
  await write(
    `MATCH (h:Hazard {id:$id}) SET h.active = true
     WITH h UNWIND $blocks AS segId
     MATCH (s:Segment {id: segId}) MERGE (s)-[:BLOCKED_BY]->(h) SET s.status='blocked'`,
    { id: hazardId, blocks: hz.blocks },
  );
  await write(
    `MATCH (h:Hazard {id:$id}) UNWIND $locs AS locId
     MATCH (l:Location {id: locId}) MERGE (l)-[:AFFECTED_BY]->(h)`,
    { id: hazardId, locs: hz.affects },
  );
}

async function run(label: string) {
  const rows = (await read(RECOMMEND_CYPHER, recommendParams("family_sharma"))) as unknown as RawPlanRow[];
  console.log(`\n━━━ ${label}`);
  if (rows.length === 0) {
    console.log("   NO VIABLE PLAN");
    return rows;
  }
  rows.forEach((r, i) => {
    const via = r.elements.filter((e) => e.labels.includes("Segment")).map((e) => e.name);
    console.log(
      `   ${i === 0 ? "BEST" : " alt"}  ${r.shelterName.padEnd(34)} score=${r.totalScore.toFixed(1).padStart(6)}` +
        `  ${r.travelMinutes}min  risk=${r.riskSum.toFixed(2)}  hazNodes=${r.hazardNodes}` +
        `  paths=${r.pathOptions}`,
    );
    console.log(`         transport: ${r.transport ? `${r.transport.volunteerName} / ${r.transport.vehicleName} (${r.transport.pickupMinutes}min from ${r.transport.stagedAtName})` : "NONE"}`);
    console.log(`         care:      ${r.careSiteName ?? "none"}${r.careMeters ? ` @${r.careMeters}m` : ""}  meds=[${r.careResources.map((x) => x.name).join(", ")}]`);
    console.log(`         via:       ${via.join(" → ")}`);
  });
  return rows;
}

async function main() {
  await resetToBaseline();
  const s1 = await run("STATE 1 — baseline");

  await activateHazard("hz_riverside_flood");
  const s2 = await run("STATE 2 — Riverside Road flooded");

  await resetToBaseline();
  await write("MATCH (s:Shelter {id:'shelter_patan_relief'}) SET s.occupancy = s.capacity, s.status='full'");
  const s3 = await run("STATE 3 — Patan Relief Center at capacity");

  await resetToBaseline();
  await write("MATCH (v:Volunteer {id:'vol_maya'}) SET v.status='unavailable'");
  const s4 = await run("STATE 4 — Volunteer Maya unavailable");

  await resetToBaseline();
  await write("MATCH (v:Volunteer) WHERE v.id IN ['vol_maya','vol_arun'] SET v.status='unavailable'");
  const s5 = await run("STATE 5 — no accessible responder available");

  await resetToBaseline();

  const check = (name: string, actual: string, expected: string) => {
    const ok = actual === expected;
    console.log(`${ok ? "  ✔" : "  ✖"} ${name.padEnd(52)} ${ok ? actual : `got "${actual}", expected "${expected}"`}`);
    return ok;
  };
  console.log("\n━━━ TRUTH TABLE");
  const results = [
    check("baseline destination", s1[0]?.shelterName ?? "-", "Patan Community Relief Center"),
    check("baseline responder", s1[0]?.transport?.volunteerName ?? "-", "Maya Shrestha"),
    check("flood destination", s2[0]?.shelterName ?? "-", "Hillcrest School Relief Point"),
    check("flood responder", s2[0]?.transport?.volunteerName ?? "-", "Arun Thapa"),
    check("flood care site", s2[0]?.careSiteName ?? "-", "East Ward Clinic"),
    check("shelter-full destination", s3[0]?.shelterName ?? "-", "Hillcrest School Relief Point"),
    check("volunteer-down destination", s4[0]?.shelterName ?? "-", "Patan Community Relief Center"),
    check("volunteer-down responder", s4[0]?.transport?.volunteerName ?? "-", "Arun Thapa"),
    check("no-responder yields no plan", String(s5.length), "0"),
  ];
  const passed = results.filter(Boolean).length;
  console.log(`\n  ${passed}/${results.length} expectations met`);
  await closeDriver();
  process.exit(passed === results.length ? 0 : 2);
}

main().catch(async (e) => {
  console.error(e);
  await closeDriver();
  process.exit(1);
});
