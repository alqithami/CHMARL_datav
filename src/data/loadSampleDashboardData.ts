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

export type CoverageDiagnostics = {
  requireOperationalRegion: boolean;
  operationalRegionLabel: string;
  providerRows: number;
  operationalRows: number;
  outOfRegionRows: number;
};

export type DashboardData = {
  source: DashboardDataSource;
  chmarlSource: ChmarlDataSource;
  portOpsSource: PortOpsDataSource;
  weatherSource: WeatherDataSource;
  weatherPoints: MarineWeatherPoint[];
  coverageDiagnostics?: CoverageDiagnostics;
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

const operationalRegion = {
  label: "Red Sea / Gulf operational region",
  minLat: 11,
  maxLat: 31,
  minLon: 32,
  maxLon: 56,
};

const requireOperationalRegion = import.meta.env.VITE_REQUIRE_OPERATIONAL_REGION !== "false";

const saudiPortReferencePoints = [
  { id: "Jeddah", latitude: 21.4858, longitude: 39.1925 },
  { id: "King Abdullah Port", latitude: 22.3924, longitude: 39.0953 },
  { id: "Yanbu", latitude: 24.0866, longitude: 38.0637 },
  { id: "Jizan", latitude: 16.8917, longitude: 42.5511 },
  { id: "Dammam", latitude: 26.4318, longitude: 50.1015 },
  { id: "Jebel Ali", latitude: 25.0114, longitude: 55.0611 },
  { id: "Suez", latitude: 29.9668, longitude: 32.5498 },
];

const portPressureDistanceNm = 120;

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
  coverageDiagnostics: {
    requireOperationalRegion,
    operationalRegionLabel: operationalRegion.label,
    providerRows: 0,
    operationalRows: 0,
    outOfRegionRows: 0,
  },
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

function inOperationalRegion(row: Vessel) {
  if (!hasPosition(row)) return false;
  const latitude = row.latitude as number;
  const longitude = row.longitude as number;
  return latitude >= operationalRegion.minLat
    && latitude <= operationalRegion.maxLat
    && longitude >= operationalRegion.minLon
    && longitude <= operationalRegion.maxLon;
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

function distanceNm(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const radiusNm = 3440.065;
  const radians = (value: number) => (value * Math.PI) / 180;
  const dLat = radians(b.latitude - a.latitude);
  const dLon = radians(b.longitude - a.longitude);
  const lat1 = radians(a.latitude);
  const lat2 = radians(b.latitude);
  const haversine = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * radiusNm * Math.asin(Math.min(1, Math.sqrt(haversine)));
}

function nearestPort(row: Vessel) {
  if (!hasPosition(row)) return undefined;
  const point = { latitude: row.latitude as number, longitude: row.longitude as number };
  return saudiPortReferencePoints
    .map((port) => ({ port, distance: distanceNm(point, port) }))
    .sort((a, b) => a.distance - b.distance)[0];
}

function derivePortPressureFromVessels(rows: Vessel[]): ChartDatum[] {
  const total = rows.length;
  const counts = new Map(saudiPortReferencePoints.map((port) => [port.id, 0]));

  for (const row of rows) {
    const nearest = nearestPort(row);
    if (nearest && nearest.distance <= portPressureDistanceNm) {
      counts.set(nearest.port.id, (counts.get(nearest.port.id) ?? 0) + 1);
    }
  }

  return saudiPortReferencePoints.map((port) => ({
    name: `AIS pressure ${port.id}`,
    value: pct(counts.get(port.id) ?? 0, total),
  }));
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

function mergeConstraintPressure(experimentRows: ChartDatum[], vesselRows: Vessel[]): ChartDatum[] {
  const nonPortRows = experimentRows.filter((row) => !/^Port pressure\b/.test(row.name) && !/^AIS pressure\b/.test(row.name));
  if (vesselRows.length === 0) return nonPortRows;
  return [...nonPortRows, ...derivePortPressureFromVessels(vesselRows)];
}

function externalTimeline(source: DashboardDataSource, rows: Vessel[], chmarlSource: ChmarlDataSource, portOpsSource: PortOpsDataSource, coverage?: CoverageDiagnostics): TimelineEvent[] {
  if (coverage && coverage.providerRows > 0 && coverage.operationalRows === 0 && coverage.outOfRegionRows > 0) {
    return [{
      time: "live",
      title: "AIS feed outside operational region",
      body: `${coverage.outOfRegionRows} provider rows were outside ${coverage.operationalRegionLabel}; CH-MARL/EcoFair scoring is blocked until regional rows arrive or the production BBOX is restored.`,
    }];
  }
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

  const providerRows = remoteVessels?.vessels ?? [];
  const source: DashboardDataSource = remoteVessels?.source ?? "none";
  const externalSource = isExternalSource(source);
  const operationalRows = requireOperationalRegion && externalSource ? providerRows.filter(inOperationalRegion) : providerRows;
  const outOfRegionRows = requireOperationalRegion && externalSource ? providerRows.length - operationalRows.length : 0;
  const coverageDiagnostics: CoverageDiagnostics = {
    requireOperationalRegion,
    operationalRegionLabel: operationalRegion.label,
    providerRows: providerRows.length,
    operationalRows: operationalRows.length,
    outOfRegionRows,
  };
  const regionMismatch = requireOperationalRegion && externalSource && providerRows.length > 0 && operationalRows.length === 0;
  const rows = regionMismatch ? [] : operationalRows;
  const experimentSteps = regionMismatch ? [] : runtimeExperiment?.steps ?? [];
  const chmarlSource: ChmarlDataSource = regionMismatch ? "runtime" : runtimeExperiment?.source ?? "none";
  const portOpsSource: PortOpsDataSource = runtimePortOps ? runtimePortOps.source : "none";
  const weatherSource: WeatherDataSource = marineWeather?.source ?? "none";
  const rewardData = experimentSteps.length > 0 ? toRewardTrend(experimentStepsToRewardTrend(experimentSteps)) : [];
  const experimentConstraintData = experimentSteps.length > 0 ? experimentStepsToConstraintPressure(experimentSteps) : [];
  const vesselConstraintData = externalSource ? deriveConstraintPressureFromVessels(rows) : [];
  const constraintData = experimentSteps.length > 0 ? mergeConstraintPressure(experimentConstraintData, rows) : [...vesselConstraintData, ...derivePortPressureFromVessels(rows)];
  const timelineData = experimentSteps.length > 0 ? experimentStepsToTimelineEvents(experimentSteps) : externalSource ? externalTimeline(source, rows, chmarlSource, portOpsSource, coverageDiagnostics) : [];

  return {
    source,
    chmarlSource,
    portOpsSource,
    weatherSource,
    weatherPoints: marineWeather?.points ?? [],
    coverageDiagnostics,
    chmarlExperimentId: regionMismatch ? undefined : runtimeExperiment?.experimentId ?? experimentSteps[0]?.experimentId,
    chmarlScenarioId: regionMismatch ? undefined : runtimeExperiment?.scenarioId ?? experimentSteps[0]?.scenarioId,
    chmarlSteps: experimentSteps,
    metrics: realOnlyMetrics,
    vessels: rows,
    portEvents: regionMismatch ? [] : runtimePortOps?.portEvents ?? [],
    portQueueStatus: regionMismatch ? [] : runtimePortOps?.queueStatus ?? [],
    rewardTrend: rewardData,
    constraintPressure: constraintData,
    portUtilization: regionMismatch ? [] : runtimePortOps?.portUtilization ?? [],
    timelineEvents: timelineData,
  };
}
