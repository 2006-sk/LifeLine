import { handle } from "@/lib/service/api";
import { resetScenario } from "@/lib/service/scenario";

export async function POST() {
  return handle(() => resetScenario());
}
