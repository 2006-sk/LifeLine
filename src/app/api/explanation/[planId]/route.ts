import { NextResponse } from "next/server";
import { handle } from "@/lib/service/api";
import { explainPlan } from "@/lib/service/scenario";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ planId: string }> }) {
  const { planId } = await context.params;
  const result = await explainPlan(planId).catch(() => undefined);
  if (result === null) {
    return NextResponse.json({ error: "No such plan", code: "NOT_FOUND" }, { status: 404 });
  }
  return handle(async () => result ?? (await explainPlan(planId)));
}
