"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { Eyebrow } from "@/lib/ui/Eyebrow";
import { cn } from "@/lib/ui/cn";
import { Glyph } from "./Glyph";
import type { LifelineController } from "./useLifeline";

const LifelineGraph = dynamic(() => import("@/components/graph/LifelineGraph"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-[12px] text-text-tertiary">Loading graph…</div>
  ),
});

export interface GraphIntelligencePanelProps {
  controller: LifelineController;
  judgeMode: boolean;
  highlightOverride: string | null;
}

export function GraphIntelligencePanel({ controller, judgeMode, highlightOverride }: GraphIntelligencePanelProps) {
  const { graph, recommendation, phase, selectedId, setSelectedId, impact } = controller;
  const [mode, setMode] = useState<"overview" | "full">("overview");
  /* Collapsed by default. Expanded, this block was taking 38% of the panel
     and squeezing the Cytoscape canvas until the network rendered as one
     bundled knot. The headline number stays visible either way. */
  const [scoreOpen, setScoreOpen] = useState(false);

  const best = recommendation?.best ?? null;
  const backup = recommendation?.alternatives[0] ?? null;

  const graphPhase =
    phase === "route-broken"
      ? "broken"
      : phase === "route-found"
        ? "traversing"
        : phase === "searching" || phase === "recalculating" || phase === "understanding"
          ? "searching"
          : "idle";

  const invalidated = [...impact.segments, ...impact.shelters, ...impact.volunteers];
  const trace = recommendation?.graphTrace;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-hairline px-4 py-3">
        <div>
          <Eyebrow>Live knowledge graph</Eyebrow>
          <h2 className="mt-0.5 text-[15px] font-semibold tracking-tight text-text-primary">Graph Intelligence</h2>
        </div>
        {/* The graph component owns the overview/full affordance. Don't duplicate it here. */}
        <span className="text-[11px] tracking-[0.1em] text-text-tertiary uppercase">
          {mode === "overview" ? "Plan focus" : "Full network"}
        </span>
      </div>

      <div className="relative min-h-0 flex-1 basis-0">
        <LifelineGraph
          payload={graph}
          highlightPath={best?.chain ?? []}
          backupPath={backup?.chain ?? []}
          invalidatedIds={invalidated}
          selectedId={highlightOverride ?? selectedId}
          onSelect={setSelectedId}
          mode={mode}
          onModeChange={setMode}
          phase={graphPhase}
          className="h-full w-full"
        />
      </div>

      {/* Judge mode: what Neo4j actually did --------------------------- */}
      {judgeMode && trace && (
        <div className="max-h-[300px] shrink-0 overflow-y-auto border-t border-hairline bg-surface-sunken/70 px-4 py-3">
          <Eyebrow>Neo4j execution</Eyebrow>
          <div className="tabular mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[12px]">
            <Metric label="Walks enumerated" value={trace.pathsEnumerated} />
            <Metric label="Survived predicates" value={trace.pathsSurviving} />
            <Metric label="Nodes traversed" value={trace.nodesTraversed} />
            <Metric label="Relationships" value={trace.relationshipsTraversed} />
          </div>
          <ul className="mt-3 space-y-2">
            {trace.queries.map((q) => (
              <li key={q.name} className="rounded-[var(--radius-sm)] border border-hairline bg-surface-base/60 p-2.5">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-mono text-[12px] text-accent">{q.name}</span>
                  <span className="tabular text-[11px] text-text-tertiary">
                    {q.ms}ms · {q.rows} rows
                  </span>
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-text-tertiary">{q.purpose}</p>
                <details className="mt-1.5">
                  <summary className="cursor-pointer text-[11px] text-text-tertiary hover:text-accent">
                    Show Cypher
                  </summary>
                  <pre className="mt-1.5 max-h-52 overflow-auto rounded bg-surface-base p-2 font-mono text-[10px] leading-relaxed whitespace-pre-wrap text-text-secondary">
                    {q.cypher.trim()}
                  </pre>
                </details>
              </li>
            ))}
          </ul>
          {recommendation && recommendation.rejected.length > 0 && (
            <div className="mt-3">
              <Eyebrow>Rejected by the graph</Eyebrow>
              <ul className="mt-1.5 space-y-1">
                {recommendation.rejected.map((r) => (
                  <li key={r.destinationId} className="flex items-start gap-2 text-[11px] leading-relaxed">
                    <Glyph name="cross" className="mt-[3px] h-2.5 w-2.5 text-danger" />
                    <span className="min-w-0 text-text-tertiary">
                      <span className="font-medium text-text-secondary">{r.destinationName}</span>. {r.detail}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Score breakdown in human view --------------------------------- */}
      {!judgeMode && best && (
        <div className="shrink-0 border-t border-hairline bg-surface-sunken/70">
          <button
            type="button"
            onClick={() => setScoreOpen((v) => !v)}
            aria-expanded={scoreOpen}
            className="flex w-full items-baseline justify-between gap-3 px-4 py-2.5 text-left transition-colors hover:bg-surface-overlay/40"
          >
            <span className="flex items-baseline gap-2">
              <Eyebrow>Route score</Eyebrow>
              <span className="tabular text-[15px] leading-none font-semibold text-text-primary">
                {best.score.total.toFixed(1)}
              </span>
              <span className="text-[11px] text-text-tertiary">lower is safer</span>
            </span>
            <span className="shrink-0 text-[11px] text-text-tertiary">
              {scoreOpen ? "Hide breakdown" : "Breakdown"}
            </span>
          </button>
          {scoreOpen && (
          <ul className="max-h-[240px] space-y-1.5 overflow-y-auto border-t border-hairline px-4 py-3">
            {best.score.terms.map((term) => (
              <li key={term.label} className="flex items-baseline gap-2 text-[12px]">
                <span
                  className={cn(
                    "tabular w-12 shrink-0 text-right font-medium",
                    term.value > 0 ? "text-warning" : "text-safe",
                  )}
                >
                  {term.value > 0 ? "+" : ""}
                  {term.value.toFixed(1)}
                </span>
                <span className="min-w-0">
                  <span className="text-text-secondary">{term.label}</span>
                  <span className="block text-[11px] text-text-tertiary">{term.detail}</span>
                </span>
              </li>
            ))}
            <li className="flex items-baseline gap-2 border-t border-hairline pt-1.5 text-[12px]">
              <span className="tabular w-12 shrink-0 text-right font-semibold text-text-primary">
                {best.score.total.toFixed(1)}
              </span>
              <span className="font-medium text-text-primary">Total route score</span>
            </li>
          </ul>
          )}
        </div>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-text-tertiary">{label}</span>
      <span className="font-medium text-text-primary">{value}</span>
    </div>
  );
}
