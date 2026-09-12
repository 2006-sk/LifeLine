import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";

export interface EyebrowProps extends HTMLAttributes<HTMLSpanElement> {
  children: ReactNode;
}

/**
 * Tiny uppercase tracking-wide label used above panel titles, stat
 * groups, and section headers. Fixed at 12px (Tailwind's `text-xs`) --
 * the floor for legible text in this app -- and text-secondary for
 * guaranteed AA contrast at that size.
 */
export function Eyebrow({ children, className, ...props }: EyebrowProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-text-secondary",
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}
