"use client";

import { cn } from "@/lib/ui/cn";
import { Glyph, PulseDot } from "./Glyph";
import type { LifelineController, Phase } from "./useLifeline";

/* ================================================================== */
/* Phase readout                                                       */
/* ================================================================== */

/**
 * The header used to show a decorative "LIVE SIMULATION" light that said the
 * same thing forever. It now reports the state machine, so the one always-on
 * element on the screen is the one that actually tells you something. Tone is
 * paired with a written label, never hue on its own.
 */
const PHASE_READOUT: Record<Phase, { label: string; tone: "safe" | "danger" | "warning" | "accent" | "muted" }> = {
  idle: { label: "Standing by", tone: "muted" },
  understanding: { label: "Reading intake", tone: "accent" },
  searching: { label: "Traversing graph", tone: "accent" },
  "route-found": { label: "Plan active", tone: "safe" },
  "route-broken": { label: "Plan compromised", tone: "danger" },
  recalculating: { label: "Recomputing", tone: "warning" },
  "no-route": { label: "No safe path", tone: "danger" },
};

const TONE_TEXT = {
  safe: "text-safe",
  danger: "text-danger",
  warning: "text-warning",
  accent: "text-accent",
  muted: "text-text-tertiary",
} as const;

function Metric({
  value,
  label,
  srLabel,
  tone,
}: {
  value: number | string;
  label: string;
  srLabel: string;
  tone?: "danger" | "safe" | "neutral";
}) {
  const toneClass = tone === "danger" ? "text-danger" : tone === "safe" ? "text-safe" : "text-text-primary";
  return (
    <div className="flex flex-col items-start gap-1 px-3.5 first:pl-0 last:pr-0">
      <span className={cn("tabular text-[20px] leading-none font-semibold tracking-[-0.02em]", toneClass)}>
        {value}
      </span>
      <span className="text-micro whitespace-nowrap text-text-tertiary uppercase">
        {label}
        <span className="sr-only"> {srLabel}</span>
      </span>
    </div>
  );
}

export interface HeaderProps {
  controller: LifelineController;
  judgeMode: boolean;
  onToggleJudgeMode: () => void;
}

/**
 * Tier one of the chrome: identity, live state, and the one control that
 * changes what the product shows. Nothing that breaks the world lives here,
 * because breaking the world is a demo instrument, not the product.
 */
export function Header({ controller, judgeMode, onToggleJudgeMode }: HeaderProps) {
  const { scenario, phase } = controller;
  const counts = scenario?.state.counts;
  const readout = PHASE_READOUT[phase];

  return (
    <header className="relative z-30 flex flex-wrap items-center gap-x-7 gap-y-3 border-b border-hairline bg-surface-raised/80 px-5 py-3 backdrop-blur-[var(--blur-panel)]">
      <div className="flex items-center gap-3">
        <LifelineMark />
        <div className="leading-tight">
          <div className="text-[17px] font-semibold tracking-[0.01em] text-text-primary">Lifeline</div>
          <div className="text-micro text-text-tertiary uppercase">
            Disaster Response Intelligence
          </div>
        </div>
      </div>

      <div
        role="status"
        aria-live="polite"
        className="flex items-center gap-2.5 rounded-full border border-hairline bg-surface-sunken px-3 py-1.5"
      >
        <PulseDot tone={readout.tone} active={phase !== "idle"} />
        <span className={cn("text-micro font-semibold uppercase", TONE_TEXT[readout.tone])}>
          {readout.label}
        </span>
      </div>

      <div className="flex items-center divide-x divide-[var(--color-hairline)]">
        <Metric
          value={counts?.activeHazards ?? 0}
          label="Hazards"
          srLabel="active"
          tone={(counts?.activeHazards ?? 0) > 0 ? "danger" : "neutral"}
        />
        <Metric value={counts?.openShelters ?? 0} label="Shelters" srLabel="open" tone="safe" />
        <Metric value={counts?.availableVolunteers ?? 0} label="Responders" srLabel="available" />
        <Metric value={counts?.familiesMonitored ?? 0} label="Families" srLabel="monitored" />
      </div>

      <div className="ml-auto">
        <ViewToggle judgeMode={judgeMode} onToggle={onToggleJudgeMode} />
      </div>
    </header>
  );
}

/* ================================================================== */
/* View toggle                                                         */
/* ================================================================== */

