import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";

export interface EyebrowProps extends HTMLAttributes<HTMLSpanElement> {
  children: ReactNode;
}

/**
 * The smallest register in the type scale: 11px, uppercase, tracked to
 * 0.14em. Wide tracking is what makes an 11px uppercase label legible --
 * set tight, the same size reads as a smudge. Held at text-secondary
 * (8.1:1 on the panel surface), comfortably past AA even at this size.
 */
export function Eyebrow({ children, className, ...props }: EyebrowProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-micro font-semibold text-text-secondary uppercase",
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}
