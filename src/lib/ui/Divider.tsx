import type { HTMLAttributes } from "react";
import { cn } from "./cn";

export interface DividerProps extends HTMLAttributes<HTMLDivElement> {
  orientation?: "horizontal" | "vertical";
}

/**
 * A separator built as a machined seam rather than a grey line: a dark groove
 * with a lit edge on the light-facing side. At 1px + 1px it costs nothing and
 * it is the difference between "panel" and "div".
 */
export function Divider({ orientation = "horizontal", className, ...props }: DividerProps) {
  return (
    <div
      role="separator"
      aria-orientation={orientation}
      className={cn(
        "bg-groove",
        orientation === "horizontal" ? "h-px w-full shadow-seam" : "w-px self-stretch shadow-seam-x",
        className,
      )}
      {...props}
    />
  );
}
