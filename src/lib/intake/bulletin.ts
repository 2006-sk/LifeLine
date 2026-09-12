/**
 * Field bulletin parsing + resolution.
 *
 * Split into three stages on purpose:
 *
 *   parseBulletin(text)      pure text -> structured intents
 *   resolveBulletin(actions) intents  -> REAL seeded world ids (or "unmatched")
 *   applyBulletin(text)      (in apply.ts) resolved ids -> parameterised Cypher
 *
 * Only the third stage touches Neo4j, so the first two are unit-testable with
 * no network at all, and — critically — a phrase that cannot be resolved to a
 * seeded entity can never reach Cypher. Bulletins never CREATE infrastructure;
 * they can only change the state of things the district already contains.
 *
 * Pure: no network, no Neo4j, no env.
 */

import type { HazardType, SegmentStatus, WorldSegment, WorldShelter, WorldVolunteer } from "../types";
import { vehicleById } from "../world/world";
import { matchLocations, matchSegments, matchShelters, volunteersAt } from "./world-match";
import { parseCount } from "./rules";

export type BulletinActionKind = "segment_hazard" | "shelter_full" | "responders_available";

export interface BulletinAction {
  kind: BulletinActionKind;
  /** The sentence this came from, verbatim. */
  sentence: string;
  /** The thing the sentence is about, as written. */
  subject: string;
  /* segment_hazard */
  hazardType?: HazardType;
  segmentStatus?: Extract<SegmentStatus, "unsafe" | "blocked">;
  /* responders_available */
  count?: number;
  accessible?: boolean;
  /** Place phrase after "near"/"at"/"in". */
  place?: string;
}

/* ------------------------------------------------------------------ */
/* Parse                                                               */
/* ------------------------------------------------------------------ */

const SHELTER_FULL =
  /\b(?:has|have)\s+reached\s+(?:capacity|its\s+capacity|full\s+capacity)\b|\bis\s+(?:now\s+)?(?:full|at\s+capacity)\b|\bat\s+(?:full\s+)?capacity\b|\bno\s+(?:more\s+)?(?:space|beds|room)\s+(?:left|available)\b/i;

const RESPONDERS =
  /\b(vans?|vehicles?|cars?|trucks?|minibus(?:es)?|ambulances?|volunteers?|drivers?|teams?|crews?|responders?)\b[^.;!?]*?\b(?:is|are)\s+(?:now\s+)?(?:available|free|back\s+in\s+service|on\s+standby|standing\s+by)\b/i;

const SEGMENT_STATE =
  /\b(?:is|are|has\s+been|have\s+been|was|were)\s+(?:now\s+)?(?:been\s+)?(unsafe|closed|blocked|impassable|flooded|under\s+water|underwater|submerged|damaged|collapsed|out\s+of\s+service|cut\s+off|washed\s+out|obstructed)\b/i;
const SEGMENT_EVENT =
  /\b(landslide|mudslide|flood(?:ing|water)?|fire|debris|rockfall|collapse)\b[^.;!?]*?\b(?:on|at|across|over|has\s+blocked|blocking|blocked)\s+(.+)$/i;

const BLOCKING_WORDS = /\b(closed|blocked|impassable|under\s+water|underwater|submerged|collapsed|out\s+of\s+service|cut\s+off|washed\s+out|obstructed|flooded)\b/i;

const HAZARD_FROM_WORD: { type: HazardType; re: RegExp }[] = [
  { type: "landslide", re: /\b(landslide|mudslide|rockfall|slope|debris\s+flow)\b/i },
  { type: "flood", re: /\b(flood\w*|under\s+water|underwater|submerged|washed\s+out|waterlogged|overtopp\w*)\b/i },
  { type: "fire", re: /\b(fire|burning|ablaze|blaze)\b/i },
  { type: "debris", re: /\b(debris|rubble|obstructed|fallen\s+(?:tree|pole|wall))\b/i },
  { type: "structural", re: /\b(unsafe|collapsed?|structural|scour\w*|cracked|undermined|damaged|out\s+of\s+service)\b/i },
];

