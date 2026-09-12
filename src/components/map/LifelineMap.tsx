"use client";

/**
 * Lifeline — district map.
 *
 * Renders a FULLY SYNTHETIC vector world built in code from `src/lib/world`.
 * There is no tile server, no sprite sheet and no glyph server: the district is
 * fictional, so a real basemap would draw real streets through our road graph,
 * and the demo has to work with the network unplugged.
 *
 * Consequence you must keep in mind when editing this file: with no `glyphs`
 * URL, `symbol` layers cannot render text or icons. Every label, glyph, badge
 * and hover card here is DOM — maplibre `Marker`s and one React overlay. GL
 * layers do fills, lines and circles only.
 */

import "maplibre-gl/dist/maplibre-gl.css";
import "./lifeline-map.css";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FeatureCollection, Point as GeoPoint } from "geojson";
import type {
  GeoJSONSource,
  Map as MapLibreMap,
  MapMouseEvent,
  Marker as MapLibreMarker,
} from "maplibre-gl";
import type { RouteStep } from "@/lib/types";
import { segmentById, world } from "@/lib/world/world";
import {
  buildBlocked,
  buildHazards,
  centroidOfRing,
  emptyLines,
  emptyPolygons,
  interpolateAlong,
  lineCollection,
  resolveEntityPosition,
  routeCoords,
  type Pos,
} from "./geo";
import {
  CSS_VAR,
  DASH_SEQUENCE,
  INTERACTIVE_LAYERS,
  LYR,
  SRC,
  TOKEN_FALLBACK,
  buildMapStyle,
  resolveTokens,
  type MapTokens,
} from "./style";
import {
  buildStaticMarkers,
  createBlockedMarker,
  createHazardMarker,
  type MarkerSpec,
} from "./markers";
import MapTooltip, {
  describeEntity,
  type DescribeContext,
  type TipState,
} from "./MapTooltip";

/* ------------------------------------------------------------------ */
/* Public contract                                                     */
/* ------------------------------------------------------------------ */

export interface LifelineMapProps {
  /** Segment ids currently impassable — render as red, dashed, with an X/slash pattern. */
  blockedSegmentIds: string[];
  /** Hazard ids currently active — render their footprints. */
  activeHazardIds: string[];
  /** The recommended plan's route, or null. Ordered steps come straight from Neo4j. */
  route: { steps: RouteStep[] } | null;
  /** The responder's pickup leg, drawn in a distinct style (dashed accent). */
  pickupRoute: { steps: RouteStep[] } | null;
  /** Lower-opacity alternative routes. */
  alternatives: { id: string; steps: RouteStep[] }[];
  /** Entity id (location/segment/shelter/volunteer/family/hazard) selected anywhere in the app. */
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Drives animation: 'idle' | 'searching' | 'route-found' | 'route-broken' */
  phase: "idle" | "searching" | "route-found" | "route-broken";
  className?: string;
}

/* ------------------------------------------------------------------ */
/* Timing + easing                                                     */
/* ------------------------------------------------------------------ */

const TRACE_MS = 1400;
const RETRACT_MS = 1000;
const HAZARD_GROW_MS = 1200;
const CAMERA_MS = 900;
const DASH_FRAME_MS = 55;

const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

const PHASE_LABEL: Record<LifelineMapProps["phase"], string> = {
  idle: "Standing by",
  searching: "Traversing graph",
  "route-found": "Route confirmed",
  "route-broken": "Route lost",
};

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

/** MapLibre 6 is WebGL2-only, so probing for `webgl` would be a false positive. */
function hasWebGL2(): boolean {
  if (typeof document === "undefined") return false;
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2"));
  } catch {
    return false;
  }
}

function pointCollection(p: Pos | null): FeatureCollection<GeoPoint> {
  return {
    type: "FeatureCollection",
    features: p
      ? [{ type: "Feature", geometry: { type: "Point", coordinates: p }, properties: {} }]
      : [],
  };
}

function setSourceData(
  map: MapLibreMap | null,
  sourceId: string,
  data: FeatureCollection<never> | FeatureCollection<GeoPoint> | ReturnType<typeof lineCollection> | ReturnType<typeof buildHazards>,
): void {
  if (!map) return;
  try {
    // setData resolves asynchronously via the worker; swallow the rejection that
    // arrives when the style is torn down mid-animation rather than leaking an
    // unhandled promise rejection into the console.
    map.getSource<GeoJSONSource>(sourceId)?.setData(data)?.catch(() => {});
  } catch {
    /* style already gone */
  }
}

