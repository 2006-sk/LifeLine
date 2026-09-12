import type { Collection, CollectionReturnValue, Core, ElementDefinition } from "cytoscape";
import type { GraphEdge, GraphNode, GraphNodeType, GraphPayload } from "@/lib/types";
import { visualFor } from "./nodeVisuals";

/**
 * Payload -> cytoscape plumbing.
 *
 * Everything here is defensive: `/api/graph` is built by another slice of the
 * app, so we assume nothing beyond the `GraphPayload` shape. Duplicate ids,
 * dangling edges, id collisions between a node and an edge, and `highlightPath`
 * entries that are not in the payload at all must degrade, never throw.
 */

/**
 * Separator for composite map keys and for aliasing clashing edge ids. Chosen
 * because Lifeline ids are `snake_case` slugs — this sequence cannot occur in
 * one, so `pairKey` can never be ambiguous.
 */
const SEP = "|>";

export interface NormalizedEdge {
  /** Unique across ALL cytoscape elements (aliased if it clashed with a node). */
  cyId: string;
  /** The id as it arrived from the API — what `invalidatedIds` will reference. */
  domainId: string;
  source: string;
  target: string;
  type: string;
  properties: Record<string, unknown>;
}

export interface GraphIndex {
  nodes: GraphNode[];
  nodeById: Map<string, GraphNode>;
  edges: NormalizedEdge[];
  edgeByCyId: Map<string, NormalizedEdge>;
  /** Domain id (node OR edge) -> the cytoscape element ids that represent it. */
  cyIdsFor: Map<string, string[]>;
  /** node id -> incident edges */
  incident: Map<string, NormalizedEdge[]>;
  /** node id -> neighbouring node ids */
  neighbors: Map<string, Set<string>>;
  /** pairKey(a, b) -> edge cyId, registered in both directions. */
  pairEdge: Map<string, string>;
  byType: Map<GraphNodeType, GraphNode[]>;
  /** Cheap content hash — use as a React effect key instead of object identity. */
  signature: string;
}

export const EMPTY_INDEX: GraphIndex = {
  nodes: [],
  nodeById: new Map(),
  edges: [],
  edgeByCyId: new Map(),
  cyIdsFor: new Map(),
  incident: new Map(),
  neighbors: new Map(),
  pairEdge: new Map(),
  byType: new Map(),
  signature: "empty",
};

/** Deterministic 32-bit FNV-1a hash of an id -> [0, 1). Never Math.random(). */
export function hash01(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return ((h >>> 0) % 100000) / 100000;
}

export function pairKey(a: string, b: string): string {
  return `${a}${SEP}${b}`;
}

