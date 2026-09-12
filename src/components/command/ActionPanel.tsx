"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Button } from "@/lib/ui/Button";
import { Eyebrow } from "@/lib/ui/Eyebrow";
import { StatusPill } from "@/lib/ui/StatusPill";
import { cn } from "@/lib/ui/cn";
import type { PlanCandidate } from "@/lib/types";
import type { LifelineController } from "./useLifeline";

export interface ActionPanelProps {
  controller: LifelineController;
  onShowWhy: () => void;
  onFocusPlan: (plan: PlanCandidate) => void;
}

export function ActionPanel({ controller, onShowWhy, onFocusPlan }: ActionPanelProps) {
  const { recommendation, phase, previousPlanSummary } = controller;
  const [showAlternatives, setShowAlternatives] = useState(false);

  const best = recommendation?.best ?? null;
  const backup = recommendation?.alternatives[0] ?? null;

  /* ---- compromised / recalculating banner ------------------------- */
  if (phase === "route-broken" || phase === "recalculating") {
    return (
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center gap-4 border-t border-danger/40 bg-danger-surface px-5 py-4"
      >
        <span className="relative flex h-3 w-3 shrink-0">
          <motion.span
            className="absolute inline-flex h-full w-full rounded-full bg-danger"
            animate={{ opacity: [0.8, 0.1, 0.8], scale: [1, 2.4, 1] }}
            transition={{ duration: 1.1, repeat: Infinity }}
          />
          <span className="relative inline-flex h-3 w-3 rounded-full bg-danger" />
        </span>
        <div className="min-w-0">
          <div className="text-lg font-semibold tracking-tight text-danger">
            {phase === "route-broken" ? "Current plan compromised" : "Searching viable alternatives…"}
          </div>
          <div className="truncate text-[13px] text-text-secondary">
            {previousPlanSummary ? `${previousPlanSummary} is no longer viable — ` : ""}
            {phase === "route-broken"
              ? "the route this plan depended on is blocked in the graph."
              : "traversing the remaining network for a path that still exists."}
          </div>
        </div>
        {phase === "recalculating" && (
          <motion.div
            className="ml-auto h-0.5 w-40 overflow-hidden rounded-full bg-surface-overlay"
            aria-hidden="true"
          >
            <motion.div
              className="h-full w-1/3 rounded-full bg-accent"
              animate={{ x: ["-100%", "300%"] }}
              transition={{ duration: 0.9, repeat: Infinity, ease: "linear" }}
            />
          </motion.div>
        )}
      </motion.div>
    );
  }

  /* ---- no viable route: the missing link -------------------------- */
  if (recommendation && recommendation.status === "no_route") {
    return (
      <div className="border-t border-danger/40 bg-surface-raised px-5 py-4">
        <div className="flex flex-wrap items-start gap-x-8 gap-y-4">
          <div className="min-w-[280px] flex-1">
            <Eyebrow>Result</Eyebrow>
            <h3 className="mt-1 text-lg font-semibold tracking-tight text-danger">
              No complete safe path currently exists
            </h3>
            <p className="mt-1 max-w-prose text-[13px] leading-relaxed text-text-secondary">
              Every candidate route fails on one specific constraint. That constraint is the thing worth fixing.
            </p>
          </div>
          <div className="flex flex-[2] flex-wrap gap-3">
            {recommendation.missingLinks.map((link) => (
              <div
                key={link.needId}
                className="min-w-[260px] flex-1 rounded-[var(--radius-md)] border border-warning/40 bg-warning-surface p-3"
              >
                <Eyebrow>Missing link</Eyebrow>
                <div className="mt-1 text-[15px] font-semibold text-warning">{link.needLabel}</div>
                <p className="mt-1 text-[12px] leading-relaxed text-text-secondary">{link.missing}</p>
                {link.nearestCandidate && (
                  <div className="mt-2 border-t border-hairline pt-2">
                    <div className="text-[12px] font-medium text-text-primary">{link.nearestCandidate.name}</div>
                    <div className="text-[12px] text-text-tertiary">{link.nearestCandidate.why}</div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  /* ---- idle ------------------------------------------------------- */
  if (!best) {
    return (
      <div className="flex items-center gap-3 border-t border-hairline bg-surface-raised px-5 py-5">
        <div className="text-[13px] text-text-tertiary">
          Describe the household on the left, then run{" "}
          <span className="text-text-secondary">Find a safe path</span> to compute a route from the live graph.
        </div>
      </div>
    );
  }

  /* ---- the plan --------------------------------------------------- */
  return (
    <div className="border-t border-hairline bg-surface-raised">
      <div className="flex flex-wrap items-stretch gap-x-8 gap-y-4 px-5 py-4">
        <PlanCard plan={best} primary onFocus={() => onFocusPlan(best)} />

        <div className="flex min-w-[240px] flex-col justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" size="md" onClick={() => onFocusPlan(best)}>
              View path
            </Button>
            <Button variant="ghost" size="md" onClick={onShowWhy}>
              Why this recommendation?
            </Button>
          </div>
          <button
            type="button"
            onClick={() => setShowAlternatives((v) => !v)}
            aria-expanded={showAlternatives}
            className="self-start text-[12px] text-text-tertiary underline-offset-2 hover:text-accent hover:underline"
          >
            {showAlternatives ? "Hide alternatives" : `Show alternatives (${recommendation?.alternatives.length ?? 0})`}
          </button>
        </div>

        {backup && (
          <div className="min-w-[280px] flex-1 border-l border-hairline pl-6">
            <div className="flex items-center gap-2">
              <Eyebrow>Backup</Eyebrow>
              <StatusPill tone="warning" label="Second choice" />
            </div>
            <div className="mt-1 text-[15px] font-semibold text-text-primary">{backup.destination.name}</div>
            <ul className="mt-1.5 space-y-1">
              <li className="text-[12px] text-text-secondary">
                {backup.route.estimatedMinutes} min · {backup.destination.headroom} spaces free
              </li>
              <li className="text-[12px] text-text-tertiary">
                {backup.careSite
                  ? `${backup.careSite.name} ${backup.careSite.meters}m away`
                  : "No care site within reach"}
              </li>
              <li className="text-[12px] text-text-tertiary">
                Ranked second: score {backup.score.total} vs {best.score.total}
              </li>
            </ul>
            <button
              type="button"
              onClick={() => onFocusPlan(backup)}
              className="mt-2 text-[12px] text-warning underline-offset-2 hover:underline"
            >
              Preview this route
            </button>
          </div>
        )}
      </div>

      <AnimatePresence>
        {showAlternatives && recommendation && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-t border-hairline bg-surface-sunken/50"
          >
            <div className="grid gap-3 px-5 py-4 md:grid-cols-2 xl:grid-cols-3">
              {recommendation.alternatives.map((alt) => (
                <button
                  key={alt.id}
                  type="button"
                  onClick={() => onFocusPlan(alt)}
                  className="rounded-[var(--radius-md)] border border-hairline bg-surface-raised p-3 text-left transition-colors hover:border-accent/50 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
                >
                  <div className="text-[13px] font-medium text-text-primary">{alt.destination.name}</div>
                  <div className="tabular mt-1 text-[12px] text-text-tertiary">
                    score {alt.score.total} · {alt.route.estimatedMinutes} min · {alt.score.hazardZoneNodes} hazard
                    nodes
                  </div>
                </button>
              ))}
              {recommendation.rejected.map((r) => (
                <div
                  key={r.destinationId}
                  className="rounded-[var(--radius-md)] border border-danger/25 bg-danger-surface/40 p-3"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-danger" aria-hidden="true">
                      ✕
                    </span>
                    <span className="text-[13px] font-medium text-text-secondary">{r.destinationName}</span>
                  </div>
                  <div className="mt-1 text-[12px] text-text-tertiary">
                    {r.reason} — {r.detail}
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function PlanCard({ plan, primary, onFocus }: { plan: PlanCandidate; primary?: boolean; onFocus: () => void }) {
  const segmentNames = plan.route.steps.map((s) => s.viaSegmentName).filter(Boolean) as string[];
  const headline = [plan.transport.volunteerName, segmentNames[0], plan.destination.name].filter(Boolean).join(" → ");

  return (
    <div className={cn("min-w-[320px] flex-[2]", primary && "relative")}>
      <div className="flex items-center gap-2">
        <Eyebrow>Best current plan</Eyebrow>
        <StatusPill tone="safe" label="Viable now" />
      </div>
      <button
        type="button"
        onClick={onFocus}
        className="mt-1 block text-left text-[19px] leading-tight font-semibold tracking-tight text-text-primary underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
      >
        {headline}
      </button>
      <ul className="mt-2 grid gap-x-6 gap-y-1 sm:grid-cols-2">
        <Fact ok={plan.transport.wheelchairAccessible}>
          {plan.transport.vehicleName}
          {plan.transport.wheelchairAccessible ? " · wheelchair accessible" : ""}
        </Fact>
        <Fact ok={plan.score.hazardZoneNodes === 0}>
          {plan.score.hazardZoneNodes === 0
            ? "Avoids all active hazard zones"
            : `Crosses ${plan.score.hazardZoneNodes} hazard zone(s)`}
        </Fact>
        <Fact ok={plan.destination.headroom > 0}>
          {plan.destination.headroom} spaces remaining at {plan.destination.name}
        </Fact>
        <Fact ok={plan.destination.wheelchairAccessible}>
          {plan.destination.wheelchairAccessible ? "Step-free shelter" : "Not step-free"}
        </Fact>
        {plan.careSite && (
          <>
            <Fact ok>{`${plan.careSite.name} ${plan.careSite.meters}m away`}</Fact>
            <Fact ok={plan.careSite.resources.length > 0}>
              {plan.careSite.resources.map((r) => r.name).join(", ") || "No matching medicine"}
            </Fact>
          </>
        )}
      </ul>
      <div className="tabular mt-2 flex flex-wrap gap-x-4 text-[12px] text-text-tertiary">
        <span>{plan.route.estimatedMinutes} min travel</span>
        <span>{plan.transport.pickupMinutes} min pickup</span>
        <span>{plan.route.steps.length - 1} segments</span>
        <span>score {plan.score.total}</span>
      </div>
    </div>
  );
}

function Fact({ children, ok }: { children: React.ReactNode; ok?: boolean }) {
  return (
    <li className="flex items-start gap-2 text-[13px] leading-snug text-text-secondary">
      <span aria-hidden="true" className={cn("mt-[2px] shrink-0 text-[11px]", ok ? "text-safe" : "text-warning")}>
        {ok ? "●" : "▲"}
      </span>
      <span>{children}</span>
    </li>
  );
}
