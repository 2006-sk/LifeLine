/**
 * Pure unit tests for the deterministic intake path.
 *
 * NO network and NO Neo4j: everything under test here is the offline half of
 * Lifeline's ingestion, which is exactly the half that has to keep working when
 * the model is slow, the key is missing or the venue wifi dies mid-demo.
 */

import { describe, expect, it } from "vitest";

import { extractWithRules, parseCount } from "../rules";
import { parseBulletin, resolveBulletin } from "../bulletin";
import { matchSegments, matchShelters, scoreName } from "../world-match";
import { mergeSituations, SituationSchema } from "../extract";
import { stripToJson } from "../llm";

const CANONICAL_INTAKE =
  "There are four of us. My grandmother cannot walk far, my son needs asthma medication, " +
  "and the main road outside our neighbourhood is flooded. We don't have a car.";

const CANONICAL_BULLETIN =
  "Bhaktapur East Bridge is now unsafe. Ward 4 Relief Center has reached capacity. " +
  "Two accessible vans are available near Patan.";

describe("extractWithRules — the canonical demo sentence", () => {
  const result = extractWithRules(CANONICAL_INTAKE, { familyId: "family_sharma" });

  it("reads the household size from a number word", () => {
    expect(result.familySize).toBe(4);
  });

  it("emits mobility_assistance for 'grandmother cannot walk far'", () => {
    expect(result.needs).toContain("mobility_assistance");
  });

  it("emits asthma_medication", () => {
    expect(result.needs).toContain("asthma_medication");
  });

  it("emits transportation from 'we don't have a car'", () => {
    expect(result.needs).toContain("transportation");
  });

  it("defaults to a shelter need — everything reaching intake is an evacuation", () => {
    expect(result.needs).toContain("shelter");
  });

  it("records the no_vehicle constraint", () => {
    expect(result.constraints).toContain("no_vehicle");
  });

  it("records the mobility, child and elderly constraints too", () => {
    expect(result.constraints).toEqual(
      expect.arrayContaining(["limited_mobility", "children_present", "elderly_present", "medical_dependency"]),
    );
  });

  it("reports the flooded road as a flood hazard", () => {
    expect(result.reportedHazards.map((h) => h.type)).toContain("flood");
  });

  it("is marked as rule-derived with a calibrated confidence", () => {
    expect(result.source).toBe("rules");
    expect(result.confidence).toBeGreaterThan(0.7);
    expect(result.confidence).toBeLessThanOrEqual(0.95);
  });

  it("needs no network — the same input is byte-for-byte reproducible", () => {
    const again = extractWithRules(CANONICAL_INTAKE, { familyId: "family_sharma" });
    expect(again).toEqual(result);
  });
});

describe("extractWithRules — family size", () => {
  it("reads digits", () => {
    expect(extractWithRules("There are 4 of us and the water is rising.").familySize).toBe(4);
  });

  it("reads 'my family of five'", () => {
    expect(extractWithRules("My family of five needs to evacuate.").familySize).toBe(5);
  });

  it("reads 'we are seven'", () => {
    expect(extractWithRules("We are seven, please send help.").familySize).toBe(7);
  });

  it("counts mentioned people when no number is given", () => {
    const result = extractWithRules("My grandmother and my son are with me. We must leave.");
    expect(result.familySize).toBe(3);
    expect(result.notes.some((n) => /inferred/i.test(n))).toBe(true);
  });

  it("returns 0 rather than guessing when nobody is described", () => {
    expect(extractWithRules("The bridge is unsafe.").familySize).toBe(0);
  });

  it("parses number words and digits identically", () => {
    expect(parseCount("four")).toBe(4);
    expect(parseCount("4")).toBe(4);
    expect(parseCount("banana")).toBeNull();
  });
});

