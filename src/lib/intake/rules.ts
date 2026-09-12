/**
 * Deterministic, offline intake extraction.
 *
 * This is the PRIMARY extraction path, not a fallback. It runs on every
 * submission whether or not a model is configured, it needs no network, and it
 * is the only path whose behaviour can be reasoned about line by line. The LLM
 * in `extract.ts` is a *supplement* that may only ADD to what these rules find.
 *
 * Pure: no network, no Neo4j, no env. Safe to unit test.
 */

import { world } from "../world/world";
import type { ExtractedSituation, HazardType, NeedKind } from "../types";
import { matchSegments } from "./world-match";

export interface RulesContext {
  /** Anchors "the bridge near us" to a real place. */
  familyId?: string | null;
  locationId?: string | null;
}

/** A hazard mention with the provenance `ExtractedSituation` has no room for. */
export interface HazardMention {
  type: HazardType;
  /** A real world id when confidently matched, otherwise the raw phrase. */
  target: string;
  phrase: string;
  matched: boolean;
  targetName?: string;
  method: "name" | "proximity" | "none";
}

export interface RulesResult extends ExtractedSituation {
  /** Superset of `reportedHazards`, carrying the raw phrase + provenance. */
  hazardMentions: HazardMention[];
}

/* ------------------------------------------------------------------ */
/* Number words                                                        */
/* ------------------------------------------------------------------ */

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
  a: 1, an: 1, couple: 2, both: 2,
};

const NUMBER_WORD_PATTERN = Object.keys(NUMBER_WORDS).filter((w) => w.length > 1).join("|");

export function parseCount(token: string | undefined): number | null {
  if (!token) return null;
  const trimmed = token.trim().toLowerCase();
  if (/^\d+$/.test(trimmed)) {
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  }
  return NUMBER_WORDS[trimmed] ?? null;
}

/* ------------------------------------------------------------------ */
/* Family size                                                         */
/* ------------------------------------------------------------------ */

const SIZE_PATTERNS: RegExp[] = [
  // "there are four of us", "four of us", "we are 4"
  new RegExp(String.raw`\b(?:there\s+(?:are|is)\s+)?(\d{1,2}|${NUMBER_WORD_PATTERN})\s+of\s+us\b`, "i"),
  new RegExp(String.raw`\b(?:my\s+)?(?:family|household)\s+of\s+(\d{1,2}|${NUMBER_WORD_PATTERN})\b`, "i"),
  new RegExp(String.raw`\bwe\s+are\s+(\d{1,2}|${NUMBER_WORD_PATTERN})\b`, "i"),
  new RegExp(String.raw`\b(\d{1,2}|${NUMBER_WORD_PATTERN})\s+(?:people|persons|members|adults\s+and\s+children|in\s+(?:the|our)\s+(?:house|home|family|household))\b`, "i"),
  new RegExp(String.raw`\b(?:family|household)\s+size\s*(?:is|:)?\s*(\d{1,2}|${NUMBER_WORD_PATTERN})\b`, "i"),
];

/** People nouns used only when no explicit count is given. */
const PERSON_PATTERNS: { re: RegExp; count: number }[] = [
  { re: /\b(?:my|our)\s+grand(?:mother|father|ma|pa|parent)\b/gi, count: 1 },
  { re: /\b(?:my|our)\s+(?:mother|father|mum|mom|dad)\b/gi, count: 1 },
  { re: /\b(?:my|our)\s+(?:wife|husband|partner|spouse)\b/gi, count: 1 },
  { re: /\b(?:my|our)\s+(?:son|daughter|child|baby|infant|newborn|toddler)\b/gi, count: 1 },
  { re: /\b(?:my|our)\s+(?:sons|daughters|children|kids|twins)\b/gi, count: 2 },
];

function extractFamilySize(text: string): { size: number; explicit: boolean } {
  for (const pattern of SIZE_PATTERNS) {
    const match = pattern.exec(text);
    const value = parseCount(match?.[1]);
    if (value && value > 0 && value <= 30) return { size: value, explicit: true };
  }

  // Fall back to counting the people actually mentioned, plus the reporter.
  let counted = 0;
  for (const { re, count } of PERSON_PATTERNS) {
    const hits = text.match(re);
    if (hits) counted += hits.length * count;
  }
  if (counted > 0 && /\b(i|me|my|we|our|us)\b/i.test(text)) counted += 1;
  return { size: Math.min(counted, 20), explicit: false };
}

/* ------------------------------------------------------------------ */
/* Needs + constraints                                                 */
/* ------------------------------------------------------------------ */

