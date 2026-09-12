"use client";

import { Fragment, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Button } from "@/lib/ui/Button";
import { Eyebrow } from "@/lib/ui/Eyebrow";
import { StatusPill } from "@/lib/ui/StatusPill";
import { cn } from "@/lib/ui/cn";
import type { PlanCandidate, RecommendationResponse } from "@/lib/types";
import { Glyph, PulseDot } from "./Glyph";
import { DURATION, EASE_OUT, STAGGER } from "./motion";
import type { LifelineController, Phase } from "./useLifeline";

/**
 * Every branch of this panel is pinned to the same height on desktop. The
 * panel sits directly under the map, so a branch that is 80px shorter than
 * the one it replaces would resize the map mid-disruption and fight the very
 * thing the viewer is watching: the route retracting.
 */
const STABLE_HEIGHT = "lg:min-h-[236px]";

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

  const compromised = phase === "route-broken" || phase === "recalculating";
  const noRoute = !compromised && recommendation?.status === "no_route";

  /* One key per visual state. Re-keying on `generatedAt` is what makes a new
     plan animate in as a new plan rather than silently mutating in place. */
  const branch = compromised
    ? "compromised"
    : noRoute
      ? "no-route"
      : best
        ? `plan:${recommendation?.generatedAt ?? ""}`
        : "idle";

  return (
    <div
      className={cn(
        "relative shrink-0 border-t bg-surface-raised transition-colors duration-200",
        compromised
          ? "border-danger/60 shadow-[0_-26px_52px_-34px_var(--color-danger-glow)]"
          : "border-hairline",
      )}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={branch}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0, transition: { duration: DURATION.swap, ease: EASE_OUT } }}
          exit={{ opacity: 0, y: -6, transition: { duration: DURATION.exit, ease: EASE_OUT } }}
        >
          {compromised ? (
            <CompromisedState phase={phase} previousPlanSummary={previousPlanSummary} />
          ) : noRoute && recommendation ? (
            <NoRouteState recommendation={recommendation} />
          ) : best && recommendation ? (
            <PlanState
              recommendation={recommendation}
              best={best}
              backup={backup}
              onFocusPlan={onFocusPlan}
              onShowWhy={onShowWhy}
              showAlternatives={showAlternatives}
              onToggleAlternatives={() => setShowAlternatives((v) => !v)}
            />
          ) : (
            <IdleState />
          )}
        </motion.div>
      </AnimatePresence>

      <AnimatePresence initial={false}>
        {showAlternatives && recommendation && best && !compromised && (
          <AlternativesDrawer recommendation={recommendation} best={best} onFocusPlan={onFocusPlan} />
        )}
      </AnimatePresence>
    </div>
  );
}

/* ================================================================== */
/* Compromised / recalculating                                         */
/* ================================================================== */

const RECOVERY_STEPS = ["Plan invalidated", "Re-traversing network", "New plan"];