function stepsKey(steps: RouteStep[] | null | undefined): string {
  if (!steps?.length) return "";
  return steps.map((s) => `${s.viaSegmentId ?? ""}>${s.locationId}`).join("|");
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return reduced;
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export default function LifelineMap({
  blockedSegmentIds,
  activeHazardIds,
  route,
  pickupRoute,
  alternatives,
  selectedId,
  onSelect,
  phase,
  className,
}: LifelineMapProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const glRef = useRef<typeof import("maplibre-gl") | null>(null);
  const tokensRef = useRef<MapTokens>({ ...TOKEN_FALLBACK });

  const staticMarkersRef = useRef(new Map<string, { marker: MapLibreMarker; spec: MarkerSpec }>());
  const blockedMarkersRef = useRef(new Map<string, MapLibreMarker>());
  const hazardMarkersRef = useRef(new Map<string, MapLibreMarker>());

  const traceRafRef = useRef<number | null>(null);
  const dashRafRef = useRef<number | null>(null);
  const hazardRafRef = useRef<number | null>(null);
  const glowRafRef = useRef<number | null>(null);

  const lastRouteCoordsRef = useRef<Pos[]>([]);
  const prevHazardsRef = useRef<Set<string> | null>(null);
  const hoverFeatureRef = useRef<{ source: string; id: string } | null>(null);
  const selectedFeatureRef = useRef<{ source: string; id: string } | null>(null);

  const [ready, setReady] = useState(false);
  const [fallback, setFallback] = useState(false);
  const [tip, setTip] = useState<TipState | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  const reduced = useReducedMotion();

  /* --- latest props, readable from long-lived map listeners --------- */
  const onSelectRef = useRef(onSelect);
  const routeRef = useRef(route);
  const pickupRef = useRef(pickupRoute);
  const altRef = useRef(alternatives);
  const blockedRef = useRef(blockedSegmentIds);
  const hazardRef = useRef(activeHazardIds);
  const reducedRef = useRef(reduced);

  const blockedSet = useMemo(() => new Set(blockedSegmentIds), [blockedSegmentIds]);
  const hazardSet = useMemo(() => new Set(activeHazardIds), [activeHazardIds]);
  const describeCtxRef = useRef<DescribeContext>({
    blockedSegmentIds: blockedSet,
    activeHazardIds: hazardSet,
  });

  /**
   * Declared BEFORE every other effect, so the map effects below always read
   * current props on the same commit. Map and marker listeners outlive renders
   * and read these refs instead of closing over stale props.
   */
  useEffect(() => {
    onSelectRef.current = onSelect;
    routeRef.current = route;
    pickupRef.current = pickupRoute;
    altRef.current = alternatives;
    blockedRef.current = blockedSegmentIds;
    hazardRef.current = activeHazardIds;
    reducedRef.current = reduced;
    describeCtxRef.current = { blockedSegmentIds: blockedSet, activeHazardIds: hazardSet };
  });

  /* Prop identities churn on every parent render; these keys do not. */
  const blockedKey = blockedSegmentIds.join("|");
  const hazardKey = activeHazardIds.join("|");
  const routeKey = useMemo(() => stepsKey(route?.steps), [route]);
  const pickupKey = useMemo(() => stepsKey(pickupRoute?.steps), [pickupRoute]);
  const altKey = useMemo(
    () => alternatives.map((a) => `${a.id}#${stepsKey(a.steps)}`).join("~"),
    [alternatives],
  );

  /* ---------------------------------------------------------------- */
  /* Animation primitives                                              */
  /* ---------------------------------------------------------------- */

  const cancelRaf = useCallback((ref: React.RefObject<number | null>) => {
    if (ref.current !== null) {
      cancelAnimationFrame(ref.current);
      ref.current = null;
    }
  }, []);

  const paintRoute = useCallback((coords: Pos[], showHead: boolean) => {
    const map = mapRef.current;
    if (!map) return;
    setSourceData(
      map,
      SRC.route,
      coords.length > 1 ? lineCollection([{ id: "route", coords, properties: {} }]) : emptyLines(),
    );
    setSourceData(
      map,
      SRC.routeHead,
      pointCollection(showHead && coords.length ? coords[coords.length - 1] : null),
    );
  }, []);

  const stopDash = useCallback(() => {
    cancelRaf(dashRafRef);
  }, [cancelRaf]);

  /** Flowing dash on top of the traced line — movement, not just a drawn path. */
  const startDash = useCallback(() => {
    if (reducedRef.current || dashRafRef.current !== null) return;
    const map = mapRef.current;
    if (!map) return;
    let last = 0;
    let i = 0;
    const tick = (now: number) => {
      if (now - last > DASH_FRAME_MS) {
        last = now;
        i = (i + 1) % DASH_SEQUENCE.length;
        try {
          map.setPaintProperty(LYR.routeDash, "line-dasharray", DASH_SEQUENCE[i]);
        } catch {
          /* style gone */
        }
      }
      dashRafRef.current = requestAnimationFrame(tick);
    };
    dashRafRef.current = requestAnimationFrame(tick);
  }, []);

  const setRouteTint = useCallback((color: string, glowOpacity: number) => {
    const map = mapRef.current;
    if (!map) return;
    try {
      map.setPaintProperty(LYR.route, "line-color", color);
      map.setPaintProperty(LYR.routeGlow, "line-color", color);
      map.setPaintProperty(LYR.routeGlow, "line-opacity", glowOpacity);
      map.setPaintProperty(LYR.routeHead, "circle-color", color);
    } catch {
      /* style gone */
    }
  }, []);

  /** Draw the line on from the origin, or peel it back off, over `duration`. */
  const runTrace = useCallback(
    (coords: Pos[], reverse: boolean, onDone?: () => void) => {
      cancelRaf(traceRafRef);
      const duration = reverse ? RETRACT_MS : TRACE_MS;
      const start = performance.now();
      const tick = (now: number) => {
        const p = Math.min(1, (now - start) / duration);
        const eased = easeInOutCubic(p);
        paintRoute(interpolateAlong(coords, reverse ? 1 - eased : eased), true);
        if (p < 1) {
          traceRafRef.current = requestAnimationFrame(tick);
        } else {
          traceRafRef.current = null;
          onDone?.();
        }
      };
      traceRafRef.current = requestAnimationFrame(tick);
    },
    [cancelRaf, paintRoute],
  );

  /* ---------------------------------------------------------------- */
  /* Hover + selection plumbing                                        */
  /* ---------------------------------------------------------------- */

  const clearHoverState = useCallback(() => {
    const map = mapRef.current;
    const prev = hoverFeatureRef.current;
    if (map && prev) {
      try {
        map.setFeatureState({ source: prev.source, id: prev.id }, { hover: false });
      } catch {
        /* style gone */
      }
    }
    hoverFeatureRef.current = null;
  }, []);

  const showTipFor = useCallback((id: string, x: number, y: number) => {
    const content = describeEntity(id, describeCtxRef.current);
    setTip(content ? { ...content, x, y } : null);
  }, []);

  /** Markers live in the DOM above the canvas, so they get their own listeners. */
  const attachMarkerEvents = useCallback(
    (spec: MarkerSpec) => {
      const el = spec.el;
      const point = (ev: MouseEvent) => {
        const rect = rootRef.current?.getBoundingClientRect();
        return rect
          ? { x: ev.clientX - rect.left, y: ev.clientY - rect.top }
          : { x: ev.clientX, y: ev.clientY };
      };
      el.addEventListener("mouseenter", (ev) => {
        const { x, y } = point(ev as MouseEvent);
        showTipFor(spec.id, x, y);
      });
      el.addEventListener("mousemove", (ev) => {
        const { x, y } = point(ev as MouseEvent);
        setTip((prev) => (prev && prev.id === spec.id ? { ...prev, x, y } : prev));
      });
      el.addEventListener("mouseleave", () => setTip(null));
      // Stop both, or the canvas-container handlers below also see the click.
      el.addEventListener("mousedown", (ev) => ev.stopPropagation());
      el.addEventListener("click", (ev) => {
        ev.stopPropagation();
        // MapLibre swallows the default focus on pointer-down, so move focus
        // ourselves — otherwise Escape has nowhere to be heard.
        rootRef.current?.focus({ preventScroll: true });
        onSelectRef.current(spec.id);
      });
      el.addEventListener("keydown", (ev) => {
        const key = (ev as KeyboardEvent).key;
        if (key === "Enter" || key === " ") {
          ev.preventDefault();
          ev.stopPropagation();
          onSelectRef.current(spec.id);
        }
      });
    },
    [showTipFor],
  );

  const addMarker = useCallback(
    (spec: MarkerSpec): MapLibreMarker | null => {
      const map = mapRef.current;
      const gl = glRef.current;
      if (!map || !gl) return null;
      const marker = new gl.Marker({ element: spec.el, anchor: spec.anchor, offset: spec.offset })
        .setLngLat(spec.lngLat)
        .addTo(map);
      attachMarkerEvents(spec);
      return marker;
    },
    [attachMarkerEvents],
  );

  /* ---------------------------------------------------------------- */
  /* 1. Map lifecycle                                                  */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;

    // Ref identities are stable for the component's lifetime; copy them so the
    // cleanup below is not reading `.current` after a later render.
    const statics = staticMarkersRef.current;
    const blockedMarkers = blockedMarkersRef.current;
    const hazardMarkers = hazardMarkersRef.current;

    let cancelled = false;
    let created: MapLibreMap | null = null;

    void (async () => {
      try {
        // Probed here rather than in the effect body so the fallback state is
        // never set synchronously during an effect.
        if (!hasWebGL2()) {
          if (!cancelled) setFallback(true);
          return;
        }
        const gl = await import("maplibre-gl");
        // StrictMode double-mounts: the cleanup may already have run.
        if (cancelled) return;
        glRef.current = gl;

        // MapLibre 6 resolves its worker with `new URL('./maplibre-gl-worker.mjs',
        // import.meta.url)`, which Turbopack/webpack do not rewrite — so inside a
        // Next.js bundle that URL 404s. MapLibre does not surface an error for
        // this: GeoJSON sources simply never finish parsing, so the map paints
        // nothing and never fires `load`. `scripts/copy-maplibre-worker.mjs`
        // stages the worker under public/, and we point MapLibre at it here.
        gl.setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");

        const tokens = resolveTokens(rootRef.current ?? surface);
        tokensRef.current = tokens;

        created = new gl.Map({
          container: surface,
          style: buildMapStyle(tokens),
          center: world.district.center,
          zoom: world.district.zoom,
          minZoom: 11,
          maxZoom: 17.5,
          dragRotate: false,
          pitchWithRotate: false,
          maplibreLogo: false,
          reduceMotion: reducedRef.current,
          attributionControl: {
            compact: true,
            customAttribution: "Synthetic district · simulation only",
          },
        });
        mapRef.current = created;

        created.on("error", (e) => {
          // A style/source hiccup must never take the console-of-record down.
          console.warn("[LifelineMap]", e?.error?.message ?? e);
        });

        created.on("mousemove", (e: MapMouseEvent) => {
          const map = mapRef.current;
          if (!map) return;
          const layers = INTERACTIVE_LAYERS.filter((l) => map.getLayer(l));
          const hits = layers.length ? map.queryRenderedFeatures(e.point, { layers }) : [];
          const top = hits[0];
          const id = top ? String(top.id ?? top.properties?.id ?? "") : "";
          const source = top?.source ?? "";

          const prev = hoverFeatureRef.current;
          if (!id) {
            if (prev) clearHoverState();
            setTip(null);
            map.getCanvas().style.cursor = "";
            return;
          }
          if (!prev || prev.id !== id || prev.source !== source) {
            clearHoverState();
            hoverFeatureRef.current = { source, id };
            try {
              map.setFeatureState({ source, id }, { hover: true });
            } catch {
              /* promoteId missing — hover styling simply won't apply */
            }
          }
          map.getCanvas().style.cursor = "pointer";
          showTipFor(id, e.point.x, e.point.y);
        });

        created.on("mouseout", () => {
          clearHoverState();
          setTip(null);
        });

        created.on("click", (e: MapMouseEvent) => {
          const map = mapRef.current;
          if (!map) return;
          rootRef.current?.focus({ preventScroll: true });
          const layers = INTERACTIVE_LAYERS.filter((l) => map.getLayer(l));
          const hits = layers.length ? map.queryRenderedFeatures(e.point, { layers }) : [];
          const top = hits[0];
          const id = top ? String(top.id ?? top.properties?.id ?? "") : "";
          onSelectRef.current(id || null);
        });

        created.once("load", () => {
          if (cancelled) return;
          setReady(true);
        });
      } catch (err) {
        console.warn("[LifelineMap] could not initialise WebGL map", err);
        if (!cancelled) setFallback(true);
      }
    })();

    return () => {
      cancelled = true;
      cancelRaf(traceRafRef);
      cancelRaf(dashRafRef);
      cancelRaf(hazardRafRef);
      cancelRaf(glowRafRef);
      for (const { marker } of statics.values()) marker.remove();
      statics.clear();
      for (const marker of blockedMarkers.values()) marker.remove();
      blockedMarkers.clear();
      for (const marker of hazardMarkers.values()) marker.remove();
      hazardMarkers.clear();
      hoverFeatureRef.current = null;
      selectedFeatureRef.current = null;
      prevHazardsRef.current = null;
      created?.remove();
      if (mapRef.current === created) mapRef.current = null;
      setReady(false);
    };
    // Mount-only: every prop change is handled by the effects below via setData.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------------------------------------------------------------- */
  /* 2. Static markers (places, shelters, clinics, responders, homes)  */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    if (!ready) return;
    const store = staticMarkersRef.current;
    for (const spec of buildStaticMarkers()) {
      const marker = addMarker(spec);
      if (marker) store.set(spec.id, { marker, spec });
    }
    return () => {
      for (const { marker } of store.values()) marker.remove();
      store.clear();
    };
  }, [ready, addMarker]);

  /* ---------------------------------------------------------------- */
  /* 3. Blocked segments: red dashed line + an ✕ at the true midpoint  */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    if (!ready) return;
    const map = mapRef.current;
    const ids = blockedRef.current;
    setSourceData(map, SRC.blocked, buildBlocked(ids));

    const wanted = new Set(ids);
    for (const [id, marker] of blockedMarkersRef.current) {
      if (!wanted.has(id)) {
        marker.remove();
        blockedMarkersRef.current.delete(id);
      }
    }
    for (const id of wanted) {
      if (blockedMarkersRef.current.has(id)) continue;
      const seg = segmentById.get(id);
      if (!seg) continue;
      const spec = createBlockedMarker(seg);
      if (!spec) continue;
      const marker = addMarker(spec);
      if (marker) blockedMarkersRef.current.set(id, marker);
    }
  }, [ready, blockedKey, addMarker]);

  /* ---------------------------------------------------------------- */
  /* 4. Hazards: footprints grow into place when newly activated       */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    if (!ready) return;
    const map = mapRef.current;
    const ids = hazardRef.current;

    // Sync the hazard name plates.
    const wanted = new Set(ids);
    for (const [id, marker] of hazardMarkersRef.current) {
      if (!wanted.has(id)) {
        marker.remove();
        hazardMarkersRef.current.delete(id);
      }
    }
    for (const id of wanted) {
      if (hazardMarkersRef.current.has(id)) continue;
      const hazard = world.hazards.find((h) => h.id === id);
      if (!hazard) continue;
      const at = centroidOfRing(hazard.footprint.map((p) => [p[0], p[1]] as Pos));
      const marker = addMarker(createHazardMarker(hazard, at));
      if (marker) hazardMarkersRef.current.set(id, marker);
    }

    // Anything already active on first paint is pre-existing, not "new".
    const previous = prevHazardsRef.current;
    const fresh = previous === null ? [] : ids.filter((id) => !previous.has(id));
    prevHazardsRef.current = new Set(ids);

    cancelRaf(hazardRafRef);
    if (!fresh.length || reducedRef.current) {
      setSourceData(map, SRC.hazards, ids.length ? buildHazards(ids) : emptyPolygons());
      return;
    }

    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / HAZARD_GROW_MS);
      const k = 0.12 + 0.88 * easeOutCubic(p);
      const scales = new Map(fresh.map((id) => [id, k]));
      setSourceData(map, SRC.hazards, buildHazards(ids, scales));
      hazardRafRef.current = p < 1 ? requestAnimationFrame(tick) : null;
    };
    hazardRafRef.current = requestAnimationFrame(tick);
  }, [ready, hazardKey, addMarker, cancelRaf]);

  /* ---------------------------------------------------------------- */
  /* 5. Recommended route: animated trace, flowing dash, red retract   */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    if (!ready) return;
    const map = mapRef.current;
    if (!map) return;
    const accent = tokensRef.current.accent;
    const danger = tokensRef.current.danger;

    cancelRaf(traceRafRef);

    // The parent usually nulls `route` in the same render that breaks it, so
    // the retract animates the LAST GOOD geometry, not the incoming prop.
    if (phase === "route-broken") {
      stopDash();
      const coords = lastRouteCoordsRef.current;
      setRouteTint(danger, 0.75);
      if (coords.length > 1 && !reducedRef.current) {
        runTrace(coords, true, () => {
          paintRoute([], false);
          setRouteTint(accent, 0.35);
          lastRouteCoordsRef.current = [];
        });
      } else {
        paintRoute([], false);
        setRouteTint(accent, 0.35);
        lastRouteCoordsRef.current = [];
      }
      return;
    }

    setRouteTint(accent, 0.35);
    const coords = routeCoords(routeRef.current?.steps);

    if (coords.length < 2) {
      stopDash();
      paintRoute([], false);
      return;
    }

    lastRouteCoordsRef.current = coords;

    if (reducedRef.current) {
      paintRoute(coords, false);
      return;
    }

    stopDash();
    runTrace(coords, false, () => {
      paintRoute(coords, false);
      startDash();
    });
  }, [ready, routeKey, phase, reduced, cancelRaf, paintRoute, runTrace, setRouteTint, startDash, stopDash]);

  /* ---------------------------------------------------------------- */
  /* 6. Pickup leg + alternatives                                      */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    if (!ready) return;
    const coords = routeCoords(pickupRef.current?.steps);
    setSourceData(
      mapRef.current,
      SRC.pickup,
      coords.length > 1 ? lineCollection([{ id: "pickup", coords, properties: {} }]) : emptyLines(),
    );
  }, [ready, pickupKey]);

  useEffect(() => {
    if (!ready) return;
    const features = altRef.current
      .map((alt) => ({ id: alt.id, coords: routeCoords(alt.steps), properties: { id: alt.id } }))
      .filter((f) => f.coords.length > 1);
    setSourceData(mapRef.current, SRC.alternatives, lineCollection(features));
  }, [ready, altKey]);

  /* ---------------------------------------------------------------- */
  /* 7. Two-way selection sync with the graph view                     */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    if (!ready) return;
    const map = mapRef.current;
    if (!map) return;

    const previous = selectedFeatureRef.current;
    if (previous) {
      try {
        map.setFeatureState({ source: previous.source, id: previous.id }, { selected: false });
      } catch {
        /* style gone */
      }
      selectedFeatureRef.current = null;
    }

    if (selectedId) {
      const source = segmentById.has(selectedId)
        ? SRC.roads
        : world.hazards.some((h) => h.id === selectedId)
          ? SRC.hazards
          : null;
      if (source) {
        try {
          map.setFeatureState({ source, id: selectedId }, { selected: true });
          selectedFeatureRef.current = { source, id: selectedId };
        } catch {
          /* feature not in this source */
        }
      }
    }

    // Marker highlight. Dim the rest only when the selection is itself a marker.
    const markerEls: HTMLElement[] = [
      ...Array.from(staticMarkersRef.current.values()).map((m) => m.spec.el),
      ...Array.from(hazardMarkersRef.current.values()).map((m) => m.getElement()),
      ...Array.from(blockedMarkersRef.current.values()).map((m) => m.getElement()),
    ];
    const selectedIsMarker = markerEls.some((el) => el.dataset.entityId === selectedId);
    for (const el of markerEls) {
      const isSelected = Boolean(selectedId) && el.dataset.entityId === selectedId;
      el.classList.toggle("is-selected", isSelected);
      el.classList.toggle("is-dim", selectedIsMarker && !isSelected);
    }

    // Ease, never jump — the camera move must read as the same map moving.
    const target = resolveEntityPosition(selectedId);
    if (target) {
      map.easeTo({
        center: target,
        duration: reducedRef.current ? 0 : CAMERA_MS,
        essential: true,
      });
    }
  }, [ready, selectedId]);

  /* ---------------------------------------------------------------- */
  /* 8. Phase flourishes                                               */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    if (!ready || phase !== "route-found" || reduced) return;
    const map = mapRef.current;
    if (!map) return;
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / 700);
      try {
        map.setPaintProperty(LYR.routeGlow, "line-opacity", 0.9 - 0.55 * p);
      } catch {
        /* style gone */
      }
      glowRafRef.current = p < 1 ? requestAnimationFrame(tick) : null;
    };
    glowRafRef.current = requestAnimationFrame(tick);
    return () => cancelRaf(glowRafRef);
  }, [ready, phase, reduced, cancelRaf]);

  /* ---------------------------------------------------------------- */
  /* 9. Container size (hover-card edge flipping) + keyboard           */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      setSize({ width: el.clientWidth, height: el.clientHeight });
    });
    ro.observe(el);
    setSize({ width: el.clientWidth, height: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setTip(null);
        onSelectRef.current(null);
      }
    },
    [],
  );

  /* ---------------------------------------------------------------- */
  /* Render                                                            */
  /* ---------------------------------------------------------------- */

  const routeSteps = route?.steps ?? [];
  const pickupSteps = pickupRoute?.steps ?? [];

  return (
    <div
      ref={rootRef}
      className={`lfl-map-root${className ? ` ${className}` : ""}`}
      tabIndex={0}
      role="application"
      aria-label={`${world.district.name} operations map. Press Escape to clear the selection.`}
      onKeyDown={handleKeyDown}
    >
      <div ref={surfaceRef} className="lfl-map-surface" aria-hidden={fallback} />

      {!fallback && phase === "searching" ? <div className="lfl-scan" aria-hidden="true" /> : null}
      {!fallback && phase === "route-broken" ? (
        // Re-mounted on every entry into the phase, which restarts the keyframes.
        <div key="route-broken-flash" className="lfl-flash" aria-hidden="true" />
      ) : null}

      {!fallback ? (
        <div className="lfl-status" data-phase={phase}>
          <span className="lfl-status-dot" aria-hidden="true" />
          {PHASE_LABEL[phase]}
        </div>
      ) : null}

      {!fallback ? <MapTooltip tip={tip} width={size.width} height={size.height} /> : null}

      {fallback ? (
        <MapFallback
          routeSteps={routeSteps}
          pickupSteps={pickupSteps}
          blockedSegmentIds={blockedSegmentIds}
          activeHazardIds={activeHazardIds}
          onSelect={onSelect}
        />
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Fallback — no WebGL2, no crash                                      */
/* ------------------------------------------------------------------ */

function MapFallback({
  routeSteps,
  pickupSteps,
  blockedSegmentIds,
  activeHazardIds,
  onSelect,
}: {
  routeSteps: RouteStep[];
  pickupSteps: RouteStep[];
  blockedSegmentIds: string[];
  activeHazardIds: string[];
  onSelect: (id: string | null) => void;
}) {
  const renderSteps = (steps: RouteStep[]) => (
    <ol className="lfl-fallback-list">
      {steps.map((step, i) => (
        <li className="lfl-fallback-step" key={`${step.locationId}-${i}`}>
          <span className="lfl-fallback-idx">{i + 1}</span>
          <span>
            <button type="button" className="lfl-fallback-btn" onClick={() => onSelect(step.locationId)}>
              {step.locationName}
            </button>
            <span className="lfl-fallback-via">
              {step.viaSegmentName
                ? ` via ${step.viaSegmentName}${step.travelMinutes ? ` · ${step.travelMinutes} min` : ""}`
                : " · origin"}
              {step.inHazardZone ? <span className="lfl-fallback-hazard"> · inside hazard zone</span> : null}
            </span>
          </span>
        </li>
      ))}
    </ol>
  );

  return (
    <div className="lfl-fallback">
      <div className="lfl-fallback-title">{world.district.name}</div>
      <p className="lfl-fallback-note">
        This browser has no WebGL2 context, so the vector map cannot be drawn. The plan itself is
        unaffected — the ordered traversal is listed below.
      </p>

      {pickupSteps.length ? (
        <>
          <div className="lfl-fallback-title">Responder pickup leg</div>
          {renderSteps(pickupSteps)}
        </>
      ) : null}

      <div className="lfl-fallback-title">
        {routeSteps.length ? "Recommended route" : "No route currently recommended"}
      </div>
      {routeSteps.length ? renderSteps(routeSteps) : null}

      <p className="lfl-fallback-note">
        {blockedSegmentIds.length} segment(s) impassable · {activeHazardIds.length} hazard(s) active
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Legend                                                              */
/* ------------------------------------------------------------------ */

const LegendGlyph = ({ children }: { children: React.ReactNode }) => (
  <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true" focusable="false">
    {children}
  </svg>
);

/**
 * Standalone legend. Mirrors the map's rule that status is never colour alone:
 * each entry names the shape, dash pattern or badge that carries the meaning.
 */
export function MapLegend() {
  return (
    <div className="lfl-legend" aria-label="Map legend">
      <div className="lfl-legend-group">
        <div className="lfl-legend-title">Routes</div>
        <div className="lfl-legend-item">
          <span className="lfl-legend-key">
            <span className="lfl-legend-line lfl-legend-line--route" />
          </span>
          <span className="lfl-legend-label">Recommended route (solid, glowing)</span>
        </div>
        <div className="lfl-legend-item">
          <span className="lfl-legend-key">
            <span className="lfl-legend-line lfl-legend-line--pickup" />
          </span>
          <span className="lfl-legend-label">Responder pickup leg (dashed)</span>
        </div>
        <div className="lfl-legend-item">
          <span className="lfl-legend-key">
            <span className="lfl-legend-line lfl-legend-line--alt" />
          </span>
          <span className="lfl-legend-label">Alternative plans (thin, faded)</span>
        </div>
      </div>

      <div className="lfl-legend-group">
        <div className="lfl-legend-title">Network</div>
        <div className="lfl-legend-item">
          <span className="lfl-legend-key">
            <span className="lfl-legend-line lfl-legend-line--road" />
          </span>
          <span className="lfl-legend-label">Road / bridge</span>
        </div>
        <div className="lfl-legend-item">
          <span className="lfl-legend-key">
            <span className="lfl-legend-line lfl-legend-line--foot" />
          </span>
          <span className="lfl-legend-label">Foot only (dotted) — no vehicle</span>
        </div>
        <div className="lfl-legend-item">
          <span className="lfl-legend-key">
            <span className="lfl-legend-line lfl-legend-line--blocked" />
          </span>
          <span className="lfl-legend-label">Impassable (dashed + ✕)</span>
        </div>
        <div className="lfl-legend-item">
          <span className="lfl-legend-key">
            <span className="lfl-legend-line lfl-legend-line--river" />
          </span>
          <span className="lfl-legend-label">River</span>
        </div>
        <div className="lfl-legend-item">
          <span className="lfl-legend-key">
            <span className="lfl-legend-swatch lfl-legend-swatch--hazard" />
          </span>
          <span className="lfl-legend-label">Active hazard footprint (dashed edge)</span>
        </div>
      </div>

      <div className="lfl-legend-group">
        <div className="lfl-legend-title">Places</div>
        <div className="lfl-legend-item">
          <span className="lfl-legend-key lfl-legend-glyph lfl-legend-glyph--family">
            <LegendGlyph>
              <path d="M3 11.2 12 4l9 7.2V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" fill="currentColor" />
            </LegendGlyph>
          </span>
          <span className="lfl-legend-label">Household (pulsing ring)</span>
        </div>
        <div className="lfl-legend-item">
          <span className="lfl-legend-key lfl-legend-glyph lfl-legend-glyph--shelter">
            <LegendGlyph>
              <path
                d="M12 2.6 20 5.4v6.2c0 4.7-3.2 8.6-8 9.8-4.8-1.2-8-5.1-8-9.8V5.4z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
              />
            </LegendGlyph>
          </span>
          <span className="lfl-legend-label">Shelter (with capacity bar)</span>
        </div>
        <div className="lfl-legend-item">
          <span className="lfl-legend-key lfl-legend-glyph lfl-legend-glyph--full">
            <LegendGlyph>
              <path
                d="M12 2.6 20 5.4v6.2c0 4.7-3.2 8.6-8 9.8-4.8-1.2-8-5.1-8-9.8V5.4z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
              />
            </LegendGlyph>
          </span>
          <span className="lfl-legend-label">Shelter at capacity (greyed + FULL)</span>
        </div>
        <div className="lfl-legend-item">
          <span className="lfl-legend-key lfl-legend-glyph lfl-legend-glyph--care">
            <LegendGlyph>
              <path d="M10.3 6.8h3.4v3.5h3.5v3.4h-3.5v3.5h-3.4v-3.5H6.8v-3.4h3.5z" fill="currentColor" />
            </LegendGlyph>
          </span>
          <span className="lfl-legend-label">Clinic (C) / hospital (H)</span>
        </div>
        <div className="lfl-legend-item">
          <span className="lfl-legend-key lfl-legend-glyph lfl-legend-glyph--volunteer">
            <LegendGlyph>
              <path
                d="M2 15V9.5A1.5 1.5 0 0 1 3.5 8H13l3.4 3H20a2 2 0 0 1 2 2v2z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinejoin="round"
              />
              <circle cx="7" cy="16.6" r="2.2" fill="currentColor" />
              <circle cx="17" cy="16.6" r="2.2" fill="currentColor" />
            </LegendGlyph>
          </span>
          <span className="lfl-legend-label">Responder + vehicle</span>
        </div>
        <div className="lfl-legend-item">
          <span className="lfl-legend-key lfl-legend-glyph lfl-legend-glyph--idle">
            <LegendGlyph>
              <path
                d="M2 15V9.5A1.5 1.5 0 0 1 3.5 8H13l3.4 3H20a2 2 0 0 1 2 2v2z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinejoin="round"
              />
              <path d="M3 19 21 5" stroke="currentColor" strokeWidth="1.8" />
            </LegendGlyph>
          </span>
          <span className="lfl-legend-label">Responder unavailable (struck through)</span>
        </div>
      </div>

      <div className="lfl-legend-group">
        <div className="lfl-legend-title">Note</div>
        <div className="lfl-legend-item">
          <span className="lfl-legend-label" style={{ color: CSS_VAR.warn }}>
            Synthetic district — no real basemap, no real emergency.
          </span>
        </div>
      </div>
    </div>
  );
}
