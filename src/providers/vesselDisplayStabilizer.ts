import type { Vessel } from "@/data/chmarlData";

type CachedVessel = {
  vessel: Vessel;
  lastObservedAt: number;
  sampleScore: number;
};

export type VesselDisplayStats = {
  reportedRows: number;
  displayRows: number;
  freshRows: number;
  heldRows: number;
  cachedRows: number;
  expiredRows: number;
  updatedAt: number;
};

const standardRetentionMs = 60 * 60 * 1000;
const middleEastRetentionMs = 6 * 60 * 60 * 1000;
const gridDegrees = 5;
const maxPerGridCell = 8;
const maxDisplayRows = 6_500;
const maxImpliedSpeedKn = 120;
const minimumJumpDistanceNm = 5;

const cache = new Map<string, CachedVessel>();
const selectedIds = new Set<string>();
let lastStats: VesselDisplayStats = {
  reportedRows: 0,
  displayRows: 0,
  freshRows: 0,
  heldRows: 0,
  cachedRows: 0,
  expiredRows: 0,
  updatedAt: 0,
};

function stableScore(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function hasCoordinates(vessel: Vessel): vessel is Vessel & { latitude: number; longitude: number } {
  return Number.isFinite(vessel.latitude)
    && Number.isFinite(vessel.longitude)
    && (vessel.latitude as number) >= -85.051129
    && (vessel.latitude as number) <= 85.051129
    && (vessel.longitude as number) >= -180
    && (vessel.longitude as number) <= 180;
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

function stickyBucketSelection(bucket: CachedVessel[]) {
  const retained = bucket
    .filter((entry) => selectedIds.has(entry.vessel.id))
    .sort((a, b) => b.lastObservedAt - a.lastObservedAt || a.sampleScore - b.sampleScore)
    .slice(0, maxPerGridCell);
  if (retained.length >= maxPerGridCell) return retained;

  const retainedIds = new Set(retained.map((entry) => entry.vessel.id));
  const additions = bucket
    .filter((entry) => !retainedIds.has(entry.vessel.id))
    .sort((a, b) => a.sampleScore - b.sampleScore)
    .slice(0, maxPerGridCell - retained.length);
  return [...retained, ...additions];
}

function capSelection(entries: CachedVessel[]) {
  if (entries.length <= maxDisplayRows) return entries;
  const protectedEntries = entries.filter((entry) => hasCoordinates(entry.vessel) && inMiddleEastOperationalCorridor(entry.vessel));
  const protectedIds = new Set(protectedEntries.map((entry) => entry.vessel.id));
  const previouslyVisible = entries.filter((entry) => !protectedIds.has(entry.vessel.id) && selectedIds.has(entry.vessel.id));
  const newcomers = entries.filter((entry) => !protectedIds.has(entry.vessel.id) && !selectedIds.has(entry.vessel.id));

  protectedEntries.sort((a, b) => vesselTimestamp(b.vessel) - vesselTimestamp(a.vessel) || a.sampleScore - b.sampleScore);
  previouslyVisible.sort((a, b) => b.lastObservedAt - a.lastObservedAt || a.sampleScore - b.sampleScore);
  newcomers.sort((a, b) => a.sampleScore - b.sampleScore);
  return [...protectedEntries, ...previouslyVisible, ...newcomers].slice(0, maxDisplayRows);
}

/**
 * A world AIS subscription can return a different high-volume cohort on each
 * poll. This cache separates "not present in the latest response" from "no
 * longer tracked". Existing display members remain sticky through short API
 * gaps and are removed only after their retention window expires.
 */
export function stabilizeVesselDisplay(rows: Vessel[], now = Date.now()) {
  const seenIds = new Set<string>();
  for (const vessel of rows) {
    if (!vessel.id || !hasCoordinates(vessel)) continue;
    seenIds.add(vessel.id);
    const existing = cache.get(vessel.id);
    if (existing && !acceptsPositionUpdate(existing.vessel, vessel)) {
      cache.set(vessel.id, { ...existing, lastObservedAt: now });
      continue;
    }
    cache.set(vessel.id, {
      vessel,
      lastObservedAt: now,
      sampleScore: existing?.sampleScore ?? stableScore(vessel.id),
    });
  }

  let expiredRows = 0;
  for (const [id, entry] of cache.entries()) {
    if (!hasCoordinates(entry.vessel)) {
      cache.delete(id);
      selectedIds.delete(id);
      expiredRows += 1;
      continue;
    }
    const retentionMs = inMiddleEastOperationalCorridor(entry.vessel) ? middleEastRetentionMs : standardRetentionMs;
    if (now - entry.lastObservedAt > retentionMs) {
      cache.delete(id);
      selectedIds.delete(id);
      expiredRows += 1;
    }
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
  for (const [, bucket] of [...cells.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    selected.push(...stickyBucketSelection(bucket));
  }

  const capped = capSelection(selected);
  selectedIds.clear();
  for (const entry of capped) selectedIds.add(entry.vessel.id);

  const freshRows = capped.filter((entry) => seenIds.has(entry.vessel.id)).length;
  lastStats = {
    reportedRows: seenIds.size,
    displayRows: capped.length,
    freshRows,
    heldRows: Math.max(0, capped.length - freshRows),
    cachedRows: cache.size,
    expiredRows,
    updatedAt: now,
  };

  return capped
    .map((entry) => entry.vessel)
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function getVesselDisplayStats(): VesselDisplayStats {
  return { ...lastStats };
}
