/**
 * Lifeline — shared domain + API contracts.
 *
 * These types are the integration boundary between the Neo4j graph layer,
 * the route handlers, the map and the graph visualisation. Both the map and
 * the graph render the SAME payload returned by the recommendation API —
 * there is deliberately no second copy of the world on the client.
 */

/* ------------------------------------------------------------------ */
/* Domain primitives                                                   */
/* ------------------------------------------------------------------ */

export type SegmentKind = "Road" | "Bridge";

/** How usable a segment is for a given traveller profile. */
export type Accessibility =
  | "full" // paved, vehicle + step-free
  | "rough" // vehicle passable, not step-free
  | "foot_only"; // pedestrians only — no vehicle may use it

export type SegmentStatus = "open" | "caution" | "unsafe" | "blocked";

export type HazardType = "flood" | "landslide" | "structural" | "fire" | "debris";

export type NeedKind =
  | "mobility_assistance"
  | "asthma_medication"
  | "transportation"
  | "shelter"
  | "infant_formula"
  | "insulin"
  | "oxygen";

export type ResourceType =
  | "asthma_medication"
  | "mobility_support"
  | "shelter_bedding"
  | "potable_water"
  | "infant_formula"
  | "insulin"
  | "oxygen";

export type VolunteerStatus = "available" | "on_task" | "out_of_zone" | "unavailable";

export type VehicleType = "van" | "car" | "truck" | "minibus" | "motorbike";

/* ------------------------------------------------------------------ */
/* World seed entities                                                 */
/* ------------------------------------------------------------------ */

export interface WorldLocation {
  id: string;
  name: string;
  lat: number;
  lng: number;
  /** 0 (dangerous) .. 1 (safe) — baseline terrain safety, e.g. elevation. */
  safetyScore: number;
  /** metres above the valley floor; drives the flood narrative + map relief. */
  elevation: number;
  zone: string;
  status: "normal" | "watch" | "evacuating";
}

export interface WorldSegment {
  id: string;
  name: string;
  kind: SegmentKind;
  /** The two locations this segment physically connects. */
  from: string;
  to: string;
  travelMinutes: number;
  /** 0..1 forecast exposure. NOT the same as an active hazard block. */
  floodRisk: number;
  accessibility: Accessibility;
  status: SegmentStatus;
  /** Optional extra geometry vertices (lng,lat) for a curved road on the map. */
  via?: [number, number][];
}

export interface WorldShelter {
  id: string;
  name: string;
  locationId: string;
  capacity: number;
  occupancy: number;
  wheelchairAccessible: boolean;
  status: "open" | "full" | "closed";
}

export interface WorldCareSite {
  id: string;
  name: string;
  locationId: string;
  kind: "Clinic" | "Hospital";
  status: "open" | "limited" | "closed";
}

export interface WorldResource {
  id: string;
  name: string;
  type: ResourceType;
  quantity: number;
  status: "in_stock" | "low" | "out";
  /** Shelter, clinic or hospital id that holds it. */
  holderId: string;
  /** Need kinds this resource satisfies. */
  satisfies: NeedKind[];
}

export interface WorldVehicle {
  id: string;
  name: string;
  type: VehicleType;
  capacity: number;
  wheelchairAccessible: boolean;
  status: "ready" | "in_use" | "maintenance";
  supportsNeeds: NeedKind[];
}

export interface WorldVolunteer {
  id: string;
  name: string;
  locationId: string;
  status: VolunteerStatus;
  vehicleId: string;
  skills: string[];
  canAssist: NeedKind[];
  /** Set for responders staged outside the response perimeter. */
  distanceOutsideZoneKm?: number;
}

export interface WorldNeed {
  id: string;
  kind: NeedKind;
  label: string;
  critical: boolean;
}

export interface WorldPerson {
  id: string;
  name: string;
  role: string;
  age: number;
  needIds: string[];
}

export interface WorldFamily {
  id: string;
  name: string;
  locationId: string;
  size: number;
  members: WorldPerson[];
  /** Needs held by the household as a whole (transport, shelter). */
  needIds: string[];
  hasVehicle: boolean;
  note: string;
}

export interface WorldHazard {
  id: string;
  name: string;
  hazardType: HazardType;
  severity: number;
  active: boolean;
  description: string;
  /** Segments this hazard makes impassable while active. */
  blocks: string[];
  /** Locations inside the hazard footprint — traversing them is penalised. */
  affects: string[];
  /** GeoJSON-ish polygon ring [lng,lat][] for the map. */
  footprint: [number, number][];
}

export interface WorldNearLink {
  from: string;
  to: string;
  meters: number;
}

export interface World {
  district: {
    name: string;
    subtitle: string;
    center: [number, number];
    zoom: number;
    /** River centreline for the map (lng,lat). */
    river: [number, number][];
    /** District boundary ring. */
    boundary: [number, number][];
  };
  locations: WorldLocation[];
  segments: WorldSegment[];
  shelters: WorldShelter[];
  careSites: WorldCareSite[];
  resources: WorldResource[];
  vehicles: WorldVehicle[];
  volunteers: WorldVolunteer[];
  needs: WorldNeed[];
  families: WorldFamily[];
  hazards: WorldHazard[];
  near: WorldNearLink[];
}

/* ------------------------------------------------------------------ */
/* Graph API payloads (what the map + graph view render)               */
/* ------------------------------------------------------------------ */

