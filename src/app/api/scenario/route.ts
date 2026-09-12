import { handle } from "@/lib/service/api";
import { getScenarioState } from "@/lib/service/scenario";
import { world } from "@/lib/world/world";

export const dynamic = "force-dynamic";

export async function GET() {
  return handle(async () => ({
    state: await getScenarioState(),
    district: world.district,
    families: world.families.map((f) => ({ id: f.id, name: f.name, size: f.size, locationId: f.locationId, note: f.note })),
    hazards: world.hazards.map((h) => ({ id: h.id, name: h.name, hazardType: h.hazardType, severity: h.severity, footprint: h.footprint, description: h.description })),
    segments: world.segments,
    locations: world.locations,
    shelters: world.shelters,
    careSites: world.careSites,
    volunteers: world.volunteers,
    vehicles: world.vehicles,
  }));
}
