"use client";

import { motion } from "framer-motion";
import { Button } from "@/lib/ui/Button";
import { cn } from "@/lib/ui/cn";
import type { LifelineController } from "./useLifeline";

function Metric({ value, label, tone }: { value: number | string; label: string; tone?: "danger" | "safe" | "warn" | "neutral" }) {
  const toneClass =
    tone === "danger" ? "text-danger" : tone === "safe" ? "text-safe" : tone === "warn" ? "text-warning" : "text-text-primary";
  return (
    <div className="flex flex-col items-start gap-0.5 px-4 first:pl-0">
      <span className={cn("tabular text-2xl leading-none font-semibold tracking-tight", toneClass)}>{value}</span>
      <span className="text-[11px] leading-none tracking-[0.14em] whitespace-nowrap text-text-tertiary uppercase">
        {label}
      </span>
    </div>
  );
}

export interface HeaderProps {
  controller: LifelineController;
  onOpenBulletin: () => void;
  judgeMode: boolean;
  onToggleJudgeMode: () => void;
}

export function Header({ controller, onOpenBulletin, judgeMode, onToggleJudgeMode }: HeaderProps) {
  const { scenario, busy, phase } = controller;
  const counts = scenario?.state.counts;

  const live = phase !== "idle";

  return (
    <header className="relative z-30 flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-hairline bg-surface-raised/80 px-5 py-3 backdrop-blur-[var(--blur-panel)]">
      {/* Wordmark ------------------------------------------------------ */}
      <div className="flex items-center gap-3">
        <LifelineMark />
        <div className="leading-tight">
          <div className="text-[17px] font-semibold tracking-[0.02em] text-text-primary">Lifeline</div>
          <div className="text-[11px] tracking-[0.16em] text-text-tertiary uppercase">Disaster Response Intelligence</div>
        </div>
      </div>

      {/* Status -------------------------------------------------------- */}
      <div className="flex items-center gap-2 rounded-full border border-hairline bg-surface-sunken px-3 py-1.5">
        <span className="relative flex h-2 w-2">
          {live && (
            <motion.span
              className="absolute inline-flex h-full w-full rounded-full bg-safe"
              animate={{ opacity: [0.9, 0.15, 0.9], scale: [1, 2.1, 1] }}
              transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
            />
          )}
          <span className={cn("relative inline-flex h-2 w-2 rounded-full", live ? "bg-safe" : "bg-text-tertiary")} />
        </span>
        <span className="text-[11px] font-medium tracking-[0.14em] text-text-secondary uppercase">Live simulation</span>
      </div>

      {/* Counters ------------------------------------------------------ */}
      <div className="flex items-center divide-x divide-[var(--color-hairline)]">
        <Metric value={counts?.activeHazards ?? 0} label="Active hazards" tone={(counts?.activeHazards ?? 0) > 0 ? "danger" : "neutral"} />
        <Metric value={counts?.openShelters ?? 0} label="Safe shelters" tone="safe" />
        <Metric value={counts?.availableVolunteers ?? 0} label="Responders" />
        <Metric value={counts?.familiesMonitored ?? 0} label="Families" />
      </div>

      {/* Simulation controls ------------------------------------------- */}
      <div className="ml-auto flex flex-wrap items-center gap-2">
        <SimButton onClick={controller.floodRiversideRoad} disabled={busy} tone="danger">
          Flood road
        </SimButton>
        <SimButton onClick={controller.closeBridge} disabled={busy} tone="danger">
          Close bridge
        </SimButton>
        <SimButton onClick={() => controller.fillShelter()} disabled={busy} tone="warn">
          Fill shelter
        </SimButton>
        <SimButton onClick={() => controller.disableVolunteer()} disabled={busy} tone="warn">
          Stand down responder
        </SimButton>
        <SimButton onClick={controller.addLandslide} disabled={busy} tone="warn">
          Add hazard
        </SimButton>
        <SimButton onClick={onOpenBulletin} disabled={busy} tone="neutral">
          Field update
        </SimButton>
        <Button variant="subtle" size="sm" onClick={controller.reset} disabled={busy}>
          Reset
        </Button>
        <button
          type="button"
          onClick={onToggleJudgeMode}
          aria-pressed={judgeMode}
          className={cn(
            "rounded-[var(--radius-sm)] border px-3 py-2 text-[11px] font-medium tracking-[0.12em] uppercase transition-colors",
            "focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none",
            judgeMode
              ? "border-accent/60 bg-accent-surface text-accent"
              : "border-hairline text-text-tertiary hover:text-text-secondary",
          )}
        >
          {judgeMode ? "Graph view" : "Human view"}
        </button>
      </div>
    </header>
  );
}

function SimButton({
  children,
  onClick,
  disabled,
  tone,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  tone: "danger" | "warn" | "neutral";
}) {
  const toneClass =
    tone === "danger"
      ? "border-danger/35 text-danger hover:border-danger/70 hover:bg-danger-surface"
      : tone === "warn"
        ? "border-warning/30 text-warning hover:border-warning/60 hover:bg-warning-surface"
        : "border-hairline text-text-secondary hover:border-hairline-strong hover:text-text-primary";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "rounded-[var(--radius-sm)] border bg-surface-sunken/60 px-3 py-2 text-[11px] font-medium tracking-[0.1em] uppercase",
        "transition-all duration-150 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none",
        "disabled:cursor-not-allowed disabled:opacity-40",
        toneClass,
      )}
    >
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
