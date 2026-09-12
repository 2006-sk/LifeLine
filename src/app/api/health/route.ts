import { NextResponse } from "next/server";
import { verifyGraph } from "@/lib/neo4j/client";

export const dynamic = "force-dynamic";

export async function GET() {
  const status = await verifyGraph();
  return NextResponse.json(status, { status: status.ok ? 200 : 503 });
}
