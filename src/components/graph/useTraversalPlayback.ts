"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Core, NodeSingular } from "cytoscape";
import { collectByIds, pairKey, resolveCyIds, type GraphIndex } from "./elements";
import { GRAPH_CLASS, PLAYBACK_CLASSES } from "./stylesheet";

export type GraphPhase = "idle" | "searching" | "traversing" | "broken";

/** Default dwell per hop. The spec window is 110-160ms. */
export const DEFAULT_HOP_MS = 135;

/** How far aStar may wander when two consecutive path nodes are not adjacent. */
const MAX_BRIDGE_HOPS = 4;

export interface TraversalHop {
  /** The cytoscape node id lit at this hop. */
  nodeId: string;
  /** Edges traversed to arrive here (>1 only when the hop had to be bridged). */
  edgeIds: string[];
  /** Connector nodes revealed with this hop (bridged hops only). */
  viaNodeIds: string[];
}

export interface TraversalPlayback {
  /** Restart the sequential reveal from hop 0. Safe to call at any time. */
  replay: () => void;
  /** Jump straight to the fully-lit end state. */
  finish: () => void;
  playing: boolean;
  /** Index of the last hop lit, -1 before the first. */
  step: number;
  hops: TraversalHop[];
}

export interface UseTraversalPlaybackOptions {
  /** Live cytoscape instance; may be null before mount or after teardown. */
  cy: Core | null;
  /** Ordered domain node ids of the recommended path. */
  path: readonly string[];
  /** Content key for `path` — prevents a restart when the array is recreated. */
  pathKey: string;
  index: GraphIndex;
  phase: GraphPhase;
  hopMs?: number;
  reducedMotion?: boolean;
  /** Gate: false while the graph is still being populated. */
  enabled?: boolean;
}

/**
 * Turns `highlightPath` into an ordered hop list, resolving the edge used for
 * each step.
 *
 * Consecutive path nodes are not always adjacent — the narrative chain
 * (Family -> Need -> Volunteer -> Vehicle -> Segment -> Location -> Shelter ->
 * CareSite -> Resource) crosses joins the graph models differently, e.g. a
 * Vehicle reaches a Segment only through its staging Location, and a Shelter
 * reaches a CareSite through a [:NEAR] between Locations. When there is no
 * direct edge we ask cytoscape for the shortest connecting walk (aStar over
 * the visible subgraph, capped at MAX_BRIDGE_HOPS) and light the connectors
 * too, so the travelling glow never teleports. aStar on a fixed graph is
 * deterministic, so the demo still looks identical every run.
 */
export function buildTraversalHops(
  cy: Core | null,
  index: GraphIndex,
  path: readonly string[],
): TraversalHop[] {
  const hops: TraversalHop[] = [];
  const present = path.filter((id) => index.nodeById.has(id));
  if (present.length === 0) return hops;

  hops.push({ nodeId: present[0], edgeIds: [], viaNodeIds: [] });

  for (let i = 1; i < present.length; i++) {
    const from = present[i - 1];
    const to = present[i];

    const direct = index.pairEdge.get(pairKey(from, to));
    if (direct) {
      hops.push({ nodeId: to, edgeIds: [direct], viaNodeIds: [] });
      continue;
    }

    const bridged = bridge(cy, from, to);
    hops.push({ nodeId: to, edgeIds: bridged.edgeIds, viaNodeIds: bridged.viaNodeIds });
  }

  return hops;
}

function bridge(
  cy: Core | null,
  from: string,
  to: string,
): { edgeIds: string[]; viaNodeIds: string[] } {
  if (!cy) return { edgeIds: [], viaNodeIds: [] };
  const root = cy.getElementById(from);
  const goal = cy.getElementById(to);
  if (root.empty() || goal.empty()) return { edgeIds: [], viaNodeIds: [] };

  try {
    const result = cy.elements().aStar({ root, goal, directed: false });
    if (!result.found) return { edgeIds: [], viaNodeIds: [] };

    // Iterate nodes and edges separately: cytoscape's own typings give
    // `CollectionReturnValue.forEach` an unusable element type.
    const edgeIds: string[] = [];
    const viaNodeIds: string[] = [];
    result.path.edges().forEach((edge) => {
      edgeIds.push(edge.id());
    });
    result.path.nodes().forEach((node) => {
      if (node.id() !== from && node.id() !== to) viaNodeIds.push(node.id());
    });

    if (edgeIds.length > MAX_BRIDGE_HOPS) return { edgeIds: [], viaNodeIds: [] };
    return { edgeIds, viaNodeIds };
  } catch {
    return { edgeIds: [], viaNodeIds: [] };
  }
}