function CompromisedState({
  phase,
  previousPlanSummary,
}: {
  phase: Phase;
  previousPlanSummary: string | null;
}) {
  const searching = phase === "recalculating";
  /* 0 = invalidated, 1 = re-traversing. Nothing claims step 3 until a plan
     actually lands, at which point this branch is gone. */
  const activeStep = searching ? 1 : 0;

  return (
    <div
      role="alert"
      className={cn("relative flex flex-wrap items-center gap-x-12 gap-y-5 px-6 py-5", STABLE_HEIGHT)}
    >
      {/* Urgency as light falling across the panel, not a red fill. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[linear-gradient(104deg,var(--color-danger-surface)_0%,transparent_58%)]"
      />

      <div className="relative flex min-w-[320px] flex-1 items-start gap-4">
        <PulseDot tone="danger" size="md" className="mt-[9px]" />
        <div className="min-w-0">
          <span className="text-micro font-semibold text-danger/80 uppercase">
            {searching ? "Recomputing" : "Plan status"}
          </span>
          <h3 className="mt-2 text-[31px] leading-none font-semibold tracking-[-0.025em] text-danger">
            {searching ? "Searching viable alternatives…" : "Current plan compromised"}
          </h3>
          <p className="mt-3 max-w-[62ch] text-[13px] leading-relaxed text-text-secondary">
            {previousPlanSummary && (
              <>
                <span className="text-text-tertiary line-through decoration-danger/70 decoration-[1.5px]">
                  {previousPlanSummary}
                </span>{" "}
                no longer holds.{" "}
              </>
            )}
            {searching
              ? "Traversing the remaining network for a path that still exists."
              : "The road this plan depended on is blocked in the graph."}
          </p>
        </div>
      </div>

      {/* What the system is doing about it, so the wait reads as work. */}
      <ol className="relative hidden min-w-[220px] flex-col gap-3.5 sm:flex">
        {RECOVERY_STEPS.map((label, i) => {
          const done = i < activeStep;
          const active = i === activeStep;
          return (
            <li key={label} className="flex items-center gap-2.5 text-[12px]">
              <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                {done ? (
                  <Glyph name="check" className="h-3.5 w-3.5 text-safe" />
                ) : active ? (
                  <PulseDot tone="danger" />
                ) : (
                  <span className="h-2 w-2 rounded-full border border-hairline-strong" aria-hidden="true" />
                )}
              </span>
              <span className={active ? "font-medium text-text-primary" : done ? "text-text-secondary" : "text-text-disabled"}>
                {label}
              </span>
              {active && <span className="sr-only">in progress</span>}
              {done && <span className="sr-only">complete</span>}
            </li>
          );
        })}
      </ol>

      {searching && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-[2px] overflow-hidden bg-surface-overlay"
        >
          <motion.div
            className="h-full w-1/4 rounded-full bg-accent"
            animate={{ transform: ["translateX(-100%)", "translateX(400%)"] }}
            transition={{ duration: 1.05, repeat: Infinity, ease: "linear" }}
          />
        </div>
      )}
    </div>
  );
}

/* ================================================================== */
/* The recommended plan                                                */
/* ================================================================== */

