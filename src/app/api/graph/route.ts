import { handle } from "@/lib/service/api";
import { getGraphPayload } from "@/lib/service/scenario";

export const dynamic = "force-dynamic";

export async function GET() {
  return handle(() => getGraphPayload());
}
