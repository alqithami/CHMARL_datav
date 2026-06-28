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
import { loadRuntimePortOperations } from "@/providers/portOperationsProvider";
import type { ChmarlExperimentStep, PortEvent } from "@/types/chmarl";

export type ChartDatum = {
  name: string;
  value: number;
};

export type DashboardDataSource = "aisstream" | "aisstream-waiting" | "upstream" | "remote" | "local-json" | "fallback";
export type ChmarlDataSource = "runtime" | "local-json" | "none";
export type PortOpsDataSource = "runtime" | "local-json" | "none";

export type DashboardData = {
  source: DashboardDataSource;
  chmarlSource: ChmarlDataSource;
  portOpsSource: PortOpsDataSource;
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

export const fallbackDashboardData: DashboardData = {
  source: "fallback",
  chmarlSource: "local-json",
  portOpsSource: "local-json",
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
      title: chmarlSource !== "none" ? "Live vessel feed + CH-MARL active" : "External vessel feed active",
      body: `${vesselRows.length} vessel rows are loaded from ${source}. CH-MARL source: ${chmarlSource}. Port operations source: ${portOpsSource}.`,
    },
  ];
}

export async function loadSampleDashboardData(): Promise<DashboardData> {
  const [remoteVessels, runtimeExperiment, runtimePortOps, rawVessels, rawPortEvents, localExperimentSteps] = await Promise.all([
    loadRemoteDashboardVessels().catch(() => null),
    loadRuntimeChmarlExperiment().catch(() => null),
    loadRuntimePortOperations().catch(() => null),
    fetchJson<RawAisVesselUpdate[]>("vessels.sample.json"),
    fetchJson<RawPortEvent[]>("port_events.sample.json"),
    fetchJson<ChmarlExperimentStep[]>("chmarl_episode.sample.json"),
    fetchJson<unknown>("maritime_layers.sample.geojson"),
  ]);

  const localVessels = normalizeAisBatch(rawVessels).map(vesselStateToDashboardRow);
  const dashboardVessels = remoteVessels?.vessels ?? localVessels;
  const source: DashboardDataSource = remoteVessels?.source ?? "local-json";
  const externalSource = isExternalSource(source);
  const experimentSteps = runtimeExperiment?.steps ?? localExperimentSteps;
  const chmarlSource: ChmarlDataSource = runtimeExperiment
    ? "runtime"
    : localExperimentSteps.length > 0
      ? "local-json"
      : "none";
  const portOpsSource: PortOpsDataSource = runtimePortOps
    ? "runtime"
    : externalSource
      ? "none"
      : "local-json";

  const normalizedPortEvents = runtimePortOps?.portEvents ?? (externalSource ? [] : normalizePortEventBatch(rawPortEvents));
  const rewardData = experimentSteps.length > 0 ? toRewardTrend(experimentStepsToRewardTrend(experimentSteps)) : [];
  const constraintData = experimentSteps.length > 0
    ? experimentStepsToConstraintPressure(experimentSteps)
    : externalSource
      ? deriveConstraintPressureFromVessels(dashboardVessels)
      : experimentStepsToConstraintPressure(localExperimentSteps);
  const utilizationData = runtimePortOps?.portUtilization ?? (externalSource ? [] : portUtilization);
  const timelineData = experimentSteps.length > 0
    ? experimentStepsToTimelineEvents(experimentSteps)
    : externalSource
      ? externalTimeline(source, dashboardVessels, chmarlSource, portOpsSource)
      : experimentStepsToTimelineEvents(localExperimentSteps);

  const fileDrivenMetrics = updateMetric(
    updateMetric(metrics, "Active vessels", String(dashboardVessels.length), source),
    "Reward index",
    rewardData.at(-1)?.[1].toFixed(3) ?? "n/a",
    chmarlSource === "runtime" ? "runtime CH-MARL log active" : chmarlSource === "local-json" ? "from local CH-MARL episode" : "no CH-MARL log connected"
  );

  return {
    source,
    chmarlSource,
    portOpsSource,
    chmarlExperimentId: runtimeExperiment?.experimentId ?? experimentSteps[0]?.experimentId,
    chmarlScenarioId: runtimeExperiment?.scenarioId ?? experimentSteps[0]?.scenarioId,
    metrics: fileDrivenMetrics,
    vessels: dashboardVessels,
    portEvents: normalizedPortEvents,
    rewardTrend: rewardData.length > 0 ? rewardData : chmarlSource === "none" ? [] : rewardTrend,
    constraintPressure: constraintData.length > 0 ? constraintData : externalSource ? [] : constraintPressure,
    portUtilization: utilizationData,
    timelineEvents: timelineData.length > 0 ? timelineData : externalSource ? [] : timelineEvents,
  };
}
