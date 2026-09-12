/**
 * Public surface of the Live Knowledge Graph panel.
 *
 *   import LifelineGraph, { GraphLegend } from "@/components/graph";
 */

export { default, default as LifelineGraph } from "./LifelineGraph";
export type { LifelineGraphProps, LifelineGraphHandle } from "./LifelineGraph";

export { default as GraphLegend } from "./GraphLegend";
export type { GraphLegendProps } from "./GraphLegend";

export { default as GraphTooltip } from "./GraphTooltip";
export type { GraphTooltipProps } from "./GraphTooltip";

export {
  useTraversalPlayback,
  useImpactRipple,
  buildTraversalHops,
  DEFAULT_HOP_MS,
} from "./useTraversalPlayback";
export type {
  GraphPhase,
  TraversalHop,
  TraversalPlayback,
  UseTraversalPlaybackOptions,
  UseImpactRippleOptions,
} from "./useTraversalPlayback";

export { GRAPH_CLASS, STATE_CLASSES, PLAYBACK_CLASSES, buildStylesheet } from "./stylesheet";
export type { GraphClass } from "./stylesheet";

export { NODE_VISUALS, NODE_TYPES, visualFor } from "./nodeVisuals";
export type { NodeVisual, GraphBand, GraphShape } from "./nodeVisuals";

export { computeLayout } from "./layout";
export { buildIndex, buildElements, selectOverview, pickFocusNode } from "./elements";
export type { GraphIndex } from "./elements";

export { readGraphTokens, CSS_VAR, FALLBACK_TOKENS } from "./tokens";
export type { GraphTokens } from "./tokens";
