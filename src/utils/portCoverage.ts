import type { Vessel } from "@/data/chmarlData";

export type MonitoredPortArea = "Saudi" | "Regional";

export type MonitoredPort = {
  id: string;
  shortId: string;
  area: MonitoredPortArea;
  latitude: number;
  longitude: number;
};

export type PortCoverageRow = {
  port: MonitoredPort;
  count: number;
  fresh: number;
  stale: number;
  sharePct: number;
  examples: string[];
};

export type PortCoverageSummary = {
  totalRows: number;
  maxDistanceNm: number;
  staleAgeMs: number;
  saudiNearPort: number;
  regionalNearPort: number;
  offshore: number;
  missingPosition: number;
  rows: PortCoverageRow[];
};

export const monitoredPorts: MonitoredPort[] = [
  { id: "Jeddah", shortId: "JED", area: "Saudi", latitude: 21.4858, longitude: 39.1925 },
  { id: "King Abdullah Port", shortId: "KAP", area: "Saudi", latitude: 22.3924, longitude: 39.0953 },
  { id: "Yanbu", shortId: "YAN", area: "Saudi", latitude: 24.0866, longitude: 38.0637 },
  { id: "Jizan", shortId: "JIZ", area: "Saudi", latitude: 16.8917, longitude: 42.5511 },
  { id: "Dammam", shortId: "DAM", area: "Saudi", latitude: 26.4318, longitude: 50.1015 },
  { id: "Jebel Ali", shortId: "JEA", area: "Regional", latitude: 25.0114, longitude: 55.0611 },
  { id: "Suez", shortId: "SUE", area: "Regional", latitude: 29.9668, longitude: 32.5498 },
];

function hasPosition(vessel: Vessel) {
  return Number.isFinite(vessel.latitude) && Number.isFinite(vessel.longitude);
}

function timestampMs(value?: string) {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isFresh(vessel: Vessel, staleAgeMs: number) {
  const ts = timestampMs(vessel.timestamp);
  return ts === 0 || Date.now() - ts <= staleAgeMs;
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

export function nearestMonitoredPort(vessel: Vessel) {
  if (!hasPosition(vessel)) return undefined;
  const point = { latitude: vessel.latitude as number, longitude: vessel.longitude as number };
  return monitoredPorts
    .map((port) => ({ port, distance: distanceNm(point, port) }))
    .sort((a, b) => a.distance - b.distance)[0];
}

export function summarizePortCoverage(vessels: Vessel[], maxDistanceNm = 120, staleAgeMs = 30 * 60 * 1000): PortCoverageSummary {
  const rows = new Map<string, PortCoverageRow>();
  for (const port of monitoredPorts) {
    rows.set(port.id, { port, count: 0, fresh: 0, stale: 0, sharePct: 0, examples: [] });
  }

  let offshore = 0;
  let missingPosition = 0;

  for (const vessel of vessels) {
    const nearest = nearestMonitoredPort(vessel);
    if (!nearest) {
      missingPosition += 1;
      continue;
    }
    if (nearest.distance > maxDistanceNm) {
      offshore += 1;
      continue;
    }

    const row = rows.get(nearest.port.id);
    if (!row) continue;
    row.count += 1;
    if (isFresh(vessel, staleAgeMs)) row.fresh += 1;
    else row.stale += 1;
    if (row.examples.length < 3) row.examples.push(vessel.name || vessel.id);
  }

  const portRows = [...rows.values()].map((row) => ({
    ...row,
    sharePct: vessels.length === 0 ? 0 : Number(((row.count / vessels.length) * 100).toFixed(1)),
  }));

  return {
    totalRows: vessels.length,
    maxDistanceNm,
    staleAgeMs,
    saudiNearPort: portRows.filter((row) => row.port.area === "Saudi").reduce((sum, row) => sum + row.count, 0),
    regionalNearPort: portRows.filter((row) => row.port.area === "Regional").reduce((sum, row) => sum + row.count, 0),
    offshore,
    missingPosition,
    rows: portRows,
  };
}
