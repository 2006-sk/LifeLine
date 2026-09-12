/**
 * Fuzzy phrase -> real world entity matching.
 *
 * Field reports name things the way people say them ("the main bridge",
 * "riverside road", "Ward 4 Relief Center"). The graph only knows seeded ids.
 * This module is the ONLY place that bridges the two, and it is deliberately
 * conservative: a match needs at least one DISTINCTIVE token in common.
 *
 * Why that matters: "Ward 4 Relief Center" shares three tokens with "Patan
 * Community Relief Center" (ward/relief/center are all generic). A naive
 * token-overlap matcher would happily fill the demo's baseline-winning shelter
 * on the strength of the word "relief". Generic tokens are therefore scored at
 * near zero and cannot, on their own, produce a match — the phrase is reported
 * as unmatched instead. In a disaster tool a loud "I don't know what that is"
 * beats a confident write to the wrong node.
 *
 * Pure: no network, no Neo4j, no env. Safe to unit test.
 */

import { world, locationById } from "../world/world";
import type { SegmentKind, WorldSegment, WorldShelter, WorldLocation, WorldVolunteer } from "../types";

/**
 * Words that appear in so many entity names that sharing one carries no
 * information. They still contribute a tiny tie-break weight.
 */
const GENERIC_TOKENS = new Set([
  "the", "a", "an", "of", "at", "in", "on", "near", "our", "us", "we", "my", "is", "are",
  "road", "roads", "street", "lane", "bridge", "crossing", "highway", "way", "path", "track",
  "link", "section", "junction", "corner", "approach", "access", "line", "route", "main",
  "center", "centre", "relief", "community", "shelter", "post", "point", "hall", "school",
  "station", "ward", "zone", "area", "district", "neighbourhood", "neighborhood", "side",
  "north", "south", "east", "west", "upper", "lower", "old", "new", "big", "small",
  "clinic", "hospital", "health", "camp", "depot", "yard", "ground", "square", "gate",
  "van", "vans", "vehicle", "vehicles", "volunteer", "volunteers", "team", "teams", "crew",
  "accessible", "available", "now", "two", "three", "four", "five",
]);

/** Words that pin a phrase to a segment kind. */
const BRIDGE_WORDS = /\b(bridge|crossing|footbridge|span|overpass|culvert)\b/i;
const ROAD_WORDS = /\b(road|lane|street|highway|drive|riverwalk|link|avenue|track|way)\b/i;

/** Phrases that mean "wherever the reporter is standing". */
const LOCALITY_WORDS =
  /\b(near us|by us|outside our|near our|next to us|near me|outside my|our neighbourhood|our neighborhood|outside the house|down the street|near here|around here|nearby|main)\b/i;

export function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 || /^\d$/.test(t));
}

function distinctive(tokens: string[]): string[] {
  return tokens.filter((t) => !GENERIC_TOKENS.has(t));
}

export interface NameScore {
  /** 0 when nothing distinctive is shared — treat as "no match". */
  score: number;
  sharedDistinctive: string[];
}

/** Score a free-text phrase against a canonical entity name. */
export function scoreName(phrase: string, name: string): NameScore {
  const phraseTokens = tokenize(phrase);
  const nameTokens = new Set(tokenize(name));
  const phraseDistinctive = distinctive(phraseTokens);

  const sharedDistinctive = phraseDistinctive.filter((t) => nameTokens.has(t));
  if (sharedDistinctive.length === 0) return { score: 0, sharedDistinctive: [] };

  const sharedGeneric = phraseTokens.filter((t) => GENERIC_TOKENS.has(t) && nameTokens.has(t));
  const coverage = sharedDistinctive.length / Math.max(1, phraseDistinctive.length);

  // A single shared token out of several distinctive ones is not a match, it is
  // a coincidence: "Kathmandu ring highway" shares only "ring" with "Market Ring
  // Road", and "Bhaktapur Ring Road" is not this district's ring road. Demand a
  // majority of the phrase's distinctive tokens, or at least two hits.
  if (coverage <= 0.5 && sharedDistinctive.length < 2) return { score: 0, sharedDistinctive: [] };

  // Distinctive overlap dominates; generic overlap only breaks ties.
  const score = sharedDistinctive.length * 2 + coverage + sharedGeneric.length * 0.05;
  return { score, sharedDistinctive };
}

/* ------------------------------------------------------------------ */
/* Geometry                                                            */
/* ------------------------------------------------------------------ */

const METRES_PER_DEGREE = 111_320;

export function metresBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const latScale = Math.cos(((a.lat + b.lat) / 2) * (Math.PI / 180));
  const dLat = (a.lat - b.lat) * METRES_PER_DEGREE;
  const dLng = (a.lng - b.lng) * METRES_PER_DEGREE * latScale;
  return Math.sqrt(dLat * dLat + dLng * dLng);
}

