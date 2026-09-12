import type { Metadata, Viewport } from "next";
import { fontVariables } from "@/lib/ui/fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: "Lifeline · Disaster Response Intelligence",
  description:
    "Finds the safest path that still exists for a household in a disaster, by traversing a live graph of roads, hazards, shelters, responders and supplies.",
};

/**
 * The console is dark-only by design: it is read at night, in a vehicle, on a
 * screen turned down. Declaring the scheme and a matching theme colour stops
 * mobile browser chrome from framing it in white.
 */
export const viewport: Viewport = {
  colorScheme: "dark",
  themeColor: "#07090c",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${fontVariables} h-full antialiased`}>
      <body className="flex min-h-full flex-col bg-surface-base font-sans text-body text-text-primary">
        {children}
      </body>
    </html>
  );
}
