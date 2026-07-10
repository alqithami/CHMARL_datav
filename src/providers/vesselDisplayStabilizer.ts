import type { Vessel } from "@/data/chmarlData";

type CachedVessel = {
  vessel: Vessel;
  lastObservedAt: number;
  sampleScore: number;
};

const retentionMs = 15 * 60 * 1000;
const gridDegrees = 10;
const maxPerGridCell = 8;
const maxDisplayRows = 5_500;

const cache = new Map<string, CachedVessel>();

function stableScore(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function hasCoordinates(vessel: Vessel): vessel is Vessel & { latitude: number; longitude: number } {
  return Number.isFinite(vessel.latitude) && Number.isFinite(vessel.longitude);
}

function gridKey(vessel: Vessel & { latitude: number; longitude: number }) {
  const latitudeBand = Math.floor((vessel.latitude + 90) / gridDegrees);
  const longitudeBand = Math.floor((vessel.longitude + 180) / gridDegrees);
  return `${latitudeBand}:${longitudeBand}`;
}

function inMiddleEastOperationalCorridor(vessel: Vessel & { latitude: number; longitude: number }) {
  return vessel.latitude >= 10 && vessel.latitude <= 33 && vessel.longitude >= 30 && vessel.longitude <= 59;
}

function vesselTimestamp(vessel: Vessel) {
  const parsed = Date.parse(String(vessel.timestamp ?? ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Global AIS providers can return a different high-volume cohort on every poll.
 * Keeping only each response makes the map appear to alternate between two or
 * more snapshots. This cache retains recently observed rows and applies a
 * deterministic spatial sample, while always prioritising the Middle East
 * operational corridor.
 */
export function stabilizeVesselDisplay(rows: Vessel[], now = Date.now()) {
  for (const vessel of rows) {
    if (!vessel.id || !hasCoordinates(vessel)) continue;
    cache.set(vessel.id, {
      vessel,
      lastObservedAt: now,
      sampleScore: stableScore(vessel.id),
    });
  }

  for (const [id, entry] of cache.entries()) {
    if (now - entry.lastObservedAt > retentionMs) cache.delete(id);
  }

  const protectedRows: CachedVessel[] = [];
  const cells = new Map<string, CachedVessel[]>();

  for (const entry of cache.values()) {
    if (!hasCoordinates(entry.vessel)) continue;
    if (inMiddleEastOperationalCorridor(entry.vessel)) {
      protectedRows.push(entry);
      continue;
    }
    const key = gridKey(entry.vessel);
    const bucket = cells.get(key) ?? [];
    bucket.push(entry);
    cells.set(key, bucket);
  }

  protectedRows.sort((a, b) => vesselTimestamp(b.vessel) - vesselTimestamp(a.vessel) || a.sampleScore - b.sampleScore);
  const selected: CachedVessel[] = [...protectedRows];

  for (const bucket of cells.values()) {
    bucket.sort((a, b) => a.sampleScore - b.sampleScore);
    selected.push(...bucket.slice(0, maxPerGridCell));
  }

  if (selected.length > maxDisplayRows) {
    const protectedIds = new Set(protectedRows.map((entry) => entry.vessel.id));
    selected.sort((a, b) => {
      const aProtected = protectedIds.has(a.vessel.id) ? 1 : 0;
      const bProtected = protectedIds.has(b.vessel.id) ? 1 : 0;
      return bProtected - aProtected || a.sampleScore - b.sampleScore;
    });
    selected.length = maxDisplayRows;
  }

  return selected
    .map((entry) => entry.vessel)
    .sort((a, b) => a.id.localeCompare(b.id));
}