const MOBILITY_DIRECT =
  /\b(can'?t\s+walk|cannot\s+walk|can\s+not\s+walk|unable\s+to\s+walk|wheelchair|wheel\s?chair|limited\s+mobility|reduced\s+mobility|mobility\s+(?:issues?|problems?|assistance|support)|bed\s?ridden|stretcher|crutches|walking\s+frame|walker\b|zimmer|cannot\s+manage\s+stairs|can'?t\s+manage\s+stairs|can'?t\s+climb|cannot\s+climb|immobile|paralysed|paralyzed)/i;
const ELDERLY = /\b(grand(?:mother|father|ma|pa|parents?)|elderly|old\s+(?:man|woman|lady|couple)|pensioner|senior\s+citizen|\b(?:8\d|9\d|7\d)\s*(?:years?\s*old|yo)\b)/i;
const MOBILITY_VERB =
  /\b(walk|walking|move|moving|stairs|steps|stand|standing|mobility|frail|slow|bedbound|carried|carry\s+her|carry\s+him|get\s+(?:her|him)\s+out)\b/i;

const ASTHMA = /\b(asthma|asthmatic|inhaler|salbutamol|ventolin|nebuli[sz]er|nebuli[sz]ed|puffer|reliever\s+medication)\b/i;
const INSULIN = /\b(insulin|diabet(?:es|ic)|glucose\s+monitor|blood\s+sugar)\b/i;
const OXYGEN = /\b(oxygen|o2\s+(?:cylinder|tank)|concentrator|copd|ventilator|breathing\s+machine)\b/i;
const INFANT = /\b(baby|babies|infant|newborn|new\s?born|formula|breast\s?milk\s+substitute|nappies|nappy|diapers?|under\s+(?:six|6)\s+months)\b/i;

/** Only negated vehicle phrasings count — "we have a car" must not fire. */
const NO_VEHICLE =
  /\b(no\s+car|no\s+vehicle|no\s+transport(?:ation)?|no\s+way\s+to\s+(?:get|travel|leave)|don'?t\s+have\s+(?:a\s+)?(?:car|vehicle|van|transport)|do\s+not\s+have\s+(?:a\s+)?(?:car|vehicle|van|transport)|without\s+(?:a\s+)?(?:car|vehicle|transport)|lost\s+our\s+(?:car|vehicle)|car\s+(?:is|was|got)\s+(?:flooded|submerged|stuck|damaged|destroyed|washed)|cannot\s+drive|can'?t\s+drive)/i;
const NEEDS_RIDE = /\b(need\s+a\s+(?:ride|lift|pickup|pick\s?up)|need\s+transport(?:ation)?|need\s+to\s+be\s+(?:driven|collected|picked\s+up)|send\s+a\s+van|send\s+transport)\b/i;
const HAS_VEHICLE = /\b(?:we|i)\s+(?:have|still\s+have|do\s+have|own)\s+(?:a|an|our\s+own|one)?\s*(car|vehicle|van|truck|bike|motorbike|scooter)\b/i;

const EVACUATING =
  /\b(evacuat\w*|shelter|relief\s+cent\w+|nowhere\s+to\s+go|leave\s+(?:our|the)\s+(?:home|house)|water\s+(?:is\s+)?(?:rising|inside|in\s+the\s+house)|flood\w*|need\s+somewhere\s+to\s+stay|homeless|roof\s+collapsed)/i;
const CHILDREN = /\b(child|children|kids?|son|daughter|baby|babies|infant|newborn|toddler|school\s?child)\b/i;

const HAZARD_KEYWORDS: { type: HazardType; re: RegExp }[] = [
  { type: "flood", re: /\b(flood\w*|under\s+water|underwater|submerged|inundat\w*|water\s+over|washed\s+out|overtopp\w*|waterlogged)\b/i },
  { type: "landslide", re: /\b(landslide|land\s+slide|mudslide|slip|slope\s+(?:failure|collapse)|debris\s+flow|rockfall)\b/i },
  { type: "structural", re: /\b(unsafe|collapsed?|collapsing|cracked|structural|scour\w*|undermined|gave\s+way|condemned|damaged|buckled)\b/i },
  { type: "fire", re: /\b(fire|burning|ablaze|smoke|blaze)\b/i },
  { type: "debris", re: /\b(debris|rubble|fallen\s+(?:tree|trees|pole|wall)|blocked\s+by\s+(?:debris|rubble)|obstruct\w*)\b/i },
];

/** Sentence fragments that look like they are naming a piece of infrastructure. */
const HAZARD_SUBJECT =
  /((?:the\s+)?[A-Za-z0-9'\- ]{2,60}?\b(?:road|lane|street|bridge|crossing|highway|riverwalk|footbridge|track|link|route|path))\b/gi;

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.;!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function hazardTypeOf(sentence: string): HazardType | null {
  for (const { type, re } of HAZARD_KEYWORDS) {
    if (re.test(sentence)) return type;
  }
  return null;
}

function extractHazards(text: string, anchorLocationId: string | null): HazardMention[] {
  const mentions: HazardMention[] = [];
  const seen = new Set<string>();

  for (const sentence of splitSentences(text)) {
    const type = hazardTypeOf(sentence);
    if (!type) continue;

    HAZARD_SUBJECT.lastIndex = 0;
    const phrases: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = HAZARD_SUBJECT.exec(sentence)) !== null) {
      const phrase = m[1]
        .replace(/\s+/g, " ")
        .trim()
        .replace(/^(?:and|but|also|so|plus|because|while|when|that|then|now|is|are|on|in|at|to)\s+/i, "")
        .trim();
      if (phrase) phrases.push(phrase);
    }
    if (phrases.length === 0) continue;

    for (const phrase of phrases) {
      const match = matchSegments(phrase, anchorLocationId);
      if (match.segments.length > 0) {
        for (const segment of match.segments) {
          const key = `${type}:${segment.id}`;
          if (seen.has(key)) continue;
          seen.add(key);
          mentions.push({
            type,
            target: segment.id,
            phrase,
            matched: true,
            targetName: segment.name,
            method: match.method,
          });
        }
      } else {
        const key = `${type}:${phrase.toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        mentions.push({ type, target: phrase, phrase, matched: false, method: "none" });
      }
    }
  }

  return mentions;
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

function locationForFamily(ctx?: RulesContext): string | null {
  if (ctx?.locationId) return ctx.locationId;
  if (!ctx?.familyId) return null;
  return world.families.find((f) => f.id === ctx.familyId)?.locationId ?? null;
}

/**
 * Extract everything the rules can see. Never throws, never awaits.
 */
export function extractWithRules(text: string, ctx?: RulesContext): RulesResult {
  // Phones and word processors emit curly apostrophes; every regex below
  // assumes the straight one.
  const raw = (text ?? "").replace(/[\u2018\u2019]/g, "'").trim();
  const anchor = locationForFamily(ctx);

  const needs = new Set<NeedKind>();
  const constraints = new Set<string>();
  const notes: string[] = [];

  const { size, explicit } = extractFamilySize(raw);

  const elderlyMentioned = ELDERLY.test(raw);
  const mobility =
    MOBILITY_DIRECT.test(raw) ||
    // "my grandmother cannot walk far" — elderly + a mobility verb in the same sentence.
    splitSentences(raw).some((s) => ELDERLY.test(s) && MOBILITY_VERB.test(s));
  if (mobility) {
    needs.add("mobility_assistance");
    constraints.add("limited_mobility");
  }

  if (ASTHMA.test(raw)) needs.add("asthma_medication");
  if (INSULIN.test(raw)) needs.add("insulin");
  if (OXYGEN.test(raw)) needs.add("oxygen");
  if (INFANT.test(raw)) needs.add("infant_formula");

  const declaresVehicle = HAS_VEHICLE.test(raw) && !NO_VEHICLE.test(raw);
  const noVehicle = NO_VEHICLE.test(raw);
  if (noVehicle) constraints.add("no_vehicle");
  if (noVehicle || (NEEDS_RIDE.test(raw) && !declaresVehicle)) needs.add("transportation");

  if (CHILDREN.test(raw)) constraints.add("children_present");
  if (elderlyMentioned) constraints.add("elderly_present");
  if (needs.has("asthma_medication") || needs.has("insulin") || needs.has("oxygen") || needs.has("mobility_assistance")) {
    constraints.add("medical_dependency");
  }

  const hazardMentions = extractHazards(raw, anchor);

  // Shelter is the default ask: everything reaching intake is an evacuation.
  const somethingFound = needs.size > 0 || constraints.size > 0 || hazardMentions.length > 0 || size > 0;
  if (EVACUATING.test(raw) || somethingFound) needs.add("shelter");

  for (const mention of hazardMentions) {
    if (!mention.matched) {
      notes.push(`Unmatched hazard phrase: "${mention.phrase}" (${mention.type}) — no district segment matches that name.`);
    } else if (mention.method === "proximity") {
      notes.push(`"${mention.phrase}" matched ${mention.targetName} (${mention.target}) by proximity to the reporting household.`);
    }
  }
  if (size > 0 && !explicit) {
    notes.push(`Household size ${size} inferred from the people mentioned, not stated directly.`);
  }
  if (declaresVehicle) notes.push("Reporter states the household still has a usable vehicle.");

  let confidence = 0.45;
  if (explicit) confidence += 0.15;
  confidence += 0.08 * Math.min(needs.size, 4);
  confidence += 0.06 * Math.min(constraints.size, 3);
  if (hazardMentions.some((h) => h.matched)) confidence += 0.08;
  if (raw.length < 12) confidence = Math.min(confidence, 0.3);
  confidence = Math.max(0.15, Math.min(0.95, Number(confidence.toFixed(2))));

  return {
    familySize: size,
    needs: [...needs],
    constraints: [...constraints],
    reportedHazards: hazardMentions.map(({ type, target }) => ({ type, target })),
    notes,
    source: "rules",
    confidence,
    hazardMentions,
  };
}

/** Re-export so `extract.ts` can normalise LLM-supplied hazard targets the same way. */
export function resolveHazardTarget(
  phrase: string,
  anchorLocationId?: string | null,
): { target: string; matched: boolean; targetName?: string } {
  const byId = world.segments.find((s) => s.id === phrase);
  if (byId) return { target: byId.id, matched: true, targetName: byId.name };
  const match = matchSegments(phrase, anchorLocationId ?? null);
  if (match.segments.length > 0) {
    return { target: match.segments[0].id, matched: true, targetName: match.segments[0].name };
  }
  return { target: phrase, matched: false };
}