/**
 * Sequential traversal playback.
 *
 * Timer discipline (hard requirement): every scheduled callback is tracked and
 * cleared on unmount, on any prop change that invalidates the run, and before
 * a new run starts — so there is no leaked timer and no double playback when
 * the parent re-renders with a fresh-but-identical `highlightPath` array.
 */
export function useTraversalPlayback({
  cy,
  path,
  pathKey,
  index,
  phase,
  hopMs = DEFAULT_HOP_MS,
  reducedMotion = false,
  enabled = true,
}: UseTraversalPlaybackOptions): TraversalPlayback {
  const timersRef = useRef<number[]>([]);
  const [playing, setPlaying] = useState(false);
  const [step, setStep] = useState(-1);

  // Hops are resolved inside the effect, NOT during render: the elements
  // effect adds nodes to cytoscape after this render, and aStar bridging needs
  // them to exist. A render-time memo would bridge against an empty graph on
  // the first frame where the payload and the path arrive together.
  const [hops, setHops] = useState<TraversalHop[]>([]);
  const hopsRef = useRef<TraversalHop[]>([]);

  const clearTimers = useCallback(() => {
    for (const id of timersRef.current) window.clearTimeout(id);
    timersRef.current = [];
  }, []);

  const elementsOf = useCallback(
    (core: Core, hop: TraversalHop) => {
      return collectByIds(core, [
        ...resolveCyIds(index, hop.nodeId),
        ...hop.viaNodeIds,
        ...hop.edgeIds,
      ]);
    },
    [index],
  );

  /** Removes every playback-owned class, leaving `.ll-path` as the resting state. */
  const reset = useCallback((core: Core) => {
    core.batch(() => {
      core.elements().removeClass(PLAYBACK_CLASSES.join(" "));
    });
  }, []);

  /** Resolve the hop list against the live graph and publish it. */
  const resolveHops = useCallback((): TraversalHop[] => {
    const fresh = buildTraversalHops(cy, index, path);
    hopsRef.current = fresh;
    setHops(fresh);
    return fresh;
  }, [cy, index, path]);

  const finish = useCallback(() => {
    clearTimers();
    if (!cy || cy.destroyed()) return;
    const hops = resolveHops();
    reset(cy);
    setPlaying(false);
    setStep(hops.length - 1);
  }, [clearTimers, cy, reset, resolveHops]);

  const play = useCallback(() => {
    clearTimers();
    if (!cy || cy.destroyed()) return;
    const hops = resolveHops();

    if (reducedMotion || hops.length < 2) {
      reset(cy);
      setPlaying(false);
      setStep(hops.length - 1);
      return;
    }

    // Everything on the path starts unlit; the reveal turns it on hop by hop.
    cy.batch(() => {
      cy.elements().removeClass(PLAYBACK_CLASSES.join(" "));
      for (const hop of hops) elementsOf(cy, hop).addClass(GRAPH_CLASS.pending);
    });

    setPlaying(true);
    setStep(-1);

    hops.forEach((hop, i) => {
      const timer = window.setTimeout(() => {
        if (!cy || cy.destroyed()) return;
        cy.batch(() => {
          if (i > 0) elementsOf(cy, hops[i - 1]).removeClass(GRAPH_CLASS.head);
          const eles = elementsOf(cy, hop);
          eles.removeClass(GRAPH_CLASS.pending);
          eles.addClass(`${GRAPH_CLASS.traversed} ${GRAPH_CLASS.head}`);
        });
        setStep(i);
      }, i * hopMs);
      timersRef.current.push(timer);
    });

    // Tail: drop the travelling glow and hand the path back to its resting
    // `.ll-path` style.
    const tail = window.setTimeout(
      () => {
        if (!cy || cy.destroyed()) return;
        reset(cy);
        setPlaying(false);
      },
      hops.length * hopMs + 260,
    );
    timersRef.current.push(tail);
  }, [clearTimers, cy, elementsOf, hopMs, reducedMotion, reset, resolveHops]);

  useEffect(() => {
    if (!cy || cy.destroyed() || !enabled) return;

    // Kicked off on the next tick so the effect body itself never calls
    // setState synchronously (which would cascade a render).
    const kickoff = window.setTimeout(() => {
      if (phase === "traversing" && buildTraversalHops(cy, index, path).length > 1) {
        play();
      } else {
        // Any other phase: the path is simply lit. Leaving `traversing`
        // mid-animation jumps to the finished state — it never clears the path.
        finish();
      }
    }, 0);
    timersRef.current.push(kickoff);

    return clearTimers;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cy, enabled, phase, pathKey, index.signature, reducedMotion, hopMs]);

  useEffect(() => clearTimers, [clearTimers]);

  return { replay: play, finish, playing, step, hops };
}