export type GraphNodeType =
  | "family"
  | "person"
  | "need"
  | "location"
  | "road"
  | "bridge"
  | "shelter"
  | "clinic"
  | "hospital"
  | "volunteer"
  | "vehicle"
  | "resource"
  | "hazard"
  | "alert"
  | "plan";

export interface GraphNode {
  id: string;
  type: GraphNodeType;
  label: string;
  /** Present for anything with a physical position, so the map can place it. */
  lat?: number;
  lng?: number;
  properties: Record<string, unknown>;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: string;
  properties: Record<string, unknown>;
}

export interface GraphPayload {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/* ------------------------------------------------------------------ */
/* Recommendation contract                                             */
/* ------------------------------------------------------------------ */

/** One ordered step of the traversal, as returned by Cypher. */
export interface RouteStep {
  /** Location the traveller is at after this step. */
  locationId: string;
  locationName: string;
  lat: number;
  lng: number;
  /** The segment used to arrive here (absent for the origin). */
  viaSegmentId?: string;
  viaSegmentName?: string;
  viaSegmentKind?: SegmentKind;
  travelMinutes?: number;
  floodRisk?: number;
  inHazardZone: boolean;
}

export interface ScoreBreakdown {
  total: number;
  travelMinutes: number;
  riskSum: number;
  maxSegmentRisk: number;
  hazardZoneNodes: number;
  pickupMinutes: number;
  capacityHeadroom: number;
  clinicMeters: number | null;
  /** Human-readable contribution of each term, already signed. */
  terms: { label: string; value: number; detail: string }[];
}

export interface TransportPlan {
  volunteerId: string;
  volunteerName: string;
  vehicleId: string;
  vehicleName: string;
  vehicleType: VehicleType;
  wheelchairAccessible: boolean;
  capacity: number;
  stagedAtId: string;
  stagedAtName: string;
  pickupMinutes: number;
  /** Ordered pickup traversal, volunteer staging point -> family. */
  pickupSteps: RouteStep[];
}

export interface DestinationPlan {
  id: string;
  name: string;
  locationId: string;
  locationName: string;
  capacity: number;
  occupancy: number;
  headroom: number;
  wheelchairAccessible: boolean;
}

export interface CareSiteMatch {
  id: string;
  name: string;
  kind: "Clinic" | "Hospital";
  meters: number;
  resources: { id: string; name: string; type: ResourceType; quantity: number }[];
}

export interface PlanCandidate {
  id: string;
  destination: DestinationPlan;
  transport: TransportPlan;
  route: {
    steps: RouteStep[];
    estimatedMinutes: number;
    /** Graph elements of exactly this path — map + graph both render these. */
    nodes: GraphNode[];
    edges: GraphEdge[];
  };
  /**
   * Ordered node ids of the full reasoning chain, family -> need -> responder
   * -> vehicle -> segments/locations -> shelter -> care site -> resource.
   * The graph view lights these sequentially; the order IS the traversal order.
   */
  chain: string[];
  careSite: CareSiteMatch | null;
  /** Need ids this plan satisfies, and those it cannot. */
  needsMet: string[];
  needsUnmet: string[];
  score: ScoreBreakdown;
  reasons: string[];
}

export interface RejectedPath {
  destinationId: string;
  destinationName: string;
  /** Machine reason code, e.g. "blocked_segment", "not_accessible". */
  reasonCode: string;
  reason: string;
  detail: string;
}

export interface MissingLink {
  needId: string;
  needLabel: string;
  /** What kind of thing would unlock a route. */
  missing: string;
  /** Nearest candidate that would satisfy it, if the graph knows one. */
  nearestCandidate?: {
    id: string;
    name: string;
    why: string;
  };
}

export interface RecommendationResponse {
  status: "success" | "no_route";
  familyId: string;
  familyName: string;
  generatedAt: string;
  /** Persisted (:Plan) id — used for invalidation traversal. */
  planId: string | null;
  best: PlanCandidate | null;
  alternatives: PlanCandidate[];
  rejected: RejectedPath[];
  missingLinks: MissingLink[];
  /** Judge-mode telemetry about the actual Cypher that ran. */
  graphTrace: GraphTrace;
  peopleCovered: number;
  criticalNeedsCovered: number;
  criticalNeedsTotal: number;
}

export interface GraphTrace {
  queries: {
    name: string;
    purpose: string;
    cypher: string;
    params: Record<string, unknown>;
    ms: number;
    rows: number;
  }[];
  pathsEnumerated: number;
  pathsSurviving: number;
  nodesTraversed: number;
  relationshipsTraversed: number;
}

/* ------------------------------------------------------------------ */
/* Intake + events                                                     */
/* ------------------------------------------------------------------ */

export interface ExtractedSituation {
  familySize: number;
  needs: NeedKind[];
  constraints: string[];
  reportedHazards: { type: HazardType; target: string }[];
  notes: string[];
  /** "llm" when a model parsed it, "rules" for the deterministic extractor. */
  source: "llm" | "rules";
  confidence: number;
}

export type ScenarioEventKind =
  | "hazard_activate"
  | "segment_block"
  | "shelter_full"
  | "volunteer_unavailable"
  | "reset";

export interface ScenarioEvent {
  kind: ScenarioEventKind;
  targetId: string;
  label: string;
  at: string;
}

export interface ScenarioState {
  activeHazards: { id: string; name: string; hazardType: HazardType; severity: number }[];
  blockedSegments: string[];
  fullShelters: string[];
  unavailableVolunteers: string[];
  counts: {
    activeHazards: number;
    openShelters: number;
    availableVolunteers: number;
    familiesMonitored: number;
  };
  events: ScenarioEvent[];
}
