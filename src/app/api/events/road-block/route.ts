import { z } from "zod";
import { NextResponse } from "next/server";
import { handle } from "@/lib/service/api";
import { blockSegment } from "@/lib/service/scenario";

const Body = z.object({ segmentId: z.string().min(1) });

export async function POST(request: Request) {
  let parsed;
  try {
    parsed = Body.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Expected { segmentId: string }", code: "BAD_REQUEST" }, { status: 400 });
  }
  return handle(() => blockSegment(parsed.segmentId));
}
