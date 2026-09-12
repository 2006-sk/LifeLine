import { cn } from "@/lib/ui/cn";

/**
 * The console's only icon source.
 *
 * No icon package is installed and we are not adding one, so the handful of
 * marks this screen needs are drawn here once, on a shared 12x12 grid with a
 * shared 1.4 stroke weight, instead of being scattered through the JSX as raw
 * characters (a hand-rolled glyph inherits the text font's metrics, sits off
 * the optical baseline, and changes shape per platform).
 *
 * Geometry deliberately mirrors src/lib/ui/StatusPill's glyphs so a check in a
 * fact row and a check in a status pill are the same mark at two sizes.
 *
 * Shape always carries the meaning: a check, a warning triangle and a cross
 * stay distinguishable with the colour removed, so status is never hue-only.
 */
export type GlyphName = "check" | "alert" | "cross" | "question" | "play" | "dot" | "spinner";

const PATHS: Record<GlyphName, React.ReactNode> = {
  check: (
    <path
      d="M2.5 6.4L4.9 8.8L9.5 3.4"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  alert: (
    <>
      <path d="M6 1.4L11 10.4H1L6 1.4Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M6 4.9V7.1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <circle cx="6" cy="8.9" r="0.75" fill="currentColor" />
    </>
  ),
  cross: <path d="M3 3L9 9M9 3L3 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />,
  question: (
    <>
      <path
        d="M4.3 4.3a1.75 1.75 0 1 1 1.9 2.3v1"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="6.2" cy="9.2" r="0.75" fill="currentColor" />
    </>
  ),
  play: <path d="M3.6 2.4L9.8 6L3.6 9.6V2.4Z" fill="currentColor" />,
  dot: <circle cx="6" cy="6" r="2.6" fill="currentColor" />,
  spinner: (
    <>
      <circle cx="6" cy="6" r="4.3" stroke="currentColor" strokeWidth="1.3" opacity="0.25" />
      <path d="M6 1.7a4.3 4.3 0 0 1 4.3 4.3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </>
  ),
};

export interface GlyphProps {
  name: GlyphName;
  className?: string;
}

/**
 * Sizes to 1em-ish by default (12px) and sits on the optical centre of a
 * 13px text line via `align-[-0.115em]`, so it lines up with adjacent text
 * without per-callsite margin nudges.
 */
export function Glyph({ name, className }: GlyphProps) {
  return (
    <svg
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden="true"
      focusable="false"
      className={cn("inline-block h-3 w-3 shrink-0 align-[-0.115em]", className)}
    >
      {PATHS[name]}
    </svg>
  );
}

/**
 * Live/severity indicator: a solid dot with an optional expanding ring.
 *
 * The ring runs on the CSS `pulse-ring` keyframe from globals.css rather than
 * a JS animation loop, so it keeps ticking on the compositor while the main
 * thread is busy re-laying out the map and the Cytoscape graph, and it is
 * silenced automatically by the global prefers-reduced-motion rule.
 */
export function PulseDot({
  tone,
  active = true,
  size = "sm",
  className,
}: {
  tone: "safe" | "danger" | "warning" | "accent" | "muted";
  active?: boolean;
  size?: "sm" | "md";
  className?: string;
}) {
  const fill =
    tone === "safe"
      ? "bg-safe"
      : tone === "danger"
        ? "bg-danger"
        : tone === "warning"
          ? "bg-warning"
          : tone === "accent"
            ? "bg-accent"
            : "bg-text-tertiary";
  const box = size === "md" ? "h-2.5 w-2.5" : "h-2 w-2";

  return (
    <span className={cn("relative flex shrink-0", box, className)} aria-hidden="true">
      {active && (
        <span className={cn("absolute inline-flex h-full w-full rounded-full animate-pulse-ring", fill)} />
      )}
      <span className={cn("relative inline-flex rounded-full", box, fill)} />
    </span>
  );
}
