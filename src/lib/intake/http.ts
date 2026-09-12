/**
 * Shared HTTP behaviour for the intake routes.
 *
 * The one rule: Lifeline NEVER fakes success. If the graph is unreachable the
 * caller gets a 503 with a machine-readable code, not an empty diff that looks
 * like "nothing happened".
 */

import { GraphUnavailableError } from "../neo4j/client";
import { FamilyNotFoundError } from "./apply";

export interface ApiError {
  error: string;
  code: string;
  detail?: unknown;
}

function isGraphUnavailable(error: unknown): boolean {
  if (error instanceof GraphUnavailableError) return true;
  // Next.js can evaluate a module twice across the dev/route boundary, which
  // breaks `instanceof`. The code brand survives that.
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "GRAPH_UNAVAILABLE";
}

export function badRequest(message: string, detail?: unknown): Response {
  return Response.json({ error: message, code: "BAD_REQUEST", detail } satisfies ApiError, { status: 400 });
}

/** Map a thrown error onto the right status. Never returns 200. */
export function errorResponse(error: unknown): Response {
  if (isGraphUnavailable(error)) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Neo4j is unreachable.",
        code: "GRAPH_UNAVAILABLE",
      } satisfies ApiError,
      { status: 503 },
    );
  }

  if (error instanceof FamilyNotFoundError) {
    return Response.json({ error: error.message, code: error.code } satisfies ApiError, { status: 404 });
  }

  return Response.json(
    {
      error: error instanceof Error ? error.message : "Unexpected server error.",
      code: "INTERNAL_ERROR",
    } satisfies ApiError,
    { status: 500 },
  );
}

/** Parse a JSON body, returning null (not throwing) when it is not JSON. */
export async function readJsonBody(request: Request): Promise<unknown | null> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}
