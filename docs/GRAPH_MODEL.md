# Lifeline — Graph Model Reference

The complete Neo4j model: every node label, every relationship, the traversal
patterns that read them, why the physical network is bipartite, and the core
reasoning queries mapped to the files they live in.

Source of truth for the data: [`src/lib/world/world.ts`](../src/lib/world/world.ts).
Source of truth for constraints, indexes and the model rationale:
[`src/lib/neo4j/schema.ts`](../src/lib/neo4j/schema.ts).
Seeded by [`src/lib/neo4j/seed.ts`](../src/lib/neo4j/seed.ts).

---

## 1. At a glance

```
                        ┌──────────┐   HAS_MEMBER   ┌────────┐
                        │  Family  │───────────────▶│ Person │
                        └────┬─────┘                └───┬────┘
                    HAS_NEED │                          │ HAS_NEED
                             ▼                          ▼
                          ┌──────┐◀────────────────┌──────────┐
                          │ Need │    SATISFIES    │ Resource │
                          └──▲───┘                 └────▲─────┘
             CAN_ASSIST /    │    \ SUPPORTS_NEED        │ HAS_RESOURCE
                       /     │     \                     │
             ┌───────────┐   │   ┌─────────┐      ┌──────┴──────┐
             │ Volunteer │───┴──▶│ Vehicle │      │  Shelter /  │
             └─────┬─────┘ HAS_  └─────────┘      │  CareSite   │
                   │      VEHICLE                 └──────┬──────┘
      AVAILABLE_AT │                                     │ LOCATED_AT
                   ▼                                     ▼
              ┌──────────┐        CONNECTS        ┌────────────┐
              │ Location │◀───────────────────────│  Segment   │
              └────┬─────┘◀───────────────────────│ Road|Bridge│
                   │            CONNECTS          └─────┬──────┘
     AFFECTED_BY   │                                    │ BLOCKED_BY
                   ▼                                    ▼
              ┌────────┐                           ┌────────┐
              │ Hazard │◀──────────────────────────│ Hazard │
              └────────┘                           └────────┘

              ┌──────┐  FOR_FAMILY ┌────────┐   USES   Segment | Shelter
              │ Plan │────────────▶│ Family │   ────▶  Volunteer | Vehicle
              └──────┘             └────────┘          CareSite
```

Baseline seed: **20** Locations, **26** Segments (23 Road + 3 Bridge),
**4** Shelters, **4** CareSites (3 Clinic + 1 Hospital), **13** Resources,
**7** Vehicles, **7** Volunteers, **5** Needs, **3** Families, **12** People,
**4** Hazards, **5** `NEAR` pairs. `Alert` and `Plan` are created at runtime.

---

## 2. Node labels

Every label addressed by id carries a uniqueness constraint (`CONSTRAINTS` in
`schema.ts`), which also supplies the index the path enumeration relies on.

### `Location`
A junction, address or site. The *only* node type with coordinates.

| Property | Type | Notes |
|---|---|---|
| `id` | string | unique; `loc_*` |
| `name` | string | display name |
| `lat`, `lng` | float | near 27.67 N / 85.32 E — synthetic |
| `safetyScore` | float `0..1` | baseline terrain safety (elevation-driven) |
| `elevation` | int | metres above the valley floor |
| `zone` | string | `West Bank`, `Ward 3`, `Riverside`, `Patan North`, `Central`, `East Uplands`, `South` |
| `status` | enum | `normal` · `watch` · `evacuating` |

### `Segment` (+ secondary label `Road` or `Bridge`)
**A road or bridge is a NODE.** The secondary label is applied at seed time with
`apoc.create.addLabels(s, [row.kind])`.

| Property | Type | Notes |
|---|---|---|
| `id` | string | unique; `seg_*` |
| `name`, `kind` | string | `kind` ∈ `Road` · `Bridge` |
| `travelMinutes` | int | cost term for `wTime` / `wPickup` |
| `floodRisk` | float `0..1` | **forecast** exposure — *not* a live block |
| `accessibility` | enum | `full` (paved, vehicle + step-free) · `rough` (vehicle, not step-free) · `foot_only` (**no vehicle**) |
| `status` | enum | `open` · `caution` · `unsafe` · `blocked` |
| `baseStatus` | enum | the seeded value; `resetToBaseline()` restores `status` from it |
| `fromId`, `toId` | string | denormalised endpoint ids, for rendering only |

### `Shelter`

