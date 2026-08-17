import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const DEFAULT_URL = "https://pocketworld.org/api/ships";

function numeric(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function timestampValue(row, now) {
  const value = row?.observed_at
    ?? row?.last_update
    ?? row?.timestamp
    ?? row?.received_at
    ?? row?.updated_at;
  if (typeof value === "string" && Number.isFinite(Date.parse(value))) return value;
  if (typeof value === "number" && Number.isFinite(value)) {
    const milliseconds = value < 10_000_000_000 ? value * 1000 : value;
    return new Date(milliseconds).toISOString();
  }
  return new Date(now()).toISOString();
}

function timestampMs(value) {
  const parsed = Date.parse(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function navStatus(value) {
  const status = Number(value);
  if ([2, 3, 4, 6, 14].includes(status)) return "Constrained";
  if ([1, 5, 11, 12].includes(status)) return "Watch";
  return "Nominal";
}

function responseRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  if (Array.isArray(payload.ships)) return payload.ships;
  if (Array.isArray(payload.vessels)) return payload.vessels;
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.items)) return payload.items;
  return [];
}

export function normalizePocketWorldVessel(row, now = Date.now) {
  if (!row || typeof row !== "object") return null;
  const latitude = numeric(row.lat ?? row.latitude);
  const longitude = numeric(row.lng ?? row.lon ?? row.longitude);
  const mmsiValue = row.mmsi ?? row.MMSI;
  const mmsi = mmsiValue === undefined || mmsiValue === null ? "" : String(mmsiValue).trim();
  if (!mmsi || latitude === undefined || longitude === undefined) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;

  const source = String(row.source ?? row.sourceProvider ?? "public-ais").trim() || "public-ais";
  const speed = numeric(row.sog ?? row.speed ?? row.speed_knots);
  const observedAt = timestampValue(row, now);
  const typeName = String(row.type_name ?? row.cargo ?? row.vessel_type ?? row.ship_type ?? row.type ?? "AIS vessel");
  const name = String(row.name ?? row.ship_name ?? row.vessel_name ?? `MMSI ${mmsi}`).trim();

  return {
    id: `MMSI-${mmsi}`,
    mmsi,
    name: name || `MMSI ${mmsi}`,
    route: row.route ?? `Live AIS · ${source}`,
    cargo: typeName,
    eta: row.eta ?? "Live AIS",
    speed: typeof row.speed === "string" && row.speed.toLowerCase().includes("kn")
      ? row.speed
      : speed === undefined
        ? "TBD"
        : `${speed.toFixed(1)} kn`,
    sog: speed,
    status: row.status ?? navStatus(row.nav_status ?? row.navigation_status),
    latitude,
    longitude,
    headingDeg: numeric(row.headingDeg ?? row.heading ?? row.true_heading),
    courseDeg: numeric(row.courseDeg ?? row.cog ?? row.course),
    timestamp: observedAt,
    inputSource: row.inputSource ?? `pocketworld-${source}`,
    provider: "pocketworld",
    sourceProvider: source,
    sourceUrl: row.sourceUrl ?? row.source_url,
    country: row.country,
    countryCode: row.countryCode ?? row.country_code,
  };
}

function statusForHttp(statusCode) {
  if (statusCode === 429) return "rate-limited";
  if (statusCode >= 500) return "provider-error";
  return "request-error";
}

