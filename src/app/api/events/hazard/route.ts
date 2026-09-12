import { z } from "zod";
import { NextResponse } from "next/server";
import { handle } from "@/lib/service/api";
import { activateHazard, deactivateHazard } from "@/lib/service/scenario";

const Body = z.object({ hazardId: z.string().min(1), active: z.boolean().default(true) });

export async function POST(request: Request) {
  let parsed;
  try {
    parsed = Body.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Expected { hazardId: string, active?: boolean }", code: "BAD_REQUEST" }, { status: 400 });
  }
  return handle<unknown>(() =>
    parsed.active ? activateHazard(parsed.hazardId) : deactivateHazard(parsed.hazardId),
  );
}