function PlanState({
  recommendation,
  best,
  backup,
  onFocusPlan,
  onShowWhy,
  showAlternatives,
  onToggleAlternatives,
}: {
  recommendation: RecommendationResponse;
  best: PlanCandidate;
  backup: PlanCandidate | null;
  onFocusPlan: (plan: PlanCandidate) => void;
  onShowWhy: () => void;
  showAlternatives: boolean;
  onToggleAlternatives: () => void;
}) {
  return (
    <div className={cn("flex flex-wrap items-stretch gap-x-10 gap-y-6 px-6 py-5", STABLE_HEIGHT)}>
      <div className="flex min-w-[340px] flex-[3] flex-col justify-center">
        <div className="flex items-center gap-2.5">
          <Eyebrow>Recommended plan</Eyebrow>
          <StatusPill tone="safe" label="Viable now" />
        </div>

        <PlanChain plan={best} onFocus={() => onFocusPlan(best)} />

        <ul className="mt-4 grid gap-x-8 gap-y-2 sm:grid-cols-2 xl:grid-cols-3">
          <Fact i={0} ok={best.transport.wheelchairAccessible}>
            {best.transport.vehicleName}
            {best.transport.wheelchairAccessible ? ", wheelchair accessible" : ""}
          </Fact>
          <Fact i={1} ok={best.score.hazardZoneNodes === 0}>
            {best.score.hazardZoneNodes === 0
              ? "Avoids all active hazard zones"
              : `Crosses ${best.score.hazardZoneNodes} hazard zone(s)`}
          </Fact>
          <Fact i={2} ok={best.destination.headroom > 0}>
            {best.destination.headroom} spaces remaining on arrival
          </Fact>
          <Fact i={3} ok={best.destination.wheelchairAccessible}>
            {best.destination.wheelchairAccessible ? "Step-free shelter" : "Not step-free"}
          </Fact>
          {best.careSite && (
            <>
              <Fact i={4} ok>{`${best.careSite.name}, ${best.careSite.meters}m away`}</Fact>
              <Fact i={5} ok={best.careSite.resources.length > 0}>
                {best.careSite.resources.map((r) => r.name).join(", ") || "No matching medicine"}
              </Fact>
            </>
          )}
        </ul>

        <div className="tabular mt-4 flex flex-wrap items-baseline gap-x-6 gap-y-1 text-[12px] text-text-tertiary">
          <Meta value={best.route.estimatedMinutes} unit="min travel" />
          <Meta value={best.transport.pickupMinutes} unit="min pickup" />
          <Meta value={best.route.steps.length - 1} unit="segments" />
          <Meta value={best.score.total} unit="route score" />
        </div>
      </div>

      <div className="flex min-w-[248px] flex-col justify-center gap-2.5">
        <Button variant="primary" size="md" fullWidth onClick={() => onFocusPlan(best)}>
          View path on map
        </Button>
        <Button variant="ghost" size="md" fullWidth onClick={onShowWhy}>
          Why this recommendation?
        </Button>
        <button
          type="button"
          onClick={onToggleAlternatives}
          aria-expanded={showAlternatives}
          className="self-center rounded-[var(--radius-sm)] px-1 py-0.5 text-[12px] text-text-tertiary underline-offset-2 transition-colors hover:text-accent hover:underline"
        >
          {showAlternatives
            ? "Hide alternatives"
            : `Show ${recommendation.alternatives.length} alternatives and ${recommendation.rejected.length} rejected`}
        </button>
      </div>

      {backup && <BackupCard backup={backup} best={best} onFocus={() => onFocusPlan(backup)} />}
    </div>
  );
}

/**
 * The answer, as three labelled cells rather than one run-on sentence: when
 * the graph re-plans, a judge has to see at a glance that BOTH the responder
 * and the shelter changed. A staggered 50ms reveal reads left to right, in
 * the order the traversal resolved them.
 */
function PlanChain({ plan, onFocus }: { plan: PlanCandidate; onFocus: () => void }) {
  const via = plan.route.steps.map((s) => s.viaSegmentName).filter(Boolean)[0] as string | undefined;
  const cells = [
    { label: "Responder", value: plan.transport.volunteerName },
    ...(via ? [{ label: "Via", value: via }] : []),
    { label: "Shelter", value: plan.destination.name },
  ].filter((c) => Boolean(c.value));

  return (
    <button
      type="button"
      onClick={onFocus}
      aria-label={`Focus the recommended path: ${cells.map((c) => c.value).join(", then ")}`}
      className="group mt-3 flex flex-wrap items-end gap-x-4 gap-y-3 rounded-[var(--radius-sm)] text-left"
    >
      {cells.map((cell, i) => (
        <Fragment key={cell.label}>
          {i > 0 && (
            <motion.span
              aria-hidden="true"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: DURATION.enter, ease: EASE_OUT, delay: i * 0.05 - 0.02 }}
              className="pb-[5px] text-[18px] text-text-tertiary"
            >
              →
            </motion.span>
          )}
          <motion.span
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: DURATION.enter, ease: EASE_OUT, delay: i * 0.05 }}
            className="flex min-w-0 flex-col"
          >
            <span className="text-micro font-semibold text-text-tertiary uppercase">
              {cell.label}
            </span>
            <span className="mt-1 truncate text-[25px] leading-tight font-semibold tracking-[-0.025em] text-text-primary transition-colors group-hover:text-accent">
              {cell.value}
            </span>
          </motion.span>
        </Fragment>
      ))}
    </button>
  );
}

