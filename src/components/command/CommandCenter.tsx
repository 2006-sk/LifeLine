"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { AnimatePresence, motion } from "framer-motion";
import { Button } from "@/lib/ui/Button";
import { Eyebrow } from "@/lib/ui/Eyebrow";
import type { PlanCandidate } from "@/lib/types";
import { Header } from "./Header";
import { SituationPanel } from "./SituationPanel";
import { ActionPanel } from "./ActionPanel";
import { GraphIntelligencePanel } from "./GraphIntelligencePanel";
import { AlertStack, BulletinDialog, WhyOverlay } from "./Overlays";
import { StoryMode } from "./StoryMode";
import { useLifeline } from "./useLifeline";

const LifelineMap = dynamic(() => import("@/components/map/LifelineMap"), {
  ssr: false,
  loading: () => (
    <div className="grid-backdrop flex h-full items-center justify-center text-[12px] text-text-tertiary">
      Loading district…
    </div>
  ),
});

const FAMILY_ID = "family_sharma";

export function CommandCenter({ autoDemo = false }: { autoDemo?: boolean }) {
  const controller = useLifeline(FAMILY_ID);
  const [judgeMode, setJudgeMode] = useState(false);
  const [whyOpen, setWhyOpen] = useState(false);
  const [bulletinOpen, setBulletinOpen] = useState(false);
  const [previewPlan, setPreviewPlan] = useState<PlanCandidate | null>(null);
  const [hoverHighlight, setHoverHighlight] = useState<string | null>(null);
  const [mobileTab, setMobileTab] = useState<"map" | "graph" | "situation">("map");

  const { scenario, recommendation, phase, graphError, alerts } = controller;

  /* Judge-friendly: land on the page and run the scenario once.
     Guarded by a ref: `reset()` returns phase to idle and refreshes `scenario`,
     which would otherwise re-trigger this and fight the user's reset. */
  const autoRan = useRef(false);
  useEffect(() => {
    if (!autoDemo || !scenario || autoRan.current) return;
    if (phase !== "idle") return;
    autoRan.current = true;
    void controller.findSafePath();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoDemo, scenario]);

  const best = recommendation?.best ?? null;
  const shown = previewPlan ?? best;

  const blockedSegmentIds = scenario?.state.blockedSegments ?? [];
  const activeHazardIds = useMemo(
    () => (scenario?.state.activeHazards ?? []).map((h) => h.id),
    [scenario],
  );

  const alternatives = useMemo(
    () =>
      (recommendation?.alternatives ?? []).map((alt) => ({
        id: alt.id,
        steps: alt.route.steps,
      })),
    [recommendation],
  );

  const onFocusPlan = useCallback(
    (plan: PlanCandidate) => {
      setPreviewPlan(plan.id === best?.id ? null : plan);
      controller.setSelectedId(plan.destination.id);
    },
    [best, controller],
  );

  // Clear a preview whenever a fresh recommendation lands.
  useEffect(() => {
    setPreviewPlan(null);
  }, [recommendation?.generatedAt]);

  /* ---- hard failure: the graph is the product -------------------- */
  if (graphError) {
    return (
      <div className="grid-backdrop flex min-h-screen items-center justify-center p-6">
        <div className="max-w-lg rounded-[var(--radius-lg)] border border-danger/50 bg-danger-surface p-6">
          <Eyebrow>Graph unavailable</Eyebrow>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-danger">Lifeline cannot reason right now</h1>
          <p className="mt-2 text-[14px] leading-relaxed text-text-secondary">
            Every safe-path answer in Lifeline is a traversal executed inside Neo4j. The graph is unreachable, so there
            is nothing trustworthy to show. Lifeline will not invent a route.
          </p>
          <pre className="mt-3 overflow-auto rounded bg-surface-base/70 p-3 font-mono text-[11px] whitespace-pre-wrap text-text-tertiary">
            {graphError}
          </pre>
          <div className="mt-4 flex gap-2">
            <Button variant="primary" size="md" onClick={() => controller.refreshWorld()}>
              Retry connection
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="grid-backdrop relative flex h-screen min-h-0 flex-col overflow-hidden">
      <Header
        controller={controller}
        onOpenBulletin={() => setBulletinOpen(true)}
        judgeMode={judgeMode}
        onToggleJudgeMode={() => setJudgeMode((v) => !v)}
      />

      {/* Mobile tabs --------------------------------------------------- */}
      <div className="flex shrink-0 gap-1 border-b border-hairline bg-surface-raised px-3 py-2 lg:hidden">
        {(["map", "graph", "situation"] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setMobileTab(tab)}
            aria-pressed={mobileTab === tab}
            className={`flex-1 rounded-[var(--radius-sm)] px-3 py-1.5 text-[12px] font-medium capitalize transition-colors focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none ${
              mobileTab === tab ? "bg-surface-overlay text-text-primary" : "text-text-tertiary"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      <main className="relative flex min-h-0 flex-1 overflow-hidden">
        {/* Left: human situation */}
        <aside
          className={`w-[330px] shrink-0 border-r border-hairline bg-surface-raised/70 backdrop-blur-[var(--blur-panel)] ${
            mobileTab === "situation" ? "absolute inset-0 z-20 w-full" : "hidden"
          } lg:relative lg:z-auto lg:block lg:w-[330px]`}
        >
          <SituationPanel controller={controller} />
        </aside>

        {/* Center: the map */}
        <section
          className={`relative min-w-0 flex-1 ${mobileTab === "map" ? "block" : "hidden"} lg:block`}
          aria-label="District map"
        >
          <LifelineMap
            blockedSegmentIds={blockedSegmentIds}
            activeHazardIds={activeHazardIds}
            route={shown ? { steps: shown.route.steps } : null}
            pickupRoute={shown?.transport.pickupSteps.length ? { steps: shown.transport.pickupSteps } : null}
            alternatives={alternatives}
            selectedId={hoverHighlight ?? controller.selectedId}
            onSelect={controller.setSelectedId}
            phase={
              phase === "route-broken"
                ? "route-broken"
                : phase === "route-found"
                  ? "route-found"
                  : phase === "searching" || phase === "recalculating"
                    ? "searching"
                    : "idle"
            }
            className="h-full w-full"
          />

          <AlertStack alerts={alerts} onDismiss={controller.dismissAlert} />

          {/* District label — never imply this is a live feed */}
          <div className="pointer-events-none absolute bottom-3 left-3 z-10 rounded-[var(--radius-sm)] border border-hairline bg-surface-base/80 px-2.5 py-1.5 backdrop-blur-sm">
            <div className="text-[11px] font-medium text-text-secondary">{scenario?.district.name}</div>
            <div className="text-[10px] text-text-tertiary">{scenario?.district.subtitle}</div>
          </div>

          <AnimatePresence>
            {previewPlan && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                className="absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-full border border-warning/50 bg-warning-surface px-3 py-1.5 text-[12px] text-warning"
              >
                Previewing alternative: {previewPlan.destination.name}
                <button
                  type="button"
                  onClick={() => setPreviewPlan(null)}
                  className="ml-2 underline underline-offset-2"
                >
                  back to best plan
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          <StoryMode controller={controller} onShowWhy={() => setWhyOpen(true)} />
        </section>

        {/* Right: the graph */}
        <aside
          className={`w-[380px] shrink-0 border-l border-hairline bg-surface-raised/70 backdrop-blur-[var(--blur-panel)] ${
            mobileTab === "graph" ? "absolute inset-0 z-20 w-full" : "hidden"
          } lg:relative lg:z-auto lg:block lg:w-[380px] xl:w-[420px]`}
          aria-label="Knowledge graph"
        >
          <GraphIntelligencePanel
            controller={controller}
            judgeMode={judgeMode}
            highlightOverride={hoverHighlight}
          />
        </aside>

        <WhyOverlay
          open={whyOpen}
          planId={recommendation?.planId ?? null}
          onClose={() => setWhyOpen(false)}
          onHighlight={setHoverHighlight}
        />
        <BulletinDialog
          open={bulletinOpen}
          onClose={() => setBulletinOpen(false)}
          onSubmit={controller.submitBulletin}
        />
      </main>

      <ActionPanel controller={controller} onShowWhy={() => setWhyOpen(true)} onFocusPlan={onFocusPlan} />
    </div>
  );
}
