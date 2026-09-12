"use client";

import { forwardRef } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";

export type ButtonVariant = "primary" | "ghost" | "danger" | "subtle";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Optional icon rendered alongside the label. */
  icon?: ReactNode;
  iconPosition?: "left" | "right";
  fullWidth?: boolean;
}

/**
 * Sized for gloved thumbs on a tablet in the rain: 40 / 48 / 56px tall, well
 * past the 44px comfortable-target floor at md and lg.
 */
const sizeClasses: Record<ButtonSize, string> = {
  sm: "h-10 gap-1.5 rounded-[var(--radius-sm)] px-3.5 text-label",
  md: "h-12 gap-2 rounded-[var(--radius-md)] px-5 text-body",
  lg: "h-14 gap-2.5 rounded-[var(--radius-md)] px-7 text-[0.9375rem] tracking-[-0.008em]",
};

/**
 * Every filled variant states its on-fill colour explicitly
 * (`text-surface-sunken`, the darkest surface in the system) rather than
 * inheriting: accent on near-black measures 9.3:1 and danger on near-black
 * 6.6:1, both well clear of AA. Never white-on-accent -- that is the
 * button-text-equals-button-fill bug.
 */
const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "border border-accent/50 bg-accent text-surface-sunken shadow-control-raised hover:bg-accent-hi hover:shadow-control-accent active:bg-accent active:shadow-control",
  ghost:
    "border border-hairline bg-transparent text-text-primary hover:border-hairline-strong hover:bg-surface-raised active:bg-surface-overlay",
  danger:
    "border border-danger/50 bg-danger text-surface-sunken shadow-control-raised hover:bg-danger-hi hover:shadow-control-danger active:bg-danger active:shadow-control",
  subtle:
    "border border-hairline bg-surface-raised text-text-primary shadow-control hover:border-hairline-strong hover:bg-surface-overlay active:bg-surface-raised active:shadow-none",
};

/**
 * Primary interactive control for the console.
 *
 * Motion: the exact properties are named -- never `all` -- and the press
 * scale is the only transform, so nothing here triggers layout. 140ms with
 * the strong ease-out means the fill starts moving on the first frame after
 * the pointer lands; `active:scale-[0.97]` is the physical confirmation that
 * the interface heard the press.
 *
 * Focus: an `outline`, never a box-shadow ring. `outline` is not in the
 * transition list, so the ring is on screen the instant focus lands --
 * a focus ring that animates in is a focus ring that is late.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "primary",
    size = "md",
    icon,
    iconPosition = "left",
    fullWidth = false,
    className,
    children,
    disabled,
    type = "button",
    ...props
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled}
      className={cn(
        "inline-flex cursor-pointer items-center justify-center font-semibold whitespace-nowrap select-none",
        "transition-[background-color,border-color,color,box-shadow,transform] duration-[140ms] ease-out",
        "active:scale-[0.97] active:duration-[100ms]",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none",
        sizeClasses[size],
        variantClasses[variant],
        fullWidth && "w-full",
        className,
      )}
      {...props}
    >
      {icon && iconPosition === "left" && (
        <span className="flex shrink-0 items-center justify-center [&>svg]:h-[1.1em] [&>svg]:w-[1.1em]">
          {icon}
        </span>
      )}
      {children}
      {icon && iconPosition === "right" && (
        <span className="flex shrink-0 items-center justify-center [&>svg]:h-[1.1em] [&>svg]:w-[1.1em]">
          {icon}
        </span>
      )}
    </button>
  );
});
