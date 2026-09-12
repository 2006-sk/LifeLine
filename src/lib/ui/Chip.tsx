"use client";

import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";

export type ChipTone = "neutral" | "danger" | "warning" | "safe" | "info";

export interface ChipProps extends Omit<HTMLAttributes<HTMLSpanElement>, "children"> {
  children: ReactNode;
  icon?: ReactNode;
  tone?: ChipTone;
  /** Called when the remove (x) button is pressed. Omit to render a plain, non-removable chip. */
  onRemove?: () => void;
  /** Accessible label for the remove button. Defaults to "Remove {children}" when children is a string. */
  removeLabel?: string;
}

const toneClasses: Record<ChipTone, string> = {
  neutral: "border-hairline bg-surface-raised text-text-secondary",
  danger: "border-danger/25 bg-danger-surface text-danger",
  warning: "border-warning/25 bg-warning-surface text-warning",
  safe: "border-safe/25 bg-safe-surface text-safe",
  info: "border-info/25 bg-info-surface text-info",
};

/**
 * Small chip for extracted facts ("4 people", "No vehicle") or removable
 * filters. Purely decorative by default; pass `onRemove` to add a remove
 * affordance.
 */
export function Chip({
  children,
  icon,
  tone = "neutral",
  onRemove,
  removeLabel,
  className,
  ...props
}: ChipProps) {
  const resolvedRemoveLabel =
    removeLabel ?? (typeof children === "string" ? `Remove ${children}` : "Remove");

  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-label font-medium",
        toneClasses[tone],
        className,
      )}
      {...props}
    >
      {icon && <span className="flex h-3 w-3 shrink-0 items-center justify-center">{icon}</span>}
      <span className="truncate">{children}</span>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={resolvedRemoveLabel}
          className={cn(
            "-mr-1 flex h-4 w-4 shrink-0 cursor-pointer items-center justify-center rounded-full opacity-70",
            "transition-[background-color,opacity,transform] duration-[140ms] ease-out",
            "hover:bg-white/10 hover:opacity-100 active:scale-[0.92]",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
          )}
        >
          <svg viewBox="0 0 10 10" className="h-2.5 w-2.5" fill="none" aria-hidden="true">
            <path d="M2 2L8 8M8 2L2 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </button>
      )}
    </span>
  );
}
