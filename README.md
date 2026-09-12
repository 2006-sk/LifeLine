# Lifeline

> **Find the safest path that still exists.**

A graph-native disaster-response system. Lifeline holds a district — roads,
bridges, shelters, clinics, medicine, vehicles, volunteers, households and
hazards — as one connected world inside **Neo4j**, and recomputes a family's
whole escape plan every time any relationship in that world changes.

`Next.js 16` · `React 19` · `TypeScript` · `neo4j-driver 6` · `Neo4j Aura` · `vitest`

> **Simulation environment.** The district, the people and the emergency are
> synthetic. See [Safety and ethics](#safety-and-ethics).

---

## The problem

The Sharma family is in Ward 3 — Riverside Lane. Four people:

| | |
|---|---|
| **Bikash**, 41 · **Rita**, 38 | parents |
| **Nirajan**, 9 | needs **asthma rescue medication** |
| **Kamala**, 71 | needs **wheelchair-level mobility assistance** |
| household | **has no vehicle** |

Floodwater is rising. They do not need more information — they need one answer
that is still true right now. And almost every obvious answer is wrong:

- The **nearest** shelter, Old Market Hall, is **60 / 60 — already full**.
- The **fastest** way out crosses Bagmati Crossing, a 2-minute bridge — and it is
  **closed by pier scour**, and the shelter it leads to, Thapa Ground, is the one
  in the district **without step-free access**.
- The **shortest** link to the hill road, Khola Footbridge, is a genuine
  3-minute connection that **no vehicle can use** — so it silently disappears
  for a family travelling in an accessible van.

A safe plan for the Sharmas is not a shelter, or a road, or a driver. It is all
of these being simultaneously true:

> a road that is **still open**, **and** a responder who can **still reach
> them**, **and** whose vehicle is **wheelchair accessible**, **and** a shelter
> with **room** and **step-free** access, **and** an **inhaler within reach of
> that shelter** — and no active hazard invalidating any link in that chain.

Break one link and the whole plan is worthless. That is not a search problem.
It is a **connectivity** problem.

---

## The solution

Lifeline models the district as a live graph and answers the whole question in
one traversal.

- **Every safety claim is a Cypher result.** The application never decides which
  route is safe; it renders an ordered list of plans that Neo4j found and ranked.
- **Disruptions are graph writes, not UI state.** "Flood Riverside Road" does
  not set a flag the frontend reads — it `MERGE`s
  `(:Segment)-[:BLOCKED_BY]->(:Hazard {active: true})` inside Neo4j. Every
  subsequent traversal sees a different world because *the world changed*.
- **Plans live in the graph too.** A recommendation is persisted as
  `(:Plan)-[:USES]->(...)`, so "which plans did this hazard just break?" is a
  one-hop traversal from the hazard — not a diff computed on a client.
- **It degrades loudly.** There is no offline fallback and no cached route. If
  Neo4j is unreachable the API returns `503 GRAPH_UNAVAILABLE`. An invented safe
  path is worse than no answer.

What the graph returns for the Sharma family at baseline — every value below is
read back from Neo4j, not written by hand:

| | |
|---|---|
| **Destination** | Patan Community Relief Center — 50 spaces free after they arrive, step-free |
| **Responder** | Maya Shrestha, 5 min away at Ward 4 Volunteer Depot |
| **Vehicle** | Accessible Community Van 2 — wheelchair accessible, seats 6 |
| **Route** | Riverside Lane → Riverside Road (Chowk) → Riverside Road (River) → Pumping Station Road → Patan Gate Approach · **21 min** |
| **Medicine** | Patan Health Post, **300 m** from the shelter, 24 salbutamol inhalers in stock |
| **Score** | **38.7** (lower is safer — [breakdown below](#multi-dimensional-scoring)) |

Then Riverside Road floods, and **both halves of the plan change at once**:
the destination becomes Hillcrest School Relief Point *and* the responder
becomes Arun Thapa — because the same flood that severed the corridor also
severed Maya's depot from the family. Nobody marked Maya unavailable. The graph
simply stopped being able to reach her.

---

## Why a graph? Why Neo4j?

**This is the part that matters.**

Traditional disaster tools treat information as isolated records: a shelter
row, a road-closure row, a hospital row, a volunteer row. Each is individually
correct and collectively useless, because **a family's viable escape plan does
not exist inside any of those records. It exists *between* them.**

A route is only useful if:

```
roads remain reachable
  AND required transport exists
    AND that transport satisfies the household's mobility needs
      AND the destination still has capacity
        AND the destination is step-free
          AND the required medicine exists within reach of it
            AND no active hazard invalidates any link in that chain
```

Every `AND` in that list is a **relationship**, not a column. In a relational
model, answering it means a cascade of joins whose depth is not known in
advance, re-run from scratch on every change, against a schema that has no
place to attach "this road is currently impassable *for this traveller*".

In a graph, it is one traversal, and the disruption is one edge.

**Neo4j lets Lifeline continuously traverse and recompute this connected world
whenever any relationship changes.** A hazard activating is a `MERGE` of a
single `BLOCKED_BY` edge; the very next traversal walks a different world, and
the second-order consequences — a responder cut off, an alternative that is
suddenly the best one, a care site that fell inside the footprint — fall out of
the graph on their own. Nobody enumerated them.

> **Neo4j is not used as generic storage.**
> **Core safety-path discovery, dependency traversal, alternative-path discovery
> and impact propagation are graph operations executed against Neo4j.**

Concretely, these are Cypher, not application logic:

| Graph operation | Where it lives | What it decides |
|---|---|---|
| **Safety-path discovery** | `queries/recommend.ts` | Which walks from the family to a shelter survive the live hazard state |
| **Dependency traversal** | `queries/recommend.ts` | `Family → Person → Need`, `Shelter → NEAR → CareSite → HAS_RESOURCE → Resource → SATISFIES → Need` |
| **Alternative-path discovery** | `queries/recommend.ts` | Every surviving destination, ranked — the alternatives are found, not stored |
| **Impact propagation** | `queries/plans.ts`, `queries/events.ts` | Which persisted plans a new hazard just invalidated, and what else it ripples into |
| **Rejection reasoning** | `queries/rejected.ts` | Why every *other* destination was ruled out, counted in candidate walks |
| **Missing-link diagnosis** | `queries/missingLink.ts` | Which single relaxed constraint would bring a plan back |

**If Neo4j disappeared, Lifeline would stop being Lifeline.** It would not
degrade into a slower version of itself — there would be nothing left. The
routing, the ranking, the rejections, the explanation and the impact analysis
are all the same traversal engine wearing different questions.

---

## Architecture

```
 ┌──────────────────────────────────────────────────────────────────────────┐
 │  Natural language  ·  Field updates                                      │
 │  "Water is rising. My grandmother can't walk. We have no car."           │
 │  "Riverside Road is under water."                                        │
 └───────────────────────────────┬──────────────────────────────────────────┘
                                 │
                                 ▼
 ┌──────────────────────────────────────────────────────────────────────────┐
 │  STRUCTURED EXTRACTION                       src/lib/intake/             │
 │  Deterministic rules (primary, offline)  →  needs, constraints, hazards  │
 │  Conservative phrase → entity matching   →  real graph ids, or "unknown" │
 │  Optional LLM supplement may only ADD; it never chooses a route.         │
 └───────────────────────────────┬──────────────────────────────────────────┘
                                 │  writes / reads
                                 ▼
 ┌══════════════════════════════════════════════════════════════════════════┐
 ║  NEO4J AURA                                  src/lib/neo4j/              ║
 ║  Location · Segment(Road|Bridge) · Shelter · CareSite(Clinic|Hospital)   ║
 ║  Resource · Vehicle · Volunteer · Need · Person · Family · Hazard        ║
 ║  Alert · Plan                                                            ║
 ╚═══════════════════════════════┬══════════════════════════════════════════╝
                                 │
                                 ▼
 ┌──────────────────────────────────────────────────────────────────────────┐
 │  GRAPH TRAVERSAL ENGINE                      src/lib/neo4j/queries/      │
 │  hazard-aware variable-length walk  ·  transport feasibility subquery    │
 │  resource matching  ·  multi-dimensional scoring  ·  ORDER BY in Cypher  │
 └───────────────────────────────┬──────────────────────────────────────────┘
                                 │
                                 ▼
 ┌──────────────────────────────────────────────────────────────────────────┐
 │  SAFE PATH  +  ALTERNATIVES  +  REJECTIONS  +  MISSING LINKS             │
 │  best plan · ranked alternatives · why each destination was ruled out    │
 └───────────────────────────────┬──────────────────────────────────────────┘
                                 │
                                 ▼
 ┌──────────────────────────────────────────────────────────────────────────┐
 │  EXPLANATION LAYER                  queries/plans.ts · service/          │
 │  the ordered chain of relationships that has to hold, as sentences       │
 └───────────────────────────────┬──────────────────────────────────────────┘
                                 │  one payload, two renderers
                 ┌───────────────┴───────────────┐
                 ▼                               ▼
 ┌───────────────────────────┐   ┌──────────────────────────────────────────┐
 │  MAP VIEW                 │   │  GRAPH VIEW                              │
 │  MapLibre · district,     │   │  Cytoscape · the same nodes and edges,   │
 │  hazard footprints, route │   │  lit in traversal order                  │
 └───────────────────────────┘   └──────────────────────────────────────────┘
```

The map and the graph render **the same payload**. There is deliberately no
second copy of the world on the client, so the two views cannot disagree about
which roads are open.

---

## The graph model

Seeded from `src/lib/world/world.ts` — the single source of truth for both the
Neo4j seed and the map geometry, so the graph and the map can never drift apart.

### Node labels

| Label | Count | Key properties |
|---|---:|---|
| `Location` | 20 | `id, name, lat, lng, safetyScore, elevation, zone, status` |
| `Segment` + `Road` \| `Bridge` | 26 (23 + 3) | `id, name, kind, travelMinutes, floodRisk, accessibility, status, baseStatus, fromId, toId` |
| `Shelter` | 4 | `id, name, capacity, occupancy, baseOccupancy, wheelchairAccessible, status` |
| `CareSite` + `Clinic` \| `Hospital` | 4 (3 + 1) | `id, name, kind, status` |
| `Resource` | 13 | `id, name, type, quantity, baseQuantity, status` |
| `Vehicle` | 7 | `id, name, type, capacity, wheelchairAccessible, status, baseStatus` |
| `Volunteer` | 7 | `id, name, status, baseStatus, skills, distanceOutsideZoneKm` |
| `Need` | 5 | `id, kind, label, critical` |
| `Person` | 12 | `id, name, role, age` |
| `Family` | 3 | `id, name, size, hasVehicle, note` |
| `Hazard` | 4 | `id, name, hazardType, severity, active, baseActive, description, footprint` |
| `Alert` | runtime | `id, title, body, severity, issuedAt, hazardType` |
| `Plan` | runtime | `id, familyId, status, score, destinationId, summary, createdAt` |

### Relationship types

| Relationship | Direction | Meaning |
|---|---|---|
| `CONNECTS` | `(Segment)→(Location)` ×2 | the two ends of a road or bridge |
| `LOCATED_AT` | `(Shelter\|CareSite\|Family)→(Location)` | where a thing physically is |
| `AVAILABLE_AT` | `(Volunteer)→(Location)` | where a responder is staged |
| `BLOCKED_BY` | `(Segment)→(Hazard)` | **the edge that closes a road** |
| `AFFECTED_BY` | `(Location)→(Hazard)` | inside an active hazard footprint |
| `HAS_MEMBER` | `(Family)→(Person)` | household composition |
| `HAS_NEED` | `(Family\|Person)→(Need)` | what must be satisfied |
| `HAS_VEHICLE` | `(Volunteer)→(Vehicle)` | who drives what |
| `SUPPORTS_NEED` / `CAN_ASSIST` | `(Vehicle\|Volunteer)→(Need)` | capability |
| `HAS_RESOURCE` | `(Shelter\|CareSite)→(Resource)` | stock on hand |
| `SATISFIES` | `(Resource)→(Need)` | what that stock is *for* |
| `NEAR` | `(Location)→(Location)`, both ways, `meters` | "there's a clinic 300 m away" |
| `USES` | `(Plan)→(Segment\|Shelter\|Volunteer\|Vehicle\|CareSite)` | what a plan depends on |
| `FOR_FAMILY` | `(Plan)→(Family)` | whose plan it is |
| `AFFECTS` | `(Alert)→(Segment\|Shelter)` | what an alert is about |

### The key modelling decision: roads are NODES, not relationships

The obvious model is `(:Location)-[:ROAD {minutes, risk}]->(:Location)`. Lifeline
deliberately does not do that.

```
(:Location)<-[:CONNECTS]-(:Segment:Road)-[:CONNECTS]->(:Location)
```

**Why.** A hazard has to be able to point *at* a road:
`(:Segment)-[:BLOCKED_BY]->(:Hazard)`. **Neo4j has no relationship-to-node
edges** — you cannot attach a relationship to another relationship. A road
modelled as a relationship could therefore never be the target of a hazard, an
alert, or a plan's `USES` edge. You would be forced into a shadow table of
"currently closed road ids" that the router consults separately — a derived
copy of the network, and a new way for the map, the graph view and the router
to disagree about which roads are open.

Segment-as-node keeps **one** representation of the world:

- blocking a road is a single `MERGE` of a `BLOCKED_BY` edge;
- the traversal predicate reads that edge **during** path expansion, so a
  blocked road is rejected mid-walk rather than filtered out afterwards;
- `(:Plan)-[:USES]->(:Segment)` makes "which plans did this hazard break?" a
  two-hop traversal from the hazard;
- there is nothing to keep in sync, because there is no second copy.

**The consequence: traversal is an undirected, variable-length walk over a
bipartite `Location`/`Segment` graph.** Because both `CONNECTS` edges point
*out* of the segment, a journey alternates Location → Segment → Location →
Segment → … and must be matched **undirected** (no arrow in the pattern):

```cypher
MATCH routePath = (origin:Location)-[:CONNECTS*2..24]-(destLoc:Location)
```

Two consequences worth knowing: hop counts are **doubled** (a 5-road route is
10 `CONNECTS` hops — `WEIGHTS.maxHops = 12` segments becomes `*2..24`), and
because an undirected variable-length walk can revisit a place, the query drops
any path that does:

```cypher
WITH routePath, [x IN nodes(routePath) WHERE x:Location] AS locs
WHERE size(locs) = size(apoc.coll.toSet(locs))   // no doubling back
```

A deeper reference — every property, every traversal pattern, and the core
reasoning queries mapped to their files — is in
**[docs/GRAPH_MODEL.md](docs/GRAPH_MODEL.md)**.

---

## Setup

**Prerequisites:** Node.js (verified on v26) and a Neo4j instance with **APOC** available.
A free [Neo4j Aura](https://console.neo4j.io) instance is ideal — APOC core is
included, and Lifeline uses `apoc.create.addLabels` in the seed and
`apoc.coll.toSet` / `apoc.coll.flatten` in the traversal queries.

```bash
npm install                       # 1. dependencies
cp .env.example .env.local        # 2. paste your Aura credentials into .env.local
npm run neo4j:init                # 3. constraints + indexes
npm run seed                      # 4. wipe and seed the synthetic district
npm run dev                       # 5. http://localhost:3000
```

Steps 1, 3 and 4 are bundled as **`npm run setup`**.

| Script | What it does |
|---|---|
| `npm run setup` | `npm install` → `neo4j:init` → `seed` |
| `npm run neo4j:init` | Applies the uniqueness constraints and indexes in `schema.ts` |
| `npm run seed` | Wipes the database and re-seeds the district deterministically |
| `npm run reset` | Returns a mid-demo graph to the seeded baseline (no re-seed) |
| `npm run truth` | Prints five scenario states and checks 9 expectations against the live graph |
| `npm run test` | `vitest run` — unit + live-graph integration tests |
| `npm run dev` | Next.js dev server |

Verify the connection at any time: `GET /api/health` returns the Neo4j version,
or `503` with a machine-readable `GRAPH_UNAVAILABLE` code.

### Environment variables

| Variable | Required | Default | Purpose |
|---|:--:|---|---|
| `NEO4J_URI` | **yes** | — | e.g. `neo4j+s://xxxxxxxx.databases.neo4j.io` |
| `NEO4J_USERNAME` | **yes** | — | Aura uses the instance id as the username |
| `NEO4J_PASSWORD` | **yes** | — | from the Aura credentials file |
| `NEO4J_DATABASE` | no | `neo4j` | Aura uses the instance id as the database name |
| `OPENAI_BASE_URL` | no | — | any OpenAI-protocol endpoint (OpenAI, Nebius, OpenRouter, vLLM, Ollama) |
| `OPENAI_API_KEY` | no | — | unset ⇒ the deterministic rule extractor runs alone; the demo is unaffected |
| `OPENAI_MODEL` | no | — | model id for intake parsing only — **never** for routing |
| `MAPBOX_TOKEN` | no | — | optional basemap underlay; the district renders as vectors without it |

There is **no** environment variable that makes Lifeline work without Neo4j.
That is intentional.

---

## Demo workflow

Seven beats. Nothing is scripted playback — each step issues the same API call
the buttons issue, and if the graph disagrees, the demo visibly changes with it.
The in-app **Story Mode** drives five of these automatically.

| # | Scene | Action | What the graph does |
|:-:|---|---|---|
| **1** | **A family asks for help** | Select the Sharma family · *Ask Lifeline* | `Family → Person → Need` is read from the graph: mobility assistance, asthma medication, transport, shelter |
| **2** | **A path that still exists** | — | Every hazard-aware walk to every qualifying shelter is enumerated and ranked. Winner: **Patan Community Relief Center**, driver **Maya Shrestha**, **21 min**, inhalers **300 m** away, score **38.7** |
| **3** | **Show why** | *Show why* | The plan is replayed as an ordered chain of relationships — each one a sentence, each one a link that must hold |
| **4** | **The world changes** | *Flood Riverside Road* | `MERGE (:Segment)-[:BLOCKED_BY]->(:Hazard {active:true})` × 3 segments, `AFFECTED_BY` × 4 locations. The graph is then asked which persisted plans that just broke |
| **5** | **A different path lights up** | — | Re-traversal returns **Hillcrest School Relief Point** *and* **Arun Thapa**. Both halves changed: the flood also severed Maya's depot access road. Score **46.6** |
| **6** | **Pressure, then the missing link** | *Fill the shelter* · *Stand down responders* | Shelters fill and responders drop out until nothing survives. Lifeline stops guessing and names the one missing relationship: **Sunita Lama** has an accessible van but is **3.2 km outside the response zone** |
| **7** | **Reset** | *Reset scenario* | A graph write returns every status to its seeded value and deletes every hazard edge added mid-demo. The recommendation returns **identical** — same destination, same responder, same score |

Every scene above is asserted by [`tests/graph.test.ts`](tests/graph.test.ts);
scenes 2, 5 and 7 are also printed by `npm run truth`.

---

## Example Cypher

Three real excerpts from the codebase.

### 1. The traversal predicate — a road is rejected *while the path is being built*

From `SEGMENT_PREDICATE` in
[`src/lib/neo4j/queries/recommend.ts`](src/lib/neo4j/queries/recommend.ts). One
predicate, reused for both the family's route and the responder's pickup leg:

```cypher
MATCH routePath = (origin)-[:CONNECTS*2..24]-(destLoc)
WHERE all(n IN nodes(routePath) WHERE
        NOT n:Segment OR (
          n.status <> 'blocked'
          AND NOT exists((n)-[:BLOCKED_BY]->(:Hazard {active: true}))
          AND (requireTransport = false OR n.accessibility <> 'foot_only')
          AND (requireStepFree  = false OR n.accessibility = 'full')))
```

A segment is dropped because a `BLOCKED_BY` edge to an **active** hazard exists
— not because a flag was copied somewhere. The same predicate is what makes the
Khola Footbridge disappear for a family travelling by van, and what makes
Maya's depot unreachable after the flood without anyone editing Maya.

### 2. Path metrics — `reduce()` over the traversed segments, inside Neo4j

```cypher
WITH ..., routePath,
     [x IN nodes(routePath) WHERE x:Segment]  AS segs,
     [x IN nodes(routePath) WHERE x:Location] AS locs
WITH ...,
     reduce(t = 0.0, s IN segs | t + s.travelMinutes) AS travelMinutes,
     reduce(t = 0.0, s IN segs | t + s.floodRisk)     AS riskSum,
     reduce(m = 0.0, s IN segs |
            CASE WHEN s.floodRisk > m THEN s.floodRisk ELSE m END) AS maxRisk,
     size([l IN locs WHERE l <> origin
           AND exists((l)-[:AFFECTED_BY]->(:Hazard {active: true}))]) AS hazardNodes
WITH ...,
     (travelMinutes * $wTime)
       + (riskSum     * $wRiskSum)
       + (maxRisk     * $wMaxRisk)
       + (hazardNodes * $wHazardNode) AS pathCost
ORDER BY pathCost ASC
```

The ranking is done by `ORDER BY` in Cypher. The application receives plans
already sorted safest-first and renders them.

### 3. Impact propagation — which plans did this hazard just break?

From [`src/lib/neo4j/queries/plans.ts`](src/lib/neo4j/queries/plans.ts):

```cypher
MATCH (h:Hazard {id: $hazardId})<-[:BLOCKED_BY]-(seg:Segment)<-[:USES]-(plan:Plan)-[:FOR_FAMILY]->(fam:Family)
WHERE plan.status = 'active' AND h.active = true
WITH plan, fam, collect(DISTINCT seg {.id, .name}) AS brokenSegments
SET plan.status = 'compromised'
RETURN plan.id AS planId, fam.id AS familyId, fam.name AS familyName,
       plan.summary AS summary, brokenSegments
```

Because plans are nodes with `USES` edges, invalidation is a **two-hop walk
from the hazard**, and it returns the exact segments that broke — not a boolean.

---

## Multi-dimensional scoring

Lower is safer. Every weight is in `WEIGHTS` in
[`src/lib/neo4j/queries/recommend.ts`](src/lib/neo4j/queries/recommend.ts), passed
into Cypher as parameters, and pinned by
[`tests/scoring.test.ts`](tests/scoring.test.ts) so this table cannot drift from
the code.

| Weight | Value | Applied to |
|---|---:|---|
| `wTime` | **1.0** | per minute the family itself is travelling |
| `wPickup` | **0.6** | per minute a responder needs to reach the family |
| `wRiskSum` | **12.0** | per unit of summed per-segment forecast flood exposure |
| `wMaxRisk` | **10.0** | per unit of the single worst segment on the route |
| `wHazardNode` | **30.0** | **per route node inside an ACTIVE hazard footprint** |
| `wHeadroom` | **−0.25** | credit per free bed at the destination (capped at `headroomCap`) |
| `headroomCap` | **60** | maximum beds that can earn credit |
| `wClinicPer100m` | **1.2** | per 100 m from the shelter to a care site holding the needed medicine |
| `wNoClinic` | **60.0** | flat penalty when a required medical resource has no reachable care site |
| `maxHops` | **12** | maximum segments in a route (⇒ `CONNECTS*2..24`) |

Two properties of this shape are what make the demo behave like a real system
rather than a tuned one:

- `wHazardNode = 30.0` is larger than any plausible time saving, so a route
  through a live footprint can never win on speed alone.
- `floodRisk` is a **forecast**, weighted; `BLOCKED_BY` is a **fact**, absolute.
  A risky-but-open road stays on the table with a penalty; a blocked road is not
  scored at all, because it never survives the traversal.

**The baseline winner, term by term** — this is exactly how `38.7` is built:

| Term | Arithmetic | Contribution |
|---|---|---:|
| Travel time | `21 min × 1.0` | **+21.00** |
| Route flood exposure | `1.55 × 12.0` | **+18.60** |
| Worst single segment | `0.50 × 10.0` | **+5.00** |
| Active hazard zones crossed | `0 × 30.0` | **0.00** |
| Destination capacity | `50 free × −0.25` | **−12.50** |
| Distance to medicine | `300 m ÷ 100 × 1.2` | **+3.60** |
| Responder pickup | `5 min × 0.6` | **+3.00** |
| | | **= 38.70** |

And the same arithmetic after Riverside Road floods, for the route that wins
instead: `25 + (0.85 × 12) + (0.50 × 10) + 0 − (20 × 0.25) + (600÷100 × 1.2) +
(7 × 0.6)` = **46.6**. The flooded corridor's own best surviving route to Patan
scores **73.1**, because it now crosses one node inside the active footprint —
a single `+30.0` term, contributed by the graph.

---

## API surface

All routes are server-side and hit Neo4j directly. Failures return
`503 GRAPH_UNAVAILABLE` rather than a fabricated answer.

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/api/health` | Neo4j connectivity + version |
| `GET` | `/api/graph` | The whole world as `{nodes, edges}` for the graph view |
| `GET` | `/api/scenario` | Live counters, active hazards, blocked segments, district geometry |
| `POST` | `/api/scenario/reset` | Return the graph to the seeded baseline |
| `GET` | `/api/recommendation/[familyId]` | Recommendation without persisting a `(:Plan)` |
| `POST` | `/api/route/recommend` | `{ familyId, persist? }` — recommend; **persists a `(:Plan)` by default**, pass `persist: false` to skip |
| `GET` | `/api/explanation/[planId]` | The ordered chain of relationships behind a persisted plan |
| `POST` | `/api/events/hazard` | `{ hazardId, active? }` — activate/deactivate a hazard |
| `POST` | `/api/events/road-block` | `{ segmentId }` — close one road from the field |
| `POST` | `/api/events/shelter-full` | `{ shelterId }` — take a shelter to capacity |
| `POST` | `/api/events/volunteer` | `{ volunteerId, status? }` — stand a responder down |
| `POST` | `/api/intake` | `{ familyId, text?, structured? }` — parse a household's situation and write its needs onto the graph |
| `POST` | `/api/bulletin` | `{ text }` — turn a free-text field update into controlled graph writes, returning a structured diff |

---

## Testing

```bash
npx vitest run tests/      # everything
npm run test               # same, via package.json
npm run truth              # five scenario states + 9 expectations, printed
```

| File | Kind | Covers |
|---|---|---|
| [`tests/scoring.test.ts`](tests/scoring.test.ts) | **pure**, no database | Referential integrity of `world.ts` (every `from`/`to`, `locationId`, `holderId`, `vehicleId`, `needId`, hazard `blocks`/`affects` and `NEAR` endpoint resolves), network connectivity, the accessibility traps the demo depends on, value ranges, and the published scoring weights |
| [`tests/graph.test.ts`](tests/graph.test.ts) | **integration**, live Neo4j Aura | The eight safety guarantees below, plus the second-order effect |

`tests/graph.test.ts` runs against the real Aura instance. It calls
`resetToBaseline()` in `beforeEach` and again in `afterAll`, so every test starts
from the deterministic seeded state and the suite is safe to run repeatedly.
Disruptions are applied through the **same service functions the API routes
call**, so the tests exercise the production path.

What it guarantees:

1. **A blocked road never appears in a returned safe route** — after the flood,
   no plan's route *or pickup leg* touches `seg_chowk_bend`,
   `seg_riverside_road` or `seg_depot_chowk_link`, and neither does anything the
   map draws.
2. **An inaccessible shelter is rejected** — `shelter_thapa_ground` is never a
   destination for the Sharmas, and appears in `rejected` with
   `reasonCode: 'not_step_free'`.
3. **A shelter at capacity is rejected** — `shelter_market_hall` is
   `at_capacity` at baseline; filling `shelter_patan_relief` removes it from
   every plan.
4. **Removing the recommended road produces a different viable route** — the
   best destination moves from Patan Community Relief Center to Hillcrest School
   Relief Point.
5. **An unavailable volunteer is never used** — standing Maya down moves the
   plan to Arun Thapa, and Maya appears in no plan.
6. **A required medical resource is satisfied** — the winning plan's care site
   stocks `asthma_medication`, and so does every alternative offered.
7. **A no-route scenario identifies the unmet link** — with both accessible
   responders down, the response is `no_route` with a `need_transport` missing
   link naming Sunita Lama, 3.2 km outside the zone.
8. **Reset restores deterministic state** — after three separate disruptions,
   `resetToBaseline()` reproduces the baseline recommendation exactly: same
   destination, same responder, same score, same road list.
9. **Second-order effect** — the flood changes the destination **and** the
   responder, because it severs Maya's depot: `stagedAtId` moves from
   `loc_ward4_depot` to `loc_south_transit_yard`.

`vitest.config.ts` maps the `@/…` alias to `./src`, loads `.env.local` via
`tests/setup.ts`, uses a 30 s timeout for the remote instance, and disables
parallelism — the graph is shared, mutable state, and two files mutating it at
once would make `resetToBaseline()` meaningless.

---

## Project layout

```
src/
  app/api/…                    route handlers — thin; all reasoning is in Cypher
  lib/
    world/world.ts             the synthetic district — one source of truth
    neo4j/
      client.ts                driver, GraphUnavailableError, no offline fallback
      schema.ts                constraints, indexes, and the model rationale
      seed.ts                  seedAll() · resetToBaseline()
      queries/
        recommend.ts           THE core traversal + WEIGHTS
        rejected.ts            why every other destination was ruled out
        missingLink.ts         which single relaxed constraint restores a plan
        plans.ts               persist · invalidate · explain
        events.ts              disruptions as graph writes
        graphSnapshot.ts       the whole world as {nodes, edges}
    service/                   recommendation.ts · scenario.ts · api.ts
    intake/                    deterministic extraction — pure, no Neo4j
  components/                  map (MapLibre) · graph (Cytoscape) · command centre
scripts/                       init-neo4j · seed-demo · reset-demo · truth-table
tests/                         scoring.test.ts (pure) · graph.test.ts (live graph)
docs/                          GRAPH_MODEL.md
```

---

## Screenshots

> Place images at these paths; the links below will resolve.

| | |
|---|---|
| **Command centre — baseline plan** | ![Command centre showing the baseline recommendation](docs/screenshots/01-baseline.png) |
| **Map — route, hazard footprints, district** | ![Map view with the safe route drawn over the district](docs/screenshots/02-map-route.png) |
| **Graph view — the reasoning chain** | ![Graph view lighting the traversal in order](docs/screenshots/03-graph-chain.png) |
| **After the flood — a different path and a different responder** | ![The recomputed plan after Riverside Road floods](docs/screenshots/04-after-flood.png) |
| **Missing link — the one relationship that would restore a plan** | ![No-route state naming the missing accessible responder](docs/screenshots/05-missing-link.png) |
| **Judge panel — the Cypher that actually ran** | ![Graph trace showing executed queries and timings](docs/screenshots/06-graph-trace.png) |

---

## Safety and ethics

**Lifeline is decision-support for coordination. It is not an authoritative
emergency service.**

- **All data is synthetic.** The district, the households, the volunteers, the
  clinics and the hazards in `src/lib/world/world.ts` are invented for
  simulation. Coordinates sit near 27.67 N / 85.32 E only so that map
  projection, scale bars and distance arithmetic behave realistically. Nothing
  here describes a real emergency, real infrastructure, or real people.
- **Not a routing authority.** Travel times, flood risks and road statuses are
  simulation values. They are not survey data, not live sensor feeds, and not a
  substitute for on-the-ground assessment.
- **Follow official emergency instructions.** Where guidance from Lifeline and
  guidance from an emergency authority differ, the authority is correct.
- **In life-threatening danger, call your local emergency services.** Do not
  wait for a tool.
- **Human in the loop, always.** Lifeline is built to explain itself — every
  recommendation exposes the chain of relationships it depends on and the
  reasons other options were rejected — precisely so a coordinator can overrule
  it. A recommendation is a starting point for a decision a person makes.
- **The LLM never decides anything safety-critical.** It is used only to parse
  free text into a validated schema, and only as a supplement to a
  deterministic rule extractor. Routing, ranking and rejection are Neo4j.
- **No real personal data.** Do not paste real names, addresses, medical details
  or contact information into the intake box in a demo environment.
