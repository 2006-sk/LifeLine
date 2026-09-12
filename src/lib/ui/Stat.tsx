import type { ReactNode } from "react";
import { cn } from "./cn";
import { Eyebrow } from "./Eyebrow";

export type StatTone = "danger" | "warning" | "safe" | "info";
export type StatDeltaDirection = "up" | "down" | "flat";

export interface StatDelta {
  label: string;
  direction: StatDeltaDirection;
  /**
   * Color for the delta. Defaults to "info" (neutral slate) rather than
   * inferring from direction -- "up" isn't inherently good or bad (rising
   * casualty counts vs. rising resources cleared mean opposite things), so
   * callers should pass the tone that matches the metric's meaning.
   */
  tone?: StatTone;
}

export interface StatProps {
  label: string;
  value: ReactNode;
  unit?: string;
  eyebrow?: ReactNode;
  delta?: StatDelta;
  className?: string;
}

const toneTextClass: Record<StatTone, string> = {
  danger: "text-danger",
  warning: "text-warning",
  safe: "text-safe",
  info: "text-info",
};

function DeltaArrow({
  direction,
  className,
}: {
  direction: StatDeltaDirection;
  className?: string;
}) {
  if (direction === "up") {
    return (
      <svg viewBox="0 0 10 10" className={className} fill="none" aria-hidden="true">
        <path
          d="M5 8.5V1.5M5 1.5L1.8 4.7M5 1.5L8.2 4.7"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  if (direction === "down") {
    return (
      <svg viewBox="0 0 10 10" className={className} fill="none" aria-hidden="true">
        <path
          d="M5 1.5V8.5M5 8.5L1.8 5.3M5 8.5L8.2 5.3"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 10 10" className={className} fill="none" aria-hidden="true">
      <path d="M1.8 5H8.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

/** Big number + label, with an optional trend delta. Value uses tabular figures. */
export function Stat({ label, value, unit, eyebrow, delta, className }: StatProps) {
  const deltaTone = delta?.tone ?? "info";

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
      <div className="flex items-baseline gap-1.5">
        <span className="tabular text-3xl font-semibold leading-none text-text-primary">
          {value}
        </span>
        {unit && <span className="text-sm font-medium text-text-tertiary">{unit}</span>}
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-text-secondary">{label}</span>
        {delta && (
          <span
            className={cn(
              "tabular inline-flex items-center gap-1 text-xs font-semibold",
              toneTextClass[deltaTone],
            )}
          >
            <DeltaArrow direction={delta.direction} className="h-2.5 w-2.5" />
            {delta.label}
          </span>
        )}
      </div>
    </div>
  );
}