| Property | Type | Notes |
|---|---|---|
| `id`, `name` | string | unique; `shelter_*` |
| `capacity`, `occupancy` | int | a household fits only if `occupancy + family.size <= capacity` |
| `baseOccupancy` | int | reset target |
| `wheelchairAccessible` | boolean | hard filter when anyone needs `mobility_assistance` |
| `status` | enum | `open` · `full` · `closed` |

### `CareSite` (+ secondary label `Clinic` or `Hospital`)

| Property | Type | Notes |
|---|---|---|
| `id`, `name` | string | unique; `clinic_*` / `hospital_*` |
| `kind` | string | `Clinic` · `Hospital` |
| `status` | enum | `open` · `limited` · `closed` — `closed` is excluded from matching |

### `Resource`

| Property | Type | Notes |
|---|---|---|
| `id`, `name` | string | unique; `res_*` |
| `type` | enum | `asthma_medication` · `mobility_support` · `shelter_bedding` · `potable_water` · `infant_formula` · `insulin` · `oxygen` |
| `quantity`, `baseQuantity` | int | reset target |
| `status` | enum | `in_stock` · `low` · `out` — `out` is excluded from matching |

### `Vehicle`

| Property | Type | Notes |
|---|---|---|
| `id`, `name` | string | unique; `veh_*` |
| `type` | enum | `van` · `car` · `truck` · `minibus` · `motorbike` |
| `capacity` | int | must be `>= family.size` |
| `wheelchairAccessible` | boolean | required when the household needs `mobility_assistance` |
| `status`, `baseStatus` | enum | `ready` · `in_use` · `maintenance` — only `ready` is usable |

### `Volunteer`

| Property | Type | Notes |
|---|---|---|
| `id`, `name` | string | unique; `vol_*` |
| `status`, `baseStatus` | enum | `available` · `on_task` · `out_of_zone` · `unavailable` — only `available` is usable |
| `skills` | string[] | display only |
| `distanceOutsideZoneKm` | float? | set only for responders staged outside the perimeter; drives the missing-link answer |

### `Need`

