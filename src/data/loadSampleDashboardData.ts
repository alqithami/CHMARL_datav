import type { Metric, RewardTrendPoint, TimelineEvent, Vessel } from "./chmarlData";
import {
  experimentStepsToConstraintPressure,
  experimentStepsToRewardTrend,
  experimentStepsToTimelineEvents,
} from "@/adapters";
import { loadRuntimeChmarlExperiment } from "@/providers/chmarlExperimentProvider";
import { loadRemoteDashboardVessels } from "@/providers/dashboardDataProvider";
import { loadMarineWeather, type MarineWeatherPoint } from "@/providers/weatherProvider";
import { loadRuntimePortOperations, type PortQueueStatus } from "@/providers/portOperationsProvider";
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
  chmarlSteps: ChmarlExperimentStep[];
  metrics: Metric[];
  vessels: Vessel[];
  portEvents: PortEvent[];
  portQueueStatus: PortQueueStatus[];
  rewardTrend: RewardTrendPoint[];
  constraintPressure: ChartDatum[];
  portUtilization: ChartDatum[];
  timelineEvents: TimelineEvent[];
};

const realOnlyMetrics: Metric[] = [
  { label: "Tracked vessels", value: "0", trend: "awaiting provider rows" },
  { label: "Port events", value: "0", trend: "awaiting provider or demo feed" },
  { label: "Feasibility score", value: "n/a", trend: "awaiting live state" },
  { label: "Reward index", value: "n/a", trend: "awaiting online inference" },
  { label: "Avg AIS SOG", value: "n/a", trend: "awaiting valid speed" },
  { label: "Sea state", value: "n/a", trend: "awaiting marine weather" },
];

export const fallbackDashboardData: DashboardData = {
  source: "none",
  chmarlSource: "none",
  portOpsSource: "none",
  weatherSource: "none",
  weatherPoints: [],
  chmarlSteps: [],
  metrics: realOnlyMetrics,
  vessels: [],
  portEvents: [],
  portQueueStatus: [],
  rewardTrend: [],
  constraintPressure: [],
  portUtilization: [],
  timelineEvents: [],
};

function toRewardTrend(points: (string | number)[][]): RewardTrendPoint[] {
  return points.map((point) => [String(point[0]), Number(point[1])] as RewardTrendPoint);
}

function isExternalSource(source: DashboardDataSource) {
  return source === "aisstream" || source === "aisstream-waiting" || source === "upstream" || source === "remote";
}

function hasPosition(row: Vessel) {
  return Number.isFinite(row.latitude) && Number.isFinite(row.longitude);
}

function speedKnots(row: Vessel) {
  const parsed = Number.parseFloat(row.speed.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function stalePosition(row: Vessel) {
  if (!row.timestamp) return false;
  const timestamp = Date.parse(row.timestamp);
  if (!Number.isFinite(timestamp)) return false;
  return Date.now() - timestamp > 30 * 60 * 1000;
}

function pct(count: number, total: number) {
  if (total === 0) return 0;
  return Number(((count / total) * 100).toFixed(1));
}

function deriveConstraintPressureFromVessels(rows: Vessel[]): ChartDatum[] {
  const total = rows.length;
  const missingPosition = rows.filter((row) => !hasPosition(row)).length;
  const stale = rows.filter(stalePosition).length;
  const slow = rows.filter((row) => {
    const speed = speedKnots(row);
    return speed !== undefined && speed <= 0.5;
  }).length;
  const watch = rows.filter((row) => row.status === "Watch").length;
  const constrained = rows.filter((row) => row.status === "Constrained").length;
  return [
    { name: "Constrained vessels", value: pct(constrained, total) },
    { name: "Watch vessels", value: pct(watch, total) },
    { name: "Missing position", value: pct(missingPosition, total) },
    { name: "Stale position", value: pct(stale, total) },
    { name: "Low speed", value: pct(slow, total) },
  ];
}

function externalTimeline(source: DashboardDataSource, rows: Vessel[], chmarlSource: ChmarlDataSource, portOpsSource: PortOpsDataSource): TimelineEvent[] {
  if (source === "aisstream-waiting") {
    return [{ time: "live", title: "AIS connected, waiting for position messages", body: "The backend socket is active, but no positions have been cached for the selected boxes yet." }];
  }
  if (!isExternalSource(source)) return [];
  return [{ time: "live", title: chmarlSource !== "none" ? "Live feed + online inference active" : "External feed active", body: `${rows.length} rows are loaded from ${source}. CH-MARL source: ${chmarlSource}. Port source: ${portOpsSource}.` }];
}

export async function loadSampleDashboardData(): Promise<DashboardData> {
  const [remoteVessels, runtimeExperiment, runtimePortOps, marineWeather] = await Promise.all([
    loadRemoteDashboardVessels().catch(() => null),
    loadRuntimeChmarlExperiment().catch(() => null),
    loadRuntimePortOperations().catch(() => null),
    loadMarineWeather().catch(() => null),
  ]);

  const rows = remoteVessels?.vessels ?? [];
  const source: DashboardDataSource = remoteVessels?.source ?? "none";
  const externalSource = isExternalSource(source);
  const experimentSteps = runtimeExperiment?.steps ?? [];
  const chmarlSource: ChmarlDataSource = runtimeExperiment?.source ?? "none";
  const portOpsSource: PortOpsDataSource = runtimePortOps ? runtimePortOps.source : "none";
  const weatherSource: WeatherDataSource = marineWeather?.source ?? "none";
  const rewardData = experimentSteps.length > 0 ? toRewardTrend(experimentStepsToRewardTrend(experimentSteps)) : [];
  const constraintData = experimentSteps.length > 0 ? experimentStepsToConstraintPressure(experimentSteps) : externalSource ? deriveConstraintPressureFromVessels(rows) : [];
  const timelineData = experimentSteps.length > 0 ? experimentStepsToTimelineEvents(experimentSteps) : externalSource ? externalTimeline(source, rows, chmarlSource, portOpsSource) : [];

  return {
    source,
    chmarlSource,
    portOpsSource,
    weatherSource,
    weatherPoints: marineWeather?.points ?? [],
    chmarlExperimentId: runtimeExperiment?.experimentId ?? experimentSteps[0]?.experimentId,
    chmarlScenarioId: runtimeExperiment?.scenarioId ?? experimentSteps[0]?.scenarioId,
    chmarlSteps: experimentSteps,
    metrics: realOnlyMetrics,
    vessels: rows,
    portEvents: runtimePortOps?.portEvents ?? [],
    portQueueStatus: runtimePortOps?.queueStatus ?? [],
    rewardTrend: rewardData,
    constraintPressure: constraintData,
    portUtilization: runtimePortOps?.portUtilization ?? [],
    timelineEvents: timelineData,
  };
}
