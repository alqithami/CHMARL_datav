import type { Vessel } from "@/data/chmarlData";

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
};

export type DashboardVesselFeed = {
  source: "remote";
  vessels: Vessel[];
};

function endpointUrl() {
  return import.meta.env.VITE_VESSEL_DATA_URL?.trim() as string | undefined;
}

function extractRows(payload: unknown): RemoteVesselRow[] {
  if (Array.isArray(payload)) return payload as RemoteVesselRow[];
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    if (Array.isArray(record.vessels)) return record.vessels as RemoteVesselRow[];
    if (Array.isArray(record.data)) return record.data as RemoteVesselRow[];
    if (Array.isArray(record.items)) return record.items as RemoteVesselRow[];
  }
  throw new Error("Remote vessel feed must return an array or an object with vessels/data/items array.");
}

function normalizeStatus(value: unknown): Vessel["status"] {
  const text = String(value ?? "").toLowerCase();
  if (text.includes("constraint") || text.includes("restricted") || text.includes("alert")) return "Constrained";
  if (text.includes("watch") || text.includes("warning") || text.includes("delay")) return "Watch";
  return "Nominal";
}

function formatSpeed(value: unknown): string {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.toLowerCase().includes("kn") ? value : `${value} kn`;
  }
  if (typeof value === "number" && Number.isFinite(value)) return `${value.toFixed(1)} kn`;
  return "TBD";
}

function toDashboardVessel(row: RemoteVesselRow): Vessel {
  const name = row.name ?? row.vesselName ?? row.shipName ?? "Unknown Vessel";
  const id = row.id ?? row.vesselId ?? (row.mmsi ? `MMSI-${row.mmsi}` : row.imo ? `IMO-${row.imo}` : name);
  const origin = row.originPort ?? row.origin ?? "Unknown";
  const destination = row.destinationPort ?? row.destination ?? row.dest ?? "Unknown";

  return {
    id: String(id),
    name: String(name),
    route: row.route ?? `${origin} → ${destination}`,
    cargo: row.cargo ?? row.cargoClass ?? row.vesselType ?? row.shipType ?? "Unspecified",
    eta: row.eta ?? row.ETA ?? "TBD",
    speed: row.speed ?? formatSpeed(row.speedKnots ?? row.sog),
    status: row.status ?? normalizeStatus(row.navStatus),
  };
}

export async function loadRemoteDashboardVessels(): Promise<DashboardVesselFeed | null> {
  const url = endpointUrl();
  if (!url) return null;

  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`Remote vessel feed request failed: ${response.status} ${response.statusText}`);
  }

  const payload = await response.json();
  return {
    source: "remote",
    vessels: extractRows(payload).map(toDashboardVessel),
  };
}
