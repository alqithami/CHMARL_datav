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
  const normalizedPortEvents = normalizePortEventBatch(rawPortEvents);
  const rewardData = toRewardTrend(experimentStepsToRewardTrend(experimentSteps));
  const constraintData = experimentStepsToConstraintPressure(experimentSteps);
  const timelineData = experimentStepsToTimelineEvents(experimentSteps);
  const source: DashboardDataSource = remoteVessels?.source ?? "local-json";

  const fileDrivenMetrics = updateMetric(
    updateMetric(metrics, "Active vessels", String(dashboardVessels.length), source),
    "Reward index",
    rewardData.at(-1)?.[1].toFixed(3) ?? metrics[3].value,
    "from local CH-MARL episode"
  );

  return {
    source,
    metrics: fileDrivenMetrics,
    vessels: dashboardVessels,
    portEvents: normalizedPortEvents,
    rewardTrend: rewardData.length > 0 ? rewardData : rewardTrend,
    constraintPressure: constraintData.length > 0 ? constraintData : constraintPressure,
    portUtilization,
    timelineEvents: timelineData.length > 0 ? timelineData : timelineEvents,
  };
}
