import type { World } from "@/lib/types";

/**
 * ---------------------------------------------------------------------------
 * LIFELINE — SYNTHETIC DISTRICT DATASET
 * ---------------------------------------------------------------------------
 * This is a FICTIONAL district inspired by the Kathmandu valley. Every
 * location, road, shelter, clinic, volunteer and hazard below is invented for
 * simulation. Nothing here describes a real emergency, real infrastructure or
 * real people. Coordinates sit near 27.67N / 85.32E only so that map
 * projection, scale bars and distance maths behave realistically.
 *
 * This module is the single source of truth for the seed script AND the map
 * geometry, so the graph and the map can never drift apart.
 *
 * ---------------------------------------------------------------------------
 * TOPOLOGY DESIGN NOTES (why the demo is deterministic without being faked)
 * ---------------------------------------------------------------------------
 * The scripted outcomes are PROPERTIES OF THE GRAPH, not hardcoded answers:
 *
 *  - Baseline winner is Patan Relief Center. It is 4 minutes closer than the
 *    hill option, has 3x the free capacity and a clinic 300m away instead of
 *    600m. Those advantages outweigh the riverside corridor's higher forecast
 *    flood risk -- while that risk is only a forecast.
 *
 *  - When hz_riverside_flood activates it blocks THREE segments that together
 *    form the Riverside Road corridor, and marks four locations as inside the
 *    flood footprint. Two things then fall out of the graph at once:
 *      (a) Patan is only reachable via the inland Market -> Ring Road detour,
 *          which must pass through Patan Gate -- a node inside the footprint;
 *      (b) Volunteer Maya's depot is severed from the family entirely, so the
 *          transport half of the plan dies too, not just the road half.
 *    The replacement plan therefore changes BOTH its road and its responder.
 *
 *  - seg_bagmati_crossing is the deceptive shortcut: 9 minutes end-to-end,
 *    less than half of any viable option, but the bridge is scoured (blocked)
 *    AND it leads to the one shelter without step-free access.
 *
 *  - seg_khola_footbridge is the accessibility trap: a genuine 3 minute link
 *    to Hill Road that no vehicle can use, so it silently disappears for a
 *    family travelling by accessible van.
 *
 *  - shelter_market_hall is already at capacity at baseline, so the "full
 *    shelter" rejection reason is visible before any button is pressed.
 * ---------------------------------------------------------------------------
 */

const L = {
  westBankRoad: "loc_west_bank_road",
  thapaGround: "loc_thapa_ground",
  ward3Home: "loc_ward3_home",
  ward3Chowk: "loc_ward3_chowk",
  ward3South: "loc_ward3_south",
  riversideBend: "loc_riverside_bend",
  pumpingStation: "loc_pumping_station",
  patanGate: "loc_patan_gate",
  patanRelief: "loc_patan_relief",
  patanHealth: "loc_patan_health",
  marketSquare: "loc_market_square",
  ringRoadEast: "loc_ring_road_east",
  hillRoadBase: "loc_hill_road_base",
  upperTerrace: "loc_upper_terrace",
  hillcrestSchool: "loc_hillcrest_school",
  eastWardClinic: "loc_east_ward_clinic",
  eastRidge: "loc_east_ridge",
  valleyHospital: "loc_valley_hospital",
  ward4Depot: "loc_ward4_depot",
  southTransitYard: "loc_south_transit_yard",
} as const;