describe("extractWithRules — needs", () => {
  it("maps wheelchair and bedridden onto mobility_assistance", () => {
    expect(extractWithRules("She uses a wheelchair.").needs).toContain("mobility_assistance");
    expect(extractWithRules("My father is bedridden.").needs).toContain("mobility_assistance");
    expect(extractWithRules("We have limited mobility here.").needs).toContain("mobility_assistance");
  });

  it("maps inhaler, salbutamol and nebuliser onto asthma_medication", () => {
    for (const phrase of ["He needs his inhaler", "We ran out of salbutamol", "She uses a nebuliser at night"]) {
      expect(extractWithRules(phrase).needs).toContain("asthma_medication");
    }
  });

  it("maps baby and formula onto infant_formula", () => {
    expect(extractWithRules("We have a baby with us.").needs).toContain("infant_formula");
    expect(extractWithRules("We are out of infant formula.").needs).toContain("infant_formula");
  });

  it("maps insulin and oxygen", () => {
    expect(extractWithRules("My mother is diabetic and needs insulin.").needs).toContain("insulin");
    expect(extractWithRules("He is on oxygen at home.").needs).toContain("oxygen");
  });

  it("maps no-vehicle phrasings onto transportation + no_vehicle", () => {
    for (const phrase of ["We have no car.", "We don't have a vehicle.", "There is no transport out of here."]) {
      const result = extractWithRules(phrase);
      expect(result.needs).toContain("transportation");
      expect(result.constraints).toContain("no_vehicle");
    }
  });

  it("does NOT invent a transport need when the household has a car", () => {
    const result = extractWithRules("We have a car and can drive ourselves to a shelter.");
    expect(result.needs).not.toContain("transportation");
    expect(result.constraints).not.toContain("no_vehicle");
  });
});

describe("extractWithRules — hazards map onto real world ids", () => {
  it("resolves 'riverside road' onto the whole seeded Riverside Road corridor", () => {
    const result = extractWithRules("Riverside Road is under water.");
    const targets = result.reportedHazards.map((h) => h.target).sort();
    expect(targets).toEqual(["seg_chowk_bend", "seg_riverside_road"]);
    expect(result.reportedHazards.every((h) => h.type === "flood")).toBe(true);
  });

  it("resolves 'the bridge near us' to the nearest Bridge to the reporting family", () => {
    const result = extractWithRules("The bridge near us is unsafe.", { familyId: "family_sharma" });
    expect(result.reportedHazards).toEqual([{ type: "structural", target: "seg_bagmati_crossing" }]);
    expect(result.hazardMentions[0].method).toBe("proximity");
  });

  it("keeps the raw phrase as the target when nothing matches, and says so", () => {
    const result = extractWithRules("The Kathmandu ring highway has collapsed.");
    expect(result.reportedHazards[0].target).toBe("The Kathmandu ring highway");
    expect(result.hazardMentions[0].matched).toBe(false);
    expect(result.notes.some((n) => /Unmatched hazard phrase/.test(n))).toBe(true);
  });

  it("never guesses a segment for a named road it cannot find, even with an anchor", () => {
    const result = extractWithRules("Bhaktapur Ring Road is flooded.", { familyId: "family_sharma" });
    expect(result.hazardMentions[0].matched).toBe(false);
  });
});

describe("world-match — generic tokens cannot carry a match on their own", () => {
  it("refuses to match 'Ward 4 Relief Center' onto Patan Community Relief Center", () => {
    // ward / relief / center are generic. Matching on them would fill the
    // demo's baseline-winning shelter on the strength of the word "relief".
    expect(matchShelters("Ward 4 Relief Center")).toEqual([]);
    expect(scoreName("Ward 4 Relief Center", "Patan Community Relief Center").score).toBe(0);
  });

  it("still matches a shelter that shares a distinctive token", () => {
    expect(matchShelters("Patan relief centre").map((s) => s.id)).toEqual(["shelter_patan_relief"]);
    expect(matchShelters("Old Market Hall").map((s) => s.id)).toEqual(["shelter_market_hall"]);
  });

  it("refuses to match an out-of-district bridge", () => {
    expect(matchSegments("Bhaktapur East Bridge", null).segments).toEqual([]);
  });
});