export function segmentMidpoint(segment: WorldSegment): { lat: number; lng: number } | null {
  const from = locationById.get(segment.from);
  const to = locationById.get(segment.to);
  if (!from || !to) return null;
  return { lat: (from.lat + to.lat) / 2, lng: (from.lng + to.lng) / 2 };
}

/* ------------------------------------------------------------------ */
/* Segments                                                            */
/* ------------------------------------------------------------------ */

export type MatchMethod = "name" | "proximity" | "none";

export interface SegmentMatch {
  segments: WorldSegment[];
  method: MatchMethod;
  /** Which segment kind the phrase implied, if any. */
  kindHint: SegmentKind | null;
}

export function kindHintFor(phrase: string): SegmentKind | null {
  if (BRIDGE_WORDS.test(phrase)) return "Bridge";
  if (ROAD_WORDS.test(phrase)) return "Road";
  return null;
}

export function hasLocalityAnchor(phrase: string): boolean {
  return LOCALITY_WORDS.test(phrase);
}

/**
 * Resolve a phrase onto real segment ids.
 *
 * 1. name match (kind-filtered first, then unfiltered);
 * 2. if the phrase is locality-anchored ("the main bridge", "bridge near us")
 *    and we know where the reporter is, the nearest segment of that kind —
 *    segments touching the reporter's own location rank first;
 * 3. otherwise nothing, and the caller reports the phrase as unmatched.
 *
 * Ties on step 1 are returned together on purpose: "Riverside Road" is two
 * seeded segments and blocking only half a corridor would be a lie.
 */
export function matchSegments(phrase: string, anchorLocationId?: string | null): SegmentMatch {
  const kindHint = kindHintFor(phrase);

  const byName = (pool: WorldSegment[]): WorldSegment[] => {
    const scored = pool
      .map((segment) => ({ segment, ...scoreName(phrase, segment.name) }))
      .filter((row) => row.score > 0);
    if (scored.length === 0) return [];
    const best = Math.max(...scored.map((r) => r.score));
    return scored.filter((r) => r.score >= best - 0.001).map((r) => r.segment);
  };

  const kindPool = kindHint ? world.segments.filter((s) => s.kind === kindHint) : world.segments;
  let hits = byName(kindPool);
  if (hits.length === 0 && kindHint) hits = byName(world.segments);
  if (hits.length > 0) return { segments: hits, method: "name", kindHint };

  // Proximity is a guess, so it is only allowed when the phrase gives us no
  // name to look up: either it is explicitly local ("the bridge near us") or it
  // contains nothing distinctive at all ("the main bridge"). A phrase that DOES
  // name something we could not find stays unmatched rather than snapping to
  // whatever happens to be closest.
  const anchor = anchorLocationId ? locationById.get(anchorLocationId) : undefined;
  const nothingDistinctive = distinctive(tokenize(phrase)).length === 0;
  if (anchor && (hasLocalityAnchor(phrase) || (kindHint !== null && nothingDistinctive))) {
    const pool = kindHint ? world.segments.filter((s) => s.kind === kindHint) : world.segments;
    const ranked = pool
      .map((segment) => {
        const mid = segmentMidpoint(segment);
        const incident = segment.from === anchor.id || segment.to === anchor.id;
        return {
          segment,
          incident,
          metres: mid ? metresBetween(anchor, mid) : Number.POSITIVE_INFINITY,
        };
      })
      .sort((a, b) => Number(b.incident) - Number(a.incident) || a.metres - b.metres);
    if (ranked.length > 0) return { segments: [ranked[0].segment], method: "proximity", kindHint };
  }

  return { segments: [], method: "none", kindHint };
}

/* ------------------------------------------------------------------ */
/* Shelters, locations, volunteers                                     */
/* ------------------------------------------------------------------ */

function bestByName<T>(phrase: string, pool: T[], nameOf: (item: T) => string): T[] {
  const scored = pool.map((item) => ({ item, ...scoreName(phrase, nameOf(item)) })).filter((r) => r.score > 0);
  if (scored.length === 0) return [];
  const best = Math.max(...scored.map((r) => r.score));
  return scored.filter((r) => r.score >= best - 0.001).map((r) => r.item);
}

export function matchShelters(phrase: string): WorldShelter[] {
  return bestByName(phrase, world.shelters, (s) => s.name);
}

/** Locations matching a place phrase — "Patan" hits all three Patan nodes. */
export function matchLocations(phrase: string): WorldLocation[] {
  const byName = bestByName(phrase, world.locations, (l) => l.name);
  if (byName.length > 0) return byName;
  // Fall back to the zone label ("Patan North", "East Uplands").
  const byZone = bestByName(phrase, world.locations, (l) => l.zone);
  return byZone;
}

/** Volunteers staged at any of the given locations. */
export function volunteersAt(locationIds: string[]): WorldVolunteer[] {
  const wanted = new Set(locationIds);
  return world.volunteers.filter((v) => wanted.has(v.locationId));
}
