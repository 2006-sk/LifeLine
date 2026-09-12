"use client";

import cytoscape, {
  type Core,
  type EdgeSingular,
  type EventObject,
  type NodeSingular,
} from "cytoscape";
import { AnimatePresence, motion } from "framer-motion";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { GraphNode, GraphNodeType, GraphPayload } from "@/lib/types";
import {
  allElements,
  buildElements,
  buildIndex,
  collectByIds,
  pickFocusNode,
  resolveAll,
  selectOverview,
} from "./elements";
import GraphLegend from "./GraphLegend";
import GraphTooltip from "./GraphTooltip";
import { computeLayout } from "./layout";
import { GRAPH_CLASS, STATE_CLASSES, buildStylesheet } from "./stylesheet";
import { CSS_VAR, readGraphTokens, type GraphTokens } from "./tokens";
import {
  DEFAULT_HOP_MS,
  buildTraversalHops,
  useImpactRipple,
  useTraversalPlayback,
  type GraphPhase,
} from "./useTraversalPlayback";

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

export interface LifelineGraphProps {
  payload: GraphPayload;
  /** Ordered node ids of the recommended path. Drives the sequential traversal animation. */
  highlightPath: string[];
  /** Node ids belonging to the backup plan — render amber, medium emphasis. */
  backupPath: string[];
  /** Node/edge ids that are blocked or invalidated — render red, and pulse when newly added. */
  invalidatedIds: string[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** 'overview' starts focused on the family with only relevant neighbours; 'full' shows the whole network. */
  mode: "overview" | "full";
  onModeChange: (mode: "overview" | "full") => void;
  /** 'idle' | 'searching' | 'traversing' | 'broken' — drives motion. */
  phase: "idle" | "searching" | "traversing" | "broken";
  className?: string;
}

/** Imperative escape hatch — `replay()` is the demo's "run it again" button. */
export interface LifelineGraphHandle {
  /** Restart the sequential traversal reveal from the first hop. */
  replay: () => void;
  /** Re-fit the viewport to everything currently visible. */
  fit: () => void;
  /** Centre a node without changing the selection. */
  focus: (id: string) => void;
  /** Escape hatch to the live cytoscape instance. */
  cy: () => Core | null;
}

/* ------------------------------------------------------------------ */
/* Tuning                                                              */
/* ------------------------------------------------------------------ */

/**
 * Hard ceiling on nodes drawn in overview mode. Sized for the ~400px side
 * panel the graph lives in: past this the board stops reading as a plan.
 */
const OVERVIEW_MAX_NODES = 70;
const FIT_PADDING = 26;
const CENTER_MS = 420;

/* ------------------------------------------------------------------ */

function keyOf(ids: readonly string[]): string {
  return ids.join("|");
}

/**
 * Everything the overview filter is not hiding.
 *
 * Deliberately NOT `cy.elements(":visible")`: cytoscape counts an element with
 * `opacity: 0` as invisible, so an element mid-fade-in would be excluded and
 * `fit()` would frame the wrong box.
 */
function unfiltered(cy: Core) {
  return allElements(cy).filter((element) => !element.hasClass(GRAPH_CLASS.hidden));
}

/**
 * Makes cytoscape agree with the DOM before any viewport maths.
 *
 * The host panel changes this container's height dramatically when a plan
 * arrives (a score breakdown opens underneath it). Cytoscape caches its
 * viewport size, so a `fit()` computed against the stale size frames the
 * graph for a viewport that no longer exists and the board drifts off-screen.
 * A ResizeObserver handles the common case, but this is the belt-and-braces
 * version: it costs one layout read and makes every fit correct by
 * construction.
 */
/**
 * Whether a viewport animation can actually complete.
 *
 * Cytoscape drives `cy.animate()` from requestAnimationFrame, which is
 * SUSPENDED while the tab is in the background — an animated fit started there
 * never finishes and the graph is left framed for the wrong viewport. In that
 * case (and under `prefers-reduced-motion`) we jump straight to the end state.
 */
function canAnimateViewport(reducedMotion: boolean): boolean {
  if (reducedMotion) return false;
  return typeof document === "undefined" || !document.hidden;
}

function syncSize(cy: Core): void {
  const container = cy.container();
  if (!container) return;
  if (cy.width() !== container.clientWidth || cy.height() !== container.clientHeight) {
    cy.resize();
  }
}

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(onChange: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const query = window.matchMedia(REDUCED_MOTION_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/** Requirement 9: honour the OS motion preference — animations become jumps. */
function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeReducedMotion,
    () => (typeof window !== "undefined" && window.matchMedia
      ? window.matchMedia(REDUCED_MOTION_QUERY).matches
      : false),
    () => false,
  );
}

/**
 * The right-hand "Live Knowledge Graph" panel.
 *
 * Its whole job is to make a Neo4j result legible as a traversal: the
 * recommended path lights up one hop at a time along
 * Family -> Need -> Volunteer -> Vehicle -> Segment -> Location -> Shelter ->
 * CareSite -> Resource, the backup plan sits behind it in amber, and when a
 * hazard invalidates the plan the break ripples outward from the hazard along
 * the graph's own edges.
 *
 * Layout is deterministic (see `layout.ts`) — no force simulation anywhere —
 * so the demo is pixel-identical on every run.
 */
const LifelineGraph = forwardRef<LifelineGraphHandle, LifelineGraphProps>(function LifelineGraph(
  {
    payload,
    highlightPath,
    backupPath,
    invalidatedIds,
    selectedId,
    onSelect,
    mode,
    onModeChange,
    phase,
    className,
  },
  ref,
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const cyRef = useRef<Core | null>(null);
  // Mirrored into state as well as a ref: effects read the ref, but the
  // playback hooks need the instance during render, where refs are off-limits.
  const [cyInstance, setCyInstance] = useState<Core | null>(null);

  const reducedMotion = usePrefersReducedMotion();

  const [tokens, setTokens] = useState<GraphTokens | null>(null);
  const [hovered, setHovered] = useState<{ node: GraphNode; x: number; y: number } | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [legendOpen, setLegendOpen] = useState(false);

  const onSelectRef = useRef(onSelect);
  const pointerInsideRef = useRef(false);
  const hoveredIdRef = useRef<string | null>(null);

  /* ---------------- derived, identity-stable ---------------- */

  const index = useMemo(() => buildIndex(payload), [payload]);
  const positions = useMemo(() => computeLayout(index), [index]);
  const isEmpty = index.nodes.length === 0;

  // The mount effect wires cytoscape listeners once; they read the index and
  // the latest onSelect through refs so a later payload still resolves.
  const indexRef = useRef(index);
  useEffect(() => {
    indexRef.current = index;
    onSelectRef.current = onSelect;
  });

  // Content keys, not array identity: a parent re-render that rebuilds an
  // equal array must never restart the traversal or re-fire the ripple.
  const pathKey = useMemo(() => keyOf(highlightPath), [highlightPath]);
  const backupKey = useMemo(() => keyOf(backupPath), [backupPath]);
  const invalidKey = useMemo(() => keyOf(invalidatedIds), [invalidatedIds]);

  const focusId = useMemo(
    () => pickFocusNode(index, highlightPath, selectedId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [index.signature, pathKey, selectedId],
  );

  /**
   * The overview node set. Always computed (it is cheap and deterministic) so
   * the mode affordance can show how much the filter is hiding; `mode` only
   * decides whether it is applied.
   */
  const overviewNodes = useMemo(
    () =>
      selectOverview(index, {
        focusId,
        highlightPath,
        backupPath,
        invalidatedIds,
        selectedId,
        maxNodes: OVERVIEW_MAX_NODES,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [index.signature, focusId, pathKey, backupKey, invalidKey, selectedId],
  );

  const presentTypes = useMemo(
    () => Array.from(index.byType.keys()) as GraphNodeType[],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [index.signature],
  );

  /* ---------------- 1. mount cytoscape ---------------- */

  useEffect(() => {
    const container = canvasRef.current;
    if (!container) return;

    const initialTokens = readGraphTokens();
    setTokens(initialTokens);

    const cy = cytoscape({
      container,
      elements: [],
      style: buildStylesheet({ tokens: initialTokens, reducedMotion }),
      // PRESET ONLY. A force layout would re-jiggle on every run and the demo
      // would never look the same twice.
      layout: { name: "preset" },
      boxSelectionEnabled: false,
      autoungrabify: true, // nodes cannot be dragged — the layout stays pristine
      autounselectify: true, // selection is ours, driven by `selectedId`
      minZoom: 0.08,
      maxZoom: 2.8,
      wheelSensitivity: 0.22,
      textureOnViewport: true,
      motionBlur: false,
      pixelRatio: "auto",
    });
    cyRef.current = cy;

    const showTooltip = (event: EventObject) => {
      const node = event.target as NodeSingular;
      if (!node || typeof node.id !== "function") return;
      const model = indexRef.current.nodeById.get(node.id());
      hoveredIdRef.current = node.id();
      node.addClass(GRAPH_CLASS.hover);
      if (!model) return;
      const rendered = node.renderedPosition();
      setHovered({ node: model, x: rendered.x, y: rendered.y });
    };

    const hideTooltip = (event: EventObject) => {
      const node = event.target as NodeSingular;
      node.removeClass(GRAPH_CLASS.hover);
      hoveredIdRef.current = null;
      setHovered(null);
    };

    cy.on("mouseover", "node", showTooltip);
    cy.on("mouseout", "node", hideTooltip);
    cy.on("mouseover", "edge", (event: EventObject) => {
      event.target.addClass(GRAPH_CLASS.hover);
    });
    cy.on("mouseout", "edge", (event: EventObject) => {
      event.target.removeClass(GRAPH_CLASS.hover);
    });

    cy.on("tap", "node", (event: EventObject) => {
      // Take focus so Escape clears the selection straight afterwards, even
      // once the pointer has moved off the panel.
      containerRef.current?.focus({ preventScroll: true });
      onSelectRef.current((event.target as NodeSingular).id());
    });
    cy.on("tap", (event: EventObject) => {
      if (event.target === cy) onSelectRef.current(null);
    });

    // Keep the tooltip pinned to its node while the viewport moves.
    const followViewport = () => {
      const id = hoveredIdRef.current;
      if (!id) return;
      const node = cy.getElementById(id);
      if (node.empty() || !node.isNode()) return;
      const rendered = (node as NodeSingular).renderedPosition();
      setHovered((current) => (current ? { ...current, x: rendered.x, y: rendered.y } : current));
    };
    cy.on("pan zoom", followViewport);

    setCyInstance(cy);

    return () => {
      cy.removeAllListeners();
      cy.destroy();
      cyRef.current = null;
      setCyInstance(null);
      setHovered(null);
      hoveredIdRef.current = null;
    };
    // Mount once. Everything else is synced by the effects below; re-creating
    // the instance on a payload change would flicker and reset the viewport.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------------- 2. size ---------------- */

  // `fit` is defined further down; the resize observer reaches it through a ref
  // so the observer itself can be mounted exactly once.
  const fitRef = useRef<() => void>(() => {});

  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;

    let refit = 0;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) setSize({ width: rect.width, height: rect.height });
      const cy = cyRef.current;
      if (!cy || cy.destroyed()) return;
      syncSize(cy);
      // The host panel swings this container between roughly 379x490 and
      // 379x164 as the plan/score breakdown appears. Without a re-fit the
      // graph keeps the framing of the old viewport and drifts off-screen.
      window.clearTimeout(refit);
      refit = window.setTimeout(() => fitRef.current(), 140);
    });
    observer.observe(container);
    setSize({ width: container.clientWidth, height: container.clientHeight });

    return () => {
      window.clearTimeout(refit);
      observer.disconnect();
    };
  }, []);

  /* ---------------- 3. tokens: initial + on theme change ---------------- */

  useEffect(() => {
    if (typeof window === "undefined") return;
    let frame = 0;
    const refresh = () => {
      window.clearTimeout(frame);
      frame = window.setTimeout(() => setTokens(readGraphTokens()), 60);
    };

    const observer = new MutationObserver(refresh);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style", "data-theme"],
    });

    const scheme = window.matchMedia?.("(prefers-color-scheme: dark)");
    scheme?.addEventListener("change", refresh);

    return () => {
      window.clearTimeout(frame);
      observer.disconnect();
      scheme?.removeEventListener("change", refresh);
    };
  }, []);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || cy.destroyed() || !tokens) return;
    cy.style(buildStylesheet({ tokens, reducedMotion }));
  }, [cyInstance, tokens, reducedMotion]);

  /* ---------------- 4. elements: diff-patch, never re-init ---------------- */

  const needsFitRef = useRef(true);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || cy.destroyed()) return;

    const desired = buildElements(index, { positions });
    const desiredIds = new Set(desired.map((definition) => String(definition.data.id)));

    cy.batch(() => {
      allElements(cy)
        .filter((element) => !desiredIds.has(element.id()))
        .remove();

      // `desired` lists every node before any edge, so an edge is never added
      // before its endpoints exist.
      for (const definition of desired) {
        const id = String(definition.data.id);
        const existing = cy.getElementById(id);
        if (existing.nonempty()) {
          existing.data(definition.data);
          if (definition.position && existing.isNode()) {
            (existing as NodeSingular).position(definition.position);
          }
        } else {
          cy.add(definition);
        }
      }
    });

    needsFitRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cyInstance, index.signature]);

  /* ---------------- 5. visual state ----------------
     One effect owns every state class so they can never fight each other.
     It touches STATE_CLASSES only — playback, hover and selection classes are
     owned elsewhere and survive untouched. */

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || cy.destroyed() || isEmpty) return;

    const hops = buildTraversalHops(cy, index, highlightPath);
    const pathIds = new Set<string>();
    for (const hop of hops) {
      pathIds.add(hop.nodeId);
      for (const id of hop.viaNodeIds) pathIds.add(id);
      for (const id of hop.edgeIds) pathIds.add(id);
    }

    const backupHops = buildTraversalHops(cy, index, backupPath);
    const backupIds = new Set<string>();
    for (const hop of backupHops) {
      backupIds.add(hop.nodeId);
      for (const id of hop.viaNodeIds) backupIds.add(id);
      for (const id of hop.edgeIds) backupIds.add(id);
    }
    for (const id of pathIds) backupIds.delete(id);

    const invalidIds = resolveAll(index, invalidatedIds);

    // One ring around the story is "relevant"; everything beyond it dims.
    const relevantIds = new Set<string>();
    const seedNodes = [...highlightPath, ...backupPath].filter((id) => index.nodeById.has(id));
    for (const id of seedNodes) {
      for (const neighbour of index.neighbors.get(id) ?? []) relevantIds.add(neighbour);
    }
    for (const id of pathIds) relevantIds.delete(id);
    for (const id of backupIds) relevantIds.delete(id);

    const hasStory = pathIds.size > 0 || backupIds.size > 0 || invalidIds.size > 0;

    cy.batch(() => {
      cy.elements().removeClass(STATE_CLASSES.join(" "));

      if (hasStory) {
        const lit = new Set([...pathIds, ...backupIds, ...invalidIds, ...relevantIds]);
        allElements(cy)
          .filter((element) => !lit.has(element.id()))
          .addClass(GRAPH_CLASS.dim);
      }

      collectByIds(cy, relevantIds).addClass(GRAPH_CLASS.relevant);
      collectByIds(cy, backupIds).addClass(GRAPH_CLASS.backup);
      collectByIds(cy, pathIds).addClass(`${GRAPH_CLASS.path} ${GRAPH_CLASS.labelled}`);
      if (!reducedMotion) {
        collectByIds(cy, pathIds).edges().addClass(GRAPH_CLASS.flow);
      }
      // Invalidation is the loudest state — applied last so it always wins.
      collectByIds(cy, invalidIds).addClass(`${GRAPH_CLASS.invalid} ${GRAPH_CLASS.labelled}`);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cyInstance, index.signature, pathKey, backupKey, invalidKey, reducedMotion, isEmpty]);

  /* ---------------- 6. overview vs full ---------------- */

  const revealFrameRef = useRef<number[]>([]);
  const revealTimerRef = useRef<number[]>([]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || cy.destroyed() || isEmpty) return;

    const visibleNodes = mode === "full" ? null : overviewNodes;

    const shouldShow = (id: string, isNode: boolean, source?: string, target?: string) => {
      if (!visibleNodes) return true;
      if (isNode) return visibleNodes.has(id);
      return !!source && !!target && visibleNodes.has(source) && visibleNodes.has(target);
    };

    // Self-heal: if a previous run's reveal frame was cancelled by this
    // effect's own cleanup, those elements would be stranded at `opacity: 0`
    // (and cytoscape would report them as not visible). Always start from a
    // clean slate.
    cy.elements().removeClass(GRAPH_CLASS.entering);

    const revealing: string[] = [];
    let hiding = 0;

    const applyVisibility = (element: NodeSingular | EdgeSingular, show: boolean) => {
      const hidden = element.hasClass(GRAPH_CLASS.hidden);
      if (show && hidden) {
        revealing.push(element.id());
        element.addClass(GRAPH_CLASS.entering);
        element.removeClass(GRAPH_CLASS.hidden);
      } else if (!show && !hidden) {
        hiding++;
        element.addClass(GRAPH_CLASS.hidden);
        element.removeClass(`${GRAPH_CLASS.hover} ${GRAPH_CLASS.entering}`);
      }
    };

    cy.batch(() => {
      cy.nodes().forEach((node) => applyVisibility(node, shouldShow(node.id(), true)));
      cy.edges().forEach((edge) =>
        applyVisibility(
          edge,
          shouldShow(edge.id(), false, edge.data("source"), edge.data("target")),
        ),
      );
    });

    if (revealing.length > 0) {
      const revealed = new Set(revealing);
      const release = () => {
        const core = cyRef.current;
        if (!core || core.destroyed()) return;
        collectByIds(core, revealed).removeClass(GRAPH_CLASS.entering);
      };

      if (reducedMotion) {
        release();
      } else {
        // Two frames: one to commit `opacity: 0`, one to release it so the
        // stylesheet transition animates the expansion in.
        revealFrameRef.current.push(
          window.requestAnimationFrame(() => window.requestAnimationFrame(release)),
        );
        // Safety net. requestAnimationFrame is SUSPENDED in a background tab,
        // and cytoscape treats `opacity: 0` as not visible — so a stranded
        // `.ll-entering` is an invisible graph, not just a missing fade.
        // Timers still run (throttled) when the tab is hidden.
        revealTimerRef.current.push(window.setTimeout(release, 400));
      }
    }

    // Only re-frame when the visible set actually changed. Without this guard
    // every external selection would re-fit and fight the pan in effect 7.
    syncSize(cy);
    const visible = unfiltered(cy);
    const changed = revealing.length > 0 || hiding > 0 || needsFitRef.current;
    if (visible.nonempty() && changed) {
      if (needsFitRef.current || !canAnimateViewport(reducedMotion)) {
        cy.fit(visible, FIT_PADDING);
      } else {
        cy.animate(
          { fit: { eles: visible, padding: FIT_PADDING } },
          { duration: 520, easing: "ease-out-cubic" },
        );
      }
    }
    needsFitRef.current = false;

    const frames = revealFrameRef.current;
    const timers = revealTimerRef.current;
    return () => {
      for (const frame of frames) window.cancelAnimationFrame(frame);
      for (const timer of timers) window.clearTimeout(timer);
      revealFrameRef.current = [];
      revealTimerRef.current = [];
      const core = cyRef.current;
      if (core && !core.destroyed()) core.elements().removeClass(GRAPH_CLASS.entering);
    };
    // `overviewNodes` already folds in the path, backup, invalidation and the
    // external selection — selecting a node the overview filtered out must
    // reveal it, which is the map -> graph sync.
  }, [cyInstance, index.signature, mode, overviewNodes, reducedMotion, isEmpty]);

  /* ---------------- 7. external selection -> highlight + pan ---------------- */

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || cy.destroyed() || isEmpty) return;

    cy.elements().removeClass(GRAPH_CLASS.selected);
    if (!selectedId) return;

    const ids = resolveAll(index, [selectedId]);
    if (ids.size === 0) return;
    const selection = collectByIds(cy, ids);
    selection.addClass(GRAPH_CLASS.selected);

    const node = selection.nodes().first();
    if (node.empty() || node.hasClass(GRAPH_CLASS.hidden)) return;
    syncSize(cy);

    // This is the map <-> graph sync: clicking a marker on the map must walk
    // the graph's eye to the same entity.
    if (!canAnimateViewport(reducedMotion)) {
      cy.center(node);
    } else {
      cy.animate(
        { center: { eles: node } },
        { duration: CENTER_MS, easing: "ease-out-cubic", queue: false },
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cyInstance, selectedId, index.signature, mode, isEmpty]);

  /* ---------------- 8. traversal + impact ---------------- */

  const playback = useTraversalPlayback({
    cy: cyInstance,
    path: highlightPath,
    pathKey,
    index,
    phase: phase as GraphPhase,
    hopMs: DEFAULT_HOP_MS,
    reducedMotion,
    enabled: !isEmpty,
  });

  useImpactRipple({
    cy: cyInstance,
    index,
    invalidatedIds,
    invalidatedKey: invalidKey,
    // The break has to travel along the plan it invalidates, not just flash
    // the blocked segment — hazard -> segment -> route -> family.
    pathIds: highlightPath,
    pathKey,
    phase: phase as GraphPhase,
    reducedMotion,
    enabled: !isEmpty,
  });

  /* ---------------- 9. travelling dash flow on the recommended path ------- */

  useEffect(() => {
    if (!cyInstance || reducedMotion) return;
    const cy = cyRef.current;
    if (!cy || cy.destroyed()) return;

    let frame = 0;
    let offset = 0;
    let last = 0;

    const tick = (now: number) => {
      frame = window.requestAnimationFrame(tick);
      if (now - last < 32) return; // ~30fps is plenty for a dash crawl
      last = now;
      const core = cyRef.current;
      if (!core || core.destroyed()) return;
      const flowing = core.edges(`.${GRAPH_CLASS.flow}`);
      if (flowing.empty() || flowing.length > 60) return;
      offset = (offset - 2.4) % 1200;
      flowing.style("line-dash-offset", offset);
    };
    frame = window.requestAnimationFrame(tick);

    return () => {
      window.cancelAnimationFrame(frame);
      const core = cyRef.current;
      if (core && !core.destroyed()) core.edges().removeStyle("line-dash-offset");
    };
  }, [cyInstance, reducedMotion]);

  /* ---------------- 10. escape clears selection ---------------- */

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const container = containerRef.current;
      if (!container) return;
      const focusedInside =
        document.activeElement instanceof Node && container.contains(document.activeElement);
      if (!focusedInside && !pointerInsideRef.current) return;
      if (selectedId === null) return;
      event.stopPropagation();
      onSelectRef.current(null);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [selectedId]);

  /* ---------------- imperative handle ---------------- */

  const fit = useCallback(() => {
    const cy = cyRef.current;
    if (!cy || cy.destroyed()) return;
    syncSize(cy);
    const visible = unfiltered(cy);
    if (visible.empty()) return;
    if (!canAnimateViewport(reducedMotion)) cy.fit(visible, FIT_PADDING);
    else
      cy.animate(
        { fit: { eles: visible, padding: FIT_PADDING } },
        { duration: 420, easing: "ease-out-cubic" },
      );
  }, [reducedMotion]);

  useEffect(() => {
    fitRef.current = fit;
  }, [fit]);

  const focus = useCallback(
    (id: string) => {
      const cy = cyRef.current;
      if (!cy || cy.destroyed()) return;
      const node = cy.getElementById(id);
      if (node.empty() || !node.isNode()) return;
      if (!canAnimateViewport(reducedMotion)) cy.center(node);
      else
        cy.animate(
          { center: { eles: node } },
          { duration: CENTER_MS, easing: "ease-out-cubic", queue: false },
        );
    },
    [reducedMotion],
  );

  useImperativeHandle(
    ref,
    () => ({
      replay: playback.replay,
      fit,
      focus,
      cy: () => cyRef.current,
    }),
    [playback.replay, fit, focus],
  );

  /* ---------------- chrome ---------------- */

  const canReplay = highlightPath.length > 1;
  const planCount = overviewNodes.size;

  return (
    <div
      ref={containerRef}
      className={className}
      tabIndex={0}
      role="application"
      aria-label="Live knowledge graph"
      onMouseEnter={() => {
        pointerInsideRef.current = true;
      }}
      onMouseLeave={() => {
        pointerInsideRef.current = false;
      }}
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        minHeight: 0,
        overflow: "hidden",
        borderRadius: 14,
        background: CSS_VAR.bgPanel,
        border: `1px solid ${CSS_VAR.borderHairline}`,
        outline: "none",
      }}
    >
      <div ref={canvasRef} style={{ position: "absolute", inset: 0 }} />

      {/* Phase readout — tells the judge what the graph is doing right now. */}
      <div
        style={{
          position: "absolute",
          top: 10,
          left: 12,
          display: "flex",
          alignItems: "center",
          gap: 7,
          pointerEvents: "none",
          zIndex: 12,
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: 6,
            height: 6,
            borderRadius: 999,
            background: PHASE_COLOR[phase],
            boxShadow: `0 0 10px 1px ${PHASE_COLOR[phase]}`,
          }}
        />
        <span
          style={{
            fontSize: 9,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            color: CSS_VAR.textSecondary,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {PHASE_LABEL[phase]}
          {playback.playing && playback.hops.length > 0
            ? ` · hop ${Math.max(0, playback.step) + 1}/${playback.hops.length}`
            : ""}
        </span>
      </div>

      {/* Controls */}
      <div
        style={{
          position: "absolute",
          top: 8,
          right: 8,
          display: "flex",
          gap: 6,
          zIndex: 14,
        }}
      >
        <ToolbarButton label="Replay" onClick={playback.replay} disabled={!canReplay} />
        <ToolbarButton label="Fit" onClick={fit} />
        <ToolbarButton
          label="Legend"
          onClick={() => setLegendOpen((open) => !open)}
          emphasis={legendOpen}
        />
      </div>

      {/* Legend */}
      <AnimatePresence>
        {legendOpen ? (
          <motion.div
            initial={reducedMotion ? false : { opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: -6 }}
            transition={{ duration: reducedMotion ? 0 : 0.18, ease: [0.16, 1, 0.3, 1] }}
            style={{
              position: "absolute",
              top: 44,
              right: 8,
              width: 268,
              maxHeight: "calc(100% - 60px)",
              overflowY: "auto",
              zIndex: 30,
            }}
          >
            <GraphLegend types={presentTypes} />
          </motion.div>
        ) : null}
      </AnimatePresence>

      {/* Mode affordance. The host panel delegates this entirely to the graph,
          so it must work in BOTH directions — there is no other way back from
          the full network. Deliberately NOT wrapped in AnimatePresence with
          mode="wait": an exit animation that never completes (background tab,
          reduced motion) would strand the button showing the previous label. */}
      {isEmpty ? null : (
        <motion.button
          type="button"
          onClick={() => onModeChange(mode === "overview" ? "full" : "overview")}
          initial={reducedMotion ? false : { opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: reducedMotion ? 0 : 0.18 }}
          style={{
            position: "absolute",
            bottom: 10,
            left: 12,
            zIndex: 12,
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "5px 10px",
            borderRadius: 999,
            fontSize: 10.5,
            cursor: "pointer",
            color: CSS_VAR.textSecondary,
            background: `color-mix(in srgb, ${CSS_VAR.bgPanel} 90%, transparent)`,
            border: `1px solid ${CSS_VAR.borderHairline}`,
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
          }}
        >
          <span aria-hidden="true" style={{ color: CSS_VAR.accent, fontWeight: 700 }}>
            {mode === "overview" ? "+" : "\u2212"}
          </span>
          {mode === "overview" ? "Explore full network" : "Focus on plan"}
          <span style={{ color: CSS_VAR.textTertiary }}>
            {mode === "overview" ? `${index.nodes.length} nodes` : `${planCount} in plan`}
          </span>
        </motion.button>
      )}

      {/* Tooltip */}
      <GraphTooltip
        node={hovered?.node ?? null}
        x={hovered?.x ?? 0}
        y={hovered?.y ?? 0}
        containerWidth={size.width}
        containerHeight={size.height}
        reducedMotion={reducedMotion}
      />

      {/* Empty state — `payload.nodes = []` must never throw. */}
      {isEmpty ? (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "grid",
            placeItems: "center",
            padding: 24,
            textAlign: "center",
            zIndex: 20,
            pointerEvents: "none",
          }}
        >
          <div style={{ maxWidth: 260 }}>
            <div
              aria-hidden="true"
              style={{
                margin: "0 auto 12px",
                width: 34,
                height: 34,
                borderRadius: 9,
                border: `1px dashed ${CSS_VAR.borderHairline}`,
                display: "grid",
                placeItems: "center",
                color: CSS_VAR.textTertiary,
                fontSize: 15,
              }}
            >
              ◇
            </div>
            <div style={{ fontSize: 12.5, color: CSS_VAR.textPrimary, marginBottom: 4 }}>
              No graph data yet
            </div>
            <div style={{ fontSize: 11, lineHeight: 1.45, color: CSS_VAR.textSecondary }}>
              Run a recommendation to watch the traversal light up node by node.
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
});