describe("parseBulletin — the canonical field bulletin", () => {
  const actions = parseBulletin(CANONICAL_BULLETIN);

  it("parses into exactly three structured actions", () => {
    expect(actions).toHaveLength(3);
    expect(actions.map((a) => a.kind)).toEqual(["segment_hazard", "shelter_full", "responders_available"]);
  });

  it("reads the bridge going unsafe as a structural hazard", () => {
    expect(actions[0]).toMatchObject({
      kind: "segment_hazard",
      subject: "Bhaktapur East Bridge",
      hazardType: "structural",
      segmentStatus: "unsafe",
    });
  });

  it("reads the shelter reaching capacity", () => {
    expect(actions[1]).toMatchObject({ kind: "shelter_full", subject: "Ward 4 Relief Center" });
  });

  it("reads the count, the accessibility flag and the place for the vans", () => {
    expect(actions[2]).toMatchObject({
      kind: "responders_available",
      count: 2,
      accessible: true,
      place: "Patan",
    });
  });
});

describe("parseBulletin — other phrasings", () => {
  it("treats 'flooded' and 'impassable' as blocking, 'unsafe' as caution", () => {
    expect(parseBulletin("Riverside Road is flooded.")[0]).toMatchObject({
      hazardType: "flood",
      segmentStatus: "blocked",
    });
    expect(parseBulletin("Bagmati Crossing is now unsafe.")[0]).toMatchObject({
      hazardType: "structural",
      segmentStatus: "unsafe",
    });
  });

  it("reads a landslide reported as an event rather than a state", () => {
    expect(parseBulletin("A landslide has blocked Hill Road.")[0]).toMatchObject({
      kind: "segment_hazard",
      hazardType: "landslide",
      segmentStatus: "blocked",
    });
  });

  it("returns nothing for a sentence that asserts no state change", () => {
    expect(parseBulletin("Crews are assessing the situation in Ward 3.")).toEqual([]);
  });
});

describe("resolveBulletin — unmatched phrases are reported, never dropped", () => {
  const { resolved, unmatched } = resolveBulletin(parseBulletin(CANONICAL_BULLETIN));

  it("grounds nothing from a bulletin naming entities outside this district", () => {
    expect(resolved).toEqual([]);
  });

  it("reports one reason per unresolvable intent, so nothing is silently lost", () => {
    expect(unmatched).toHaveLength(3);
    expect(unmatched.join(" ")).toContain("Bhaktapur East Bridge");
    expect(unmatched.join(" ")).toContain("Ward 4 Relief Center");
    expect(unmatched.join(" ")).toContain("Patan");
  });

  it("accounts for every parsed action exactly once", () => {
    const actions = parseBulletin(CANONICAL_BULLETIN);
    expect(resolved.length + unmatched.length).toBe(actions.length);
  });
});

describe("resolveBulletin — a bulletin that does name seeded entities", () => {
  const text =
    "Bagmati Crossing is now unsafe. Old Market Hall Shelter has reached capacity. " +
    "Two accessible vans are available near Upper Terrace.";
  const { resolved, unmatched } = resolveBulletin(parseBulletin(text));

  it("grounds all three intents on real world ids", () => {
    expect(unmatched).toEqual([]);
    expect(resolved).toHaveLength(3);
  });

  it("grounds the bridge on the seeded segment", () => {
    const hazard = resolved.find((r) => r.kind === "segment_hazard");
    expect(hazard?.kind === "segment_hazard" && hazard.segment.id).toBe("seg_bagmati_crossing");
  });

  it("grounds the shelter on the seeded shelter", () => {
    const shelter = resolved.find((r) => r.kind === "shelter_full");
    expect(shelter?.kind === "shelter_full" && shelter.shelter.id).toBe("shelter_market_hall");
  });

  it("grounds responders on volunteers actually staged there, preferring ones not already available", () => {
    const responders = resolved.find((r) => r.kind === "responders_available");
    expect(responders?.kind === "responders_available" && responders.volunteers.map((v) => v.id)).toEqual([
      "vol_prakash",
    ]);
  });

  it("expands a corridor name to every segment it covers", () => {
    const { resolved: corridor } = resolveBulletin(parseBulletin("Riverside Road is flooded."));
    expect(corridor.map((r) => (r.kind === "segment_hazard" ? r.segment.id : "")).sort()).toEqual([
      "seg_chowk_bend",
      "seg_riverside_road",
    ]);
  });
});

