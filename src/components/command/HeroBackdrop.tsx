import { hazardById, locationById, segmentById, world } from "@/lib/world/world";

/* ---------------------------------------------------------------------------
 * THE DISTRICT PLATE
 * ---------------------------------------------------------------------------
 * The hero backdrop is not decoration: it is the exact world the product
 * reasons about, drawn from src/lib/world/world.ts. Every hairline here is a
 * real (:Segment), every dot a real (:Location), every polygon a real hazard
 * footprint, and the bright line is the baseline recommended route to Patan
 * Relief Center -- literally "the safest path that still exists".
 *
 * Rendered on the server as static SVG: no canvas, no requestAnimationFrame,
 * no client JS. It paints with the first byte and cannot drift from the graph.
 * ------------------------------------------------------------------------- */

type Pt = [number, number];

const { boundary, river, center } = world.district;

/* Equirectangular projection with a cos(lat) correction, matching how the
   MapLibre view foreshortens longitude at ~27.67N. */
const KX = Math.cos((center[1] * Math.PI) / 180);
const projX = (lng: number) => lng * KX;
const projY = (lat: number) => -lat;

const MIN_X = Math.min(...boundary.map(([lng]) => projX(lng)));
const MAX_X = Math.max(...boundary.map(([lng]) => projX(lng)));
const MIN_Y = Math.min(...boundary.map(([, lat]) => projY(lat)));
const MAX_Y = Math.max(...boundary.map(([, lat]) => projY(lat)));

const MARGIN = 44;
const VB_W = 1000;
const SCALE = (VB_W - MARGIN * 2) / (MAX_X - MIN_X);
const VB_H = Math.round((MAX_Y - MIN_Y) * SCALE + MARGIN * 2);

function at(lng: number, lat: number): Pt {
  return [MARGIN + (projX(lng) - MIN_X) * SCALE, MARGIN + (projY(lat) - MIN_Y) * SCALE];
}
const atPair = ([lng, lat]: [number, number]): Pt => at(lng, lat);
const atLoc = (id: string): Pt => {
  const l = locationById.get(id);
  return l ? at(l.lng, l.lat) : [0, 0];
};

function d(points: Pt[], close = false) {
  const body = points.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join("");
  return close ? `${body}Z` : body;
}

/* -- Graticule ----------------------------------------------------------- */
const STEP = 0.005;
const ticks = (lo: number, hi: number) => {
  const out: number[] = [];
  for (let v = Math.ceil(lo / STEP) * STEP; v < hi; v += STEP) out.push(Number(v.toFixed(4)));
  return out;
};
const lngTicks = ticks(Math.min(...boundary.map(([lng]) => lng)), Math.max(...boundary.map(([lng]) => lng)));
const latTicks = ticks(Math.min(...boundary.map(([, lat]) => lat)), Math.max(...boundary.map(([, lat]) => lat)));

/* -- Roads --------------------------------------------------------------- */
const roads = world.segments.map((seg) => {
  const pts: Pt[] = [atLoc(seg.from), ...(seg.via ?? []).map(atPair), atLoc(seg.to)];
  const shut = seg.status === "blocked" || seg.status === "unsafe";
  return {
    id: seg.id,
    d: d(pts),
    shut,
    caution: seg.status === "caution",
    footOnly: seg.accessibility === "foot_only",
    bridge: seg.kind === "Bridge",
  };
});

/* -- The baseline recommendation, walked segment by segment so the drawn line
      is the graph's answer rather than a hand-drawn swoosh. ---------------- */
const ROUTE_SEGMENTS = [
  "seg_riverside_lane",
  "seg_chowk_bend",
  "seg_riverside_road",
  "seg_pumping_patan_gate",
  "seg_patan_gate_relief",
];

const routePts: Pt[] = [];
{
  let cursor = "loc_ward3_home";
  for (const id of ROUTE_SEGMENTS) {
    const seg = segmentById.get(id);
    if (!seg) continue;
    const forward = seg.from === cursor;
    const head = forward ? seg.from : seg.to;
    const tail = forward ? seg.to : seg.from;
    const via = (seg.via ?? []).map(atPair);
    if (!routePts.length) routePts.push(atLoc(head));
    routePts.push(...(forward ? via : [...via].reverse()), atLoc(tail));
    cursor = tail;
  }
}
const ROUTE_D = d(routePts);