const PHASE_LABEL: Record<LifelineGraphProps["phase"], string> = {
  idle: "Graph idle",
  searching: "Querying Neo4j",
  traversing: "Traversing path",
  broken: "Plan invalidated",
};

const PHASE_COLOR: Record<LifelineGraphProps["phase"], string> = {
  idle: CSS_VAR.textTertiary,
  searching: CSS_VAR.info,
  traversing: CSS_VAR.accent,
  broken: CSS_VAR.danger,
};

function ToolbarButton({
  label,
  onClick,
  disabled = false,
  emphasis = false,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  emphasis?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        appearance: "none",
        padding: "4px 9px",
        borderRadius: 7,
        fontSize: 10.5,
        lineHeight: 1.4,
        letterSpacing: "0.01em",
        cursor: disabled ? "not-allowed" : "pointer",
        color: disabled
          ? CSS_VAR.textTertiary
          : emphasis
            ? CSS_VAR.accent
            : CSS_VAR.textSecondary,
        background: emphasis
          ? `color-mix(in srgb, ${CSS_VAR.accent} 12%, transparent)`
          : `color-mix(in srgb, ${CSS_VAR.bgPanel} 88%, transparent)`,
        border: `1px solid ${emphasis ? `color-mix(in srgb, ${CSS_VAR.accent} 38%, transparent)` : CSS_VAR.borderHairline}`,
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        opacity: disabled ? 0.5 : 1,
        transition: "color 150ms ease, background 150ms ease, border-color 150ms ease",
      }}
    >
      {label}
    </button>
  );
}

export default LifelineGraph;
export { GraphLegend };
