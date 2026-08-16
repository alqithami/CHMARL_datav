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

  const source = String(row.source ?? "public-ais").trim() || "public-ais";
  const speed = numeric(row.sog ?? row.speed ?? row.speed_knots);
  const observedAt = timestampValue(row, now);
  const typeName = String(row.type_name ?? row.vessel_type ?? row.ship_type ?? row.type ?? "AIS vessel");
  const name = String(row.name ?? row.ship_name ?? row.vessel_name ?? `MMSI ${mmsi}`).trim();

  return {
    id: `MMSI-${mmsi}`,
    mmsi,
    name: name || `MMSI ${mmsi}`,
    route: `Live AIS · ${source}`,
    cargo: typeName,
    eta: "Live AIS",
    speed: speed === undefined ? "TBD" : `${speed.toFixed(1)} kn`,
    sog: speed,
    status: navStatus(row.nav_status ?? row.navigation_status),
    latitude,
    longitude,
    headingDeg: numeric(row.heading ?? row.true_heading),
    courseDeg: numeric(row.cog ?? row.course),
    timestamp: observedAt,
    inputSource: `pocketworld-${source}`,
    provider: "pocketworld",
    sourceProvider: source,
    sourceUrl: row.source_url,
    country: row.country,
    countryCode: row.country_code,
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
  maxAgeMs = 30 * 60_000,
  maxVessels = 2500,
  fetchImpl = globalThis.fetch,
  now = Date.now,
} = {}) {
  const active = Boolean(enabled && typeof fetchImpl === "function");
  const interval = Math.max(5_000, Number(pollIntervalMs) || 5 * 60_000);
  const requestTimeout = Math.max(1_000, Number(timeoutMs) || 30_000);
  const vesselMaxAge = Math.max(60_000, Number(maxAgeMs) || 30 * 60_000);
  const vesselLimit = Math.max(1, Number(maxVessels) || 2500);
  const cache = new Map();
  let inFlight = null;
  let abortController = null;

  const state = {
    provider: "pocketworld",
    enabled: active,
    configured: active,
    status: active ? "idle" : "disabled",
    url: String(url),
    pollIntervalMs: interval,
    maxAgeMs: vesselMaxAge,
    maxVessels: vesselLimit,
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
    rejectedInvalid: 0,
    rejectedStale: 0,
    cachedVessels: 0,
    staleHeader: false,
    connected: false,
    sourceHealth: null,
    observedSources: [],
    workingSources: [],
    coverage: null,
    totalAvailable: 0,
    truncated: false,
  };

  function prune() {
    const cutoff = now() - vesselMaxAge;
    for (const [id, vessel] of cache.entries()) {
      const parsed = Date.parse(String(vessel.timestamp ?? ""));
      if (Number.isFinite(parsed) && parsed < cutoff) cache.delete(id);
    }
    while (cache.size > vesselLimit) {
      const oldest = [...cache.entries()]
        .sort((a, b) => Date.parse(String(a[1].timestamp ?? "")) - Date.parse(String(b[1].timestamp ?? "")))[0]?.[0];
      if (!oldest) break;
      cache.delete(oldest);
    }
    state.cachedVessels = cache.size;
  }

  function rows() {
    prune();
    return [...cache.values()].sort((a, b) => Date.parse(String(b.timestamp ?? "")) - Date.parse(String(a.timestamp ?? "")));
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
        const cutoff = now() - vesselMaxAge;
        let invalid = 0;
        let stale = 0;
        const normalized = [];
        for (const raw of rawRows) {
          const vessel = normalizePocketWorldVessel(raw, now);
          if (!vessel) {
            invalid += 1;
            continue;
          }
          const observed = Date.parse(String(vessel.timestamp ?? ""));
          if (Number.isFinite(observed) && observed < cutoff) {
            stale += 1;
            continue;
          }
          normalized.push(vessel);
        }
        normalized.sort((a, b) => Date.parse(String(b.timestamp ?? "")) - Date.parse(String(a.timestamp ?? "")));
        for (const vessel of normalized.slice(0, vesselLimit)) cache.set(vessel.id, vessel);
        prune();

        state.payloadCount = rawRows.length;
        state.rowsAccepted += Math.min(normalized.length, vesselLimit);
        state.rejectedInvalid += invalid;
        state.rejectedStale += stale;
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
          state.status = state.staleHeader ? "live-regional-stale-global" : "live-regional";
          state.successfulPolls += 1;
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
  }

  return {
    refresh,
    rows,
    publicState,
    shutdown,
  };
}
