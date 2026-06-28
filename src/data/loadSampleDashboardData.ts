import {
  constraintPressure,
  metrics,
  portUtilization,
  rewardTrend,
  timelineEvents,
  vessels,
  type Metric,
  type RewardTrendPoint,
  type TimelineEvent,
  type Vessel,
} from "./chmarlData";
import {
  experimentStepsToConstraintPressure,
  experimentStepsToRewardTrend,
  experimentStepsToTimelineEvents,
  normalizeAisBatch,
  normalizePortEventBatch,
  vesselStateToDashboardRow,
} from "@/adapters";
import type { RawAisVesselUpdate } from "@/adapters/aisAdapter";
import type { RawPortEvent } from "@/adapters/portEventAdapter";
import { loadRemoteDashboardVessels } from "@/providers/dashboardDataProvider";
import type { ChmarlExperimentStep, PortEvent } from "@/types/chmarl";

export type ChartDatum = {
  name: string;
  value: number;
};

export type DashboardDataSource = "aisstream" | "aisstream-waiting" | "upstream" | "remote" | "local-json" | "fallback";

export type DashboardData = {
  source: DashboardDataSource;
  metrics: Metric[];
  vessels: Vessel[];
  portEvents: PortEvent[];
  rewardTrend: RewardTrendPoint[];
  constraintPressure: ChartDatum[];
  portUtilization: ChartDatum[];
  timelineEvents: TimelineEvent[];
};

const knownPorts = [
  { name: "Jeddah", latitude: 21.485, longitude: 39.173 },
  { name: "King Abdullah Port", latitude: 22.393, longitude: 39.097 },
  { name: "Yanbu", latitude: 24.086, longitude: 38.063 },
  { name: "Suez", latitude: 29.966, longitude: 32.549 },
  { name: "Dammam", latitude: 26.43, longitude: 50.09 },
  { name: "Jebel Ali", latitude: 25.011, longitude: 55.061 },
  { name: "Jizan", latitude: 16.889, longitude: 42.551 },
];

export const fallbackDashboardData: DashboardData = {
  source: "fallback",
  metrics,
  vessels,
  portEvents: [],
  rewardTrend,
  constraintPressure,
  portUtilization,
  timelineEvents,
};

async function fetchJson<T>(fileName: string): Promise<T> {
  const baseUrl = import.meta.env.BASE_URL || "/";
  const response = await fetch(`${baseUrl}data/${fileName}`);

  if (!response.ok) {
    throw new Error(`Failed to load ${fileName}: ${response.status} ${response.statusText}`);
  }

  return response.json() as Promise<T>;
}

function updateMetric(metricsList: Metric[], label: string, value: string, trend?: string) {
  return metricsList.map((metric) =>
    metric.label === label ? { ...metric, value, trend: trend ?? metric.trend } : metric
  );
}

function toRewardTrend(points: (string | number)[][]): RewardTrendPoint[] {
  return points.map((point) => [String(point[0]), Number(point[1])] as RewardTrendPoint);
}

function isExternalSource(source: DashboardDataSource) {
  return source === "aisstream" || source === "aisstream-waiting" || source === "upstream" || source === "remote";
}

function hasPosition(vessel: Vessel) {
  return Number.isFinite(vessel.latitude) && Number.isFinite(vessel.longitude);
}

