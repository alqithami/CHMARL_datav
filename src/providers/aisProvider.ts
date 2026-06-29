import type { VesselState } from "@/types/chmarl";

type ProviderVesselState = Omit<VesselState, "latitude" | "longitude"> & {
  latitude?: number;
  longitude?: number;
};

type RawProviderRow = Record<string, unknown>;

export type AisProviderResult = {
  source: "live-ais" | "local-json";
  vessels: ProviderVesselState[];
};

function getAisProxyUrl() {
  return import.meta.env.VITE_AIS_PROXY_URL?.trim() as string | undefined;
}

function extractRows(payload: unknown): RawProviderRow[] {
  if (Array.isArray(payload)) return payload as RawProviderRow[];

  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    if (Array.isArray(record.vessels)) return record.vessels as RawProviderRow[];
    if (Array.isArray(record.data)) return record.data as RawProviderRow[];
    if (Array.isArray(record.items)) return record.items as RawProviderRow[];
  }

  throw new Error("AIS proxy response must be an array or an object with vessels/data/items array.");
}

function toFiniteNumber(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return undefined;
    const parsed = Number(text);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function asText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeRow(row: RawProviderRow): ProviderVesselState {
  const name = asText(row.name) ?? asText(row.vesselName) ?? "Unknown Vessel";
  const mmsi = asText(row.mmsi);
  const imo = asText(row.imo);
  const vesselId = asText(row.vesselId) ?? mmsi ?? imo ?? name;

  return {
    vesselId,
    mmsi,
    imo,
    name,
    vesselType: asText(row.vesselType),
    cargoClass: asText(row.cargoClass),
    latitude: toFiniteNumber(row.latitude ?? row.lat),
    longitude: toFiniteNumber(row.longitude ?? row.lon ?? row.lng),
    speedKnots: toFiniteNumber(row.speedKnots ?? row.sog),
    courseDeg: toFiniteNumber(row.courseDeg ?? row.cog),
    headingDeg: toFiniteNumber(row.headingDeg ?? row.heading),
    navStatus: asText(row.navStatus),
    draughtMeters: toFiniteNumber(row.draughtMeters ?? row.draught),
    originPort: asText(row.originPort),
    destinationPort: asText(row.destinationPort) ?? asText(row.destination),
    eta: asText(row.eta),
    timestamp: asText(row.timestamp) ?? new Date().toISOString(),
  };
}

export async function loadLiveAisVessels(): Promise<AisProviderResult | null> {
  const url = getAisProxyUrl();
  if (!url) return null;

  const response = await fetch(url, { headers: { Accept: "application/json" } }).catch((error: unknown) => {
    console.warn("AIS proxy request failed.", error);
    return null;
  });

  if (!response) return null;

  if (!response.ok) {
    console.warn(`AIS proxy request returned ${response.status} ${response.statusText}`);
    return null;
  }

  const payload = await response.json();

  return {
    source: "live-ais",
    vessels: extractRows(payload).map(normalizeRow),
  };
}
