"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ExtractedSituation,
  GraphPayload,
  RecommendationResponse,
  ScenarioState,
  World,
} from "@/lib/types";

/* ------------------------------------------------------------------ */
/* Phases                                                              */
/* ------------------------------------------------------------------ */

export type Phase =
  | "idle"
  | "understanding"
  | "searching"
  | "route-found"
  | "route-broken"
  | "recalculating"
  | "no-route";

export interface UnderstandingStep {
  label: string;
  done: boolean;
}

export interface LiveAlert {
  id: string;
  title: string;
  body: string;
  severity: number;
  at: number;
}

export interface ImpactPulse {
  segments: string[];
  locations: string[];
  shelters: string[];
  volunteers: string[];
}

export interface ScenarioBundle {
  state: ScenarioState;
  district: World["district"];
  families: { id: string; name: string; size: number; locationId: string; note: string }[];
  hazards: World["hazards"];
  segments: World["segments"];
  locations: World["locations"];
  shelters: World["shelters"];
  careSites: World["careSites"];
  volunteers: World["volunteers"];
  vehicles: World["vehicles"];
}

const UNDERSTANDING_LABELS = [
  "Extracting needs",
  "Checking active hazards",
  "Mapping reachable resources",
  "Finding viable paths",
];

/** Short, deliberate beats. Long enough to read, short enough to never stall a demo. */
const BEAT = 420;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body?.error ?? `Request to ${path} failed`) as Error & { code?: string };
    error.code = body?.code;
    throw error;
  }
  return body as T;
}

