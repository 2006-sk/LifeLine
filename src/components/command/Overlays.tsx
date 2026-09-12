"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Button } from "@/lib/ui/Button";
import { Eyebrow } from "@/lib/ui/Eyebrow";
import { cn } from "@/lib/ui/cn";
import type { LiveAlert } from "./useLifeline";

/* ================================================================== */
/* Alert stack                                                         */
/* ================================================================== */

export function AlertStack({ alerts, onDismiss }: { alerts: LiveAlert[]; onDismiss: (id: string) => void }) {
  return (
    <div className="pointer-events-none absolute top-3 left-1/2 z-40 flex w-[min(560px,calc(100vw-2rem))] -translate-x-1/2 flex-col gap-2">
      <AnimatePresence initial={false}>
        {alerts.map((alert) => (
          <motion.div
            key={alert.id}
            layout
            initial={{ opacity: 0, y: -24, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -16, scale: 0.97 }}
            transition={{ type: "spring", stiffness: 420, damping: 32 }}
            role="status"
            aria-live="polite"
            className={cn(
              "pointer-events-auto flex items-start gap-3 rounded-[var(--radius-md)] border px-4 py-3 backdrop-blur-[var(--blur-panel)]",
              alert.severity >= 0.7
                ? "border-danger/50 bg-danger-surface shadow-[var(--shadow-glow-danger)]"
                : "border-warning/40 bg-warning-surface",
            )}
          >
            <span
              aria-hidden="true"
              className={cn("mt-0.5 text-[13px]", alert.severity >= 0.7 ? "text-danger" : "text-warning")}
            >
              ▲
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-semibold text-text-primary">{alert.title}</div>
              <div className="text-[12px] leading-relaxed text-text-secondary">{alert.body}</div>
            </div>
            <button
              type="button"
              onClick={() => onDismiss(alert.id)}
              aria-label={`Dismiss alert: ${alert.title}`}
              className="rounded p-1 text-text-tertiary hover:text-text-primary focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
            >
              ✕
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

/* ================================================================== */
/* Why overlay — the explainability moment                             */
/* ================================================================== */

export interface ExplanationLink {
  step: string;
  fromId: string;
  fromLabel: string;
  fromType: string;
  rel: string;
  toId: string;
  toLabel: string;
  toType: string;
  sentence: string;
}

const STEP_ORDER = ["need", "transport", "route", "destination", "resource"];
const STEP_TITLE: Record<string, string> = {
  need: "Who needs what",
  transport: "Who can carry them",
  route: "Which roads still hold",
  destination: "Where there is room",
  resource: "What is stocked there",
};

export function WhyOverlay({
  open,
  planId,
  onClose,
  onHighlight,
}: {
  open: boolean;
  planId: string | null;
  onClose: () => void;
  onHighlight: (id: string | null) => void;
}) {
  const [links, setLinks] = useState<ExplanationLink[]>([]);
  const [statement, setStatement] = useState("");
  const [loading, setLoading] = useState(false);
  const [cursor, setCursor] = useState(0);

  useEffect(() => {
    if (!open || !planId) return;
    let cancelled = false;
    setLoading(true);
    setCursor(0);
    fetch(`/api/explanation/${planId}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        const ordered: ExplanationLink[] = (data.links ?? []).sort(
          (a: ExplanationLink, b: ExplanationLink) => STEP_ORDER.indexOf(a.step) - STEP_ORDER.indexOf(b.step),
        );
        setLinks(ordered);
        setStatement(data.statement ?? "");
      })
      .catch(() => !cancelled && setLinks([]))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [open, planId]);

  // Reveal links one at a time so the chain reads as a traversal.
  useEffect(() => {
    if (!open || links.length === 0) return;
    if (cursor >= links.length) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setCursor(links.length);
      return;
    }
    const timer = setTimeout(() => {
      setCursor((c) => c + 1);
      onHighlight(links[cursor]?.toId ?? null);
    }, 320);
    return () => clearTimeout(timer);
  }, [open, links, cursor, onHighlight]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const grouped = STEP_ORDER.map((step) => ({
    step,
    items: links.slice(0, cursor).filter((l) => l.step === step),
  })).filter((g) => g.items.length > 0);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 z-50 flex items-stretch justify-end bg-surface-base/86 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="Why this recommendation"
        >
          <motion.div
            initial={{ x: 40, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 40, opacity: 0 }}
            transition={{ type: "spring", stiffness: 340, damping: 34 }}
            className="flex h-full w-[min(560px,100vw)] flex-col border-l border-hairline bg-surface-raised"
          >
            <div className="flex items-start justify-between border-b border-hairline px-5 py-4">
              <div>
                <Eyebrow>Explainability</Eyebrow>
                <h2 className="mt-1 text-xl font-semibold tracking-tight text-text-primary">
                  Why this recommendation?
                </h2>
              </div>
              <Button variant="subtle" size="sm" onClick={onClose}>
                Close
              </Button>
            </div>

            <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
              {loading && <p className="text-[13px] text-text-tertiary">Reading the plan’s relationships…</p>}
              {!loading && links.length === 0 && (
                <p className="text-[13px] text-text-tertiary">
                  No stored plan to explain yet. Run <span className="text-text-secondary">Find a safe path</span>{" "}
                  first.
                </p>
              )}

              {grouped.map((group) => (
                <div key={group.step}>
                  <Eyebrow>{STEP_TITLE[group.step] ?? group.step}</Eyebrow>
                  <ul className="mt-2 space-y-2">
                    {group.items.map((link, i) => (
                      <motion.li
                        key={`${link.fromId}-${link.rel}-${link.toId}-${i}`}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        onMouseEnter={() => onHighlight(link.toId)}
                        onMouseLeave={() => onHighlight(null)}
                        className="rounded-[var(--radius-md)] border border-hairline bg-surface-sunken/70 p-3"
                      >
                        <div className="flex flex-wrap items-center gap-1.5 font-mono text-[11px] text-text-tertiary">
                          <span className="text-accent">{link.fromLabel}</span>
                          <span aria-hidden="true">—[</span>
                          <span className="text-safe">{link.rel}</span>
                          <span aria-hidden="true">]→</span>
                          <span className="text-accent">{link.toLabel}</span>
                        </div>
                        <p className="mt-1 text-[13px] leading-relaxed text-text-secondary">{link.sentence}</p>
                      </motion.li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>

            {statement && (
              <div className="border-t border-hairline bg-accent-surface px-5 py-4">
                <p className="text-[13px] leading-relaxed font-medium text-text-primary">{statement}</p>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ================================================================== */
/* Field bulletin dialog                                               */
/* ================================================================== */

const DEMO_BULLETIN =
  "Upper Canal Bridge is now unsafe. Old Market Hall Shelter has reached capacity. Two accessible vans are available near Patan.";

export function BulletinDialog({
  open,
  onClose,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (text: string) => Promise<{ applied: { detail: string }[]; unmatched: string[] } | null>;
}) {
  const [text, setText] = useState(DEMO_BULLETIN);
  const [result, setResult] = useState<{ applied: { detail: string }[]; unmatched: string[] } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  async function submit() {
    setBusy(true);
    try {
      setResult(await onSubmit(text));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 z-50 flex items-center justify-center bg-surface-base/86 p-6 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="Add field update"
        >
          <motion.div
            initial={{ y: 16, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 16, opacity: 0 }}
            className="w-[min(640px,100%)] rounded-[var(--radius-lg)] border border-hairline bg-surface-raised p-5 shadow-[var(--shadow-elevated)]"
          >
            <Eyebrow>Field update</Eyebrow>
            <h2 className="mt-1 text-xl font-semibold tracking-tight text-text-primary">Add a disaster bulletin</h2>
            <p className="mt-1 text-[13px] leading-relaxed text-text-secondary">
              Unstructured field information becomes structured graph updates. Only entities that already exist in the
              district can be changed — nothing is invented.
            </p>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={4}
              aria-label="Bulletin text"
              className="mt-3 w-full resize-none rounded-[var(--radius-md)] border border-hairline bg-surface-sunken p-3 text-[13px] leading-relaxed text-text-primary focus-visible:border-accent/50 focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none"
            />
            {result && (
              <div className="mt-3 space-y-1.5 rounded-[var(--radius-md)] border border-hairline bg-surface-sunken p-3">
                {result.applied.map((a, i) => (
                  <div key={i} className="flex items-start gap-2 text-[12px] text-safe">
                    <span aria-hidden="true">✓</span>
                    <span className="text-text-secondary">{a.detail}</span>
                  </div>
                ))}
                {result.unmatched.map((u, i) => (
                  <div key={`u-${i}`} className="flex items-start gap-2 text-[12px]">
                    <span aria-hidden="true" className="text-warning">
                      ?
                    </span>
                    <span className="text-text-tertiary">Not matched to a known entity: “{u}”</span>
                  </div>
                ))}
                {result.applied.length === 0 && result.unmatched.length === 0 && (
                  <div className="text-[12px] text-text-tertiary">Nothing in this bulletin matched the district.</div>
                )}
              </div>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="subtle" size="md" onClick={onClose}>
                Close
              </Button>
              <Button variant="primary" size="md" onClick={submit} disabled={busy}>
                {busy ? "Applying…" : "Apply to graph"}
              </Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
