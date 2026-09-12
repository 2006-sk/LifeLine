/**
 * Validated extraction: deterministic rules FIRST, model as a supplement.
 *
 * The order is the whole point. `extractWithRules` always runs and always
 * produces an answer. If a model is configured we also ask it, zod-validate the
 * reply against the frozen `ExtractedSituation` enums, and then MERGE — union
 * the needs, keep the rules' household size when the two materially disagree,
 * and keep whatever extra notes the model added.
 *
 * WHY A UNION AND NOT A REPLACEMENT: Qwen3 has been observed reading
 * "my grandmother cannot walk far" as a *constraint* ("limited mobility") and
 * never emitting the `mobility_assistance` need. Under a replace-if-valid
 * policy that omission would silently delete a safety-relevant need that the
 * rules had already found, and the family would be routed to a shelter without
 * step-free access. A model may add to what the rules saw; it may never
 * subtract from it.
 *
 * THE MODEL NEVER TOUCHES THE GRAPH. It returns enum values and ids from a
 * fixed vocabulary; every write goes through the parameterised Cypher in
 * `apply.ts`. No Cypher is ever generated from, or influenced by, model output.
 */

import { z } from "zod";

import type { ExtractedSituation, HazardType, NeedKind } from "../types";
import { world } from "../world/world";
import { complete, isLLMConfigured, parseJsonResponse } from "./llm";
import { extractWithRules, resolveHazardTarget, type HazardMention, type RulesContext } from "./rules";

/* ------------------------------------------------------------------ */
/* Frozen vocabularies — the ONLY values a model may return            */
/* ------------------------------------------------------------------ */

export const NEED_KINDS = [
  "mobility_assistance",
  "asthma_medication",
  "transportation",
  "shelter",
  "infant_formula",
  "insulin",
  "oxygen",
] as const satisfies readonly NeedKind[];

export const HAZARD_TYPES = [
  "flood",
  "landslide",
  "structural",
  "fire",
  "debris",
] as const satisfies readonly HazardType[];

export const CONSTRAINTS = [
  "no_vehicle",
  "limited_mobility",
  "children_present",
  "elderly_present",
  "medical_dependency",
] as const;

/* ------------------------------------------------------------------ */
/* Schema                                                              */
/* ------------------------------------------------------------------ */

/**
 * Mirrors `ExtractedSituation` with STRICT enums. Unknown need strings, typos
 * and hallucinated hazard types fail validation rather than reaching Cypher.
 * Every field is optional so one missing key does not throw away a good answer.
 */
export const SituationSchema = z.object({
  familySize: z.number().int().min(0).max(30).optional(),
  needs: z.array(z.enum(NEED_KINDS)).max(12).optional(),
  constraints: z.array(z.string().max(60)).max(12).optional(),
  reportedHazards: z
    .array(
      z.object({
        type: z.enum(HAZARD_TYPES),
        target: z.string().min(1).max(120),
      }),
    )
    .max(12)
    .optional(),
  notes: z.array(z.string().max(400)).max(12).optional(),
  confidence: z.number().min(0).max(1).optional(),
});

export type LLMSituation = z.infer<typeof SituationSchema>;

/* ------------------------------------------------------------------ */
/* Prompt                                                              */
/* ------------------------------------------------------------------ */

function segmentCatalogue(): string {
  return world.segments.map((s) => `${s.id} = ${s.name} (${s.kind})`).join("\n");
}

const SYSTEM_PROMPT = `You are an emergency-intake parser for a disaster response command centre.
Read the household's message and return EXACTLY ONE JSON object. No prose, no markdown fences, no explanation.

Schema:
{
  "familySize": integer (0 if the message does not say),
  "needs": array of the EXACT strings below, nothing else,
  "constraints": array of the EXACT strings below, nothing else,
  "reportedHazards": [{"type": one of the hazard types below, "target": a segment id from the catalogue OR the exact phrase the household used}],
  "notes": array of short factual strings worth showing a dispatcher,
  "confidence": number 0..1
}

Allowed "needs" values (use these strings verbatim):
  mobility_assistance   - anyone who cannot walk far, uses a wheelchair, is bedridden, or an elderly person described as unable to move unaided
  asthma_medication     - asthma, inhaler, salbutamol, nebuliser
  transportation        - no car / no vehicle / no way to leave / needs a ride
  shelter               - needs somewhere safe to stay
  infant_formula        - a baby or infant in the household
  insulin               - diabetes
  oxygen                - supplemental oxygen or a ventilator

Allowed "constraints" values: no_vehicle, limited_mobility, children_present, elderly_present, medical_dependency

Allowed hazard "type" values: flood, landslide, structural, fire, debris

Rules:
- A person described as unable to walk is BOTH the need "mobility_assistance" AND the constraint "limited_mobility". Emitting only the constraint is wrong.
- Never invent a need that the message does not support.
- For "target", prefer an id from this catalogue of the ONLY roads and bridges that exist in this district:
${segmentCatalogue()}
- If no catalogue entry clearly matches, put the household's own words in "target".

Return only the JSON object.`;

/* ------------------------------------------------------------------ */
/* Merge                                                               */
/* ------------------------------------------------------------------ */

