/**
 * POST /api/intake
 *
 * Turns what a household said — free text, a structured form, or both — into a
 * validated `ExtractedSituation` and writes it onto their (:Family) node with
 * parameterised Cypher.
 *
 * Request
 *   {
 *     familyId: string,                  // must already exist in the graph
 *     text?: string,                     // free-text intake
 *     structured?: {                     // left-panel form; may be combined with text
 *       familySize?: number,
 *       hasVehicle?: boolean,
 *       needsTransportation?: boolean,
 *       mobilityAssistance?: boolean,
 *       medicalNeeds?: NeedKind[],
 *       needsShelter?: boolean,
 *       knownHazards?: (string | { type: HazardType, target: string })[],
 *       notes?: string
 *     },
 *     useLLM?: boolean                   // default true when a key is configured
 *   }
 *
 * Response 200
 *   { situation: ExtractedSituation, applied: AppliedSituation }
 *
 * Errors
 *   400 BAD_REQUEST       — body is not JSON, or neither text nor structured given
 *   404 FAMILY_NOT_FOUND  — no such family in the graph
 *   503 GRAPH_UNAVAILABLE — Neo4j unreachable; nothing was written
 */

import { z } from "zod";

import { applySituationToFamily } from "@/lib/intake/apply";
import { extractSituation, HAZARD_TYPES, NEED_KINDS } from "@/lib/intake/extract";
import { badRequest, errorResponse, readJsonBody } from "@/lib/intake/http";
import { extractWithRules, resolveHazardTarget, type HazardMention } from "@/lib/intake/rules";
import type { ExtractedSituation, NeedKind } from "@/lib/types";
import { world } from "@/lib/world/world";

export const dynamic = "force-dynamic";

const StructuredSchema = z.object({
  familySize: z.number().int().min(0).max(30).optional(),
  hasVehicle: z.boolean().optional(),
  needsTransportation: z.boolean().optional(),
  mobilityAssistance: z.boolean().optional(),
  medicalNeeds: z.array(z.enum(NEED_KINDS)).max(10).optional(),
  needsShelter: z.boolean().optional(),
  knownHazards: z
    .array(z.union([z.string().min(1).max(120), z.object({ type: z.enum(HAZARD_TYPES), target: z.string().min(1).max(120) })]))
    .max(10)
    .optional(),
  notes: z.string().max(1000).optional(),
});

const BodySchema = z
  .object({
    familyId: z.string().min(1).max(120),
    text: z.string().max(4000).optional(),
    structured: StructuredSchema.optional(),
    useLLM: z.boolean().optional(),
  })
  .refine((body) => (body.text && body.text.trim().length > 0) || body.structured !== undefined, {
    message: "Provide either `text` or `structured`.",
  });

type StructuredIntake = z.infer<typeof StructuredSchema>;

/**
 * The form is already structured, so it needs no extraction — but it still has
 * to produce the same `ExtractedSituation` shape, because everything downstream
 * (the graph write, the UI, the judge panel) reads exactly one contract.
 */
