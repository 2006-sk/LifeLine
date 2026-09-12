import Link from "next/link";
import { HeroBackdrop } from "@/components/command/HeroBackdrop";
import { LifelineMark } from "@/components/command/Header";
import { world } from "@/lib/world/world";

/* Entrance choreography. Four beats, weighted fade-up, ease-out. Kept here
   rather than in globals.css because the hero owns it; React 19 hoists a
   <style href precedence> into <head> and dedupes it. Reduced motion gets a
   short opacity crossfade, not a dead page. */
const heroMotion = `
@keyframes lfl-rise { from { opacity: 0; transform: translate3d(0, 20px, 0); } to { opacity: 1; transform: none; } }
@keyframes lfl-appear { from { opacity: 0; } to { opacity: 1; } }
.lfl-rise { animation: lfl-rise 720ms cubic-bezier(0.16, 1, 0.3, 1) both; }
@media (prefers-reduced-motion: reduce) {
  .lfl-rise { animation: lfl-appear 150ms linear both; animation-delay: 0ms !important; }
}
`;

const [lng, lat] = world.district.center;
const sheetRef = `${lat.toFixed(4)}°N · ${lng.toFixed(4)}°E`;

export default function Home() {
  return (
    <main className="relative isolate flex min-h-[100dvh] flex-col overflow-x-clip bg-surface-base">
      <style href="lifeline-hero" precedence="default">
        {heroMotion}
      </style>

      <HeroBackdrop />

      <div className="relative z-10 flex min-h-[100dvh] flex-col px-6 sm:px-10 lg:px-14">
        {/* Masthead. The hairline breaks the page margin and runs off the right
            edge into the plate -- the one deliberate escape from the grid. */}
        <header className="lfl-rise pt-7 sm:pt-9">
          <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
            <div className="flex items-center gap-3 sm:gap-4">
              <LifelineMark size={26} className="h-9 w-9 sm:h-11 sm:w-11 lg:h-14 lg:w-14" />
              {/* Display-scale wordmark. The negative right margin cancels the
                  trailing letter-space so the mark still sits flush to the
                  page margin optically, not just mathematically. */}
              <span className="-mr-[0.24em] text-[clamp(1.9rem,4.4vw,3.25rem)] leading-none font-semibold tracking-[0.24em] text-text-primary">
                LIFELINE
              </span>
            </div>
            <p className="pb-1.5 font-mono text-[10px] tracking-[0.2em] text-text-tertiary uppercase">
              Simulation environment · Bagmati West<span className="hidden sm:inline"> · {sheetRef}</span>
            </p>
          </div>
          <div className="mt-6 -mr-6 border-t border-hairline sm:-mr-10 lg:-mr-14" />
        </header>

        {/* Hero. Headline hangs on the page margin; the lede and the actions
            step in to a second axis, so nothing reads as one stacked column. */}
        <div className="flex flex-1 flex-col justify-center pt-14 pb-10 sm:pt-20">
          <h1
            className="lfl-rise max-w-[15ch] text-[clamp(2.35rem,5.6vw,4.15rem)] leading-[1.06] font-semibold tracking-[-0.03em] text-text-primary"
            style={{ animationDelay: "90ms" }}
          >
            Find the safest path that still exists.
          </h1>

          <div className="lfl-rise md:pl-[clamp(2rem,9vw,8rem)]" style={{ animationDelay: "180ms" }}>
            <p className="mt-7 max-w-[46ch] text-[15px] leading-relaxed text-text-secondary sm:text-[16px]">
              In a disaster nobody needs more information. They need a road that is open, and a responder who can
              actually reach them.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                href="/command?demo=1"
                className="rounded-[var(--radius-md)] bg-accent px-6 py-3.5 text-[14px] font-semibold whitespace-nowrap text-surface-base transition-[background-color,transform] duration-150 ease-out hover:bg-accent/85 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-accent"
              >
                Run flood demo
              </Link>
              <Link
                href="/command"
                className="rounded-[var(--radius-md)] border border-hairline-strong px-6 py-3.5 text-[14px] font-semibold whitespace-nowrap text-text-primary transition-[color,border-color,transform] duration-150 ease-out hover:border-accent/60 hover:text-accent active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-accent"
              >
                Enter disaster command center
              </Link>
            </div>
          </div>
        </div>

        {/* Safety notice. Substance is fixed by the ethics requirement; only the
            typography changes. Kept at 12px on text-tertiary, which is the
            smallest size that still clears WCAG AA against surface-base. */}
        <footer className="lfl-rise border-t border-hairline pt-5 pb-7" style={{ animationDelay: "270ms" }}>
          <p className="max-w-[80ch] text-[12px] leading-relaxed text-text-tertiary">
            <span className="text-text-secondary">
              Lifeline is decision-support for disaster-response coordination, not an authoritative emergency service.
            </span>{" "}
            All locations, resources and incidents shown are synthetic simulation data. Conditions may change. Follow
            official emergency instructions when available, and call local emergency services for immediate
            life-threatening danger.
          </p>
        </footer>
      </div>
    </main>
  );
}