export function useLifeline(familyId: string) {
  const [scenario, setScenario] = useState<ScenarioBundle | null>(null);
  const [graph, setGraph] = useState<GraphPayload>({ nodes: [], edges: [] });
  const [recommendation, setRecommendation] = useState<RecommendationResponse | null>(null);
  const [previousPlanSummary, setPreviousPlanSummary] = useState<string | null>(null);
  const [situation, setSituation] = useState<ExtractedSituation | null>(null);

  const [phase, setPhase] = useState<Phase>("idle");
  const [understanding, setUnderstanding] = useState<UnderstandingStep[]>([]);
  const [alerts, setAlerts] = useState<LiveAlert[]>([]);
  const [impact, setImpact] = useState<ImpactPulse>({ segments: [], locations: [], shelters: [], volunteers: [] });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [graphError, setGraphError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  /* ---------------------------------------------------------------- */
  /* Loading                                                           */
  /* ---------------------------------------------------------------- */

  const refreshWorld = useCallback(async () => {
    try {
      const [bundle, graphPayload] = await Promise.all([
        api<ScenarioBundle>("/api/scenario"),
        api<GraphPayload>("/api/graph"),
      ]);
      if (!mounted.current) return;
      setScenario(bundle);
      setGraph(graphPayload);
      setGraphError(null);
    } catch (error) {
      if (!mounted.current) return;
      setGraphError(error instanceof Error ? error.message : String(error));
    }
  }, []);

  useEffect(() => {
    void refreshWorld();
  }, [refreshWorld]);

  const pushAlert = useCallback((alert: Omit<LiveAlert, "at">) => {
    setAlerts((prev) => [{ ...alert, at: Date.now() }, ...prev].slice(0, 4));
  }, []);

  const dismissAlert = useCallback((id: string) => {
    setAlerts((prev) => prev.filter((a) => a.id !== id));
  }, []);

  /* ---------------------------------------------------------------- */
  /* Find a safe path                                                  */
  /* ---------------------------------------------------------------- */

  const findSafePath = useCallback(
    async (options: { showUnderstanding?: boolean } = {}) => {
      const { showUnderstanding = true } = options;
      setBusy(true);
      setGraphError(null);

      if (showUnderstanding) {
        setPhase("understanding");
        setUnderstanding(UNDERSTANDING_LABELS.map((label) => ({ label, done: false })));
        // Kick the query off immediately; the beats run alongside it, they do
        // not gate it. A fast graph must never be made to look slow.
        const pending = api<RecommendationResponse>("/api/route/recommend", {
          method: "POST",
          body: JSON.stringify({ familyId }),
        });
        for (let i = 0; i < UNDERSTANDING_LABELS.length; i++) {
          await sleep(BEAT);
          if (!mounted.current) return;
          setUnderstanding((prev) => prev.map((s, idx) => (idx <= i ? { ...s, done: true } : s)));
        }
        setPhase("searching");
        try {
          const result = await pending;
          if (!mounted.current) return;
          setRecommendation(result);
          setPhase(result.status === "success" ? "route-found" : "no-route");
          await refreshWorld();
        } catch (error) {
          if (!mounted.current) return;
          setGraphError(error instanceof Error ? error.message : String(error));
          setPhase("idle");
        } finally {
          if (mounted.current) setBusy(false);
        }
        return;
      }

      setPhase("searching");
      try {
        const result = await api<RecommendationResponse>("/api/route/recommend", {
          method: "POST",
          body: JSON.stringify({ familyId }),
        });
        if (!mounted.current) return;
        setRecommendation(result);
        setPhase(result.status === "success" ? "route-found" : "no-route");
        await refreshWorld();
      } catch (error) {
        if (!mounted.current) return;
        setGraphError(error instanceof Error ? error.message : String(error));
        setPhase("idle");
      } finally {
        if (mounted.current) setBusy(false);
      }
    },
    [familyId, refreshWorld],
  );

  /* ---------------------------------------------------------------- */
  /* Disruptions — the signature moment                                */
  /* ---------------------------------------------------------------- */

  interface DisruptionResponse {
    kind: string;
    label: string;
    impacted: ImpactPulse;
    invalidatedPlans: { planId: string; familyId: string; familyName: string; summary: string }[];
    alert: { id: string; title: string; body: string; severity: number } | null;
  }

  const disrupt = useCallback(
    async (path: string, body: Record<string, unknown>) => {
      setBusy(true);
      const hadPlan = Boolean(recommendation?.best);
      setPreviousPlanSummary(
        recommendation?.best
          ? `${recommendation.best.transport.volunteerName} → ${recommendation.best.destination.name}`
          : null,
      );

      try {
        // 1. The world actually changes, in Neo4j.
        const result = await api<DisruptionResponse>(path, { method: "POST", body: JSON.stringify(body) });
        if (!mounted.current) return;

        // 2. The alert arrives and the impact ripples through both views.
        if (result.alert) pushAlert(result.alert);
        setImpact(result.impacted);

        // 3. Only claim the plan is compromised if the graph says this event
        //    actually touched it — never assume a disruption broke something.
        const brokeCurrentPlan = result.invalidatedPlans.some((p) => p.familyId === familyId);
        if (hadPlan && brokeCurrentPlan) {
          setPhase("route-broken");
          await sleep(BEAT * 2.2);
          if (!mounted.current) return;
          setPhase("recalculating");
          await sleep(BEAT);
        }
        await refreshWorld();
        if (!mounted.current) return;

        // 4. Recompute against the world as it now is.
        if (hadPlan) {
          await findSafePath({ showUnderstanding: false });
        }
      } catch (error) {
        if (!mounted.current) return;
        setGraphError(error instanceof Error ? error.message : String(error));
      } finally {
        if (mounted.current) setBusy(false);
        setTimeout(() => mounted.current && setImpact({ segments: [], locations: [], shelters: [], volunteers: [] }), 2600);
      }
    },
    [familyId, findSafePath, pushAlert, recommendation, refreshWorld],
  );

  const floodRiversideRoad = useCallback(
    () => disrupt("/api/events/hazard", { hazardId: "hz_riverside_flood", active: true }),
    [disrupt],
  );
  const closeBridge = useCallback(
    () => disrupt("/api/events/road-block", { segmentId: "seg_upper_canal_bridge" }),
    [disrupt],
  );
  const fillShelter = useCallback(
    (shelterId = "shelter_patan_relief") => disrupt("/api/events/shelter-full", { shelterId }),
    [disrupt],
  );
  const disableVolunteer = useCallback(
    (volunteerId = "vol_maya") => disrupt("/api/events/volunteer", { volunteerId, status: "unavailable" }),
    [disrupt],
  );
  const addLandslide = useCallback(
    () => disrupt("/api/events/hazard", { hazardId: "hz_upper_landslide", active: true }),
    [disrupt],
  );

  const reset = useCallback(async () => {
    setBusy(true);
    try {
      await api("/api/scenario/reset", { method: "POST" });
      if (!mounted.current) return;
      setRecommendation(null);
      setPreviousPlanSummary(null);
      setSituation(null);
      setUnderstanding([]);
      setAlerts([]);
      setImpact({ segments: [], locations: [], shelters: [], volunteers: [] });
      setSelectedId(null);
      setPhase("idle");
      setGraphError(null);
      await refreshWorld();
    } catch (error) {
      if (!mounted.current) return;
      setGraphError(error instanceof Error ? error.message : String(error));
    } finally {
      if (mounted.current) setBusy(false);
    }
  }, [refreshWorld]);

  const submitIntake = useCallback(
    async (payload: { text?: string; structured?: Record<string, unknown> }) => {
      try {
        const result = await api<{ situation: ExtractedSituation }>("/api/intake", {
          method: "POST",
          body: JSON.stringify({ familyId, ...payload }),
        });
        if (!mounted.current) return null;
        setSituation(result.situation);
        await refreshWorld();
        return result.situation;
      } catch (error) {
        if (!mounted.current) return null;
        setGraphError(error instanceof Error ? error.message : String(error));
        return null;
      }
    },
    [familyId, refreshWorld],
  );

  const submitBulletin = useCallback(
    async (text: string) => {
      setBusy(true);
      try {
        const result = await api<{ applied: { action: string; targetId: string; targetName: string; detail: string }[]; unmatched: string[] }>(
          "/api/bulletin",
          { method: "POST", body: JSON.stringify({ text }) },
        );
        if (!mounted.current) return null;
        if (result.applied.length > 0) {
          pushAlert({
            id: `alert_bulletin_${Date.now()}`,
            title: "Field update applied to the graph",
            body: result.applied.map((a) => a.detail).join(" · "),
            severity: 0.5,
          });
          setImpact({
            segments: result.applied.map((a) => a.targetId).filter((id) => id.startsWith("seg_")),
            locations: [],
            shelters: result.applied.map((a) => a.targetId).filter((id) => id.startsWith("shelter_")),
            volunteers: result.applied.map((a) => a.targetId).filter((id) => id.startsWith("vol_")),
          });
        }
        await refreshWorld();
        if (recommendation?.best) await findSafePath({ showUnderstanding: false });
        return result;
      } catch (error) {
        if (!mounted.current) return null;
        setGraphError(error instanceof Error ? error.message : String(error));
        return null;
      } finally {
        if (mounted.current) setBusy(false);
      }
    },
    [findSafePath, pushAlert, recommendation, refreshWorld],
  );

  return {
    // data
    scenario,
    graph,
    recommendation,
    previousPlanSummary,
    situation,
    // ui state
    phase,
    understanding,
    alerts,
    impact,
    selectedId,
    graphError,
    busy,
    // actions
    setSelectedId,
    findSafePath,
    floodRiversideRoad,
    closeBridge,
    fillShelter,
    disableVolunteer,
    addLandslide,
    reset,
    submitIntake,
    submitBulletin,
    dismissAlert,
    refreshWorld,
  };
}

export type LifelineController = ReturnType<typeof useLifeline>;
