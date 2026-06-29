import type { DashboardDataSource } from "@/data/loadSampleDashboardData";
import type { Vessel, VesselTrailPoint } from "@/data/chmarlData";
import { fetchFirstJson } from "./backendUrl";

type RemoteTrailPoint = Partial<VesselTrailPoint> & {
  lat?: string | number;
  lon?: string | number;
  lng?: string | number;
};

type RemoteVesselRow = Partial<Vessel> & {
  vesselId?: string;
  mmsi?: string | number;
  imo?: string | number;
  vesselName?: string;
  shipName?: string;
  vesselType?: string;
  shipType?: string;
  cargoClass?: string;
  originPort?: string;
  origin?: string;
  destinationPort?: string;
  destination?: string;
  dest?: string;
  ETA?: string;
  speedKnots?: string | number;
  sog?: string | number;
  navStatus?: string;
  lat?: string | number;
  lon?: string | number;
  lng?: string | number;
  heading?: string | number;
  cog?: string | number;
  trail?: RemoteTrailPoint[];
  history?: RemoteTrailPoint[];
  track?: RemoteTrailPoint[];
};

type RemoteVesselPayload = {
  source?: string;
  vessels?: RemoteVesselRow[];
  data?: RemoteVesselRow[];
  items?: RemoteVesselRow[];
};

export type DashboardVesselFeed = {
  source: DashboardDataSource;
  vessels: Vessel[];
};

function endpointUrl() {
  return import.meta.env.VITE_VESSEL_DATA_URL?.trim() || "/api/vessels";
}

function extractRows(payload: unknown): RemoteVesselRow[] {
  if (Array.isArray(payload)) return payload as RemoteVesselRow[];
  if (payload && typeof payload === "object") {
    const record = payload as RemoteVesselPayload;
    if (Array.isArray(record.vessels)) return record.vessels;
    if (Array.isArray(record.data)) return record.data;
    if (Array.isArray(record.items)) return record.items;
  }
  throw new Error("Remote vessel feed must return an array or an object with vessels/data/items array.");
}

function normalizeSource(value: unknown): DashboardDataSource {
  if (value === "aisstream") return "aisstream";
  if (value === "aisstream-waiting") return "aisstream-waiting";
  if (value === "upstream") return "upstream";
  if (value === "fallback") return "fallback";
  if (value === "none") return "none";
  return "remote";
}

function normalizeStatus(value: unknown): Vessel["status"] {
  const text = String(value ?? "").toLowerCase();
  if (text.includes("constraint") || text.includes("restricted") || text.includes("alert")) return "Constrained";
  if (text.includes("watch") || text.includes("warning") || text.includes("delay")) return "Watch";
  return "Nominal";
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function normalizeTrail(points: RemoteTrailPoint[] | undefined): VesselTrailPoint[] | undefined {
  if (!Array.isArray(points)) return undefined;

  const normalized: VesselTrailPoint[] = [];
  for (const point of points) {
    const latitude = toNumber(point.latitude ?? point.lat);
    const longitude = toNumber(point.longitude ?? point.lon ?? point.lng);
    if (latitude === undefined || longitude === undefined) continue;
    const entry: VesselTrailPoint = { latitude, longitude };
    if (point.timestamp !== undefined) entry.timestamp = point.timestamp;
    normalized.push(entry);
  }

  return normalized.length > 1 ? normalized : undefined;
}

function formatSpeed(value: unknown): string {
  if (typeof value === "string" && value.trim().length > 0) return value.toLowerCase().includes("kn") ? value : `${value} kn`;
  if (typeof value === "number" && Number.isFinite(value)) return `${value.toFixed(1)} kn`;
  return "TBD";
}

function toDashboardVessel(row: RemoteVesselRow): Vessel {
  const name = row.name ?? row.vesselName ?? row.shipName ?? "Unknown Vessel";
  const id = row.id ?? row.vesselId ?? (row.mmsi ? `MMSI-${row.mmsi}` : row.imo ? `IMO-${row.imo}` : name);
  const origin = row.originPort ?? row.origin ?? "Unknown";
  const destination = row.destinationPort ?? row.destination ?? row.dest ?? "Unknown";
  const latitude = toNumber(row.latitude ?? row.lat);
  const longitude = toNumber(row.longitude ?? row.lon ?? row.lng);

  return {
    id: String(id),
    name: String(name),
    route: row.route ?? `${origin} → ${destination}`,
    cargo: row.cargo ?? row.cargoClass ?? row.vesselType ?? row.shipType ?? "Unspecified",
    eta: row.eta ?? row.ETA ?? "TBD",
    speed: row.speed ?? formatSpeed(row.speedKnots ?? row.sog),
    status: row.status ?? normalizeStatus(row.navStatus),
    latitude,
    longitude,
    headingDeg: toNumber(row.headingDeg ?? row.heading),
    courseDeg: toNumber(row.courseDeg ?? row.cog),
    timestamp: row.timestamp,
    trail: normalizeTrail(row.trail ?? row.history ?? row.track),
  };
}

export async function loadRemoteDashboardVessels(): Promise<DashboardVesselFeed | null> {
  const payload = await fetchFirstJson<RemoteVesselPayload | RemoteVesselRow[]>(endpointUrl());
  if (!payload) return null;

  return {
    source: normalizeSource(!Array.isArray(payload) ? payload.source : undefined),
    vessels: extractRows(payload).map(toDashboardVessel),
  };
}
