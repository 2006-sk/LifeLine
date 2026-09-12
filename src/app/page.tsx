import Link from "next/link";
import { HeroBackdrop } from "@/components/command/HeroBackdrop";
import { LifelineMark } from "@/components/command/Header";

export default function Home() {
  return (
    <main className="relative flex min-h-screen flex-col overflow-hidden bg-surface-base">
      <HeroBackdrop />

      <div className="relative z-10 flex flex-1 flex-col">
        <header className="flex items-center gap-3 px-6 py-5 sm:px-10">
          <LifelineMark size={28} />
          <span className="text-[15px] font-semibold tracking-[0.02em] text-text-primary">Lifeline</span>
          <span className="ml-auto rounded-full border border-hairline px-3 py-1 text-[11px] tracking-[0.14em] text-text-tertiary uppercase">
            Simulation environment
          </span>
        </header>

        <div className="flex flex-1 items-center px-6 sm:px-10">
          <div className="max-w-3xl">
            <p className="text-[12px] tracking-[0.22em] text-accent uppercase">Disaster Response Intelligence</p>
            <h1 className="mt-4 text-[clamp(3rem,9vw,6.5rem)] leading-[0.92] font-semibold tracking-[-0.03em] text-text-primary">
              LIFELINE
            </h1>
            <p className="mt-5 max-w-xl text-[clamp(1.05rem,2.2vw,1.5rem)] leading-snug text-text-secondary">
              Find the safest path that still exists.
            </p>
            <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-text-tertiary">
              In a disaster, people don’t need more information. They need a route that is still open, transport that
              fits their needs, a shelter with room, and medicine within reach — all at once. Lifeline keeps those
              relationships in a live graph and recomputes the answer every time the world changes.
            </p>

            <div className="mt-9 flex flex-wrap gap-3">
              <Link
                href="/command?demo=1"
                className="rounded-[var(--radius-md)] bg-accent px-6 py-3.5 text-[14px] font-semibold text-surface-base transition-transform hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base focus-visible:outline-none"
              >
                Run flood demo
              </Link>
              <Link
                href="/command"
                className="rounded-[var(--radius-md)] border border-hairline-strong px-6 py-3.5 text-[14px] font-semibold text-text-primary transition-colors hover:border-accent/60 hover:text-accent focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
              >
                Enter disaster command center
              </Link>
            </div>

            <dl className="mt-12 grid max-w-2xl grid-cols-2 gap-x-8 gap-y-4 border-t border-hairline pt-6 sm:grid-cols-4">
              {[
                ["20", "locations"],
                ["26", "roads & bridges"],
                ["7", "responders"],
                ["4", "shelters"],
              ].map(([value, label]) => (
                <div key={label}>
                  <dt className="tabular text-2xl font-semibold text-text-primary">{value}</dt>
                  <dd className="text-[11px] tracking-[0.14em] text-text-tertiary uppercase">{label}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>

        <footer className="px-6 pb-6 sm:px-10">
          <p className="max-w-3xl text-[12px] leading-relaxed text-text-tertiary">
            Lifeline is decision-support for disaster-response coordination, not an authoritative emergency service.
            All locations, resources and incidents shown are synthetic simulation data. Conditions may change. Follow
            official emergency instructions when available, and call local emergency services for immediate
            life-threatening danger.
          </p>
        </footer>
      </div>
    </main>
  );
}
