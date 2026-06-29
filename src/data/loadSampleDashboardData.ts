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
import { loadRuntimeChmarlExperiment } from "@/providers/chmarlExperimentProvider";
import { loadRemoteDashboardVessels } from "@/providers/dashboardDataProvider";
import { loadMarineWeather, type MarineWeatherPoint } from "@/providers/weatherProvider";
import { loadRuntimePortOperations } from "@/providers/portOperationsProvider";
import type { ChmarlExperimentStep, PortEvent } from "@/types/chmarl";

export type ChartDatum = { name: string; value: number };

export type DashboardDataSource = "aisstream" | "aisstream-waiting" | "upstream" | "remote" | "local-json" | "fallback" | "none";
export type ChmarlDataSource = "runtime" | "local-json" | "none";
export type PortOpsDataSource = "runtime" | "demo" | "local-json" | "none";
export type WeatherDataSource = "open-meteo" | "runtime" | "none";

export type DashboardData = {
  source: DashboardDataSource;
  chmarlSource: ChmarlDataSource;
  portOpsSource: PortOpsDataSource;
  weatherSource: WeatherDataSource;
  weatherPoints: MarineWeatherPoint[];
  chmarlExperimentId?: string;
  chmarlScenarioId?: string;
  metrics: Metric[];
  vessels: Vessel[];
  portEvents: PortEvent[];
  rewardTrend: RewardTrendPoint[];
  constraintPressure: ChartDatum[];
  portUtilization: ChartDatum[];
  timelineEvents: TimelineEvent[];
};

const allowSampleData = import.meta.env.VITE_ALLOW_SAMPLE_DATA === "true";

const realOnlyMetrics: Metric[] = [
  { label: "Tracked vessels", value: "0", trend: "awaiting AIS/provider rows" },
  { label: "Port events", value: "0", trend: "connect PORT_EVENTS_URL or review demo feed" },
  { label: "Feasibility score", value: "n/a", trend: "awaiting live CH-MARL state" },
  { label: "Reward index", value: "n/a", trend: "awaiting online CH-MARL" },
  { label: "Avg AIS SOG", value: "n/a", trend: "awaiting valid AIS speed" },
  { label: "Sea state", value: "n/a", trend: "awaiting marine weather" },
];

export const fallbackDashboardData: DashboardData = {
  source: allowSampleData ? "local-json" : "none",
  chmarlSource: allowSampleData ? "local-json" : "none",
  portOpsSource: allowSampleData ? "local-json" : "none",
  weatherSource: "none",
  weatherPoints: [],
  metrics: allowSampleData ? metrics : realOnlyMetrics,
  vessels: allowSampleData ? vessels : [],
  portEvents: [],
  rewardTrend: allowSampleData ? rewardTrend : [],
  constraintPressure: allowSampleData ? constraintPressure : [],
  portUtilization: allowSampleData ? portUtilization : [],
  timelineEvents: allowSampleData ? timelineEvents : [],
};

async function fetchJson<T>(fileName: string): Promise<T> {
  if (!allowSampleData) return [] as unknown as T;
  const baseUrl = import.meta.env.BASE_URL || "/";
  const response = await fetch(`${baseUrl}data/${fileName}`);
  if (!response.ok) throw new Error(`Failed to load ${fileName}: ${response.status} ${response.statusText}`);
  return response.json() as Promise<T>;
}

