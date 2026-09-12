import { NextResponse } from "next/server";
import { GraphUnavailableError } from "@/lib/neo4j/client";

/**
 * Lifeline degrades LOUDLY. If the graph is unreachable we return 503 with a
 * machine-readable code so the UI can show a hard failure banner. We never
 * substitute cached or synthesised routes — an invented safe path is worse
 * than no answer at all.
 */
export async function handle<T>(fn: () => Promise<T>) {
  try {
    return NextResponse.json(await fn());
  } catch (error) {
    if (error instanceof GraphUnavailableError) {
      return NextResponse.json(
        {
          error: error.message,
          code: "GRAPH_UNAVAILABLE",
          hint: "Lifeline computes every route inside Neo4j. Check NEO4J_* in .env.local and that your Aura instance is running.",
        },
        { status: 503 },
      );
    }
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message, code: "INTERNAL" }, { status: 500 });
  }
}
