import { z } from "zod";
import { NextResponse } from "next/server";
import { handle } from "@/lib/service/api";
import { setVolunteerStatus } from "@/lib/service/scenario";

const Body = z.object({
  volunteerId: z.string().min(1),
  status: z.enum(["available", "on_task", "out_of_zone", "unavailable"]).default("unavailable"),
});

export async function POST(request: Request) {
  let parsed;
  try {
    parsed = Body.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Expected { volunteerId: string, status?: ... }", code: "BAD_REQUEST" }, { status: 400 });
  }
  return handle(() => setVolunteerStatus(parsed.volunteerId, parsed.status));
}
