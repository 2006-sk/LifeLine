"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Button } from "@/lib/ui/Button";
import { Chip } from "@/lib/ui/Chip";
import { Eyebrow } from "@/lib/ui/Eyebrow";
import { cn } from "@/lib/ui/cn";
import type { LifelineController } from "./useLifeline";

const DEMO_TEXT =
  "There are four of us. My grandmother cannot walk far, my son needs asthma medication, and the main road outside our neighbourhood is flooded. We don't have a car.";

const NEED_LABEL: Record<string, string> = {
  mobility_assistance: "Mobility assistance",
  asthma_medication: "Asthma medication",
  transportation: "No vehicle",
  shelter: "Needs shelter",
  infant_formula: "Infant formula",
  insulin: "Insulin",
  oxygen: "Oxygen",
};

export function SituationPanel({ controller }: { controller: LifelineController }) {
  const { scenario, situation, phase, understanding, busy, recommendation } = controller;
  const [mode, setMode] = useState<"text" | "form">("text");
  const [text, setText] = useState(DEMO_TEXT);
  const [size, setSize] = useState(4);
  const [flags, setFlags] = useState({ mobility: true, asthma: true, noVehicle: true });
  const [submitting, setSubmitting] = useState(false);

  const family = scenario?.families.find((f) => f.id === "family_sharma");

  async function handleFind() {
    setSubmitting(true);
    try {
      if (mode === "text") {
        await controller.submitIntake({ text });
      } else {
        await controller.submitIntake({
          structured: {
            familySize: size,
            mobilityAssistance: flags.mobility,
            medicalNeeds: flags.asthma ? ["asthma_medication"] : [],
            hasVehicle: !flags.noVehicle,
          },
        });
      }
      await controller.findSafePath();
    } finally {
      setSubmitting(false);
    }
  }

  const chips = situation
    ? [
        { label: `${situation.familySize} people` },
        ...situation.needs.map((n) => ({ label: NEED_LABEL[n] ?? n })),
        ...situation.constraints
          .filter((c) => c !== "limited_mobility")
          .map((c) => ({ label: c.replace(/_/g, " ") })),
      ]
    : [];

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      <div>
        <Eyebrow>Situation intake</Eyebrow>
        <h2 className="mt-1 text-xl font-semibold tracking-tight text-text-primary">Who needs help?</h2>
        <p className="mt-1 text-[13px] leading-relaxed text-text-secondary">
          Describe the household in plain language, or use the structured form. Lifeline turns it into needs on the
          graph.
        </p>
      </div>

      {/* Household ---------------------------------------------------- */}
      {family && (
        <div className="rounded-[var(--radius-md)] border border-hairline bg-surface-sunken/60 p-3">
          <div className="flex items-center justify-between">
            <span className="text-[13px] font-medium text-text-primary">{family.name}</span>
            <span className="tabular text-[11px] text-text-tertiary">{family.size} people</span>
          </div>
          <p className="mt-1 text-[12px] leading-relaxed text-text-tertiary">{family.note}</p>
        </div>
      )}

      {/* Mode switch --------------------------------------------------- */}
      <div className="flex gap-1 rounded-[var(--radius-sm)] border border-hairline bg-surface-sunken p-1">
        {(["text", "form"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            aria-pressed={mode === m}
            className={cn(
              "flex-1 rounded-[calc(var(--radius-sm)-2px)] px-3 py-1.5 text-[12px] font-medium transition-colors",
              "focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none",
              mode === m ? "bg-surface-overlay text-text-primary" : "text-text-tertiary hover:text-text-secondary",
            )}
          >
            {m === "text" ? "Natural language" : "Structured"}
          </button>
        ))}
      </div>

      {mode === "text" ? (
        <div className="space-y-2">
          <label htmlFor="intake-text" className="sr-only">
            Describe your situation
          </label>
          <textarea
            id="intake-text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={5}
            className={cn(
              "w-full resize-none rounded-[var(--radius-md)] border border-hairline bg-surface-sunken p-3",
              "text-[13px] leading-relaxed text-text-primary placeholder:text-text-disabled",
              "focus-visible:border-accent/50 focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none",
            )}
            placeholder="e.g. There are four of us, my grandmother cannot walk far…"
          />
          <button
            type="button"
            onClick={() => setText(DEMO_TEXT)}
            className="text-[11px] text-text-tertiary underline-offset-2 hover:text-accent hover:underline"
          >
            Use the demo description
          </button>
        </div>
      ) : (
        <div className="space-y-3 rounded-[var(--radius-md)] border border-hairline bg-surface-sunken p-3">
          <div className="flex items-center justify-between">
            <label htmlFor="hh-size" className="text-[12px] text-text-secondary">
              Household size
            </label>
            <input
              id="hh-size"
              type="number"
              min={1}
              max={12}
              value={size}
              onChange={(e) => setSize(Number(e.target.value))}
              className="tabular w-16 rounded-[var(--radius-sm)] border border-hairline bg-surface-base px-2 py-1 text-right text-[13px] text-text-primary focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
            />
          </div>
          {(
            [
              ["mobility", "Mobility assistance needed"],
              ["asthma", "Asthma medication needed"],
              ["noVehicle", "No usable vehicle"],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="flex cursor-pointer items-center gap-2.5 text-[12px] text-text-secondary">
              <input
                type="checkbox"
                checked={flags[key]}
                onChange={(e) => setFlags((f) => ({ ...f, [key]: e.target.checked }))}
                className="h-4 w-4 accent-[var(--color-accent)] focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
              />
              {label}
            </label>
          ))}
        </div>
      )}

      <Button
        variant="primary"
        size="lg"
        fullWidth
        onClick={handleFind}
        disabled={busy || submitting}
      >
        {busy || submitting ? "Working…" : "Find a safe path"}
      </Button>

      {/* Understanding beats ------------------------------------------- */}
      <AnimatePresence>
        {phase === "understanding" && understanding.length > 0 && (
          <motion.ul
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="space-y-1.5 overflow-hidden rounded-[var(--radius-md)] border border-hairline bg-surface-sunken p-3"
          >
            {understanding.map((step) => (
              <li key={step.label} className="flex items-center gap-2 text-[12px]">
                <span
                  className={cn(
                    "flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border text-[8px]",
                    step.done ? "border-safe bg-safe/15 text-safe" : "border-hairline-strong text-transparent",
                  )}
                >
                  ✓
                </span>
                <span className={step.done ? "text-text-secondary" : "text-text-tertiary"}>{step.label}</span>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>

      {/* Extracted chips ----------------------------------------------- */}
      {chips.length > 0 && (
        <div>
          <Eyebrow>Understood</Eyebrow>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {chips.map((c, i) => (
              <Chip key={`${c.label}-${i}`} tone="info">
                {c.label}
              </Chip>
            ))}
          </div>
          {situation && (
            <p className="mt-2 text-[11px] text-text-tertiary">
              Parsed by {situation.source === "llm" ? "language model + rules" : "deterministic parser"} · confidence{" "}
              {Math.round(situation.confidence * 100)}%
            </p>
          )}
        </div>
      )}

      {/* Human impact --------------------------------------------------- */}
      {recommendation && (
        <div className="mt-auto space-y-2 rounded-[var(--radius-md)] border border-hairline bg-surface-sunken/60 p-3">
          <Eyebrow>{recommendation.status === "success" ? "People protected by this plan" : "Plan status"}</Eyebrow>
          {recommendation.status === "success" ? (
            <div className="flex items-end gap-4">
              <div>
                <div className="tabular text-3xl leading-none font-semibold text-safe">
                  {recommendation.peopleCovered}
                </div>
                <div className="mt-1 text-[11px] tracking-[0.12em] text-text-tertiary uppercase">covered</div>
              </div>
              <div>
                <div className="tabular text-3xl leading-none font-semibold text-text-primary">
                  {recommendation.criticalNeedsTotal - recommendation.criticalNeedsCovered}
                </div>
                <div className="mt-1 text-[11px] tracking-[0.12em] text-text-tertiary uppercase">unmet needs</div>
              </div>
            </div>
          ) : (
            <p className="text-[12px] text-danger">No viable plan for this household right now.</p>
          )}
        </div>
      )}

      <p className="text-[11px] leading-relaxed text-text-tertiary">
        Recommended based on currently available information. Conditions may change. Follow official emergency
        instructions when available, and call local emergency services for immediate life-threatening danger.
      </p>
    </div>
  );
}