export function buildIndex(payload: GraphPayload | null | undefined): GraphIndex {
  const rawNodes = Array.isArray(payload?.nodes) ? payload.nodes : [];
  const rawEdges = Array.isArray(payload?.edges) ? payload.edges : [];
  if (rawNodes.length === 0) return { ...EMPTY_INDEX, signature: "empty" };

  const nodeById = new Map<string, GraphNode>();
  const nodes: GraphNode[] = [];
  for (const node of rawNodes) {
    if (!node || typeof node.id !== "string" || !node.id) continue;
    if (nodeById.has(node.id)) continue; // first wins — stable
    nodeById.set(node.id, node);
    nodes.push(node);
  }

  const edges: NormalizedEdge[] = [];
  const edgeByCyId = new Map<string, NormalizedEdge>();
  const cyIdsFor = new Map<string, string[]>();
  const incident = new Map<string, NormalizedEdge[]>();
  const neighbors = new Map<string, Set<string>>();
  const pairEdge = new Map<string, string>();
  const seenDomainEdgeIds = new Set<string>();

  for (const node of nodes) {
    cyIdsFor.set(node.id, [node.id]);
    incident.set(node.id, []);
    neighbors.set(node.id, new Set());
  }

  const register = (edge: GraphEdge, fallbackIndex: number) => {
    if (!edge || typeof edge.source !== "string" || typeof edge.target !== "string") return;
    if (!nodeById.has(edge.source) || !nodeById.has(edge.target)) return; // dangling

    const domainId =
      typeof edge.id === "string" && edge.id
        ? edge.id
        : `${edge.source}->${edge.target}#${fallbackIndex}`;
    if (seenDomainEdgeIds.has(domainId)) return;
    seenDomainEdgeIds.add(domainId);

    // Cytoscape ids must be unique across nodes AND edges.
    const cyId = nodeById.has(domainId) ? `edge${SEP}${domainId}` : domainId;

    const normalized: NormalizedEdge = {
      cyId,
      domainId,
      source: edge.source,
      target: edge.target,
      type: typeof edge.type === "string" ? edge.type : "RELATED",
      properties: edge.properties ?? {},
    };

    edges.push(normalized);
    edgeByCyId.set(cyId, normalized);
    const existing = cyIdsFor.get(domainId);
    if (existing) existing.push(cyId);
    else cyIdsFor.set(domainId, [cyId]);

    incident.get(edge.source)?.push(normalized);
    if (edge.target !== edge.source) incident.get(edge.target)?.push(normalized);
    neighbors.get(edge.source)?.add(edge.target);
    neighbors.get(edge.target)?.add(edge.source);

    if (!pairEdge.has(pairKey(edge.source, edge.target))) {
      pairEdge.set(pairKey(edge.source, edge.target), cyId);
      pairEdge.set(pairKey(edge.target, edge.source), cyId);
    }
  };

  rawEdges.forEach(register);

  const byType = new Map<GraphNodeType, GraphNode[]>();
  for (const node of nodes) {
    const list = byType.get(node.type);
    if (list) list.push(node);
    else byType.set(node.type, [node]);
  }

  const signature = `${nodes.length}:${edges.length}:${hash01(
    `${nodes.map((n) => n.id).join(",")}|${edges.map((e) => e.cyId).join(",")}`,
  ).toFixed(5)}`;

  return {
    nodes,
    nodeById,
    edges,
    edgeByCyId,
    cyIdsFor,
    incident,
    neighbors,
    pairEdge,
    byType,
    signature,
  };
}

/* ------------------------------------------------------------------ */
/* Cytoscape collection helpers                                        */
/* ------------------------------------------------------------------ */

/**
 * `cy.elements()` returns `CollectionReturnValue`, an intersection of three
 * `Collection<...>` instantiations. TypeScript cannot contextually type a
 * callback against that intersection (the parameter collapses to `never`), so
 * every iteration goes through the plain `Collection` view instead.
 */
export function allElements(cy: Core): Collection {
  return cy.elements();
}

/** The elements whose cytoscape ids are in `ids`. Empty input -> empty collection. */
export function collectByIds(cy: Core, ids: Iterable<string>): CollectionReturnValue {
  const set = ids instanceof Set ? (ids as Set<string>) : new Set(ids);
  if (set.size === 0) return cy.collection();
  return allElements(cy).filter((element) => set.has(element.id()));
}

/** Domain id -> cytoscape element ids. Unknown ids yield an empty array. */
export function resolveCyIds(index: GraphIndex, domainId: string): string[] {
  return index.cyIdsFor.get(domainId) ?? [];
}

/** Expands a list of domain ids into a flat, deduped set of cytoscape ids. */
export function resolveAll(index: GraphIndex, domainIds: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const id of domainIds) {
    for (const cyId of resolveCyIds(index, id)) out.add(cyId);
  }
  return out;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

export interface BuildElementsOptions {
  positions: Map<string, { x: number; y: number }>;
}

export function buildElements(
  index: GraphIndex,
  { positions }: BuildElementsOptions,
): ElementDefinition[] {
  const out: ElementDefinition[] = [];

  for (const node of index.nodes) {
    const visual = visualFor(node.type);
    const position = positions.get(node.id) ?? { x: 0, y: 0 };
    out.push({
      group: "nodes",
      data: {
        id: node.id,
        type: node.type,
        label: node.label ?? node.id,
        short: truncate(node.label ?? node.id, 26),
        // `[?showLabel]` in the stylesheet matches truthiness, so only
        // headline types carry a resting label. The rest reveal on hover,
        // selection, or membership of a highlighted path.
        showLabel: visual.alwaysLabel ? 1 : 0,
        degree: index.neighbors.get(node.id)?.size ?? 0,
      },
      position: { ...position },
      selectable: true,
      grabbable: false,
    });
  }

  for (const edge of index.edges) {
    out.push({
      group: "edges",
      data: {
        id: edge.cyId,
        domainId: edge.domainId,
        source: edge.source,
        target: edge.target,
        type: edge.type,
        // CONNECTS / NEAR are physically symmetric, so they get no arrowhead.
        directed: edge.type === "CONNECTS" || edge.type === "NEAR" ? 0 : 1,
      },
      selectable: false,
      grabbable: false,
    });
  }

  return out;
}