function updateMetric(metricsList: Metric[], label: string, value: string, trend?: string) {
  return metricsList.map((metric) => metric.label === label ? { ...metric, value, trend: trend ?? metric.trend } : metric);
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

function externalTimeline(source: DashboardDataSource, vesselRows: Vessel[], chmarlSource: ChmarlDataSource, portOpsSource: PortOpsDataSource): TimelineEvent[] {
  if (source === "aisstream-waiting") {
    return [{ time: "live", title: "AIS connected, waiting for position messages", body: "The backend socket is active, but no vessel positions have been cached for the selected bounding boxes yet." }];
  }
  if (!isExternalSource(source)) return [];
  return [{ time: "live", title: chmarlSource !== "none" ? "Live vessel feed + online CH-MARL active" : "External vessel feed active", body: `${vesselRows.length} vessel rows are loaded from ${source}. CH-MARL source: ${chmarlSource}. Port operations source: ${portOpsSource}.` }];
}

export async function loadSampleDashboardData(): Promise<DashboardData> {
  const [remoteVessels, runtimeExperiment, runtimePortOps, marineWeather, rawVessels, rawPortEvents, localExperimentSteps] = await Promise.all([
    loadRemoteDashboardVessels().catch(() => null),
    loadRuntimeChmarlExperiment().catch(() => null),
    loadRuntimePortOperations().catch(() => null),
    loadMarineWeather().catch(() => null),
    fetchJson<RawAisVesselUpdate[]>("vessels.sample.json"),
    fetchJson<RawPortEvent[]>("port_events.sample.json"),
    fetchJson<ChmarlExperimentStep[]>("chmarl_episode.sample.json"),
    fetchJson<unknown>("maritime_layers.sample.geojson"),
  ]);

  const localVessels = allowSampleData ? normalizeAisBatch(rawVessels).map(vesselStateToDashboardRow) : [];
  const dashboardVessels = remoteVessels?.vessels ?? localVessels;
  const source: DashboardDataSource = remoteVessels?.source ?? (allowSampleData ? "local-json" : "none");
  const externalSource = isExternalSource(source);
  const experimentSteps = runtimeExperiment?.steps ?? (allowSampleData ? localExperimentSteps : []);
  const chmarlSource: ChmarlDataSource = runtimeExperiment ? "runtime" : allowSampleData && localExperimentSteps.length > 0 ? "local-json" : "none";
  const portOpsSource: PortOpsDataSource = runtimePortOps ? runtimePortOps.source : externalSource || !allowSampleData ? "none" : "local-json";
  const weatherSource: WeatherDataSource = marineWeather?.source ?? "none";
  const weatherPoints = marineWeather?.points ?? [];

  const normalizedPortEvents = runtimePortOps?.portEvents ?? (externalSource || !allowSampleData ? [] : normalizePortEventBatch(rawPortEvents));
  const rewardData = experimentSteps.length > 0 ? toRewardTrend(experimentStepsToRewardTrend(experimentSteps)) : [];
  const constraintData = experimentSteps.length > 0 ? experimentStepsToConstraintPressure(experimentSteps) : externalSource ? deriveConstraintPressureFromVessels(dashboardVessels) : [];
  const utilizationData = runtimePortOps?.portUtilization ?? (externalSource || !allowSampleData ? [] : portUtilization);
  const timelineData = experimentSteps.length > 0 ? experimentStepsToTimelineEvents(experimentSteps) : externalSource ? externalTimeline(source, dashboardVessels, chmarlSource, portOpsSource) : [];

  const fileDrivenMetrics = updateMetric(
    updateMetric(allowSampleData ? metrics : realOnlyMetrics, "Active vessels", String(dashboardVessels.length), source),
    "Reward index",
    rewardData.at(-1)?.[1].toFixed(3) ?? "n/a",
    chmarlSource === "runtime" ? "online CH-MARL active" : chmarlSource === "local-json" ? "from local CH-MARL episode" : "no CH-MARL log connected"
  );

  return {
    source,
    chmarlSource,
    portOpsSource,
    weatherSource,
    weatherPoints,
    chmarlExperimentId: runtimeExperiment?.experimentId ?? experimentSteps[0]?.experimentId,
    chmarlScenarioId: runtimeExperiment?.scenarioId ?? experimentSteps[0]?.scenarioId,
    metrics: fileDrivenMetrics,
    vessels: dashboardVessels,
    portEvents: normalizedPortEvents,
    rewardTrend: rewardData.length > 0 ? rewardData : allowSampleData && chmarlSource !== "none" ? rewardTrend : [],
    constraintPressure: constraintData.length > 0 ? constraintData : allowSampleData ? constraintPressure : [],
    portUtilization: utilizationData,
    timelineEvents: timelineData.length > 0 ? timelineData : allowSampleData ? timelineEvents : [],
  };
}
