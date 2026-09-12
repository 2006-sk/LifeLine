import { handle } from "@/lib/service/api";
import { recommendForFamily } from "@/lib/service/recommendation";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ familyId: string }> }) {
  const { familyId } = await context.params;
  return handle(() => recommendForFamily(familyId, { persist: false }));
}