/* ------------------------------------------------------------------ */
/* Overview mode                                                       */
/* ------------------------------------------------------------------ */

export interface OverviewOptions {
  focusId: string | null;
  highlightPath: readonly string[];
  backupPath: readonly string[];
  invalidatedIds: readonly string[];
  selectedId: string | null;
  maxNodes: number;
}

/**
 * Picks the family the overview orbits: the first family on the recommended
 * path, else the family implied by the current selection (so an idle panel
 * follows whoever the operator clicked rather than whoever sorts first), else
 * the first family in the payload, else the first node.
 */
export function pickFocusNode(
  index: GraphIndex,
  highlightPath: readonly string[],
  selectedId: string | null = null,
): string | null {
  for (const id of highlightPath) {
    if (index.nodeById.get(id)?.type === "family") return id;
  }

  if (selectedId && index.nodeById.has(selectedId)) {
    if (index.nodeById.get(selectedId)?.type === "family") return selectedId;
    const adjacent = [...(index.neighbors.get(selectedId) ?? [])]
      .filter((id) => index.nodeById.get(id)?.type === "family")
      .sort();
    if (adjacent.length > 0) return adjacent[0];
  }

  const families = index.byType.get("family");
  if (families && families.length > 0) {
    return [...families].sort((a, b) => (a.id < b.id ? -1 : 1))[0].id;
  }
  return index.nodes[0]?.id ?? null;
}

/**
 * Node ids visible in `overview` mode: the focal household, its people and
 * needs, the plan chain (recommended + backup + invalidated), whatever is
 * selected from the map, and one ring of neighbours — capped so a dense
 * network never turns the panel into spaghetti.
 */
export function selectOverview(index: GraphIndex, opts: OverviewOptions): Set<string> {
  const visible = new Set<string>();
  const has = (id: string) => index.nodeById.has(id);
  const add = (id: string) => {
    if (has(id)) visible.add(id);
  };

  const tiers: string[][] = [];

  // Tier 0 — the focal household, its members, and the needs they hold.
  const core: string[] = [];
  if (opts.focusId && has(opts.focusId)) {
    core.push(opts.focusId);
    const members = index.neighbors.get(opts.focusId) ?? new Set<string>();
    for (const member of members) {
      const type = index.nodeById.get(member)?.type;
      if (type === "person" || type === "need" || type === "location" || type === "plan") {
        core.push(member);
        if (type === "person") {
          for (const held of index.neighbors.get(member) ?? []) {
            if (index.nodeById.get(held)?.type === "need") core.push(held);
          }
        }
      }
    }
  }
  tiers.push(core);

  // Tier 1/2/3 — the plan chain, the backup, and anything invalidated.
  tiers.push([...opts.highlightPath]);
  tiers.push([...opts.backupPath]);
  tiers.push(opts.invalidatedIds.filter(has));

  // Tier 4 — external selection (map -> graph sync) plus its immediate ring,
  // so clicking a lattice node on the map always reveals it here.
  if (opts.selectedId && has(opts.selectedId)) {
    tiers.push([opts.selectedId, ...(index.neighbors.get(opts.selectedId) ?? [])]);
  }

  for (const tier of tiers) for (const id of tier) add(id);

  // Tier 5 — threats touching anything already visible; the "why it broke"
  // story is unreadable without them.
  const threats: string[] = [];
  for (const id of visible) {
    for (const other of index.neighbors.get(id) ?? []) {
      const type = index.nodeById.get(other)?.type;
      if (type === "hazard" || type === "alert") threats.push(other);
    }
  }
  threats.sort();
  for (const id of threats) {
    if (visible.size >= opts.maxNodes) break;
    add(id);
  }

  // Tier 6 — one deterministic ring around the chain, budget permitting.
  const ringSeed = [...opts.highlightPath, ...opts.backupPath].filter(has);
  const ring: string[] = [];
  for (const id of ringSeed) {
    for (const other of index.neighbors.get(id) ?? []) {
      if (!visible.has(other)) ring.push(other);
    }
  }
  ring.sort();
  for (const id of ring) {
    if (visible.size >= opts.maxNodes) break;
    add(id);
  }

  return visible;
}