/* ------------------------------------------------------------------ */
/* The LLM half — still pure: no network is touched here.              */
/* ------------------------------------------------------------------ */

describe("stripToJson — tolerate what chat models wrap around JSON", () => {
  it("strips a markdown fence", () => {
    expect(stripToJson('```json\n{"familySize": 4}\n```')).toBe('{"familySize": 4}');
  });

  it("strips a <think> preamble", () => {
    expect(stripToJson('<think>Let me count the people.</think>\n{"familySize": 4}')).toBe('{"familySize": 4}');
  });

  it("strips an unterminated <think> block", () => {
    expect(stripToJson('<think>reasoning that ran on</think>{"a":1}')).toBe('{"a":1}');
  });

  it("strips conversational padding around the object", () => {
    expect(stripToJson('Sure! Here you go:\n{"a":1}\nHope that helps.')).toBe('{"a":1}');
  });

  it("leaves clean JSON untouched", () => {
    expect(stripToJson('{"a":1}')).toBe('{"a":1}');
  });
});

describe("mergeSituations — a model may add to the rules, never subtract", () => {
  const rules = extractWithRules(CANONICAL_INTAKE, { familyId: "family_sharma" });

  it("keeps a rules-only need the model failed to emit", () => {
    // The observed failure: Qwen reads "grandmother cannot walk far" as a
    // constraint and never emits the mobility need. Under replace-if-valid the
    // household would be routed to a shelter without step-free access.
    const merged = mergeSituations(rules, {
      familySize: 4,
      needs: ["shelter", "asthma_medication"],
      constraints: ["limited_mobility"],
    });
    expect(merged.needs).toContain("mobility_assistance");
    expect(merged.needs).toContain("transportation");
    expect(merged.source).toBe("llm");
  });

  it("adds a need only the model saw", () => {
    const merged = mergeSituations(rules, { needs: ["insulin"] });
    expect(merged.needs).toContain("insulin");
  });

  it("drops constraint strings outside the allowed vocabulary", () => {
    const merged = mergeSituations(rules, { constraints: ["no car", "flooded main road"] });
    expect(merged.constraints).not.toContain("no car");
    expect(merged.constraints).toEqual(expect.arrayContaining(["no_vehicle", "limited_mobility"]));
  });

  it("keeps the rules' household size on a material disagreement, and says why", () => {
    const merged = mergeSituations(rules, { familySize: 9 });
    expect(merged.familySize).toBe(4);
    expect(merged.notes.some((n) => /rules read 4, the model read 9/.test(n))).toBe(true);
  });

  it("takes the model's size when it is within one, or when the rules found none", () => {
    expect(mergeSituations(rules, { familySize: 5 }).familySize).toBe(5);
    const noSize = extractWithRules("We need help, the water is rising.");
    expect(mergeSituations(noSize, { familySize: 6 }).familySize).toBe(6);
  });

  it("grounds a model-supplied hazard target through the same resolver", () => {
    const merged = mergeSituations(extractWithRules("We are stuck."), {
      reportedHazards: [{ type: "flood", target: "Riverside Road" }],
    });
    expect(merged.reportedHazards[0].target).toBe("seg_chowk_bend");
  });

  it("keeps a model hazard target it cannot ground as the raw phrase", () => {
    const merged = mergeSituations(extractWithRules("We are stuck."), {
      reportedHazards: [{ type: "fire", target: "Thamel Market Street" }],
    });
    expect(merged.reportedHazards[0].target).toBe("Thamel Market Street");
    expect(merged.hazardMentions[0].matched).toBe(false);
  });
});

describe("SituationSchema — strict enums keep bad model output out of Cypher", () => {
  it("rejects a hallucinated need string", () => {
    expect(SituationSchema.safeParse({ needs: ["helicopter_evacuation"] }).success).toBe(false);
  });

  it("rejects a hallucinated hazard type", () => {
    expect(SituationSchema.safeParse({ reportedHazards: [{ type: "earthquake", target: "x" }] }).success).toBe(false);
  });

  it("accepts a partial but well-typed object", () => {
    expect(SituationSchema.safeParse({ needs: ["shelter"], confidence: 0.8 }).success).toBe(true);
  });
});