/* -- Node classes -------------------------------------------------------- */
const shelterLocIds = new Set(world.shelters.map((s) => s.locationId));
const careLocIds = new Set(world.careSites.map((c) => c.locationId));

/* -- Marginalia: two facts the drawing itself cannot state. Both are derived
      from world.ts, never typed in by hand. ------------------------------- */
const relief = world.shelters.find((s) => s.id === "shelter_patan_relief");
const reliefLoc = relief ? locationById.get(relief.locationId) : undefined;
const forecast = hazardById.get("hz_riverside_flood");

const centroid = (ring: [number, number][]): [number, number] => {
  const uniq = ring.slice(0, -1);
  const lng = uniq.reduce((a, p) => a + p[0], 0) / uniq.length;
  const lat = uniq.reduce((a, p) => a + p[1], 0) / uniq.length;
  return [lng, lat];
};

type Note = { at: Pt; side: "left" | "right"; title: string; body: string };
const notes: Note[] = [];
if (relief && reliefLoc) {
  notes.push({
    at: at(reliefLoc.lng, reliefLoc.lat),
    side: "left",
    title: "Patan Relief Center",
    body: `${relief.capacity - relief.occupancy} of ${relief.capacity} beds free`,
  });
}
if (forecast) {
  notes.push({
    at: atPair(centroid(forecast.footprint)),
    side: "right",
    title: "Riverside corridor",
    body: `flood forecast · ${forecast.blocks.length} roads at risk`,
  });
}