function speedKnots(vessel: Vessel) {
  const parsed = Number.parseFloat(vessel.speed.replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function stalePosition(vessel: Vessel) {
  if (!vessel.timestamp) return false;
  const timestamp = Date.parse(vessel.timestamp);
  if (!Number.isFinite(timestamp)) return false;
  return Date.now() - timestamp > 30 * 60 * 1000;
}

function pct(count: number, total: number) {
  if (total === 0) return 0;
  return Number(((count / total) * 100).toFixed(1));
}

function distanceNm(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const radiusNm = 3440.065;
  const toRad = (value: number) => (value * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLon = Math.sin(dLon / 2);
  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLon * sinDLon;
  return 2 * radiusNm * Math.asin(Math.min(1, Math.sqrt(h)));
}

function deriveConstraintPressureFromVessels(vesselRows: Vessel[]): ChartDatum[] {
  const total = vesselRows.length;
  const missingPosition = vesselRows.filter((vessel) => !hasPosition(vessel)).length;
  const stale = vesselRows.filter(stalePosition).length;
  const slow = vesselRows.filter((vessel) => {
    const speed = speedKnots(vessel);
    return speed !== undefined && speed <= 0.5;
  }).length;
  const watch = vesselRows.filter((vessel) => vessel.status === "Watch").length;
  const constrained = vesselRows.filter((vessel) => vessel.status === "Constrained").length;

  return [
    { name: "Constrained vessels", value: pct(constrained, total) },
    { name: "Watch vessels", value: pct(watch, total) },
    { name: "Missing position", value: pct(missingPosition, total) },
    { name: "Stale position", value: pct(stale, total) },
    { name: "Low speed", value: pct(slow, total) },
  ];
}

function derivePortProximityFromVessels(vesselRows: Vessel[]): ChartDatum[] {
  const counts = new Map<string, number>();
  const positioned = vesselRows.filter((vessel): vessel is Vessel & { latitude: number; longitude: number } => hasPosition(vessel));

  for (const vessel of positioned) {
    const nearest = knownPorts
      .map((port) => ({ port, distance: distanceNm(vessel, port) }))
      .sort((a, b) => a.distance - b.distance)[0];
    if (!nearest || nearest.distance > 75) continue;
    counts.set(nearest.port.name, (counts.get(nearest.port.name) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 6);
}

function externalTimeline(source: DashboardDataSource, vesselRows: Vessel[]): TimelineEvent[] {
  if (source === "aisstream-waiting") {
    return [
      {
        time: "live",
        title: "AIS connected, waiting for position messages",
        body: "The backend socket is active but no AIS position rows have been cached for the selected bounding box yet.",
      },
    ];
  }

  if (!isExternalSource(source)) return timelineEvents;

  return [
    {
      time: "live",
      title: "External vessel feed active",
      body: `${vesselRows.length} vessel rows are currently loaded from ${source}. No local fixture events are mixed into this operating picture.`,
    },
  ];
}

export async function loadSampleDashboardData(): Promise<DashboardData> {
  const [remoteVessels, rawVessels, rawPortEvents, experimentSteps] = await Promise.all([
    loadRemoteDashboardVessels().catch(() => null),
    fetchJson<RawAisVesselUpdate[]>("vessels.sample.json"),
    fetchJson<RawPortEvent[]>("port_events.sample.json"),
    fetchJson<ChmarlExperimentStep[]>("chmarl_episode.sample.json"),
    fetchJson<unknown>("maritime_layers.sample.geojson"),
  ]);

  const localVessels = normalizeAisBatch(rawVessels).map(vesselStateToDashboardRow);
  const dashboardVessels = remoteVessels?.vessels ?? localVessels;
  const source: DashboardDataSource = remoteVessels?.source ?? "local-json";
  const externalSource = isExternalSource(source);

  const normalizedPortEvents = externalSource ? [] : normalizePortEventBatch(rawPortEvents);
  const rewardData = externalSource ? [] : toRewardTrend(experimentStepsToRewardTrend(experimentSteps));
  const constraintData = externalSource ? deriveConstraintPressureFromVessels(dashboardVessels) : experimentStepsToConstraintPressure(experimentSteps);
  const utilizationData = externalSource ? derivePortProximityFromVessels(dashboardVessels) : portUtilization;
  const timelineData = externalSource ? externalTimeline(source, dashboardVessels) : experimentStepsToTimelineEvents(experimentSteps);

  const fileDrivenMetrics = updateMetric(
    updateMetric(metrics, "Active vessels", String(dashboardVessels.length), source),
    "Reward index",
    rewardData.at(-1)?.[1].toFixed(3) ?? (externalSource ? "n/a" : metrics[3].value),
    externalSource ? "no CH-MARL log connected" : "from local CH-MARL episode"
  );

  return {
    source,
    metrics: fileDrivenMetrics,
    vessels: dashboardVessels,
    portEvents: normalizedPortEvents,
    rewardTrend: rewardData.length > 0 ? rewardData : externalSource ? [] : rewardTrend,
    constraintPressure: constraintData.length > 0 ? constraintData : externalSource ? [] : constraintPressure,
    portUtilization: utilizationData,
    timelineEvents: timelineData.length > 0 ? timelineData : externalSource ? [] : timelineEvents,
  };
}
