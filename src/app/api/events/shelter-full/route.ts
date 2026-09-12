import { z } from "zod";
import { NextResponse } from "next/server";
import { handle } from "@/lib/service/api";
import { fillShelter } from "@/lib/service/scenario";

const Body = z.object({ shelterId: z.string().min(1) });

export async function POST(request: Request) {
  let parsed;
  try {
    parsed = Body.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Expected { shelterId: string }", code: "BAD_REQUEST" }, { status: 400 });
  }
  return handle(() => fillShelter(parsed.shelterId));
}