export function createPocketWorldLiveAisProvider({
  enabled = true,
  url = DEFAULT_URL,
  pollIntervalMs = 5 * 60_000,
  timeoutMs = 30_000,
  maxAgeMs = 6 * 60 * 60_000,
  freshAgeMs = 30 * 60_000,
  maxVessels = 5000,
  cacheFile,
  cacheFlushMs = 60_000,
  fetchImpl = globalThis.fetch,
  now = Date.now,
} = {}) {
  const active = Boolean(enabled && typeof fetchImpl === "function");
  const interval = Math.max(5_000, Number(pollIntervalMs) || 5 * 60_000);
  const requestTimeout = Math.max(1_000, Number(timeoutMs) || 30_000);
  const vesselDisplayMaxAge = Math.max(60_000, Number(maxAgeMs) || 6 * 60 * 60_000);
  const vesselFreshAge = Math.min(vesselDisplayMaxAge, Math.max(60_000, Number(freshAgeMs) || 30 * 60_000));
  const vesselLimit = Math.max(1, Number(maxVessels) || 5000);
  const cachePath = String(cacheFile ?? "").trim();
  const cacheWriteInterval = Math.max(5_000, Number(cacheFlushMs) || 60_000);
  const cache = new Map();
  let inFlight = null;
  let abortController = null;
  let lastCacheWriteMs = 0;

  const state = {
    provider: "pocketworld",
    enabled: active,
    configured: active,
    status: active ? "idle" : "disabled",
    url: String(url),
    pollIntervalMs: interval,
    maxAgeMs: vesselDisplayMaxAge,
    displayMaxAgeMs: vesselDisplayMaxAge,
    freshAgeMs: vesselFreshAge,
    maxVessels: vesselLimit,
    cacheFile: cachePath || null,
    cacheLoadedAt: null,
    cacheSavedAt: null,
    cacheSaveError: null,
    restoredVessels: 0,
    lastAttemptAt: null,
    lastSuccessAt: null,
    lastError: null,
    lastHttpStatus: null,
    nextPollAt: null,
    requests: 0,
    successfulPolls: 0,
    emptyPolls: 0,
    payloadCount: 0,
    rowsAccepted: 0,
    freshRowsInPayload: 0,
    lastKnownRowsInPayload: 0,
    rejectedInvalid: 0,
    rejectedStale: 0,
    rejectedExpired: 0,
    cachedVessels: 0,
    freshVessels: 0,
    lastKnownVessels: 0,
    newestObservationAt: null,
    oldestObservationAt: null,
    newestAgeMs: null,
    oldestAgeMs: null,
    staleHeader: false,
    connected: false,
    sourceHealth: null,
    observedSources: [],
    workingSources: [],
    coverage: null,
    totalAvailable: 0,
    truncated: false,
  };

  function observationAge(vessel) {
    const observed = timestampMs(vessel?.timestamp);
    return observed > 0 ? Math.max(0, now() - observed) : Number.POSITIVE_INFINITY;
  }

  function updateFreshnessState() {
    const rows = [...cache.values()];
    const ages = rows.map(observationAge).filter(Number.isFinite);
    state.cachedVessels = rows.length;
    state.freshVessels = rows.filter((vessel) => observationAge(vessel) <= vesselFreshAge).length;
    state.lastKnownVessels = Math.max(0, rows.length - state.freshVessels);
    if (rows.length > 0) {
      const ordered = rows
        .map((vessel) => ({ timestamp: timestampMs(vessel.timestamp), value: vessel.timestamp }))
        .filter((entry) => entry.timestamp > 0)
        .sort((a, b) => a.timestamp - b.timestamp);
      state.oldestObservationAt = ordered[0]?.value ?? null;
      state.newestObservationAt = ordered.at(-1)?.value ?? null;
      state.newestAgeMs = ages.length > 0 ? Math.min(...ages) : null;
      state.oldestAgeMs = ages.length > 0 ? Math.max(...ages) : null;
    } else {
      state.oldestObservationAt = null;
      state.newestObservationAt = null;
      state.newestAgeMs = null;
      state.oldestAgeMs = null;
    }
  }

  function prune() {
    const cutoff = now() - vesselDisplayMaxAge;
    for (const [id, vessel] of cache.entries()) {
      const parsed = timestampMs(vessel.timestamp);
      if (parsed > 0 && parsed < cutoff) cache.delete(id);
    }
    while (cache.size > vesselLimit) {
      const oldest = [...cache.entries()]
        .sort((a, b) => timestampMs(a[1].timestamp) - timestampMs(b[1].timestamp))[0]?.[0];
      if (!oldest) break;
      cache.delete(oldest);
    }
    updateFreshnessState();
  }

  function saveCache(force = false) {
    if (!cachePath || cache.size === 0) return;
    if (!force && now() - lastCacheWriteMs < cacheWriteInterval) return;
    try {
      mkdirSync(dirname(cachePath), { recursive: true });
      const payload = {
        version: 1,
        provider: "pocketworld",
        savedAt: new Date(now()).toISOString(),
        vessels: [...cache.values()],
      };
      writeFileSync(cachePath, JSON.stringify(payload));
      lastCacheWriteMs = now();
      state.cacheSavedAt = payload.savedAt;
      state.cacheSaveError = null;
    } catch (error) {
      state.cacheSaveError = error instanceof Error ? error.message : String(error);
    }
  }

  function loadCache() {
    if (!cachePath || !existsSync(cachePath)) return;
    try {
      const payload = JSON.parse(readFileSync(cachePath, "utf8"));
      for (const raw of responseRows(payload)) {
        const vessel = normalizePocketWorldVessel(raw, now);
        if (!vessel || observationAge(vessel) > vesselDisplayMaxAge) continue;
        cache.set(vessel.id, vessel);
      }
      prune();
      state.restoredVessels = cache.size;
      state.cacheLoadedAt = new Date(now()).toISOString();
      if (cache.size > 0) state.status = state.freshVessels > 0 ? "restored-fresh" : "restored-last-known";
    } catch (error) {
      state.cacheSaveError = error instanceof Error ? error.message : String(error);
    }
  }

  function rows() {
    prune();
    return [...cache.values()].sort((a, b) => timestampMs(b.timestamp) - timestampMs(a.timestamp));
  }

  function publicState() {
    prune();
    return { ...state };
  }

  function due(force) {
    if (force) return true;
    if (!state.lastAttemptAt) return true;
    return now() - Date.parse(state.lastAttemptAt) >= interval;
  }

  async function refresh({ force = false } = {}) {
    if (!active || !due(force)) return rows();
    if (inFlight) return inFlight;

    inFlight = (async () => {
      state.status = "fetching";
      state.lastAttemptAt = new Date(now()).toISOString();
      state.nextPollAt = new Date(now() + interval).toISOString();
      state.requests += 1;
      abortController = new AbortController();
      const timer = setTimeout(() => abortController.abort(), requestTimeout);

      try {
        const response = await fetchImpl(state.url, {
          headers: {
            accept: "application/json",
            "user-agent": "CHMARL-DataV/1.0 public-live-AIS-fallback",
          },
          redirect: "follow",
          signal: abortController.signal,
        });
        state.lastHttpStatus = response.status;
        state.staleHeader = response.headers?.get?.("x-pocketworld-stale") === "1";
        if (!response.ok) {
          const detail = (await response.text().catch(() => "")).slice(0, 500);
          state.status = statusForHttp(response.status);
          state.lastError = `${response.status} ${response.statusText}${detail ? `: ${detail}` : ""}`;
          return rows();
        }

        const payload = await response.json();
        const rawRows = responseRows(payload);
        let invalid = 0;
        let expired = 0;
        let fresh = 0;
        let lastKnown = 0;
        const normalized = [];
        for (const raw of rawRows) {
          const vessel = normalizePocketWorldVessel(raw, now);
          if (!vessel) {
            invalid += 1;
            continue;
          }
          const age = observationAge(vessel);
          if (age > vesselDisplayMaxAge) {
            expired += 1;
            continue;
          }
          if (age <= vesselFreshAge) fresh += 1;
          else lastKnown += 1;
          normalized.push(vessel);
        }
        normalized.sort((a, b) => timestampMs(b.timestamp) - timestampMs(a.timestamp));
        for (const vessel of normalized.slice(0, vesselLimit)) cache.set(vessel.id, vessel);
        prune();

        state.payloadCount = rawRows.length;
        state.rowsAccepted += Math.min(normalized.length, vesselLimit);
        state.freshRowsInPayload = Math.min(fresh, vesselLimit);
        state.lastKnownRowsInPayload = Math.min(lastKnown, vesselLimit);
        state.rejectedInvalid += invalid;
        state.rejectedStale += expired;
        state.rejectedExpired += expired;
        state.lastSuccessAt = new Date(now()).toISOString();
        state.lastError = null;
        state.connected = payload?.connected !== false;
        state.sourceHealth = payload?.source_health ?? null;
        state.observedSources = Array.isArray(payload?.sources) ? payload.sources : [];
        state.workingSources = Array.isArray(payload?.working_sources) ? payload.working_sources : [];
        state.coverage = payload?.coverage ?? null;
        state.totalAvailable = Number(payload?.total_available ?? payload?.total_tracked ?? rawRows.length) || 0;
        state.truncated = Boolean(payload?.truncated);
        if (cache.size > 0) {
          state.status = state.freshVessels > 0
            ? state.staleHeader ? "live-regional-stale-global" : "live-regional"
            : "last-known-regional";
          state.successfulPolls += 1;
          saveCache();
        } else {
          state.status = "empty";
          state.emptyPolls += 1;
        }
        return rows();
      } catch (error) {
        state.status = error?.name === "AbortError" ? "timeout" : "provider-error";
        state.lastError = error instanceof Error ? error.message : String(error);
        return rows();
      } finally {
        clearTimeout(timer);
        abortController = null;
        inFlight = null;
      }
    })();

    return inFlight;
  }

  function shutdown() {
    abortController?.abort();
    saveCache(true);
  }

  loadCache();

  return {
    refresh,
    rows,
    publicState,
    shutdown,
  };
}
