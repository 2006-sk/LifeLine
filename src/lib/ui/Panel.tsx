import type { ReactNode } from "react";
import { cn } from "./cn";
import { Eyebrow } from "./Eyebrow";

export type PanelTone = "neutral" | "danger" | "warn" | "safe";

export interface PanelProps {
  title?: ReactNode;
  eyebrow?: ReactNode;
  /** Content aligned to the right of the header, e.g. a status pill or action button. */
  right?: ReactNode;
  tone?: PanelTone;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  /** Skip the default body padding, e.g. when the child manages its own (a table, a map). */
  noPadding?: boolean;
}

/**
 * Tone is carried by a 2px lit rail across the top edge of the enclosure --
 * the flag on a filing tab. It is never the only signal: a toned panel always
 * carries a StatusPill or a glyph in its header too.
 */
const toneAccentClass: Record<PanelTone, string> = {
  neutral: "",
  danger: "border-t-2 border-t-danger",
  warn: "border-t-2 border-t-warning",
  safe: "border-t-2 border-t-safe",
};

/**
 * The command panel: the base enclosure every console module sits in.
 *
 * The visual weight lives in `.panel` (globals.css) -- a lit top edge, an
 * inner bezel line at a concentric radius, a contact shadow and an ambient
 * shadow. Deliberately opaque: panels hold scrolling content, and a
 * backdrop-filter behind a scroll container repaints the whole stacking
 * context every frame. Fixed chrome uses `.chrome-blur` instead.
 */
export function Panel({
  title,
  eyebrow,
  right,
  tone = "neutral",
  children,
  className,
  bodyClassName,
  noPadding = false,
}: PanelProps) {
  const hasHeader = Boolean(title || eyebrow || right);

  return (
    <section className={cn("panel", toneAccentClass[tone], className)}>
      {hasHeader && (
        <header className="panel-header">
          <div className="flex min-w-0 flex-col gap-1">
            {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
            {title && <h3 className="truncate text-heading text-text-primary">{title}</h3>}
          </div>
          {right && <div className="flex shrink-0 items-center gap-2">{right}</div>}
        </header>
      )}
      <div className={cn(noPadding ? undefined : "p-panel", bodyClassName)}>{children}</div>
    </section>
  );
}
