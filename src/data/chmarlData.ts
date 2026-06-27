export type Metric = {
  label: string;
  value: string;
  trend: string;
};

export type VesselTrailPoint = {
  latitude: number;
  longitude: number;
  timestamp?: string;
};

export type Vessel = {
  id: string;
  name: string;
  route: string;
  cargo: string;
  eta: string;
  speed: string;
  status: "Nominal" | "Watch" | "Constrained";
  latitude?: number;
  longitude?: number;
  headingDeg?: number;
  courseDeg?: number;
  timestamp?: string;
  trail?: VesselTrailPoint[];
};

export type TimelineEvent = {
  time: string;
  title: string;
  body: string;
};

export type RewardTrendPoint = [time: string, value: number];

export const metrics: Metric[] = [
  { label: "Active vessels", value: "128", trend: "+14 vs. baseline" },
  { label: "Port calls", value: "42", trend: "next 24 hours" },
  { label: "Constraint score", value: "96.4%", trend: "+3.1% safe policy" },
  { label: "Reward index", value: "0.873", trend: "+0.042 episode mean" },
  { label: "Avg ETA error", value: "18m", trend: "-11m after replanning" },
  { label: "CO₂ intensity", value: "7.8", trend: "kg / t-nm" },
];

export const vessels: Vessel[] = [
  {
    id: "MMSI-538214",
    name: "Al Riyadh Trader",
    route: "Jeddah → Suez",
    cargo: "Containers",
    eta: "04:20 UTC",
    speed: "14.8 kn",
    status: "Nominal",
    latitude: 21.45,
    longitude: 39.12,
    courseDeg: 322,
    trail: [
      { latitude: 20.92, longitude: 39.42, timestamp: "T-30m" },
      { latitude: 21.12, longitude: 39.31, timestamp: "T-20m" },
      { latitude: 21.28, longitude: 39.22, timestamp: "T-10m" },
      { latitude: 21.45, longitude: 39.12, timestamp: "Now" },
    ],
  },
  {
    id: "MMSI-403882",
    name: "Gulf Horizon",
    route: "Dammam → Jebel Ali",
    cargo: "General cargo",
    eta: "07:55 UTC",
    speed: "11.2 kn",
    status: "Watch",
    latitude: 26.43,
    longitude: 50.09,
    courseDeg: 112,
    trail: [
      { latitude: 26.65, longitude: 49.52, timestamp: "T-30m" },
      { latitude: 26.58, longitude: 49.74, timestamp: "T-20m" },
      { latitude: 26.51, longitude: 49.92, timestamp: "T-10m" },
      { latitude: 26.43, longitude: 50.09, timestamp: "Now" },
    ],
  },
  {
    id: "MMSI-636719",
    name: "Red Sea Pearl",
    route: "Yanbu → Aqaba",
    cargo: "Energy products",
    eta: "11:10 UTC",
    speed: "10.1 kn",
    status: "Constrained",
    latitude: 24.05,
    longitude: 37.88,
    courseDeg: 7,
    trail: [
      { latitude: 23.43, longitude: 37.74, timestamp: "T-30m" },
      { latitude: 23.64, longitude: 37.79, timestamp: "T-20m" },
      { latitude: 23.86, longitude: 37.84, timestamp: "T-10m" },
      { latitude: 24.05, longitude: 37.88, timestamp: "Now" },
    ],
  },
  {
    id: "MMSI-370441",
    name: "Najd Carrier",
    route: "Jizan → Port Sudan",
    cargo: "Dry bulk",
    eta: "14:35 UTC",
    speed: "12.6 kn",
    status: "Nominal",
    latitude: 16.89,
    longitude: 42.55,
    courseDeg: 208,
    trail: [
      { latitude: 17.42, longitude: 42.88, timestamp: "T-30m" },
      { latitude: 17.24, longitude: 42.77, timestamp: "T-20m" },
      { latitude: 17.04, longitude: 42.66, timestamp: "T-10m" },
      { latitude: 16.89, longitude: 42.55, timestamp: "Now" },
    ],
  },
  {
    id: "MMSI-565902",
    name: "Arabian Express",
    route: "Jeddah → King Abdullah Port",
    cargo: "Ro-Ro",
    eta: "18:05 UTC",
    speed: "16.4 kn",
    status: "Watch",
    latitude: 22.72,
    longitude: 38.98,
    courseDeg: 352,
    trail: [
      { latitude: 22.10, longitude: 39.12, timestamp: "T-30m" },
      { latitude: 22.32, longitude: 39.07, timestamp: "T-20m" },
      { latitude: 22.52, longitude: 39.02, timestamp: "T-10m" },
      { latitude: 22.72, longitude: 38.98, timestamp: "Now" },
    ],
  },
];

export const rewardTrend: RewardTrendPoint[] = [
  ["00:00", 0.62],
  ["04:00", 0.66],
  ["08:00", 0.7],
  ["12:00", 0.74],
  ["16:00", 0.81],
  ["20:00", 0.86],
  ["24:00", 0.873],
];

export const constraintPressure = [
  { name: "Berth capacity", value: 68 },
  { name: "Channel safety", value: 42 },
  { name: "Fuel budget", value: 54 },
  { name: "ETA window", value: 76 },
  { name: "Emissions cap", value: 58 },
];

export const portUtilization = [
  { name: "Jeddah", value: 82 },
  { name: "Dammam", value: 71 },
  { name: "Yanbu", value: 63 },
  { name: "Jizan", value: 47 },
  { name: "KAEC", value: 58 },
];

export const timelineEvents: TimelineEvent[] = [
  {
    time: "T+00:02",
    title: "Fleet-level policy selected",
    body: "Upper-level controller selected congestion-aware routing for Red Sea corridor.",
  },
  {
    time: "T+00:07",
    title: "Port agent capacity update",
    body: "Jeddah berth availability reduced by one slot; local policy rebalanced arrivals.",
  },
  {
    time: "T+00:13",
    title: "Constraint shield activated",
    body: "ETA and channel-safety constraints applied to two high-priority vessels.",
  },
  {
    time: "T+00:21",
    title: "Reward stabilized",
    body: "Episode reward improved while keeping emissions and berth constraints feasible.",
  },
];

export const ports = [
  { name: "Jeddah", position: [-5.2, 0, -0.6] as [number, number, number] },
  { name: "Yanbu", position: [-4.4, 0, 2.4] as [number, number, number] },
  { name: "Suez", position: [-3.4, 0, 5.2] as [number, number, number] },
  { name: "Dammam", position: [5.3, 0, 2.2] as [number, number, number] },
  { name: "Jebel Ali", position: [6.1, 0, -0.9] as [number, number, number] },
  { name: "Jizan", position: [-4.8, 0, -3.9] as [number, number, number] },
];

export const routes = [
  { from: "Jeddah", to: "Suez", risk: "medium" },
  { from: "Yanbu", to: "Suez", risk: "low" },
  { from: "Jeddah", to: "Jizan", risk: "high" },
  { from: "Dammam", to: "Jebel Ali", risk: "low" },
  { from: "Jizan", to: "Jeddah", risk: "medium" },
];
