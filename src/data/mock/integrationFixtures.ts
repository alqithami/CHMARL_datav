import type { ChmarlExperimentStep, PortEvent, VesselState } from "@/types/chmarl";

export const mockAisVesselStates: VesselState[] = [
  {
    vesselId: "vessel-al-riyadh-trader",
    mmsi: "538214",
    name: "Al Riyadh Trader",
    vesselType: "Container Ship",
    cargoClass: "Containers",
    latitude: 21.45,
    longitude: 39.12,
    speedKnots: 14.8,
    courseDeg: 322,
    headingDeg: 320,
    navStatus: "Nominal",
    originPort: "Jeddah",
    destinationPort: "Suez",
    eta: "04:20 UTC",
    timestamp: "2026-06-25T18:00:00.000Z",
  },
  {
    vesselId: "vessel-red-sea-pearl",
    mmsi: "636719",
    name: "Red Sea Pearl",
    vesselType: "Tanker",
    cargoClass: "Energy products",
    latitude: 24.05,
    longitude: 37.88,
    speedKnots: 10.1,
    courseDeg: 7,
    headingDeg: 9,
    navStatus: "Constrained",
    originPort: "Yanbu",
    destinationPort: "Aqaba",
    eta: "11:10 UTC",
    timestamp: "2026-06-25T18:00:00.000Z",
  },
];

export const mockPortEvents: PortEvent[] = [
  {
    eventId: "event-jeddah-arrival-001",
    vesselId: "vessel-al-riyadh-trader",
    portId: "Jeddah",
    eventType: "arrival",
    timestamp: "2026-06-25T18:12:00.000Z",
  },
  {
    eventId: "event-yanbu-berth-001",
    vesselId: "vessel-red-sea-pearl",
    portId: "Yanbu",
    berthId: "YNB-B03",
    eventType: "berth_assigned",
    timestamp: "2026-06-25T18:20:00.000Z",
  },
];

export const mockExperimentSteps: ChmarlExperimentStep[] = [
  {
    experimentId: "demo-exp-001",
    scenarioId: "baseline",
    episode: 1,
    step: 1,
    timestamp: "T+00:02",
    state: {
      activeVessels: 128,
      berthPressure: 0.62,
    },
    actions: [
      {
        agentId: "fleet-controller",
        agentType: "fleet",
        actionType: "select_policy",
        actionValue: "congestion-aware-routing",
      },
    ],
    rewards: [
      { component: "global", value: 0.62 },
      { component: "delay", value: -0.08 },
      { component: "safety", value: 0.12 },
    ],
    constraints: [
      {
        constraintId: "berth-capacity",
        name: "Berth capacity",
        value: 68,
        limit: 100,
        satisfied: true,
        severity: "medium",
      },
      {
        constraintId: "channel-safety",
        name: "Channel safety",
        value: 42,
        limit: 100,
        satisfied: true,
        severity: "low",
      },
    ],
    fairness: [
      {
        metricId: "port-service-balance",
        name: "Port service balance",
        value: 0.81,
        groupBy: "port",
      },
    ],
    hierarchyDecisions: [
      {
        level: "fleet",
        decisionId: "decision-001",
        decisionLabel: "Fleet-level policy selected",
        rationale: "Upper-level controller selected congestion-aware routing for Red Sea corridor.",
        affectedAgents: ["vessel-al-riyadh-trader", "vessel-red-sea-pearl"],
      },
    ],
  },
];