export function HeroBackdrop() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      {/* The plate. Deliberately oversized and anchored off the right edge so it
          bleeds past its own neatline on three sides -- a map sheet cropped by
          the viewport, not a graphic centred in a box. */}
      <div
        className="absolute top-1/2 left-[-16%] w-[132%] -translate-y-1/2 opacity-[0.8] md:left-[26%] md:w-[88%] md:opacity-100"
        style={{ aspectRatio: `${VB_W} / ${VB_H}` }}
      >
        <svg
          viewBox={`0 0 ${VB_W} ${VB_H}`}
          preserveAspectRatio="none"
          className="absolute inset-0 h-full w-full"
          fill="none"
          shapeRendering="geometricPrecision"
        >
          <g vectorEffect="non-scaling-stroke">
            {/* graticule ------------------------------------------------- */}
            <g className="stroke-hairline-soft" strokeWidth={1} vectorEffect="non-scaling-stroke">
              {lngTicks.map((lng) => {
                const [x] = at(lng, 0);
                return <line key={`v${lng}`} x1={x} y1={MARGIN} x2={x} y2={VB_H - MARGIN} vectorEffect="non-scaling-stroke" />;
              })}
              {latTicks.map((lat) => {
                const [, y] = at(0, lat);
                return <line key={`h${lat}`} x1={MARGIN} y1={y} x2={VB_W - MARGIN} y2={y} vectorEffect="non-scaling-stroke" />;
              })}
            </g>

            {/* neatline --------------------------------------------------- */}
            <path
              d={d(boundary.map(atPair), true)}
              className="stroke-hairline-strong"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />

            {/* hazard footprints. Active = filled; armed but not yet live =
                dashed outline only, so "forecast" and "happening" never look
                the same. -------------------------------------------------- */}
            {world.hazards.map((hz) => (
              <path
                key={hz.id}
                d={d(hz.footprint.map(atPair), true)}
                className={hz.active ? "fill-danger/[0.07] stroke-danger/30" : "stroke-warning/30"}
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
                style={hz.active ? undefined : { strokeDasharray: "var(--stroke-dash-caution)" }}
              />
            ))}

            {/* the river -------------------------------------------------- */}
            <path d={d(river.map(atPair))} className="stroke-info/10" strokeWidth={13} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
            <path d={d(river.map(atPair))} className="stroke-info/35" strokeWidth={1.5} strokeLinecap="round" vectorEffect="non-scaling-stroke" />

            {/* roads and bridges ------------------------------------------ */}
            {roads.map((r) => (
              <path
                key={r.id}
                d={r.d}
                className={
                  r.shut
                    ? "stroke-danger/50"
                    : r.caution
                      ? "stroke-warning/40"
                      : r.bridge || r.footOnly
                        ? "stroke-text-data/45"
                        : "stroke-text-data/32"
                }
                strokeWidth={r.bridge ? 1.6 : 1.1}
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
                style={
                  r.shut
                    ? { strokeDasharray: "var(--stroke-dash-blocked)" }
                    : r.footOnly
                      ? { strokeDasharray: "var(--stroke-dash-info)" }
                      : undefined
                }
              />
            ))}

            {/* the recommended route -------------------------------------- */}
            <path d={ROUTE_D} className="stroke-accent/12" strokeWidth={9} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
            <path
              d={ROUTE_D}
              className="stroke-accent/70 motion-reduce:animate-none animate-[dash-flow_5s_linear_infinite]"
              strokeWidth={1.8}
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
              style={{ strokeDasharray: "12 12" }}
            />

            {/* locations -------------------------------------------------- */}
            {world.locations.map((l) => {
              const [x, y] = at(l.lng, l.lat);
              if (shelterLocIds.has(l.id)) {
                return <circle key={l.id} cx={x} cy={y} r={4.5} className="stroke-safe/55" strokeWidth={1.2} vectorEffect="non-scaling-stroke" />;
              }
              if (careLocIds.has(l.id)) {
                return (
                  <g key={l.id} className="stroke-info/50" strokeWidth={1.2} vectorEffect="non-scaling-stroke">
                    <line x1={x - 3.4} y1={y} x2={x + 3.4} y2={y} vectorEffect="non-scaling-stroke" />
                    <line x1={x} y1={y - 3.4} x2={x} y2={y + 3.4} vectorEffect="non-scaling-stroke" />
                  </g>
                );
              }
              return <circle key={l.id} cx={x} cy={y} r={1.6} className="fill-text-data/45" stroke="none" />;
            })}

            {/* leader lines for the two marginal notes -------------------- */}
            {notes.map((n) => (
              <circle
                key={n.title}
                cx={n.at[0]}
                cy={n.at[1]}
                r={9}
                className="stroke-text-tertiary/35"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </g>
        </svg>

        {/* Marginal notes as real HTML so the type is set in CSS pixels and
            stays legible at every plate size. ---------------------------- */}
        {notes.map((n) => (
          <div
            key={n.title}
            className="absolute hidden h-0 w-0 md:block"
            style={{
              left: `${(n.at[0] / VB_W) * 100}%`,
              top: `${(n.at[1] / VB_H) * 100}%`,
            }}
          >
            <div
              className={
                n.side === "left"
                  ? "absolute right-4 bottom-0 w-max pb-1 text-right"
                  : "absolute bottom-0 left-4 w-max pb-1"
              }
            >
              <div className="font-mono text-[10px] tracking-[0.18em] whitespace-nowrap text-text-secondary uppercase">
                {n.title}
              </div>
              <div className="mt-0.5 font-mono text-[10px] tracking-[0.06em] whitespace-nowrap text-text-tertiary">
                {n.body}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Scrims. The type sits left; the plate resolves to the right. ------ */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(97deg, var(--color-surface-base) 0%, var(--color-surface-base) 30%, color-mix(in srgb, var(--color-surface-base) 66%, transparent) 52%, transparent 84%)",
        }}
      />
      <div
        className="absolute inset-0 md:hidden"
        style={{
          background:
            "linear-gradient(180deg, color-mix(in srgb, var(--color-surface-base) 45%, transparent) 0%, color-mix(in srgb, var(--color-surface-base) 80%, transparent) 44%, var(--color-surface-base) 78%)",
        }}
      />
      <div
        className="absolute inset-x-0 top-0 h-[16%]"
        style={{
          background:
            "linear-gradient(180deg, var(--color-surface-base) 0%, color-mix(in srgb, var(--color-surface-base) 60%, transparent) 55%, transparent 100%)",
        }}
      />
      <div
        className="absolute inset-x-0 bottom-0 h-[34%]"
        style={{
          background:
            "linear-gradient(0deg, var(--color-surface-base) 0%, var(--color-surface-base) 14%, color-mix(in srgb, var(--color-surface-base) 78%, transparent) 42%, transparent 100%)",
        }}
      />
    </div>
  );
}