function situationFromForm(form: StructuredIntake, anchorLocationId: string | null): ExtractedSituation & { hazardMentions: HazardMention[] } {
  const needs = new Set<NeedKind>();
  const constraints = new Set<string>();
  const notes: string[] = [];

  if (form.mobilityAssistance) {
    needs.add("mobility_assistance");
    constraints.add("limited_mobility");
    constraints.add("medical_dependency");
  }
  for (const need of form.medicalNeeds ?? []) {
    needs.add(need);
    if (need === "asthma_medication" || need === "insulin" || need === "oxygen") constraints.add("medical_dependency");
    if (need === "infant_formula") constraints.add("children_present");
    if (need === "mobility_assistance") constraints.add("limited_mobility");
  }
  if (form.hasVehicle === false) {
    constraints.add("no_vehicle");
    needs.add("transportation");
  }
  if (form.needsTransportation) needs.add("transportation");
  if (form.needsShelter !== false) needs.add("shelter");
  if (form.notes?.trim()) notes.push(form.notes.trim());

  const hazardMentions: HazardMention[] = [];
  const seenHazards = new Set<string>();
  const pushHazard = (mention: HazardMention) => {
    const key = `${mention.type}:${mention.target}`;
    if (seenHazards.has(key)) return;
    seenHazards.add(key);
    hazardMentions.push(mention);
    if (!mention.matched) {
      notes.push(`Unmatched hazard phrase: "${mention.phrase}" — no district segment matches that name.`);
    }
  };

  for (const entry of form.knownHazards ?? []) {
    const phrase = typeof entry === "string" ? entry : entry.target;
    const declaredType = typeof entry === "string" ? null : entry.type;

    // The form's hazard box is still free text: an operator may type a bare name
    // ("Riverside Road") or a whole sentence ("Riverside Road is flooded"). Run
    // it through the SAME rules extractor first, which reads the hazard type out
    // of the sentence and expands a corridor name to every segment it covers.
    const derived = extractWithRules(phrase, { locationId: anchorLocationId }).hazardMentions;
    if (derived.length > 0) {
      for (const mention of derived) pushHazard(declaredType ? { ...mention, type: declaredType } : mention);
      continue;
    }

    // No hazard keyword in the phrase — treat the whole thing as a target name.
    const resolved = resolveHazardTarget(phrase, anchorLocationId);
    pushHazard({
      type: declaredType ?? "flood",
      target: resolved.target,
      phrase,
      matched: resolved.matched,
      targetName: resolved.targetName,
      method: resolved.matched ? "name" : "none",
    });
    if (!declaredType) {
      notes.push(`Hazard type not stated for "${phrase}" — recorded as flood, the district's active scenario.`);
    }
  }

  return {
    familySize: form.familySize ?? 0,
    needs: [...needs],
    constraints: [...constraints],
    reportedHazards: hazardMentions.map(({ type, target }) => ({ type, target })),
    notes,
    // A form is not an inference: what the operator typed is what we record.
    source: "rules",
    confidence: 1,
    hazardMentions,
  };
}

/** Union a form situation over a text-derived one. The form is authoritative. */
function combine(
  text: (ExtractedSituation & { hazardMentions: HazardMention[] }) | null,
  form: (ExtractedSituation & { hazardMentions: HazardMention[] }) | null,
): ExtractedSituation & { hazardMentions: HazardMention[] } {
  if (!text) return form!;
  if (!form) return text;

  const mentions = [...text.hazardMentions];
  const seen = new Set(mentions.map((m) => `${m.type}:${m.target}`));
  for (const mention of form.hazardMentions) {
    const key = `${mention.type}:${mention.target}`;
    if (!seen.has(key)) {
      seen.add(key);
      mentions.push(mention);
    }
  }

  return {
    familySize: form.familySize > 0 ? form.familySize : text.familySize,
    needs: [...new Set([...text.needs, ...form.needs])],
    constraints: [...new Set([...text.constraints, ...form.constraints])],
    reportedHazards: mentions.map(({ type, target }) => ({ type, target })),
    notes: [...new Set([...text.notes, ...form.notes])],
    source: text.source,
    confidence: Math.max(text.confidence, 0.9),
    hazardMentions: mentions,
  };
}

export async function POST(request: Request): Promise<Response> {
  const body = await readJsonBody(request);
  if (body === null) return badRequest("Request body must be JSON.");

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return badRequest("Invalid intake payload.", parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
  }

  const { familyId, text, structured, useLLM } = parsed.data;
  const anchorLocationId = world.families.find((f) => f.id === familyId)?.locationId ?? null;

  try {
    const fromText =
      text && text.trim().length > 0
        ? await extractSituation(text, { familyId, locationId: anchorLocationId, useLLM })
        : null;
    const fromForm = structured ? situationFromForm(structured, anchorLocationId) : null;

    const situation = combine(fromText, fromForm);
    const applied = await applySituationToFamily(familyId, situation);

    // `hazardMentions` is an internal superset; the wire contract is the frozen
    // ExtractedSituation, with provenance surfaced separately.
    const { hazardMentions, ...wire } = situation;
    return Response.json({
      situation: wire satisfies ExtractedSituation,
      hazardDetail: hazardMentions,
      applied,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