function Fact({ children, ok, i }: { children: React.ReactNode; ok?: boolean; i: number }) {
  return (
    <motion.li
      initial={{ opacity: 0, y: 5 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: DURATION.enter, ease: EASE_OUT, delay: 0.1 + i * STAGGER }}
      className="flex items-start gap-2 text-[13px] leading-relaxed text-text-secondary"
    >
      <Glyph
        name={ok ? "check" : "alert"}
        className={cn("mt-[5px] h-3 w-3", ok ? "text-safe" : "text-warning")}
      />
      <span className="min-w-0">{children}</span>
    </motion.li>
  );
}

function Meta({ value, unit }: { value: number; unit: string }) {
  return (
    <span>
      <span className="font-medium text-text-secondary">{value}</span> {unit}
    </span>
  );
}

/**
 * Nested enclosure: the backup sits in a recessed tray inside the panel, so
 * it is legible as a real second option without ever competing with the
 * recommendation for the eye.
 */
function BackupCard({
  backup,
  best,
  onFocus,
}: {
  backup: PlanCandidate;
  best: PlanCandidate;
  onFocus: () => void;
}) {
  return (
    <div className="min-w-[252px] flex-1 rounded-[var(--radius-lg)] border border-hairline bg-surface-sunken/70 p-1.5 xl:max-w-[340px]">
      <div className="flex h-full flex-col rounded-[calc(var(--radius-lg)-6px)] border border-hairline-soft bg-surface-raised/40 p-4">
        <div className="flex items-baseline justify-between gap-2">
          <Eyebrow>Backup plan</Eyebrow>
          <span className="tabular shrink-0 text-[11px] text-text-tertiary">
            score {backup.score.total} vs {best.score.total}
          </span>
        </div>
        <div className="mt-2 truncate text-[16px] font-semibold text-text-primary">{backup.destination.name}</div>
        <ul className="mt-2 space-y-1.5">
          <li className="tabular text-[12px] text-text-secondary">
            {backup.route.estimatedMinutes} min travel, {backup.destination.headroom} spaces free
          </li>
          <li className="text-[12px] leading-relaxed text-text-tertiary">
            {backup.careSite
              ? `${backup.careSite.name}, ${backup.careSite.meters}m away`
              : "No care site within reach"}
          </li>
        </ul>
        <button
          type="button"
          onClick={onFocus}
          className="mt-auto self-start rounded-[var(--radius-sm)] pt-3 text-[12px] font-medium text-warning underline-offset-2 transition-colors hover:underline"
        >
          Preview this route
        </button>
      </div>
    </div>
  );
}

/* ================================================================== */
/* No viable route                                                     */
/* ================================================================== */

function NoRouteState({ recommendation }: { recommendation: RecommendationResponse }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-x-12 gap-y-5 px-6 py-5", STABLE_HEIGHT)}>
      <div className="flex min-w-[300px] max-w-[420px] flex-1 items-start gap-4">
        <Glyph name="alert" className="mt-[7px] h-4 w-4 text-danger" />
        <div>
          <Eyebrow>Result</Eyebrow>
          <h3 className="mt-1 text-[22px] leading-tight font-semibold tracking-[-0.02em] text-danger">
            No complete safe path exists right now
          </h3>
          <p className="mt-2 text-[13px] leading-relaxed text-text-secondary">
            Every candidate route fails on one specific constraint. That constraint is the thing worth fixing.
          </p>
        </div>
      </div>
      <div className="flex flex-[2] flex-wrap gap-3">
        {recommendation.missingLinks.map((link, i) => (
          <motion.div
            key={link.needId}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: DURATION.enter, ease: EASE_OUT, delay: 0.08 + i * STAGGER }}
            className="min-w-[248px] flex-1 rounded-[var(--radius-md)] border border-warning/35 bg-warning-surface p-3.5"
          >
            <Eyebrow>Missing link</Eyebrow>
            <div className="mt-1 text-[15px] font-semibold text-warning">{link.needLabel}</div>
            <p className="mt-1 text-[12px] leading-relaxed text-text-secondary">{link.missing}</p>
            {link.nearestCandidate && (
              <div className="mt-2.5 border-t border-hairline pt-2">
                <div className="text-[12px] font-medium text-text-primary">{link.nearestCandidate.name}</div>
                <div className="text-[12px] text-text-tertiary">{link.nearestCandidate.why}</div>
              </div>
            )}
          </motion.div>
        ))}
      </div>
    </div>
  );
}

