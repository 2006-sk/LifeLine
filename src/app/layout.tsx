import type { Metadata } from "next";
import { fontVariables } from "@/lib/ui/fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: "Lifeline — Disaster Response Intelligence",
  description:
    "Real-time situational awareness and mission command for disaster response operations.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${fontVariables} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-surface-base font-sans text-text-primary">
        {children}
      </body>
    </html>
  );
}
