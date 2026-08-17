import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const DEFAULT_URL = "https://pocketworld.org/api/ships";
const DEFAULT_PAGE_SIZE = 5_000;
const DEFAULT_MAX_PAGES = 10;
const PROVIDER_MAX_PAGE_SIZE = 5_000;
const PROVIDER_MAX_VESSELS = 50_000;

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

function pageMetadata(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return {
      snapshotId: null,
      nextCursor: null,
      totalAvailable: 0,
      truncated: false,
    };
  }
  const nextCursor = payload.next_cursor ?? payload.nextCursor ?? null;
  return {
    snapshotId: payload.snapshot_id ?? payload.snapshotId ?? null,
    nextCursor: nextCursor === "" ? null : nextCursor,
    totalAvailable: Number(payload.total_available ?? payload.total_tracked ?? payload.count ?? 0) || 0,
    truncated: Boolean(payload.truncated),
  };
}

function cursorForNextPage(metadata, accumulatedRows, snapshotId) {
  if (metadata.nextCursor !== null && metadata.nextCursor !== undefined && String(metadata.nextCursor).trim()) {
    return metadata.nextCursor;
  }
  if (
    snapshotId !== null
    && snapshotId !== undefined
    && String(snapshotId).trim()
    && metadata.truncated
    && metadata.totalAvailable > accumulatedRows
  ) {
    return accumulatedRows;
  }
  return null;
}

function buildPageUrl(baseUrl, snapshotId, cursor, limit) {
  const url = new URL(baseUrl);
  if (snapshotId !== null && snapshotId !== undefined && String(snapshotId).trim()) {
    url.searchParams.set("snapshot_id", String(snapshotId));
  }
  if (cursor !== null && cursor !== undefined && String(cursor).trim()) {
    url.searchParams.set("cursor", String(cursor));
  }
  url.searchParams.set("limit", String(limit));
  return url.toString();
}

