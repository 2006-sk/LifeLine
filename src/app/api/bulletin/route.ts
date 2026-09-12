/**
 * POST /api/bulletin
 *
 * Applies a field bulletin to the district and returns exactly what changed, so
 * the map and the graph view can animate the same nodes and edges.
 *
 * Request
 *   { text: string }
 *
 * Response 200
 *   {
 *     applied: { action, targetId, targetName, detail }[],
 *     unmatched: string[]     // every phrase that could not be grounded, with a reason
 *   }
 *
 * Errors
 *   400 BAD_REQUEST       — body is not JSON, or `text` is missing/empty
 *   503 GRAPH_UNAVAILABLE — Neo4j unreachable; nothing was written
 *
 * A bulletin can only change the STATE of entities the seed already created.
 * Names it cannot ground come back in `unmatched` — never silently dropped, and
 * never blind-created.
 */

import { z } from "zod";

import { applyBulletin } from "@/lib/intake/apply";
import { badRequest, errorResponse, readJsonBody } from "@/lib/intake/http";

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  text: z.string().min(1, "Bulletin text is required.").max(4000),
});

export async function POST(request: Request): Promise<Response> {
  const body = await readJsonBody(request);
  if (body === null) return badRequest("Request body must be JSON.");

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return badRequest("Invalid bulletin payload.", parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
  }
  if (parsed.data.text.trim().length === 0) return badRequest("Bulletin text is required.");

  try {
    const diff = await applyBulletin(parsed.data.text);
    return Response.json(diff);
  } catch (error) {
    return errorResponse(error);
  }
}