export const world: World = {
  district: {
    name: "Bagmati West — Synthetic District",
    subtitle: "Simulation environment · not a live emergency feed",
    center: [85.3205, 27.6685],
    zoom: 13.4,
    river: [
      [85.3012, 27.6812],
      [85.3062, 27.6760],
      [85.3088, 27.6714],
      [85.3094, 27.6668],
      [85.3076, 27.6620],
      [85.3040, 27.6572],
      [85.2996, 27.6528],
    ],
    boundary: [
      [85.2930, 27.6880],
      [85.3440, 27.6880],
      [85.3470, 27.6520],
      [85.2930, 27.6500],
      [85.2930, 27.6880],
    ],
  },

  /* --------------------------------------------------------------- */
  /* Locations                                                        */
  /* --------------------------------------------------------------- */
  locations: [
    { id: L.westBankRoad, name: "West Bank Road", lat: 27.6690, lng: 85.3040, safetyScore: 0.45, elevation: 8, zone: "West Bank", status: "watch" },
    { id: L.thapaGround, name: "Thapa Ground", lat: 27.6705, lng: 85.2995, safetyScore: 0.55, elevation: 12, zone: "West Bank", status: "normal" },
    { id: L.ward3Home, name: "Ward 3 — Riverside Lane", lat: 27.6640, lng: 85.3120, safetyScore: 0.30, elevation: 4, zone: "Ward 3", status: "evacuating" },
    { id: L.ward3Chowk, name: "Ward 3 Chowk", lat: 27.6658, lng: 85.3158, safetyScore: 0.50, elevation: 9, zone: "Ward 3", status: "watch" },
    { id: L.ward3South, name: "Ward 3 South Lane", lat: 27.6608, lng: 85.3140, safetyScore: 0.52, elevation: 10, zone: "Ward 3", status: "watch" },
    { id: L.riversideBend, name: "Riverside Bend", lat: 27.6700, lng: 85.3178, safetyScore: 0.38, elevation: 6, zone: "Riverside", status: "watch" },
    { id: L.pumpingStation, name: "Pumping Station Corner", lat: 27.6738, lng: 85.3208, safetyScore: 0.42, elevation: 7, zone: "Riverside", status: "watch" },
    { id: L.patanGate, name: "Patan Gate", lat: 27.6768, lng: 85.3238, safetyScore: 0.62, elevation: 14, zone: "Patan North", status: "normal" },
    { id: L.patanRelief, name: "Patan Relief Center", lat: 27.6790, lng: 85.3266, safetyScore: 0.88, elevation: 22, zone: "Patan North", status: "normal" },
    { id: L.patanHealth, name: "Patan Health Post", lat: 27.6782, lng: 85.3292, safetyScore: 0.86, elevation: 21, zone: "Patan North", status: "normal" },
    { id: L.marketSquare, name: "Old Market Square", lat: 27.6672, lng: 85.3236, safetyScore: 0.70, elevation: 16, zone: "Central", status: "normal" },
    { id: L.ringRoadEast, name: "Ring Road East Junction", lat: 27.6700, lng: 85.3298, safetyScore: 0.74, elevation: 18, zone: "Central", status: "normal" },
    { id: L.hillRoadBase, name: "Hill Road Base", lat: 27.6636, lng: 85.3212, safetyScore: 0.76, elevation: 24, zone: "East Uplands", status: "normal" },
    { id: L.upperTerrace, name: "Upper Terrace", lat: 27.6618, lng: 85.3272, safetyScore: 0.90, elevation: 48, zone: "East Uplands", status: "normal" },
    { id: L.hillcrestSchool, name: "Hillcrest Community School", lat: 27.6606, lng: 85.3322, safetyScore: 0.94, elevation: 61, zone: "East Uplands", status: "normal" },
    { id: L.eastWardClinic, name: "East Ward Clinic", lat: 27.6624, lng: 85.3350, safetyScore: 0.92, elevation: 58, zone: "East Uplands", status: "normal" },
    { id: L.eastRidge, name: "East Ridge Road", lat: 27.6674, lng: 85.3352, safetyScore: 0.89, elevation: 52, zone: "East Uplands", status: "normal" },
    { id: L.valleyHospital, name: "Valley General Hospital", lat: 27.6730, lng: 85.3378, safetyScore: 0.93, elevation: 44, zone: "East Uplands", status: "normal" },
    { id: L.ward4Depot, name: "Ward 4 Volunteer Depot", lat: 27.6684, lng: 85.3166, safetyScore: 0.44, elevation: 7, zone: "Riverside", status: "watch" },
    { id: L.southTransitYard, name: "South Transit Yard", lat: 27.6580, lng: 85.3168, safetyScore: 0.72, elevation: 19, zone: "South", status: "normal" },
  ],

  /* --------------------------------------------------------------- */
  /* Segments — roads and bridges. These become (:Segment) nodes with  */
  /* two [:CONNECTS] relationships each, so hazards can attach to them */
  /* and traversal predicates can reject them mid-path.                */
  /* --------------------------------------------------------------- */
  segments: [
    { id: "seg_riverside_lane", name: "Riverside Lane", kind: "Road", from: L.ward3Home, to: L.ward3Chowk, travelMinutes: 3, floodRisk: 0.50, accessibility: "full", status: "caution" },
    { id: "seg_ward3_south_lane", name: "Ward 3 South Lane", kind: "Road", from: L.ward3Home, to: L.ward3South, travelMinutes: 3, floodRisk: 0.45, accessibility: "full", status: "open" },
    { id: "seg_chowk_bend", name: "Riverside Road — Chowk Section", kind: "Road", from: L.ward3Chowk, to: L.riversideBend, travelMinutes: 4, floodRisk: 0.30, accessibility: "full", status: "open", via: [[85.3172, 27.6674]] },
    { id: "seg_riverside_road", name: "Riverside Road — River Section", kind: "Road", from: L.riversideBend, to: L.pumpingStation, travelMinutes: 6, floodRisk: 0.35, accessibility: "full", status: "open", via: [[85.3196, 27.6722]] },
    { id: "seg_pumping_patan_gate", name: "Pumping Station Road", kind: "Road", from: L.pumpingStation, to: L.patanGate, travelMinutes: 5, floodRisk: 0.25, accessibility: "full", status: "open" },
    { id: "seg_patan_gate_relief", name: "Patan Gate Approach", kind: "Road", from: L.patanGate, to: L.patanRelief, travelMinutes: 3, floodRisk: 0.15, accessibility: "full", status: "open" },
    { id: "seg_relief_health_path", name: "Relief Center Link", kind: "Road", from: L.patanRelief, to: L.patanHealth, travelMinutes: 2, floodRisk: 0.10, accessibility: "full", status: "open" },
    { id: "seg_bagmati_crossing", name: "Bagmati Crossing", kind: "Bridge", from: L.ward3Chowk, to: L.westBankRoad, travelMinutes: 2, floodRisk: 0.60, accessibility: "full", status: "unsafe" },
    { id: "seg_west_bank_road", name: "West Bank Road", kind: "Road", from: L.westBankRoad, to: L.thapaGround, travelMinutes: 4, floodRisk: 0.45, accessibility: "rough", status: "open" },
    { id: "seg_market_link", name: "Market Link Road", kind: "Road", from: L.ward3Chowk, to: L.marketSquare, travelMinutes: 5, floodRisk: 0.30, accessibility: "full", status: "open", via: [[85.3196, 27.6664]] },
    { id: "seg_market_ring", name: "Market Ring Road", kind: "Road", from: L.marketSquare, to: L.ringRoadEast, travelMinutes: 5, floodRisk: 0.25, accessibility: "full", status: "open" },
    { id: "seg_ring_north_link", name: "Ring Road North Link", kind: "Road", from: L.ringRoadEast, to: L.patanGate, travelMinutes: 7, floodRisk: 0.45, accessibility: "full", status: "open", via: [[85.3286, 27.6748]] },
    { id: "seg_hill_road_lower", name: "Hill Road — Lower", kind: "Road", from: L.ward3Chowk, to: L.hillRoadBase, travelMinutes: 6, floodRisk: 0.20, accessibility: "full", status: "open", via: [[85.3186, 27.6640]] },
    { id: "seg_hill_road_upper", name: "Hill Road — Upper", kind: "Road", from: L.hillRoadBase, to: L.upperTerrace, travelMinutes: 9, floodRisk: 0.10, accessibility: "full", status: "open", via: [[85.3244, 27.6620]] },
    { id: "seg_terrace_school", name: "Terrace School Road", kind: "Road", from: L.upperTerrace, to: L.hillcrestSchool, travelMinutes: 7, floodRisk: 0.05, accessibility: "full", status: "open" },
    { id: "seg_school_clinic_lane", name: "School Clinic Lane", kind: "Road", from: L.hillcrestSchool, to: L.eastWardClinic, travelMinutes: 3, floodRisk: 0.05, accessibility: "full", status: "open" },
    { id: "seg_khola_footbridge", name: "Khola Footbridge", kind: "Bridge", from: L.ward3South, to: L.hillRoadBase, travelMinutes: 3, floodRisk: 0.40, accessibility: "foot_only", status: "open" },
    { id: "seg_ward3_riverwalk", name: "Ward 3 Riverwalk", kind: "Road", from: L.ward3Home, to: L.riversideBend, travelMinutes: 4, floodRisk: 0.80, accessibility: "full", status: "blocked" },
    { id: "seg_depot_chowk_link", name: "Depot Access Road", kind: "Road", from: L.ward4Depot, to: L.ward3Chowk, travelMinutes: 2, floodRisk: 0.40, accessibility: "full", status: "open" },
    { id: "seg_depot_bend_link", name: "Depot River Track", kind: "Road", from: L.ward4Depot, to: L.riversideBend, travelMinutes: 2, floodRisk: 0.40, accessibility: "rough", status: "open" },
    { id: "seg_south_yard_link", name: "South Yard Road", kind: "Road", from: L.southTransitYard, to: L.ward3South, travelMinutes: 4, floodRisk: 0.20, accessibility: "full", status: "open" },
    { id: "seg_south_hill_link", name: "South Hill Connector", kind: "Road", from: L.southTransitYard, to: L.hillRoadBase, travelMinutes: 8, floodRisk: 0.15, accessibility: "full", status: "open", via: [[85.3196, 27.6596]] },
    { id: "seg_upper_canal_bridge", name: "Upper Canal Bridge", kind: "Bridge", from: L.upperTerrace, to: L.eastRidge, travelMinutes: 4, floodRisk: 0.10, accessibility: "full", status: "open" },
    { id: "seg_ridge_hospital", name: "Ridge Hospital Road", kind: "Road", from: L.eastRidge, to: L.valleyHospital, travelMinutes: 5, floodRisk: 0.10, accessibility: "full", status: "open" },
    { id: "seg_ring_ridge_link", name: "Ring Ridge Link", kind: "Road", from: L.ringRoadEast, to: L.eastRidge, travelMinutes: 5, floodRisk: 0.15, accessibility: "full", status: "open" },
    { id: "seg_market_hill_link", name: "Market Hill Lane", kind: "Road", from: L.marketSquare, to: L.hillRoadBase, travelMinutes: 6, floodRisk: 0.25, accessibility: "full", status: "open" },
  ],

  /* --------------------------------------------------------------- */
  /* Shelters                                                         */
  /* --------------------------------------------------------------- */
  shelters: [
    { id: "shelter_patan_relief", name: "Patan Community Relief Center", locationId: L.patanRelief, capacity: 240, occupancy: 186, wheelchairAccessible: true, status: "open" },
    { id: "shelter_hillcrest", name: "Hillcrest School Relief Point", locationId: L.hillcrestSchool, capacity: 120, occupancy: 96, wheelchairAccessible: true, status: "open" },
    { id: "shelter_thapa_ground", name: "Thapa Ground Relief Post", locationId: L.thapaGround, capacity: 80, occupancy: 41, wheelchairAccessible: false, status: "open" },
    { id: "shelter_market_hall", name: "Old Market Hall Shelter", locationId: L.marketSquare, capacity: 60, occupancy: 60, wheelchairAccessible: true, status: "full" },
  ],

  /* --------------------------------------------------------------- */
  /* Clinics + hospitals                                              */
  /* --------------------------------------------------------------- */
  careSites: [
    { id: "clinic_patan_health", name: "Patan Health Post", locationId: L.patanHealth, kind: "Clinic", status: "open" },
    { id: "clinic_east_ward", name: "East Ward Clinic", locationId: L.eastWardClinic, kind: "Clinic", status: "open" },
    { id: "clinic_west_bank", name: "West Bank Health Camp", locationId: L.westBankRoad, kind: "Clinic", status: "limited" },
    { id: "hospital_valley", name: "Valley General Hospital", locationId: L.valleyHospital, kind: "Hospital", status: "open" },
  ],

  /* --------------------------------------------------------------- */
  /* Resources                                                        */
  /* --------------------------------------------------------------- */
  resources: [
    { id: "res_inhaler_patan", name: "Salbutamol inhalers", type: "asthma_medication", quantity: 24, status: "in_stock", holderId: "clinic_patan_health", satisfies: ["asthma_medication"] },
    { id: "res_inhaler_east", name: "Salbutamol inhalers", type: "asthma_medication", quantity: 12, status: "in_stock", holderId: "clinic_east_ward", satisfies: ["asthma_medication"] },
    { id: "res_inhaler_valley", name: "Salbutamol + nebulisers", type: "asthma_medication", quantity: 60, status: "in_stock", holderId: "hospital_valley", satisfies: ["asthma_medication"] },
    { id: "res_wheelchair_patan", name: "Step-free ward + wheelchairs", type: "mobility_support", quantity: 6, status: "in_stock", holderId: "shelter_patan_relief", satisfies: ["mobility_assistance"] },
    { id: "res_wheelchair_hill", name: "Step-free dormitory", type: "mobility_support", quantity: 4, status: "in_stock", holderId: "shelter_hillcrest", satisfies: ["mobility_assistance"] },
    { id: "res_beds_patan", name: "Cots", type: "shelter_bedding", quantity: 54, status: "in_stock", holderId: "shelter_patan_relief", satisfies: ["shelter"] },
    { id: "res_beds_hill", name: "Cots", type: "shelter_bedding", quantity: 24, status: "in_stock", holderId: "shelter_hillcrest", satisfies: ["shelter"] },
    { id: "res_blankets_thapa", name: "Blankets", type: "shelter_bedding", quantity: 60, status: "in_stock", holderId: "shelter_thapa_ground", satisfies: ["shelter"] },
    { id: "res_water_patan", name: "Potable water", type: "potable_water", quantity: 900, status: "in_stock", holderId: "shelter_patan_relief", satisfies: [] },
    { id: "res_water_hill", name: "Potable water", type: "potable_water", quantity: 400, status: "in_stock", holderId: "shelter_hillcrest", satisfies: [] },
    { id: "res_formula_hill", name: "Infant formula", type: "infant_formula", quantity: 30, status: "in_stock", holderId: "shelter_hillcrest", satisfies: ["infant_formula"] },
    { id: "res_insulin_patan", name: "Insulin (cold chain)", type: "insulin", quantity: 15, status: "low", holderId: "clinic_patan_health", satisfies: ["insulin"] },
    { id: "res_oxygen_valley", name: "Oxygen cylinders", type: "oxygen", quantity: 20, status: "in_stock", holderId: "hospital_valley", satisfies: ["oxygen"] },
  ],

  /* --------------------------------------------------------------- */
  /* Vehicles                                                         */
  /* --------------------------------------------------------------- */
  vehicles: [
    { id: "veh_van_2", name: "Accessible Community Van 2", type: "van", capacity: 6, wheelchairAccessible: true, status: "ready", supportsNeeds: ["transportation", "mobility_assistance"] },
    { id: "veh_van_5", name: "Accessible Relief Van 5", type: "van", capacity: 6, wheelchairAccessible: true, status: "ready", supportsNeeds: ["transportation", "mobility_assistance"] },
    { id: "veh_van_7", name: "Accessible Van 7", type: "van", capacity: 6, wheelchairAccessible: true, status: "ready", supportsNeeds: ["transportation", "mobility_assistance"] },
    { id: "veh_car_4", name: "Adapted Car 4", type: "car", capacity: 3, wheelchairAccessible: true, status: "in_use", supportsNeeds: ["transportation", "mobility_assistance"] },
    { id: "veh_truck_3", name: "Relief Pickup 3", type: "truck", capacity: 6, wheelchairAccessible: false, status: "ready", supportsNeeds: ["transportation"] },
    { id: "veh_bus_1", name: "Community Minibus 1", type: "minibus", capacity: 14, wheelchairAccessible: false, status: "ready", supportsNeeds: ["transportation"] },
    { id: "veh_bike_1", name: "Trail Motorbike 1", type: "motorbike", capacity: 1, wheelchairAccessible: false, status: "ready", supportsNeeds: ["transportation"] },
  ],

  /* --------------------------------------------------------------- */
  /* Volunteers                                                       */
  /* --------------------------------------------------------------- */
  volunteers: [
    { id: "vol_maya", name: "Maya Shrestha", locationId: L.ward4Depot, status: "available", vehicleId: "veh_van_2", skills: ["accessible transfer", "first aid"], canAssist: ["transportation", "mobility_assistance"] },
    { id: "vol_arun", name: "Arun Thapa", locationId: L.southTransitYard, status: "available", vehicleId: "veh_van_5", skills: ["accessible transfer", "driver"], canAssist: ["transportation", "mobility_assistance"] },
    { id: "vol_bina", name: "Bina Rai", locationId: L.ward3Chowk, status: "available", vehicleId: "veh_bike_1", skills: ["scout", "messenger"], canAssist: ["transportation"] },
    { id: "vol_deepak", name: "Deepak Gurung", locationId: L.marketSquare, status: "available", vehicleId: "veh_truck_3", skills: ["logistics"], canAssist: ["transportation"] },
    { id: "vol_kiran", name: "Kiran Magar", locationId: L.ringRoadEast, status: "available", vehicleId: "veh_bus_1", skills: ["group evacuation"], canAssist: ["transportation"] },
    { id: "vol_prakash", name: "Prakash Adhikari", locationId: L.upperTerrace, status: "on_task", vehicleId: "veh_car_4", skills: ["accessible transfer"], canAssist: ["transportation", "mobility_assistance"] },
    { id: "vol_sunita", name: "Sunita Lama", locationId: L.valleyHospital, status: "out_of_zone", vehicleId: "veh_van_7", skills: ["accessible transfer", "paramedic"], canAssist: ["transportation", "mobility_assistance"], distanceOutsideZoneKm: 3.2 },
  ],

  /* --------------------------------------------------------------- */
  /* Needs                                                            */
  /* --------------------------------------------------------------- */
  needs: [
    { id: "need_mobility", kind: "mobility_assistance", label: "Wheelchair-level mobility assistance", critical: true },
    { id: "need_asthma", kind: "asthma_medication", label: "Asthma rescue medication", critical: true },
    { id: "need_transport", kind: "transportation", label: "Accessible transportation", critical: true },
    { id: "need_shelter", kind: "shelter", label: "Safe shelter space", critical: true },
    { id: "need_formula", kind: "infant_formula", label: "Infant formula", critical: true },
    // These two exist so that resources declaring satisfies:["insulin"|"oxygen"] actually
    // get a SATISFIES edge at seed time. Without a Need node of the matching kind the
    // seed's MATCH finds nothing and the edge is silently skipped, which would make a
    // household with an insulin or oxygen need unmatchable to the clinic that stocks it.
    { id: "need_insulin", kind: "insulin", label: "Insulin (cold chain)", critical: true },
    { id: "need_oxygen", kind: "oxygen", label: "Supplemental oxygen", critical: true },
  ],

  /* --------------------------------------------------------------- */
  /* Families                                                         */
  /* --------------------------------------------------------------- */
  families: [
    {
      id: "family_sharma",
      name: "Sharma Family",
      locationId: L.ward3Home,
      size: 4,
      hasVehicle: false,
      note: "Floodwater rising on Riverside Lane. No usable vehicle.",
      needIds: ["need_transport", "need_shelter"],
      members: [
        { id: "person_sharma_bikash", name: "Bikash Sharma", role: "Parent", age: 41, needIds: [] },
        { id: "person_sharma_rita", name: "Rita Sharma", role: "Parent", age: 38, needIds: [] },
        { id: "person_sharma_nirajan", name: "Nirajan Sharma", role: "Child", age: 9, needIds: ["need_asthma"] },
        { id: "person_sharma_kamala", name: "Kamala Sharma", role: "Grandmother", age: 71, needIds: ["need_mobility"] },
      ],
    },
    {
      id: "family_gurung",
      name: "Gurung Family",
      locationId: L.ward3South,
      size: 3,
      hasVehicle: true,
      note: "Has own vehicle. Seeking shelter space only.",
      needIds: ["need_shelter"],
      members: [
        { id: "person_gurung_sita", name: "Sita Gurung", role: "Parent", age: 35, needIds: [] },
        { id: "person_gurung_ram", name: "Ram Gurung", role: "Parent", age: 37, needIds: [] },
        { id: "person_gurung_anu", name: "Anu Gurung", role: "Child", age: 14, needIds: [] },
      ],
    },
    {
      id: "family_tamang",
      name: "Tamang Family",
      locationId: L.riversideBend,
      size: 5,
      hasVehicle: false,
      note: "Infant under 6 months. Directly on the river bend.",
      needIds: ["need_transport", "need_shelter"],
      members: [
        { id: "person_tamang_dolma", name: "Dolma Tamang", role: "Parent", age: 29, needIds: ["need_formula"] },
        { id: "person_tamang_pemba", name: "Pemba Tamang", role: "Parent", age: 33, needIds: [] },
        { id: "person_tamang_infant", name: "Tashi Tamang", role: "Infant", age: 0, needIds: ["need_formula"] },
        { id: "person_tamang_nima", name: "Nima Tamang", role: "Child", age: 7, needIds: [] },
        { id: "person_tamang_aama", name: "Phurba Tamang", role: "Grandmother", age: 68, needIds: [] },
      ],
    },
  ],

  /* --------------------------------------------------------------- */
  /* Hazards                                                          */
  /* --------------------------------------------------------------- */
  hazards: [
    {
      id: "hz_ward3_flood",
      name: "Ward 3 Riverwalk flooding",
      hazardType: "flood",
      severity: 0.75,
      active: true,
      description: "Riverwalk submerged to 0.9m. Impassable to vehicles and pedestrians.",
      blocks: ["seg_ward3_riverwalk"],
      affects: [L.ward3Home],
      footprint: [
        [85.3098, 27.6618],
        [85.3142, 27.6626],
        [85.3178, 27.6686],
        [85.3160, 27.6706],
        [85.3110, 27.6672],
        [85.3092, 27.6636],
        [85.3098, 27.6618],
      ],
    },
    {
      id: "hz_bagmati_scour",
      name: "Bagmati Crossing pier scour",
      hazardType: "structural",
      severity: 0.80,
      active: true,
      description: "Pier 2 undermined by scour. Engineers have closed the crossing to all traffic.",
      blocks: ["seg_bagmati_crossing"],
      affects: [],
      footprint: [
        [85.3084, 27.6650],
        [85.3162, 27.6664],
        [85.3158, 27.6678],
        [85.3080, 27.6664],
        [85.3084, 27.6650],
      ],
    },
    {
      id: "hz_riverside_flood",
      name: "Riverside Road flash flooding",
      hazardType: "flood",
      severity: 0.90,
      active: false,
      description: "Rapid-onset overtopping along the Riverside Road corridor and Ward 4 depot approach.",
      blocks: ["seg_chowk_bend", "seg_riverside_road", "seg_depot_chowk_link"],
      affects: [L.riversideBend, L.pumpingStation, L.ward4Depot, L.patanGate],
      footprint: [
        [85.3140, 27.6650],
        [85.3196, 27.6660],
        [85.3238, 27.6726],
        [85.3268, 27.6782],
        [85.3236, 27.6796],
        [85.3198, 27.6736],
        [85.3156, 27.6682],
        [85.3140, 27.6650],
      ],
    },
    {
      id: "hz_upper_landslide",
      name: "Upper Terrace slope instability",
      hazardType: "landslide",
      severity: 0.55,
      active: false,
      description: "Saturated slope above Hill Road — Upper. Debris flow risk.",
      blocks: ["seg_hill_road_upper"],
      affects: [L.upperTerrace],
      footprint: [
        [85.3206, 27.6608],
        [85.3260, 27.6606],
        [85.3272, 27.6636],
        [85.3214, 27.6640],
        [85.3206, 27.6608],
      ],
    },
  ],

  /* --------------------------------------------------------------- */
  /* Proximity links used for "clinic near shelter" reasoning          */
  /* --------------------------------------------------------------- */
  near: [
    { from: L.patanRelief, to: L.patanHealth, meters: 300 },
    { from: L.hillcrestSchool, to: L.eastWardClinic, meters: 600 },
    { from: L.thapaGround, to: L.westBankRoad, meters: 450 },
    { from: L.eastRidge, to: L.valleyHospital, meters: 700 },
    { from: L.marketSquare, to: L.ringRoadEast, meters: 640 },
  ],
};

/** Convenience lookups used across the app. */
export const DEMO_FAMILY_ID = "family_sharma";
export const DEMO_FLOOD_HAZARD_ID = "hz_riverside_flood";
export const DEMO_PRIMARY_SHELTER_ID = "shelter_patan_relief";
export const DEMO_PRIMARY_VOLUNTEER_ID = "vol_maya";

export const locationById = new Map(world.locations.map((l) => [l.id, l]));
export const segmentById = new Map(world.segments.map((s) => [s.id, s]));
export const shelterById = new Map(world.shelters.map((s) => [s.id, s]));
export const volunteerById = new Map(world.volunteers.map((v) => [v.id, v]));
export const vehicleById = new Map(world.vehicles.map((v) => [v.id, v]));
export const hazardById = new Map(world.hazards.map((h) => [h.id, h]));
export const careSiteById = new Map(world.careSites.map((c) => [c.id, c]));