function splitSentences(text: string): string[] {
  return text
    .replace(/[\u2018\u2019]/g, "'")
    .split(/(?<=[.;!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.replace(/[^a-z0-9]/gi, "").length > 0);
}

function cleanSubject(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .replace(/^(?:and|but|also|so|then|now)\s+/i, "")
    .replace(/[.,;:!?]+$/, "")
    .trim();
}

function hazardTypeFor(sentence: string): HazardType {
  for (const { type, re } of HAZARD_FROM_WORD) {
    if (re.test(sentence)) return type;
  }
  return "structural";
}

/**
 * Text -> structured intents. Never throws; a sentence it cannot classify is
 * simply not returned (the caller compares counts to spot the shortfall).
 */
export function parseBulletin(text: string): BulletinAction[] {
  const actions: BulletinAction[] = [];

  for (const sentence of splitSentences(text ?? "")) {
    // --- shelter at capacity -------------------------------------------------
    const full = SHELTER_FULL.exec(sentence);
    if (full) {
      const subject = cleanSubject(sentence.slice(0, full.index));
      if (subject) {
        actions.push({ kind: "shelter_full", sentence, subject });
        continue;
      }
    }

    // --- responders / vehicles coming available ------------------------------
    if (RESPONDERS.test(sentence)) {
      const available = /\b(?:is|are)\s+(?:now\s+)?(?:available|free|back\s+in\s+service|on\s+standby|standing\s+by)\b/i.exec(sentence);
      const subject = cleanSubject(available ? sentence.slice(0, available.index) : sentence);
      const countMatch = /\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)\b/i.exec(subject);
      const place = /\b(?:near|at|in|around|by)\s+([^.;!?]+)/i.exec(sentence.slice(available ? available.index : 0));
      actions.push({
        kind: "responders_available",
        sentence,
        subject: subject || sentence,
        count: parseCount(countMatch?.[1]) ?? 1,
        accessible: /\b(accessible|wheelchair|step[-\s]?free)\b/i.test(sentence),
        place: place ? cleanSubject(place[1]) : undefined,
      });
      continue;
    }

    // --- a road or bridge changing state -------------------------------------
    const state = SEGMENT_STATE.exec(sentence);
    if (state) {
      const subject = cleanSubject(sentence.slice(0, state.index));
      if (subject) {
        actions.push({
          kind: "segment_hazard",
          sentence,
          subject,
          hazardType: hazardTypeFor(sentence),
          segmentStatus: BLOCKING_WORDS.test(state[1]) ? "blocked" : "unsafe",
        });
        continue;
      }
    }

    // --- "Landslide has blocked Hill Road — Upper" ---------------------------
    const event = SEGMENT_EVENT.exec(sentence);
    if (event) {
      const subject = cleanSubject(event[2]);
      if (subject) {
        actions.push({
          kind: "segment_hazard",
          sentence,
          subject,
          hazardType: hazardTypeFor(sentence),
          segmentStatus: "blocked",
        });
      }
    }
  }

  return actions;
}

/* ------------------------------------------------------------------ */
/* Resolve                                                             */
/* ------------------------------------------------------------------ */

export interface ResolvedSegmentHazard {
  kind: "segment_hazard";
  action: BulletinAction;
  segment: WorldSegment;
  hazardType: HazardType;
  segmentStatus: "unsafe" | "blocked";
}

export interface ResolvedShelterFull {
  kind: "shelter_full";
  action: BulletinAction;
  shelter: WorldShelter;
}

export interface ResolvedResponders {
  kind: "responders_available";
  action: BulletinAction;
  volunteers: WorldVolunteer[];
  placeNames: string[];
}

export type ResolvedBulletinAction = ResolvedSegmentHazard | ResolvedShelterFull | ResolvedResponders;

export interface BulletinResolution {
  resolved: ResolvedBulletinAction[];
  /** Human-readable reason for every intent that could NOT be grounded. */
  unmatched: string[];
}

/**
 * Ground parsed intents in the seeded world.
 *
 * Deliberately strict: bulletins arrive from the field with names that may not
 * exist in this district, and inventing a match would silently reroute real
 * families. Everything that fails to ground is reported, never dropped.
 */
export function resolveBulletin(actions: BulletinAction[]): BulletinResolution {
  const resolved: ResolvedBulletinAction[] = [];
  const unmatched: string[] = [];

  for (const action of actions) {
    if (action.kind === "shelter_full") {
      const shelters = matchShelters(action.subject);
      if (shelters.length === 0) {
        unmatched.push(`"${action.subject}" — no shelter in this district matches that name; capacity update not applied.`);
        continue;
      }
      for (const shelter of shelters) resolved.push({ kind: "shelter_full", action, shelter });
      continue;
    }

    if (action.kind === "segment_hazard") {
      // No locality anchor for bulletins: a control-room report must NAME the
      // road it is talking about.
      const match = matchSegments(action.subject, null);
      if (match.segments.length === 0) {
        unmatched.push(`"${action.subject}" — no road or bridge in this district matches that name; no segment was blocked.`);
        continue;
      }
      for (const segment of match.segments) {
        resolved.push({
          kind: "segment_hazard",
          action,
          segment,
          hazardType: action.hazardType ?? "structural",
          segmentStatus: action.segmentStatus ?? "blocked",
        });
      }
      continue;
    }

    // responders_available
    if (!action.place) {
      unmatched.push(`"${action.subject}" — report does not say where; no responder status was changed.`);
      continue;
    }
    const locations = matchLocations(action.place);
    if (locations.length === 0) {
      unmatched.push(`"${action.place}" — no location in this district matches that name; no responder status was changed.`);
      continue;
    }
    const placeNames = locations.map((l) => l.name);
    let candidates = volunteersAt(locations.map((l) => l.id));
    if (action.accessible) {
      candidates = candidates.filter((v) => vehicleById.get(v.vehicleId)?.wheelchairAccessible === true);
    }
    if (candidates.length === 0) {
      unmatched.push(
        `"${action.subject}" near ${placeNames.join(", ")} — no ${action.accessible ? "accessible " : ""}responder is staged there, so nothing was marked available.`,
      );
      continue;
    }
    // Prefer responders who are NOT already available: the bulletin reports a change.
    const ordered = [...candidates].sort((a, b) => Number(a.status === "available") - Number(b.status === "available"));
    resolved.push({
      kind: "responders_available",
      action,
      volunteers: ordered.slice(0, Math.max(1, action.count ?? 1)),
      placeNames,
    });
  }

  return { resolved, unmatched };
}
