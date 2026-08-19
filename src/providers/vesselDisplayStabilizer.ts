import type { Vessel } from "@/data/chmarlData";

type CachedVessel = {
  vessel: Vessel;
  lastObservedAt: number;
};

export type VesselDisplayStats = {
  reportedRows: number;
  displayRows: number;
  freshRows: number;
  heldRows: number;
  cachedRows: number;
  expiredRows: number;
  rejectedInvalidRows: number;
  countLimited: false;
  discardedByLocation: 0;
  updatedAt: number;
};

const configuredRetentionMs = Number(import.meta.env.VITE_VESSEL_DISPLAY_RETENTION_MS ?? 6 * 60 * 60 * 1000);
const retentionMs = Number.isFinite(configuredRetentionMs) && configuredRetentionMs > 0
  ? configuredRetentionMs
  : 6 * 60 * 60 * 1000;
const maxImpliedSpeedKn = 120;
const minimumJumpDistanceNm = 5;

const cache = new Map<string, CachedVessel>();
let lastStats: VesselDisplayStats = {
  reportedRows: 0,
  displayRows: 0,
  freshRows: 0,
  heldRows: 0,
  cachedRows: 0,
  expiredRows: 0,
  rejectedInvalidRows: 0,
  countLimited: false,
  discardedByLocation: 0,
  updatedAt: 0,
};

function hasCoordinates(vessel: Vessel): vessel is Vessel & { latitude: number; longitude: number } {
  return Number.isFinite(vessel.latitude)
    && Number.isFinite(vessel.longitude)
    && (vessel.latitude as number) >= -90
    && (vessel.latitude as number) <= 90
    && (vessel.longitude as number) >= -180
    && (vessel.longitude as number) <= 180;
}

function vesselTimestamp(vessel: Vessel) {
  const parsed = Date.parse(String(vessel.timestamp ?? ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function distanceNm(a: Vessel & { latitude: number; longitude: number }, b: Vessel & { latitude: number; longitude: number }) {
  const radiusNm = 3440.065;
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const dLat = toRadians(b.latitude - a.latitude);
  const dLon = toRadians(b.longitude - a.longitude);
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);
  const haversine = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * radiusNm * Math.asin(Math.min(1, Math.sqrt(haversine)));
}

function acceptsPositionUpdate(existing: Vessel, incoming: Vessel) {
  if (!hasCoordinates(existing) || !hasCoordinates(incoming)) return true;
  const existingTimestamp = vesselTimestamp(existing);
  const incomingTimestamp = vesselTimestamp(incoming);
  if (existingTimestamp > 0 && incomingTimestamp > 0 && incomingTimestamp < existingTimestamp) return false;
  if (existingTimestamp > 0 && incomingTimestamp > existingTimestamp) {
    const elapsedHours = (incomingTimestamp - existingTimestamp) / 3_600_000;
    const distance = distanceNm(existing, incoming);
    const impliedSpeed = elapsedHours > 0 ? distance / elapsedHours : 0;
    if (distance > minimumJumpDistanceNm && impliedSpeed > maxImpliedSpeedKn) return false;
  }
  return true;
}

/**
 * Retain every valid vessel row supplied by the backend. The display cache is
 * deduplicated by vessel ID and pruned only by a uniform time window. No count
 * ceiling, spatial sampling, regional preference, or geographic discard is
 * applied. Invalid/missing coordinates remain excluded because the map cannot
 * render a position that was not reported.
 */
export function stabilizeVesselDisplay(rows: Vessel[], now = Date.now()) {
  const seenIds = new Set<string>();
  let rejectedInvalidRows = 0;

  for (const vessel of rows) {
    if (!vessel.id || !hasCoordinates(vessel)) {
      rejectedInvalidRows += 1;
      continue;
    }
    seenIds.add(vessel.id);
    const existing = cache.get(vessel.id);
    if (existing && !acceptsPositionUpdate(existing.vessel, vessel)) {
      cache.set(vessel.id, { ...existing, lastObservedAt: now });
      continue;
    }
    cache.set(vessel.id, { vessel, lastObservedAt: now });
  }

  let expiredRows = 0;
  for (const [id, entry] of cache.entries()) {
    if (!hasCoordinates(entry.vessel) || now - entry.lastObservedAt > retentionMs) {
      cache.delete(id);
      expiredRows += 1;
    }
  }

  const retained = [...cache.values()];
  const freshRows = retained.filter((entry) => seenIds.has(entry.vessel.id)).length;
  lastStats = {
    reportedRows: seenIds.size,
    displayRows: retained.length,
    freshRows,
    heldRows: Math.max(0, retained.length - freshRows),
    cachedRows: retained.length,
    expiredRows,
    rejectedInvalidRows,
    countLimited: false,
    discardedByLocation: 0,
    updatedAt: now,
  };

  return retained
    .map((entry) => entry.vessel)
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function getVesselDisplayStats(): VesselDisplayStats {
  return { ...lastStats };
}
