"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Button } from "@/lib/ui/Button";
import { Eyebrow } from "@/lib/ui/Eyebrow";
import { Glyph } from "./Glyph";
import { DURATION, EASE_OUT } from "./motion";
import type { LifelineController } from "./useLifeline";

interface SceneActions {
  showWhy: () => void;
}

interface Scene {
  title: string;
  body: string;
  cta: string;
  run?: (c: LifelineController, actions: SceneActions) => Promise<void> | void;
}

/**
 * A guided run of the exact demo sequence. It drives the SAME actions the
 * buttons do. There is no scripted playback and no canned data, so if the
 * graph disagrees the story visibly changes with it.
 */
const SCENES: Scene[] = [
  {
    title: "A family asks for help",
    body: "Floodwater is rising in Ward 3. Kamala cannot walk far, nine-year-old Nirajan needs asthma medication, and the household has no vehicle.",
    cta: "Ask Lifeline",
    run: (c) => c.findSafePath(),
  },
  {
    title: "Neo4j finds a path that still exists",
    body: "The graph traverses roads, responders, capacity and medicine together, and returns the safest chain that survives right now.",
    cta: "Show why",
    run: (_c, actions) => actions.showWhy(),
  },
  {
    title: "The world changes",
    body: "Riverside Road floods. Watch the route break on the map and the relationships collapse in the graph, including the responder whose depot is now cut off.",
    cta: "Flood Riverside Road",
    run: (c) => c.floodRiversideRoad(),
  },
  {
    title: "A different path lights up",
    body: "Lifeline re-traverses the remaining network. The destination changes, and so does the responder, because the graph decided both. Nothing here is scripted.",
    cta: "Fill the new shelter",
    run: (c) => c.fillShelter("shelter_hillcrest"),
  },
  {
    title: "A safe path still exists",
    body: "Even with a flooded corridor and a full shelter, the graph keeps finding what remains. When it cannot, it names the one missing link instead of guessing.",
    cta: "Reset scenario",
    run: (c) => c.reset(),
  },
];

export function StoryMode({
  controller,
  onShowWhy,
}: {
  controller: LifelineController;
  onShowWhy: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);

  const scene = SCENES[step];

  async function advance() {
    if (!scene) return;
    setBusy(true);
    try {
      await scene.run?.(controller, { showWhy: onShowWhy });
    } finally {
      setBusy(false);
      setStep((s) => (s + 1) % SCENES.length);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="absolute right-3 bottom-3 z-10 inline-flex items-center gap-2 rounded-full border border-hairline bg-surface-raised/90 px-3.5 py-2 text-[12px] font-medium text-text-secondary backdrop-blur-sm [transition-property:color,background-color,border-color,transform] duration-150 hover:border-accent/50 hover:text-accent active:scale-[0.97]"
      >
        <Glyph name="play" className="h-2.5 w-2.5" />
        Story mode
      </button>
    );
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 14, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1, transition: { duration: DURATION.swap, ease: EASE_OUT } }}
        exit={{ opacity: 0, y: 10, scale: 0.99, transition: { duration: DURATION.exit, ease: EASE_OUT } }}
        className="absolute right-3 bottom-3 z-20 w-[min(380px,calc(100%-1.5rem))] rounded-[var(--radius-lg)] border border-hairline bg-surface-raised/95 p-4 shadow-[var(--shadow-elevated)] backdrop-blur-[var(--blur-panel)]"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <Eyebrow>
              Story mode · scene {step + 1} of {SCENES.length}
            </Eyebrow>
            <h3 className="mt-1 text-[16px] leading-tight font-semibold text-text-primary">{scene.title}</h3>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close story mode"
            className="-mt-1 -mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-text-tertiary transition-colors hover:bg-white/5 hover:text-text-primary"
          >
            <Glyph name="cross" className="h-3 w-3" />
          </button>
        </div>
        <p className="mt-2 text-[13px] leading-relaxed text-text-secondary">{scene.body}</p>

        <div className="mt-3 flex items-center gap-2">
          <Button variant="primary" size="sm" onClick={advance} disabled={busy || controller.busy}>
            {busy || controller.busy ? "Running…" : scene.cta}
          </Button>
          <button
            type="button"
            onClick={() => setStep((s) => (s + 1) % SCENES.length)}
            className="rounded-[var(--radius-sm)] px-1 text-[12px] text-text-tertiary underline-offset-2 transition-colors hover:text-accent hover:underline"
          >
            Skip
          </button>
          <div className="ml-auto flex gap-1" aria-hidden="true">
            {SCENES.map((_, i) => (
              <span
                key={i}
                className={`h-1.5 w-1.5 rounded-full ${i === step ? "bg-accent" : "bg-[var(--color-hairline-strong)]"}`}
              />
            ))}
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
