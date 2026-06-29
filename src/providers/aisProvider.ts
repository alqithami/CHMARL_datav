import { normalizeAisBatch, type RawAisVesselUpdate } from "@/adapters/aisAdapter";
import type { VesselState } from "@/types/chmarl";

export type AisProviderResult = {
  source: "live-ais" | "local-json";
  vessels: VesselState[];
};

function getAisProxyUrl() {
  return import.meta.env.VITE_AIS_PROXY_URL?.trim() as string | undefined;
}

function extractVesselUpdates(payload: unknown): RawAisVesselUpdate[] {
  if (Array.isArray(payload)) return payload as RawAisVesselUpdate[];

  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    if (Array.isArray(record.vessels)) return record.vessels as RawAisVesselUpdate[];
    if (Array.isArray(record.data)) return record.data as RawAisVesselUpdate[];
    if (Array.isArray(record.items)) return record.items as RawAisVesselUpdate[];
  }

  throw new Error("AIS proxy response must be an array or an object with vessels/data/items array.");
}

export async function loadLiveAisVessels(): Promise<AisProviderResult | null> {
  const url = getAisProxyUrl();
  if (!url) return null;

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
    },
  }).catch((error: unknown) => {
    console.warn("AIS proxy request failed.", error);
    return null;
  });

  if (!response) return null;

  if (!response.ok) {
    console.warn(`AIS proxy request returned ${response.status} ${response.statusText}`);
    return null;
  }

  const payload = await response.json();
  const updates = extractVesselUpdates(payload);

  return {
    source: "live-ais",
    vessels: normalizeAisBatch(updates).map((item) => item.state),
  };
}
