import type { HTMLAttributes } from "react";
import { cn } from "./cn";

export interface DividerProps extends HTMLAttributes<HTMLDivElement> {
  orientation?: "horizontal" | "vertical";
}

/** A hairline separator, horizontal or vertical. */
export function Divider({ orientation = "horizontal", className, ...props }: DividerProps) {
  return (
    <div
      role="separator"
      aria-orientation={orientation}
      className={cn(
        orientation === "horizontal" ? "h-px w-full bg-hairline" : "w-px self-stretch bg-hairline",
        className,
      )}
      {...props}
    />
  );
}
