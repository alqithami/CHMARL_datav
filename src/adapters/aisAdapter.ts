import type { Vessel } from "@/data/chmarlData";
import type { VesselState } from "@/types/chmarl";

export interface RawAisVesselUpdate {
  vesselId?: string;
  mmsi?: string;
  imo?: string;
  name?: string;
  vesselName?: string;
  vesselType?: string;
  cargoClass?: string;
  lat?: number | string;
  latitude?: number | string;
  lon?: number | string;
  longitude?: number | string;
  sog?: number | string;
  speedKnots?: number | string;
  cog?: number | string;
  courseDeg?: number | string;
  heading?: number | string;
  headingDeg?: number | string;
  navStatus?: string;
  draught?: number | string;
  draughtMeters?: number | string;
  originPort?: string;
  destination?: string;
  destinationPort?: string;
  eta?: string;
  timestamp?: string;
}

function numberOrFallback(value: number | string | undefined, fallback: number) {
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function optionalNumber(value: number | string | undefined) {
  if (value === undefined) return undefined;
  const parsed = numberOrFallback(value, Number.NaN);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function normalizeAisVesselUpdate(update: RawAisVesselUpdate): VesselState {
  const name = update.name ?? update.vesselName ?? "Unknown Vessel";
  const mmsi = update.mmsi;
  const imo = update.imo;
  const vesselId = update.vesselId ?? mmsi ?? imo ?? name;

  return {
    vesselId,
    mmsi,
    imo,
    name,
    vesselType: update.vesselType,
    cargoClass: update.cargoClass,
    latitude: numberOrFallback(update.latitude ?? update.lat, 0),
    longitude: numberOrFallback(update.longitude ?? update.lon, 0),
    speedKnots: optionalNumber(update.speedKnots ?? update.sog),
    courseDeg: optionalNumber(update.courseDeg ?? update.cog),
    headingDeg: optionalNumber(update.headingDeg ?? update.heading),
    navStatus: update.navStatus,
    draughtMeters: optionalNumber(update.draughtMeters ?? update.draught),
    originPort: update.originPort,
    destinationPort: update.destinationPort ?? update.destination,
    eta: update.eta,
    timestamp: update.timestamp ?? new Date().toISOString(),
  };
}

export function vesselStateToDashboardRow(state: VesselState): Vessel {
  const status: Vessel["status"] = state.navStatus?.toLowerCase().includes("constrained")
    ? "Constrained"
    : state.navStatus?.toLowerCase().includes("watch")
      ? "Watch"
      : "Nominal";

  return {
    id: state.mmsi ? `MMSI-${state.mmsi}` : state.vesselId,
    name: state.name,
    route: `${state.originPort ?? "Unknown"} → ${state.destinationPort ?? "Unknown"}`,
    cargo: state.cargoClass ?? state.vesselType ?? "Unspecified",
    eta: state.eta ?? "TBD",
    speed: state.speedKnots === undefined ? "TBD" : `${state.speedKnots.toFixed(1)} kn`,
    status,
  };
}

export function normalizeAisBatch(updates: RawAisVesselUpdate[]) {
  return updates.map(normalizeAisVesselUpdate);
}