/**
 * Union the two extractions.
 *
 *  - needs / constraints : UNION. The model may add, never remove.
 *  - familySize          : the rules win when the two differ by more than 1
 *                          (a regex counting "four of us" is more trustworthy
 *                          than a model counting people); otherwise the model's
 *                          value is taken as the refinement.
 *  - reportedHazards     : union, with every model-supplied target pushed
 *                          through the SAME resolver the rules use, so it
 *                          either becomes a real world id or stays a phrase.
 *  - notes               : concatenated, deduped.
 *  - confidence          : the higher of the two when they agree on size,
 *                          otherwise the rules' value.
 */
export function mergeSituations(
  rules: ExtractedSituation & { hazardMentions: HazardMention[] },
  llm: LLMSituation,
  anchorLocationId?: string | null,
): ExtractedSituation & { hazardMentions: HazardMention[] } {
  const needs = new Set<NeedKind>(rules.needs);
  for (const need of llm.needs ?? []) needs.add(need);

  const constraints = new Set<string>(rules.constraints);
  for (const constraint of llm.constraints ?? []) {
    if ((CONSTRAINTS as readonly string[]).includes(constraint)) constraints.add(constraint);
  }
  // Keep the invariants the rules guarantee, even if only the model saw the fact.
  if (needs.has("mobility_assistance")) constraints.add("limited_mobility");
  if (needs.has("transportation") && rules.constraints.includes("no_vehicle")) constraints.add("no_vehicle");

  const llmSize = llm.familySize ?? 0;
  const disagreesMaterially = rules.familySize > 0 && llmSize > 0 && Math.abs(rules.familySize - llmSize) > 1;
  let familySize = rules.familySize;
  if (rules.familySize === 0) familySize = llmSize;
  else if (!disagreesMaterially && llmSize > 0) familySize = llmSize;

  const mentions: HazardMention[] = [...rules.hazardMentions];
  const seen = new Set(mentions.map((m) => `${m.type}:${m.target}`));
  for (const hazard of llm.reportedHazards ?? []) {
    const resolved = resolveHazardTarget(hazard.target, anchorLocationId);
    const key = `${hazard.type}:${resolved.target}`;
    if (seen.has(key)) continue;
    seen.add(key);
    mentions.push({
      type: hazard.type,
      target: resolved.target,
      phrase: hazard.target,
      matched: resolved.matched,
      targetName: resolved.targetName,
      method: resolved.matched ? "name" : "none",
    });
  }

  const notes = [...rules.notes];
  for (const note of llm.notes ?? []) {
    const trimmed = note.trim();
    if (trimmed && !notes.includes(trimmed)) notes.push(trimmed);
  }
  if (disagreesMaterially) {
    notes.push(
      `Household size: rules read ${rules.familySize}, the model read ${llmSize}. Kept ${rules.familySize} (deterministic extraction wins on a material disagreement).`,
    );
  }

  const confidence = disagreesMaterially
    ? rules.confidence
    : Math.max(rules.confidence, Math.min(llm.confidence ?? 0, 0.95));

  return {
    familySize,
    needs: [...needs],
    constraints: [...constraints],
    reportedHazards: mentions.map(({ type, target }) => ({ type, target })),
    notes,
    source: "llm",
    confidence: Number(confidence.toFixed(2)),
    hazardMentions: mentions,
  };
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

export interface ExtractResult extends ExtractedSituation {
  hazardMentions: HazardMention[];
}

export interface ExtractOptions extends RulesContext {
  /** Skip the model even when it is configured (used by tests + the reset path). */
  useLLM?: boolean;
  timeoutMs?: number;
}

/**
 * Extract a situation from free text.
 *
 * Rules always run. The model runs only if configured, and only ever widens the
 * result. Marked `source: "llm"` only when the model replied AND zod validated
 * it; otherwise `source: "rules"`.
 */
export async function extractSituation(text: string, opts: ExtractOptions = {}): Promise<ExtractResult> {
  const anchor = opts.locationId ?? world.families.find((f) => f.id === opts.familyId)?.locationId ?? null;
  const rules = extractWithRules(text, { familyId: opts.familyId, locationId: anchor });

  const wantLLM = opts.useLLM !== false && isLLMConfigured() && (text ?? "").trim().length > 0;
  if (!wantLLM) return rules;

  const raw = await complete(SYSTEM_PROMPT, (text ?? "").trim(), { timeoutMs: opts.timeoutMs });
  if (raw === null) {
    return {
      ...rules,
      notes: [...rules.notes, "Language model unavailable or timed out — deterministic extraction used."],
    };
  }

  const json = parseJsonResponse(raw);
  if (json === null) {
    return { ...rules, notes: [...rules.notes, "Language model returned unparseable output — deterministic extraction used."] };
  }

  const parsed = SituationSchema.safeParse(json);
  if (!parsed.success) {
    return {
      ...rules,
      notes: [
        ...rules.notes,
        `Language model output failed schema validation (${parsed.error.issues[0]?.path.join(".") || "shape"}) — deterministic extraction used.`,
      ],
    };
  }

  return mergeSituations(rules, parsed.data, anchor);
}
