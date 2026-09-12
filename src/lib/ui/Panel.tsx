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

const toneAccentClass: Record<PanelTone, string> = {
  neutral: "",
  danger: "border-t-2 border-t-danger",
  warn: "border-t-2 border-t-warning",
  safe: "border-t-2 border-t-safe",
};

/** Glass command panel: the base surface every console module sits in. */
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
            {title && <h3 className="truncate text-sm font-semibold text-text-primary">{title}</h3>}
          </div>
          {right && <div className="flex shrink-0 items-center gap-2">{right}</div>}
        </header>
      )}
      <div className={cn(noPadding ? undefined : "p-5", bodyClassName)}>{children}</div>
    </section>
  );
}
