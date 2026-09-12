import { IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";

/**
 * UI typeface: IBM Plex Sans.
 *
 * Chosen over the usual neo-grotesks (Inter, Geist, Helvetica) because this
 * console is civic infrastructure, not a SaaS dashboard. Plex was drawn as the
 * voice of an engineering institution: flared stems, a double-storey `a` with a
 * real spur, an unmistakable `g`, and slightly squared bowls. It reads
 * *institutional and technical* at 12px rather than neutral-and-anonymous, and
 * it holds authority at 600 without shouting. Exposed as `--font-plex-sans`,
 * aliased to Tailwind's `--font-sans` in globals.css.
 */
export const fontSans = IBM_Plex_Sans({
  subsets: ["latin"],
  variable: "--font-plex-sans",
  display: "swap",
  fallback: ["ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
});

/**
 * Data typeface: IBM Plex Mono — the same skeleton, the same terminals, the
 * same spur on the `a`. Because it shares Plex Sans' DNA, coordinates, ETAs and
 * counters read as one system with the chrome around them instead of as a
 * bolted-on code font. Static weights only on Google Fonts, so the three the
 * console actually uses are requested explicitly.
 * Exposed as `--font-plex-mono`, aliased to Tailwind's `--font-mono`.
 */
export const fontMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-mono",
  display: "swap",
  fallback: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
});

/** Combined class list to apply on the root <html> element. */
export const fontVariables = `${fontSans.variable} ${fontMono.variable}`;