/* ------------------------------------------------------------------ */
/* Impact propagation                                                  */
/* ------------------------------------------------------------------ */

/** Delay between ripple rings. 6 rings + pulse stays inside the 1.5s budget. */
const RING_MS = 150;
const PULSE_MS = 260;
const MAX_RINGS = 6;

export interface UseImpactRippleOptions {
  cy: Core | null;
  index: GraphIndex;
  invalidatedIds: readonly string[];
  /** Content key for `invalidatedIds`. */
  invalidatedKey: string;
  /**
   * The plan chain that is being broken. The ripple travels along it so the
   * break visibly reaches the family, not just the blocked segment.
   */
  pathIds?: readonly string[];
  /** Content key for `pathIds`. */
  pathKey?: string;
  phase: GraphPhase;
  reducedMotion?: boolean;
  enabled?: boolean;
}

/**
 * When `invalidatedIds` GAINS ids while the phase is `broken`, pulses red
 * outward from the HAZARD along the graph's own edges:
 *
 *     hazard -> the segment it blocks -> the route through it -> the family
 *
 * Rings are BFS distance from the hazard, so the ripple follows real
 * relationships rather than a hard-coded script; anything further away than
 * MAX_RINGS is clamped into the final ring, which is why the family reliably
 * flashes last. The whole thing lands in ~1.2s and leaves the broken elements
 * in their dashed, faded `.ll-invalid` rest state (the class transition does
 * the fade).
 *
 * Two subtleties that the real payload forces:
 *
 *  - `invalidatedIds` carries blocked SEGMENTS, full shelters and stood-down
 *    responders — never the hazard itself. So when no hazard is in the blast
 *    we walk one hop out to find the `hazard`/`alert` the blocked elements
 *    point at (`BLOCKED_BY` / `AFFECTED_BY`) and seed the ripple there.
 *    Without this every element sits at distance 0 and the "ripple" is a
 *    single simultaneous flash.
 *
 *  - "Gained" is Set membership against the previous run, never array
 *    identity, so re-renders cannot re-fire it. Ids that arrive BEFORE the
 *    phase flips to `broken` are parked in `pendingRef` and fired when it
 *    does, so a host that updates its impact and its phase in two separate
 *    renders still gets the ripple.
 */
export function useImpactRipple({
  cy,
  index,
  invalidatedIds,
  invalidatedKey,
  pathIds,
  pathKey = "",
  phase,
  reducedMotion = false,
  enabled = true,
}: UseImpactRippleOptions): void {
  const previousRef = useRef<Set<string>>(new Set());
  const pendingRef = useRef<Set<string>>(new Set());
  const timersRef = useRef<number[]>([]);

  const clearTimers = useCallback(() => {
    for (const id of timersRef.current) window.clearTimeout(id);
    timersRef.current = [];
  }, []);

  useEffect(() => {
    const current = new Set(invalidatedIds);
    for (const id of current) {
      if (!previousRef.current.has(id)) pendingRef.current.add(id);
    }
    previousRef.current = current;

    if (!cy || cy.destroyed() || !enabled) return;
    if (phase !== "broken") return;

    // Only blast things that are still invalidated (the host clears `impact`
    // on a timer; a stale pending id must not resurrect).
    const blast = [...pendingRef.current].filter((id) => current.has(id));
    if (blast.length === 0) return;
    pendingRef.current = new Set();

    clearTimers();
    cy.elements().removeClass(GRAPH_CLASS.ripple);

    if (reducedMotion) return; // final state is already painted by the state sync

    const rings = planImpactRings(index, blast, pathIds ?? []);

    const touched: string[] = [];
    rings.forEach((ids, ring) => {
      if (ids.length === 0) return;
      const cyIds = ids.flatMap((id) => resolveCyIds(index, id));
      if (cyIds.length === 0) return;
      touched.push(...cyIds);

      timersRef.current.push(
        window.setTimeout(() => {
          if (!cy || cy.destroyed()) return;
          collectByIds(cy, cyIds).addClass(GRAPH_CLASS.ripple);
        }, ring * RING_MS),
      );
      timersRef.current.push(
        window.setTimeout(
          () => {
            if (!cy || cy.destroyed()) return;
            collectByIds(cy, cyIds).removeClass(GRAPH_CLASS.ripple);
          },
          ring * RING_MS + PULSE_MS,
        ),
      );
    });

    const total = MAX_RINGS * RING_MS + PULSE_MS;
    timersRef.current.push(
      window.setTimeout(() => {
        if (!cy || cy.destroyed()) return;
        collectByIds(cy, touched).removeClass(GRAPH_CLASS.ripple);
      }, total),
    );

    return clearTimers;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cy, enabled, invalidatedKey, pathKey, phase, reducedMotion, index.signature]);

  useEffect(() => clearTimers, [clearTimers]);
}

