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

/** Sized for large hit targets: 40 / 48 / 56px tall. */
const sizeClasses: Record<ButtonSize, string> = {
  sm: "h-10 px-3.5 text-xs gap-1.5 rounded-md",
  md: "h-12 px-5 text-sm gap-2 rounded-md",
  lg: "h-14 px-7 text-base gap-2.5 rounded-lg",
};

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "border border-accent bg-accent text-surface-sunken hover:bg-accent/90 hover:shadow-glow-accent active:bg-accent/80",
  ghost:
    "border border-hairline bg-transparent text-text-primary hover:border-hairline-strong hover:bg-surface-raised active:bg-surface-overlay",
  danger:
    "border border-danger bg-danger text-surface-sunken hover:bg-danger/90 hover:shadow-glow-danger active:bg-danger/80",
  subtle:
    "border border-hairline bg-surface-raised text-text-primary hover:bg-surface-overlay active:bg-surface-overlay",
};

/**
 * Primary interactive control for the console. Every variant keeps a
 * visible `:focus-visible` ring (accent-colored, offset against the
 * surrounding surface) since keyboard accessibility matters on a
 * disaster-response product.
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
        "inline-flex select-none items-center justify-center whitespace-nowrap font-semibold transition-colors duration-150",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base",
        "disabled:pointer-events-none disabled:opacity-40",
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