function unionStrings(payloads, key) {
  return [...new Set(payloads.flatMap((payload) => (
    Array.isArray(payload?.[key]) ? payload[key].map((value) => String(value)) : []
  )))];
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
  maxVessels = 50_000,
  pageSize = DEFAULT_PAGE_SIZE,
  maxPages = DEFAULT_MAX_PAGES,
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
  const vesselLimit = Math.min(PROVIDER_MAX_VESSELS, Math.max(1, Number(maxVessels) || PROVIDER_MAX_VESSELS));
  const paginationPageSize = Math.min(PROVIDER_MAX_PAGE_SIZE, Math.max(1, Number(pageSize) || DEFAULT_PAGE_SIZE));
  const paginationMaxPages = Math.min(100, Math.max(1, Number(maxPages) || DEFAULT_MAX_PAGES));
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
    pageSize: paginationPageSize,
    maxPages: paginationMaxPages,
    pagesFetched: 0,
    snapshotId: null,
    nextCursor: null,
    fetchComplete: false,
    paginationError: null,
    responseRowCount: 0,
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
        version: 2,
        provider: "pocketworld",
        savedAt: new Date(now()).toISOString(),
        totalAvailable: state.totalAvailable,
        fetchComplete: state.fetchComplete,
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
      state.totalAvailable = Number(payload?.totalAvailable ?? cache.size) || cache.size;
      state.fetchComplete = Boolean(payload?.fetchComplete);
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

  async function fetchPage(requestUrl) {
    const controller = new AbortController();
    abortController = controller;
    const timer = setTimeout(() => controller.abort(), requestTimeout);
    state.requests += 1;
    try {
      const response = await fetchImpl(requestUrl, {
        headers: {
          accept: "application/json",
          "user-agent": "CHMARL-DataV/1.0 public-live-AIS-fallback",
        },
        redirect: "follow",
        signal: controller.signal,
      });
      state.lastHttpStatus = response.status;
      state.staleHeader = state.staleHeader || response.headers?.get?.("x-pocketworld-stale") === "1";
      if (!response.ok) {
        const detail = (await response.text().catch(() => "")).slice(0, 500);
        const error = new Error(`${response.status} ${response.statusText}${detail ? `: ${detail}` : ""}`);
        error.statusCode = response.status;
        throw error;
      }
      return await response.json();
    } finally {
      clearTimeout(timer);
      if (abortController === controller) abortController = null;
    }
  }

  async function refresh({ force = false } = {}) {
    if (!active || !due(force)) return rows();
    if (inFlight) return inFlight;

    inFlight = (async () => {
      state.status = "fetching";
      state.lastAttemptAt = new Date(now()).toISOString();
      state.nextPollAt = new Date(now() + interval).toISOString();
      state.staleHeader = false;
      state.pagesFetched = 0;
      state.snapshotId = null;
      state.nextCursor = null;
      state.fetchComplete = false;
      state.paginationError = null;
      state.responseRowCount = 0;

      try {
        const payloads = [];
        const firstRequestLimit = Math.min(paginationPageSize, vesselLimit);
        const firstPayload = await fetchPage(buildPageUrl(state.url, null, null, firstRequestLimit));
        payloads.push(firstPayload);
        let metadata = pageMetadata(firstPayload);
        const snapshotId = metadata.snapshotId;
        let totalAvailable = metadata.totalAvailable;
        const rawRows = [...responseRows(firstPayload)];
        let nextCursor = cursorForNextPage(metadata, rawRows.length, snapshotId);
        const seenCursors = new Set();
        let paginationError = null;

        while (
          nextCursor !== null
          && nextCursor !== undefined
          && String(nextCursor).trim()
          && rawRows.length < vesselLimit
          && payloads.length < paginationMaxPages
        ) {
          const cursorKey = String(nextCursor);
          if (seenCursors.has(cursorKey)) {
            paginationError = `PocketWorld repeated cursor ${cursorKey}`;
            break;
          }
          seenCursors.add(cursorKey);
          const remaining = vesselLimit - rawRows.length;
          const requestLimit = Math.min(paginationPageSize, remaining);
          const requestUrl = buildPageUrl(state.url, snapshotId, nextCursor, requestLimit);
          try {
            const pagePayload = await fetchPage(requestUrl);
            payloads.push(pagePayload);
            rawRows.push(...responseRows(pagePayload));
            metadata = pageMetadata(pagePayload);
            totalAvailable = Math.max(totalAvailable, metadata.totalAvailable);
            nextCursor = cursorForNextPage(
              { ...metadata, totalAvailable },
              rawRows.length,
              snapshotId,
            );
          } catch (error) {
            paginationError = error instanceof Error ? error.message : String(error);
            break;
          }
        }

        const expectedRows = totalAvailable > 0 ? Math.min(totalAvailable, vesselLimit) : null;
        const cursorExhausted = nextCursor === null || nextCursor === undefined || !String(nextCursor).trim();
        const reachedExpectedRows = expectedRows !== null && rawRows.length >= expectedRows;
        const localLimitTruncates = totalAvailable > vesselLimit;
        const providerOmittedCursor = expectedRows !== null && rawRows.length < expectedRows && cursorExhausted;
        if (!paginationError && providerOmittedCursor) {
          paginationError = `PocketWorld reported ${expectedRows} available rows but returned ${rawRows.length} without next_cursor`;
        }
        const fetchComplete = !paginationError
          && !localLimitTruncates
          && (reachedExpectedRows || (expectedRows === null && cursorExhausted));

        let invalid = 0;
        let expired = 0;
        const normalizedById = new Map();
        for (const raw of rawRows) {
          const vessel = normalizePocketWorldVessel(raw, now);
          if (!vessel) {
            invalid += 1;
            continue;
          }
          if (observationAge(vessel) > vesselDisplayMaxAge) {
            expired += 1;
            continue;
          }
          const existing = normalizedById.get(vessel.id);
          if (!existing || timestampMs(vessel.timestamp) >= timestampMs(existing.timestamp)) {
            normalizedById.set(vessel.id, vessel);
          }
        }

        const normalized = [...normalizedById.values()]
          .sort((a, b) => timestampMs(b.timestamp) - timestampMs(a.timestamp))
          .slice(0, vesselLimit);
        const fresh = normalized.filter((vessel) => observationAge(vessel) <= vesselFreshAge).length;
        const lastKnown = Math.max(0, normalized.length - fresh);
        for (const vessel of normalized) cache.set(vessel.id, vessel);
        prune();

        state.pagesFetched = payloads.length;
        state.snapshotId = snapshotId;
        state.nextCursor = nextCursor;
        state.fetchComplete = fetchComplete;
        state.paginationError = paginationError;
        state.responseRowCount = rawRows.length;
        state.payloadCount = rawRows.length;
        state.rowsAccepted += normalized.length;
        state.freshRowsInPayload = fresh;
        state.lastKnownRowsInPayload = lastKnown;
        state.rejectedInvalid += invalid;
        state.rejectedStale += expired;
        state.rejectedExpired += expired;
        state.lastSuccessAt = new Date(now()).toISOString();
        state.lastError = paginationError;
        state.connected = firstPayload?.connected !== false;
        state.sourceHealth = payloads.find((payload) => payload?.source_health)?.source_health ?? null;
        state.observedSources = unionStrings(payloads, "sources");
        state.workingSources = unionStrings(payloads, "working_sources");
        state.coverage = payloads.find((payload) => payload?.coverage)?.coverage ?? null;
        state.totalAvailable = totalAvailable || rawRows.length;
        state.truncated = !fetchComplete;

        if (cache.size > 0) {
          const baseStatus = state.freshVessels > 0
            ? state.staleHeader ? "live-regional-stale-global" : "live-regional"
            : "last-known-regional";
          state.status = fetchComplete ? baseStatus : `${baseStatus}-partial`;
          state.successfulPolls += 1;
          saveCache();
        } else {
          state.status = "empty";
          state.emptyPolls += 1;
        }
        return rows();
      } catch (error) {
        state.status = error?.name === "AbortError"
          ? "timeout"
          : error?.statusCode
            ? statusForHttp(error.statusCode)
            : "provider-error";
        state.lastError = error instanceof Error ? error.message : String(error);
        return rows();
      } finally {
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