| Property | Type | Notes |
|---|---|---|
| `id` | string | unique; `need_*` |
| `kind` | enum | `mobility_assistance` · `asthma_medication` · `transportation` · `shelter` · `infant_formula` (`insulin` and `oxygen` exist in the type union — see [Known gaps](#8-known-gaps)) |
| `label` | string | human sentence used in explanations |
| `critical` | boolean | all five seeded needs are critical |

### `Person` / `Family`

| Label | Properties |
|---|---|
| `Person` | `id`, `name`, `role`, `age` |
| `Family` | `id`, `name`, `size`, `hasVehicle`, `note` |

`hasVehicle = false` is what turns on the transport half of the traversal
(`requireTransport`).

### `Hazard`

| Property | Type | Notes |
|---|---|---|
| `id`, `name` | string | unique; `hz_*` |
| `hazardType` | enum | `flood` · `landslide` · `structural` · `fire` · `debris` |
| `severity` | float `0..1` | display + alert severity |
| `active` | boolean | **the switch every traversal predicate reads** |
| `baseActive` | boolean | seeded value; `resetToBaseline()` restores `active` from it and deletes the edges of anything with `baseActive = false` |
| `description` | string | alert body |
| `footprint` | float[] | the polygon ring flattened to `[lng, lat, lng, lat, …]` for storage |

### `Alert` / `Plan` — runtime only

| Label | Properties |
|---|---|
| `Alert` | `id`, `title`, `body`, `severity`, `issuedAt`, `hazardType` |
| `Plan` | `id`, `familyId`, `status` ∈ `active` · `superseded` · `compromised`, `score`, `destinationId`, `summary`, `createdAt` |

Both are deleted wholesale by `resetToBaseline()`.

---

## 3. Relationship types

`RELATIONSHIP_TYPES` in `schema.ts` is the canonical list.

| Type | Pattern | Properties | Notes |
|---|---|---|---|
| `CONNECTS` | `(Segment)→(Location)` | — | **two per segment**, both pointing *out* of the segment. Always matched **undirected**. |
| `LOCATED_AT` | `(Shelter)→(Location)`, `(CareSite)→(Location)`, `(Family)→(Location)` | — | physical placement |
| `AVAILABLE_AT` | `(Volunteer)→(Location)` | — | staging point; the start of the pickup walk |
| `BLOCKED_BY` | `(Segment)→(Hazard)` | — | **the edge that closes a road.** Present ⇒ the segment is rejected mid-traversal while the hazard is `active` |
| `AFFECTED_BY` | `(Location)→(Hazard)` | — | inside the footprint; each such node on a route costs `wHazardNode` |
| `HAS_MEMBER` | `(Family)→(Person)` | — | household composition |
| `HAS_NEED` | `(Family)→(Need)`, `(Person)→(Need)` | — | household-level *and* person-level; the query unions both |
| `HAS_VEHICLE` | `(Volunteer)→(Vehicle)` | — | one per volunteer |
| `SUPPORTS_NEED` | `(Vehicle)→(Need)` | — | capability |
| `CAN_ASSIST` | `(Volunteer)→(Need)` | — | capability |
| `HAS_RESOURCE` | `(Shelter)→(Resource)`, `(CareSite)→(Resource)` | — | stock on hand |
| `SATISFIES` | `(Resource)→(Need)` | — | what the stock is *for*; matched by `Need.kind`, not by id |
| `NEAR` | `(Location)→(Location)` | `meters` | written in **both** directions at seed time, so it can be traversed as directed |
| `USES` | `(Plan)→(Segment\|Shelter\|Volunteer\|Vehicle\|CareSite)` | — | everything the plan depends on |
| `FOR_FAMILY` | `(Plan)→(Family)` | — | whose plan |
| `AFFECTS` | `(Alert)→(Segment)`, `(Alert)→(Shelter)` | — | what an alert is about |

---

## 4. Why the physical network is bipartite

### The decision

```
(:Location)<-[:CONNECTS]-(:Segment:Road)-[:CONNECTS]->(:Location)
```

not

```
(:Location)-[:ROAD {travelMinutes, floodRisk}]->(:Location)
```

### The reason

A hazard must be able to point **at** a road: `(:Segment)-[:BLOCKED_BY]->(:Hazard)`.

**Neo4j has no relationship-to-node edges.** A relationship's endpoints are
nodes, and nothing can attach to a relationship. So a road modelled as a
relationship could never be:

- the target of a hazard's `BLOCKED_BY`,
- the target of an alert's `AFFECTS`,
- the target of a plan's `USES`.

Every one of those is load-bearing in Lifeline. Without them you need a
side-channel — a set of "currently closed road ids" the router consults
separately. That is a **derived copy of the network**, and the moment it exists
the map, the graph view and the router can disagree about which roads are open.

### What it buys

| | |
|---|---|
| **Blocking a road** | one `MERGE` of a `BLOCKED_BY` edge |
| **Rejecting a road** | a predicate evaluated **during** path expansion, reading the edge directly |
| **Invalidating plans** | a two-hop walk from the hazard: `(Hazard)<-[:BLOCKED_BY]-(Segment)<-[:USES]-(Plan)` |
| **Keeping views in sync** | nothing to sync — there is exactly one representation of the world |

### What it costs

Because both `CONNECTS` edges point *out* of the `Segment`, no directed pattern
can traverse a road. Every journey must be matched **undirected**, and it
alternates node types:

```
Location → Segment → Location → Segment → … → Location
```

Three consequences the queries handle explicitly:

1. **Hop counts double.** A route of *n* segments is *2n* `CONNECTS` hops.
   `WEIGHTS.maxHops = 12` segments is therefore written `*2..24`, and the
   minimum useful walk is `*2..` (one segment).
2. **Walks can revisit places.** An undirected variable-length match will happily
   loop, so every traversal drops paths that repeat a Location:
   ```cypher
   WITH p, [x IN nodes(p) WHERE x:Location] AS locs
   WHERE size(locs) = size(apoc.coll.toSet(locs))
   ```
3. **Metrics come from the node list, not the relationship list.** Travel time
   and risk live on the `Segment` nodes, so they are summed with
   `reduce()` over `[x IN nodes(p) WHERE x:Segment]`.

---

## 5. Traversal patterns

### 5.1 The segment predicate (the safety core)

Reused verbatim for both the family's route and the responder's pickup leg:

```cypher
NOT n:Segment OR (
  n.status <> 'blocked'
  AND NOT exists((n)-[:BLOCKED_BY]->(:Hazard {active: true}))
  AND (requireTransport = false OR n.accessibility <> 'foot_only')
  AND (requireStepFree  = false OR n.accessibility = 'full')
)
```

`NOT n:Segment OR (…)` lets Locations pass untouched, so one `all()` covers a
mixed node list. The four clauses, in order: a manually closed road; a road with
a live hazard edge; a link no vehicle can use when the family must be driven; a
link that is not step-free when someone uses a wheelchair.

### 5.2 Reading the household's needs

Household-level and person-level needs are unioned, then reduced to the three
flags the rest of the query branches on:

```cypher
MATCH (fam:Family {id: $familyId})-[:LOCATED_AT]->(origin:Location)
OPTIONAL MATCH (fam)-[:HAS_MEMBER]->(:Person)-[:HAS_NEED]->(personNeed:Need)
OPTIONAL MATCH (fam)-[:HAS_NEED]->(familyNeed:Need)
WITH fam, origin,
     [n IN collect(DISTINCT personNeed) + collect(DISTINCT familyNeed)
        WHERE n IS NOT NULL] AS needs
WITH fam, origin, needs,
     any(n IN needs WHERE n.kind = 'mobility_assistance')     AS requireStepFree,
     (fam.hasVehicle = false)                                 AS requireTransport,
     [n IN needs WHERE n.kind IN $medicalNeedKinds | n.kind]  AS medicalKinds
```

`$medicalNeedKinds` = `['asthma_medication', 'insulin', 'oxygen', 'infant_formula']`.

### 5.3 Transport feasibility (a traversal, not a lookup)

The pickup leg is itself hazard-aware, which is what makes a cut-off responder
*stop being an option* without anyone changing their status:

```cypher
MATCH (vol:Volunteer)-[:AVAILABLE_AT]->(volLoc:Location)
MATCH (vol)-[:HAS_VEHICLE]->(veh:Vehicle)
WHERE requireTransport = true
  AND vol.status = 'available'
  AND veh.status  = 'ready'
  AND veh.capacity >= fam.size
  AND (requireStepFree = false OR veh.wheelchairAccessible = true)
MATCH pickupPath = (volLoc)-[:CONNECTS*0..12]-(origin)
WHERE all(n IN nodes(pickupPath) WHERE <segment predicate>)
```

`*0..12` allows a zero-length walk — a responder already standing at the
family's location.

### 5.4 Destination filters (structural, before any walking)

```cypher
MATCH (shelter:Shelter)-[:LOCATED_AT]->(destLoc:Location)
WHERE shelter.status <> 'closed'
  AND shelter.occupancy + fam.size <= shelter.capacity
  AND (requireStepFree = false OR shelter.wheelchairAccessible = true)
```

### 5.5 Resource matching through the graph

```
Shelter -[:LOCATED_AT]-> Location -[:NEAR]-> Location <-[:LOCATED_AT]- CareSite
        -[:HAS_RESOURCE]-> Resource -[:SATISFIES]-> Need
```

A care site counts only if it is open, **outside every active hazard
footprint**, and actually stocks something that satisfies a medical need this
household has:

```cypher
OPTIONAL MATCH (destLoc)-[near:NEAR]->(careLoc:Location)<-[:LOCATED_AT]-(care:CareSite)
WHERE care.status <> 'closed'
  AND NOT exists((careLoc)-[:AFFECTED_BY]->(:Hazard {active: true}))
  AND (size(medicalKinds) = 0 OR exists {
        MATCH (care)-[:HAS_RESOURCE]->(r:Resource)-[:SATISFIES]->(need:Need)
        WHERE need.kind IN medicalKinds AND r.status <> 'out'
      })
ORDER BY near.meters ASC
```

Shelters are also checked for on-site stock (`shelter -[:HAS_RESOURCE]->`) —
step-free wards, cots, infant formula.

### 5.6 Scoring and ranking — in Cypher

```cypher
best.pathCost + careCost + headroomCredit + pickupCost AS totalScore
ORDER BY totalScore ASC
```

The application receives rows already sorted safest-first. Weights are
parameters, listed in the [README](../README.md#multi-dimensional-scoring).

---

## 6. The core reasoning queries

Eight questions Lifeline answers by traversal, and where each one lives.

| # | Question | Constant | File |
|:-:|---|---|---|
| **1** | *What is the safest plan that still exists for this household?* — needs, transport feasibility, every hazard-aware walk to every qualifying shelter, resource matching, scoring, ranking | `RECOMMEND_CYPHER` | [`queries/recommend.ts`](../src/lib/neo4j/queries/recommend.ts) |
| **2** | *Why was every other destination rejected?* — `closed` · `at_capacity` · `not_step_free` · `blocked_by_hazard` · `unreachable`, with the count of candidate walks each hazard eliminated | `REJECTED_CYPHER` | [`queries/rejected.ts`](../src/lib/neo4j/queries/rejected.ts) |
| **3** | *Which single relaxed constraint would bring a plan back?* — re-runs feasibility with `relaxStepFree` / `relaxTransport` / `relaxCapacity`, one at a time | `RELAXED_FEASIBILITY_CYPHER` | [`queries/missingLink.ts`](../src/lib/neo4j/queries/missingLink.ts) |
| **4** | *Who would solve the accessible-transport gap, and why can't they?* — every responder with a wheelchair-accessible vehicle who is **not** available, nearest near-miss first | `NEAREST_ACCESSIBLE_RESPONDER_CYPHER` | [`queries/missingLink.ts`](../src/lib/neo4j/queries/missingLink.ts) |
| **5** | *If they truly cannot leave, where is the safest place they can still reach?* — hazard-aware walk to the highest `safetyScore` location outside every footprint | `NEAREST_SAFE_WAIT_POINT_CYPHER` | [`queries/missingLink.ts`](../src/lib/neo4j/queries/missingLink.ts) |
| **6** | *Which active plans did this hazard just break?* — `(Hazard)<-[:BLOCKED_BY]-(Segment)<-[:USES]-(Plan)-[:FOR_FAMILY]->(Family)`, marking them `compromised` | `PLANS_INVALIDATED_BY_HAZARD_CYPHER` | [`queries/plans.ts`](../src/lib/neo4j/queries/plans.ts) |
| **7** | *Explain the chosen plan as an ordered chain of relationships* — need → transport → route → destination → resource, each link a sentence | `EXPLAIN_PLAN_CYPHER` | [`queries/plans.ts`](../src/lib/neo4j/queries/plans.ts) |
| **8** | *What does this hazard ripple into?* — blocked segments, the locations they touch, and the families, responders and shelters at those locations | `HAZARD_RIPPLE_CYPHER` | [`queries/events.ts`](../src/lib/neo4j/queries/events.ts) |

### Supporting statements

| Purpose | Constant | File |
|---|---|---|
| Persist a recommendation as `(:Plan)` and supersede the previous one | `PERSIST_PLAN_CYPHER` | `queries/plans.ts` |
| Any plan depending on something no longer usable (full shelter, stood-down responder, blocked road) | `PLANS_COMPROMISED_CYPHER` | `queries/plans.ts` |
| Activate / deactivate a hazard; close one road from the field | `ACTIVATE_HAZARD_CYPHER`, `DEACTIVATE_HAZARD_CYPHER`, `BLOCK_SEGMENT_CYPHER` | `queries/events.ts` |
| Take a shelter to capacity; change a responder's status | `SET_SHELTER_FULL_CYPHER`, `SET_VOLUNTEER_STATUS_CYPHER` | `queries/events.ts` |
| Project the whole world for the map + graph views | `GRAPH_SNAPSHOT_CYPHER`, `GRAPH_EDGES_CYPHER` | `queries/graphSnapshot.ts` |
| Header counters, read from the graph rather than client state | `SCENARIO_STATE_CYPHER` | `queries/graphSnapshot.ts` |

---

## 7. Constraints, indexes, seeding and reset

### Constraints
Uniqueness on `id` for `Location`, `Segment`, `Shelter`, `Clinic`, `Hospital`,
`Resource`, `Vehicle`, `Volunteer`, `Need`, `Person`, `Family`, `Hazard`,
`Alert`, `Plan`. Each also supplies the backing index that keeps path
enumeration fast.

### Indexes
`Segment.status`, `Hazard.active`, `Volunteer.status`, `Shelter.status`,
`Need.kind`, `Resource.type`, `Plan.familyId`.

### APOC
Required. `apoc.create.addLabels` applies the `Road`/`Bridge` and
`Clinic`/`Hospital` secondary labels at seed time; `apoc.coll.toSet` and
`apoc.coll.flatten` implement the no-doubling-back rule and the blocked-name
rollup. APOC core ships with Neo4j Aura.

### `seedAll()` vs `resetToBaseline()`

| | `seedAll()` (`npm run seed`) | `resetToBaseline()` (`npm run reset`, `POST /api/scenario/reset`) |
|---|---|---|
| Applies constraints + indexes | yes | no |
| Deletes all nodes | yes (batched, to stay inside Aura Free's transaction memory) | no |
| Re-creates the district | yes | no |
| Restores `Segment.status` from `baseStatus` | — | yes |
| Restores `Volunteer` / `Vehicle` status, `Shelter.occupancy`, `Resource.quantity` | — | yes |
| Restores `Hazard.active` from `baseActive` | — | yes |
| Deletes `BLOCKED_BY` / `AFFECTED_BY` edges of non-baseline hazards | — | yes |
| Deletes every `Alert` and `Plan` | — | yes |
| Deletes `hz_bulletin*` / `hz_manual*` hazards created from the field | — | yes |
| Restores `Family.size` / `hasVehicle`, drops intake-added `HAS_NEED` edges and `intake*` properties | — | yes |
| Re-asserts the baseline hazards' blocking edges | — | yes |

The baseline-active hazards are `hz_ward3_flood` (blocks `seg_ward3_riverwalk`)
and `hz_bagmati_scour` (blocks `seg_bagmati_crossing`). `hz_riverside_flood` and
`hz_upper_landslide` are seeded **inactive**, with no edges, and become active
only when the demo fires them.

`resetToBaseline()` restores the seeded **state** and removes the classes of
node and relationship the running demo creates — alerts, plans, field-reported
hazards, and the household needs intake attaches to a `Family`. It does not
rebuild anything the seed itself created, so if the district's structure has
been damaged (a deleted `Segment`, a missing `CONNECTS`) run `npm run seed` for
a guaranteed clean graph.

This matters for the reset guarantee in
[`tests/graph.test.ts`](../tests/graph.test.ts): "identical recommendation after
reset" holds only while every runtime write path has a matching undo here. A new
feature that writes to the graph needs a line in `resetToBaseline()`, or the
second run of a demo starts from a mutated world.

---

## 8. Known gaps

- **`insulin` and `oxygen` have no `Need` node.** `res_insulin_patan` declares
  `satisfies: ["insulin"]` and `res_oxygen_valley` declares
  `satisfies: ["oxygen"]`, but `world.needs` defines neither kind. The seed
  writes `SATISFIES` with `MATCH (r:Resource {id: row.id}), (n:Need {kind: needKind})`,
  so those two rows match nothing and the edges are never created — confirmed
  against the live graph, where both resources have zero `SATISFIES`
  relationships. Since `recommendParams()` lists `insulin` and `oxygen` among
  `medicalNeedKinds`, a household with either need could never be matched to the
  clinic that stocks it. No seeded family has those needs, so no demo outcome
  changes. Pinned by
  [`tests/scoring.test.ts`](../tests/scoring.test.ts) so the orphan set cannot
  grow silently.

- **Pickup walks are shallower than route walks.** The `WEIGHTS.maxHops`
  comment reads *"maximum segments in a route (relationship hops = 2×)"*, and
  the family's route uses `*2..${maxHops * 2}` (24 hops = 12 segments) — but the
  pickup leg uses `*0..${maxHops}` (12 hops = 6 segments). The pickup leg
  therefore searches half the depth the comment implies. Every seeded responder
  is well inside 6 segments, so no demo outcome changes.

- **The `need_mobility` missing-link copy can mislead.** When no plan exists
  because no accessible *vehicle* can reach the family, `diagnoseMissingLinks()`
  also reports `need_mobility` with the text *"the only remaining routes include
  segments a wheelchair cannot use"*. What relaxing `relaxStepFree` actually
  unlocks in that state is the non-accessible truck and minibus, not a different
  road. The primary `need_transport` link, which names the nearest accessible
  responder, is correct.

---

## 9. Reading the model from a live instance

```cypher
// every label and how many of each
MATCH (n) UNWIND labels(n) AS label
RETURN label, count(*) AS count ORDER BY label;

// every relationship type and how many of each
MATCH ()-[r]->() RETURN type(r) AS type, count(r) AS count ORDER BY type;

// what is currently closed, and by what
MATCH (s:Segment)-[:BLOCKED_BY]->(h:Hazard {active: true})
RETURN s.id, s.name, h.id, h.name ORDER BY s.id;

// the whole district network, bipartite
MATCH (a:Location)<-[:CONNECTS]-(s:Segment)-[:CONNECTS]->(b:Location)
WHERE a.id < b.id
RETURN a.name, s.name, s.travelMinutes, s.accessibility, s.status, b.name
ORDER BY s.name;
```
