import { z } from "zod";
import { NextResponse } from "next/server";
import { handle } from "@/lib/service/api";
import { recommendForFamily } from "@/lib/service/recommendation";

const Body = z.object({
  familyId: z.string().min(1),
  persist: z.boolean().optional(),
});

export async function POST(request: Request) {
  let parsed;
  try {
    parsed = Body.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Expected { familyId: string }", code: "BAD_REQUEST" }, { status: 400 });
  }
  return handle(() => recommendForFamily(parsed.familyId, { persist: parsed.persist }));
}
