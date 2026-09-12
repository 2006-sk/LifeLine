import type { HTMLAttributes } from "react";
import { cn } from "./cn";

export type StatusTone = "danger" | "warning" | "safe" | "info";

export interface StatusPillProps extends HTMLAttributes<HTMLSpanElement> {
  tone: StatusTone;
  label: string;
}

interface GlyphProps {
  className?: string;
}

function CheckGlyph({ className }: GlyphProps) {
  return (
    <svg viewBox="0 0 12 12" className={className} fill="none" aria-hidden="true">
      <path
        d="M2.5 6.4L4.9 8.8L9.5 3.4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function TriangleGlyph({ className }: GlyphProps) {
  return (
    <svg viewBox="0 0 12 12" className={className} fill="none" aria-hidden="true">
      <path
        d="M6 1.4L11 10.4H1L6 1.4Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <path d="M6 4.9V7.1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <circle cx="6" cy="8.9" r="0.75" fill="currentColor" />
    </svg>
  );
}

function CrossGlyph({ className }: GlyphProps) {
  return (
    <svg viewBox="0 0 12 12" className={className} fill="none" aria-hidden="true">
      <path d="M3 3L9 9M9 3L3 9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function InfoGlyph({ className }: GlyphProps) {
  return (
    <svg viewBox="0 0 12 12" className={className} fill="none" aria-hidden="true">
      <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.3" />
      <path d="M6 5.3V8.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <circle cx="6" cy="3.5" r="0.7" fill="currentColor" />
    </svg>
  );
}

interface ToneConfig {
  classes: string;
  Glyph: (props: GlyphProps) => ReturnType<typeof CheckGlyph>;
}

/**
 * Status is never conveyed by hue alone: every tone pairs its color with a
 * distinct glyph shape (check / triangle-exclamation / cross / info-dot) so
 * the pill still reads correctly for color-blind viewers or on a washed-out
 * projector feed.
 */
const toneConfig: Record<StatusTone, ToneConfig> = {
  danger: {
    classes: "border-danger/25 bg-danger-surface text-danger",
    Glyph: CrossGlyph,
  },
  warning: {
    classes: "border-warning/25 bg-warning-surface text-warning",
    Glyph: TriangleGlyph,
  },
  safe: {
    classes: "border-safe/25 bg-safe-surface text-safe",
    Glyph: CheckGlyph,
  },
  info: {
    classes: "border-info/25 bg-info-surface text-info",
    Glyph: InfoGlyph,
  },
};

export function StatusPill({ tone, label, className, ...props }: StatusPillProps) {
  const { classes, Glyph } = toneConfig[tone];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-micro font-semibold uppercase",
        "shadow-lip",
        classes,
        className,
      )}
      {...props}
    >
      <Glyph className="h-3 w-3 shrink-0" />
      {label}
    </span>
  );
}
