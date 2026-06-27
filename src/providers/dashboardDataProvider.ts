import type { Vessel } from "@/data/chmarlData";

export type DashboardVesselFeed = {
  source: "remote";
  vessels: Vessel[];
};

function endpointUrl() {
  return import.meta.env.VITE_VESSEL_DATA_URL?.trim() as string | undefined;
}

function extractVessels(payload: unknown): Vessel[] {
  if (Array.isArray(payload)) return payload as Vessel[];
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    if (Array.isArray(record.vessels)) return record.vessels as Vessel[];
    if (Array.isArray(record.data)) return record.data as Vessel[];
  }
  throw new Error("Remote vessel feed must return an array or an object with vessels/data array.");
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
    vessels: extractVessels(payload),
  };
}