function ViewToggle({ judgeMode, onToggle }: { judgeMode: boolean; onToggle: () => void }) {
  const options = [
    { id: "human", label: "Human", pressed: !judgeMode },
    { id: "graph", label: "Graph", pressed: judgeMode },
  ] as const;

  return (
    <div
      role="group"
      aria-label="View mode"
      className="flex items-center gap-0.5 rounded-full border border-hairline bg-surface-sunken p-1"
    >
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          aria-pressed={option.pressed}
          onClick={() => {
            if (!option.pressed) onToggle();
          }}
          className={cn(
            "rounded-full px-3.5 py-1.5 text-[11px] font-semibold tracking-[0.1em] uppercase",
            "transition-colors duration-150 active:scale-[0.97]",
            "[transition-property:color,background-color,border-color,transform]",
            option.pressed
              ? "bg-surface-overlay text-text-primary shadow-[inset_0_1px_0_0_rgb(255_255_255/6%)]"
              : "text-text-tertiary hover:text-text-secondary",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/* ================================================================== */
/* Simulation rail                                                     */
/* ================================================================== */

/**
 * Tier two: demo instruments. Recessed surface, lowercase labels, small hit
 * pills, and a literal "Simulate" tag, so the eye reads these as a test
 * harness attached to the product rather than as product chrome. Every
 * control stays one click away: the flood button is never behind a menu,
 * because the demo's rhythm depends on it firing instantly.
 */
export function SimulateRail({
  controller,
  onOpenBulletin,
}: {
  controller: LifelineController;
  onOpenBulletin: () => void;
}) {
  const { busy } = controller;

  return (
    <div
      className={cn(
        /* py/-my pair: the scroll container is exactly button-height, and
           overflow-x also clips vertically, which would cut the 2px + 3px
           focus outline off every instrument. This buys the ring room
           without changing the row height. */
        "-my-1.5 flex min-w-0 flex-1 items-center gap-x-3 py-1.5",
        /* One line at every width. Below `lg` this strip scrolls sideways
           rather than stacking into a three-row block that would eat the
           map; the page itself never scrolls horizontally. */
        "overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
      )}
    >
      <span className="flex shrink-0 items-center gap-1.5 text-micro font-semibold text-text-disabled uppercase">
        <Glyph name="play" className="h-2.5 w-2.5" />
        Simulate
      </span>

      <Rule />

      <div role="group" aria-label="Simulate a disruption" className="flex shrink-0 items-center gap-1.5">
        <SimButton
          onClick={controller.floodRiversideRoad}
          disabled={busy}
          tone="danger"
          lead
          label="Simulate flooding on Riverside Road"
        >
          Flood road
        </SimButton>
        <SimButton
          onClick={controller.closeBridge}
          disabled={busy}
          tone="danger"
          label="Simulate closing the Upper Canal Bridge"
        >
          Close bridge
        </SimButton>
        <SimButton
          onClick={() => controller.fillShelter()}
          disabled={busy}
          tone="warn"
          label="Simulate a shelter reaching capacity"
        >
          Fill shelter
        </SimButton>
        <SimButton
          onClick={() => controller.disableVolunteer()}
          disabled={busy}
          tone="warn"
          label="Simulate standing down a responder"
        >
          Stand down
        </SimButton>
        <SimButton
          onClick={controller.addLandslide}
          disabled={busy}
          tone="warn"
          label="Simulate a new landslide hazard"
        >
          Add hazard
        </SimButton>
      </div>

      <Rule />

      <SimButton onClick={onOpenBulletin} disabled={busy} tone="neutral" label="Add a field bulletin">
        Field update
      </SimButton>

      <Rule />

      <SimButton onClick={controller.reset} disabled={busy} tone="neutral" outlined label="Reset the scenario">
        Reset scenario
      </SimButton>
    </div>
  );
}

function Rule() {
  return <span aria-hidden="true" className="h-4 w-px shrink-0 bg-[var(--color-hairline-strong)]" />;
}

function SimButton({
  children,
  onClick,
  disabled,
  tone,
  label,
  lead,
  outlined,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  tone: "danger" | "warn" | "neutral";
  label: string;
  /** The one instrument the demo is built around. Given a visible edge and a
   *  status dot so it is findable without looking, but still sized as an
   *  instrument rather than a product CTA. */
  lead?: boolean;
  /** Carries a resting edge without the danger tint (used by Reset). */
  outlined?: boolean;
}) {
  const toneClass =
    tone === "danger"
      ? "hover:border-danger/55 hover:bg-danger-surface hover:text-danger"
      : tone === "warn"
        ? "hover:border-warning/45 hover:bg-warning-surface hover:text-warning"
        : "hover:border-hairline-strong hover:bg-surface-overlay hover:text-text-primary";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12px] font-medium whitespace-nowrap",
        "[transition-property:color,background-color,border-color,transform] duration-150 active:scale-[0.97]",
        "disabled:pointer-events-none disabled:opacity-35",
        lead
          ? "border-danger/35 bg-danger-surface/40 text-text-secondary"
          : outlined
            ? "border-hairline bg-surface-raised text-text-secondary"
            : "border-transparent bg-surface-raised/60 text-text-tertiary",
        toneClass,
      )}
    >
      {lead && <Glyph name="dot" className="h-2 w-2 text-danger" />}
      {children}
    </button>
  );
}

export function LifelineMark({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <path
        d="M3 20.5h6.2l2.6-8.4 3.6 13.2 3.4-17 2.7 12.2h7.6"
        stroke="var(--color-accent)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="26.9" cy="20.5" r="2.6" fill="var(--color-safe)" />
    </svg>
  );
}