/**
 * Buckets everything the break touches by how many hops it is from the cause.
 *
 * Exported so the ordering can be asserted against the real `/api/graph`
 * payload without mounting React — it is the part of requirement 6 that is
 * easy to get silently wrong.
 *
 * Returns exactly MAX_RINGS buckets; index 0 is the hazard itself.
 */
export function planImpactRings(
  index: GraphIndex,
  blast: readonly string[],
  pathIds: readonly string[] = [],
): string[][] {
  const rings: string[][] = Array.from({ length: MAX_RINGS }, () => []);
  if (blast.length === 0) return rings;

  const isThreat = (id: string) => {
    const type = index.nodeById.get(id)?.type;
    return type === "hazard" || type === "alert";
  };

  // Seed at the cause. Prefer a hazard inside the blast; else the hazard the
  // blast points at (BLOCKED_BY / AFFECTED_BY); else the blast itself.
  let roots = blast.filter(isThreat);
  if (roots.length === 0) {
    const derived = new Set<string>();
    for (const id of blast) {
      for (const neighbour of index.neighbors.get(id) ?? []) {
        if (isThreat(neighbour)) derived.add(neighbour);
      }
    }
    roots = [...derived].sort();
  }
  const seeded = roots.length > 0;
  if (!seeded) roots = blast.filter((id) => index.nodeById.has(id));

  const distance = bfsDistances(index, roots.length > 0 ? roots : [...blast]);

  /** Distance of a domain id, resolving edges through their endpoints. */
  const distanceOf = (domainId: string): number => {
    const direct = distance.get(domainId);
    if (direct !== undefined) return direct;
    const edge = index.edges.find((e) => e.domainId === domainId);
    if (edge) {
      const ends = [distance.get(edge.source), distance.get(edge.target)].filter(
        (n): n is number => n !== undefined,
      );
      if (ends.length > 0) return Math.min(...ends);
    }
    // Unreachable inside the budget: it belongs at the far end of the blast,
    // which is exactly where the family sits.
    return MAX_RINGS - 1;
  };

  // What pulses: the hazard, everything newly invalidated, and the plan chain
  // it breaks — each bucketed by how far it is from the cause.
  const affected = new Set<string>(blast);
  if (seeded) for (const id of roots) affected.add(id);
  for (const id of pathIds) {
    if (index.nodeById.has(id)) affected.add(id);
  }

  for (const domainId of affected) {
    const ring = Math.min(MAX_RINGS - 1, Math.max(0, distanceOf(domainId)));
    rings[ring].push(domainId);
  }
  for (const ring of rings) ring.sort();

  return rings;
}

/** Unweighted BFS over the payload's own adjacency. */
function bfsDistances(index: GraphIndex, roots: string[]): Map<string, number> {
  const distance = new Map<string, number>();
  const queue: string[] = [];
  for (const root of roots) {
    if (!index.nodeById.has(root)) continue;
    distance.set(root, 0);
    queue.push(root);
  }

  let head = 0;
  while (head < queue.length) {
    const id = queue[head++];
    const d = distance.get(id) ?? 0;
    if (d >= MAX_RINGS) continue;
    for (const next of index.neighbors.get(id) ?? []) {
      if (distance.has(next)) continue;
      distance.set(next, d + 1);
      queue.push(next);
    }
  }

  return distance;
}

/** Narrow helper kept for callers that want the underlying node singular. */
export function nodeOrNull(cy: Core | null, id: string): NodeSingular | null {
  if (!cy || cy.destroyed() || !id) return null;
  const found = cy.getElementById(id);
  return found.nonempty() && found.isNode() ? (found as NodeSingular) : null;
}
