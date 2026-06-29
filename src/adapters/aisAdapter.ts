import type { Vessel, VesselTrailPoint } from "@/data/chmarlData";
import type { VesselState } from "@/types/chmarl";

export type RawAisVesselUpdate = Record<string, unknown>;

export type NormalizedAisVesselUpdate = {
  state: VesselState;
  trail?: VesselTrailPoint[];
};

function readText(row: RawAisVesselUpdate, key: string) {
  const value = row[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readNumber(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return undefined;
    const parsed = Number(text);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function readTrail(row: RawAisVesselUpdate) {
  const raw = row.trail ?? row.history ?? row.track;
  if (!Array.isArray(raw)) return undefined;
  const points: VesselTrailPoint[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const point = item as Record<string, unknown>;
    const latitude = readNumber(point.latitude ?? point.lat);
    const longitude = readNumber(point.longitude ?? point.lon ?? point.lng);
    if (latitude === undefined || longitude === undefined) continue;
    const next: VesselTrailPoint = { latitude, longitude };
    if (typeof point.timestamp === "string") next.timestamp = point.timestamp;
    points.push(next);
  }
  return points.length > 1 ? points : undefined;
}

export function normalizeAisVesselUpdate(row: RawAisVesselUpdate): NormalizedAisVesselUpdate {
  const name = readText(row, "name") ?? readText(row, "vesselName") ?? "Unknown Vessel";
  const state: VesselState = {
    vesselId: readText(row, "vesselId") ?? readText(row, "mmsi") ?? readText(row, "imo") ?? name,
    mmsi: readText(row, "mmsi"),
    imo: readText(row, "imo"),
    name,
    vesselType: readText(row, "vesselType"),
    cargoClass: readText(row, "cargoClass"),
    latitude: readNumber(row.latitude ?? row.lat),
    longitude: readNumber(row.longitude ?? row.lon ?? row.lng),
    speedKnots: readNumber(row.speedKnots ?? row.sog),
    courseDeg: readNumber(row.courseDeg ?? row.cog),
    headingDeg: readNumber(row.headingDeg ?? row.heading),
    navStatus: readText(row, "navStatus"),
    draughtMeters: readNumber(row.draughtMeters ?? row.draught),
    originPort: readText(row, "originPort"),
    destinationPort: readText(row, "destinationPort") ?? readText(row, "destination"),
    eta: readText(row, "eta"),
    timestamp: readText(row, "timestamp") ?? new Date().toISOString(),
  };
  return { state, trail: readTrail(row) };
}

export function vesselStateToDashboardRow(state: VesselState, trail?: VesselTrailPoint[]): Vessel {
  const statusText = state.navStatus?.toLowerCase() ?? "";
  const status: Vessel["status"] = statusText.includes("constrained") ? "Constrained" : statusText.includes("watch") ? "Watch" : "Nominal";
  return {
    id: state.mmsi ?? state.vesselId,
    name: state.name,
    route: `${state.originPort ?? "Unknown"} → ${state.destinationPort ?? "Unknown"}`,
    cargo: state.cargoClass ?? state.vesselType ?? "Unspecified",
    eta: state.eta ?? "TBD",
    speed: state.speedKnots === undefined ? "TBD" : `${state.speedKnots.toFixed(1)} kn`,
    status,
    latitude: state.latitude,
    longitude: state.longitude,
    headingDeg: state.headingDeg,
    courseDeg: state.courseDeg,
    timestamp: state.timestamp,
    trail,
  };
}

export function normalizeAisBatch(rows: RawAisVesselUpdate[]) {
  return rows.map(normalizeAisVesselUpdate);
}