/* ================================================================== */
/* Idle                                                                */
/* ================================================================== */

function IdleState() {
  return (
    <div className={cn("flex items-center gap-4 px-6 py-5", STABLE_HEIGHT)}>
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-hairline bg-surface-sunken">
        <Glyph name="dot" className="h-3 w-3 text-text-disabled" />
      </div>
      <div className="max-w-[62ch]">
        <div className="text-[15px] font-medium text-text-primary">No plan computed yet</div>
        <p className="mt-1 text-[13px] leading-relaxed text-text-tertiary">
          Describe the household on the left, then run{" "}
          <span className="text-text-secondary">Find a safe path</span>. Lifeline will traverse the live graph and
          show the result here.
        </p>
      </div>
    </div>
  );
}

/* ================================================================== */
/* Alternatives drawer                                                 */
/* ================================================================== */

function AlternativesDrawer({
  recommendation,
  best,
  onFocusPlan,
}: {
  recommendation: RecommendationResponse;
  best: PlanCandidate;
  onFocusPlan: (plan: PlanCandidate) => void;
}) {
  return (
    <motion.div
      /* Height is not animated: the panel resizes in one step and the content
         slides in over it, so no frame costs a layout pass. */
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0, transition: { duration: DURATION.enter, ease: EASE_OUT } }}
      exit={{ opacity: 0, y: -8, transition: { duration: DURATION.exit, ease: EASE_OUT } }}
      className="border-t border-hairline bg-surface-sunken/60"
    >
      <div className="grid gap-3 px-6 py-4 md:grid-cols-2 xl:grid-cols-3">
        {recommendation.alternatives.map((alt, i) => (
          <motion.button
            key={alt.id}
            type="button"
            onClick={() => onFocusPlan(alt)}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: DURATION.enter, ease: EASE_OUT, delay: i * STAGGER }}
            className="rounded-[var(--radius-md)] border border-hairline bg-surface-raised p-3 text-left transition-colors hover:border-accent/50"
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate text-[13px] font-medium text-text-primary">{alt.destination.name}</span>
              <span className="tabular shrink-0 text-[11px] text-text-tertiary">
                +{(alt.score.total - best.score.total).toFixed(1)}
              </span>
            </div>
            <div className="tabular mt-1 text-[12px] text-text-tertiary">
              {alt.route.estimatedMinutes} min · {alt.score.hazardZoneNodes} hazard nodes · score{" "}
              {alt.score.total}
            </div>
          </motion.button>
        ))}
        {recommendation.rejected.map((r, i) => (
          <motion.div
            key={r.destinationId}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              duration: DURATION.enter,
              ease: EASE_OUT,
              delay: (recommendation.alternatives.length + i) * STAGGER,
            }}
            className="rounded-[var(--radius-md)] border border-danger/25 bg-danger-surface/40 p-3"
          >
            <div className="flex items-center gap-2">
              <Glyph name="cross" className="text-danger" />
              <span className="truncate text-[13px] font-medium text-text-secondary">{r.destinationName}</span>
              <span className="ml-auto shrink-0 text-[11px] tracking-[0.08em] text-danger/80 uppercase">
                rejected
              </span>
            </div>
            <div className="mt-1 text-[12px] leading-relaxed text-text-tertiary">
              {r.reason}. {r.detail}
            </div>
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
}
