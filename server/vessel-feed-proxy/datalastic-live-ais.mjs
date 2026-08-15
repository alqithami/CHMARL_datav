const DEFAULT_BASE_URL = "https://api.datalastic.com/api/v0";

function numeric(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function timestamp(value, now) {
  if (typeof value === "string" && Number.isFinite(Date.parse(value))) return value;
  if (typeof value === "number" && Number.isFinite(value)) {
    const milliseconds = value < 10_000_000_000 ? value * 1000 : value;
    return new Date(milliseconds).toISOString();
  }
  return new Date(now()).toISOString();
}

function statusFromNavigation(value) {
  const text = String(value ?? "").toLowerCase();
  if (text.includes("restricted") || text.includes("aground") || text.includes("not under command")) return "Constrained";
  if (text.includes("anchored") || text.includes("moored") || text.includes("constrained") || text.includes("towing")) return "Watch";
  return "Nominal";
}

function responseRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  if (Array.isArray(payload.vessels)) return payload.vessels;
  if (Array.isArray(payload.items)) return payload.items;
  if (Array.isArray(payload.data)) return payload.data;
  if (payload.data && typeof payload.data === "object") {
    if (Array.isArray(payload.data.vessels)) return payload.data.vessels;
    if (Array.isArray(payload.data.items)) return payload.data.items;
  }
  return [];
}

export function normalizeDatalasticVessel(row, now = Date.now) {
  if (!row || typeof row !== "object") return null;
  const latitude = numeric(row.lat ?? row.latitude ?? row.last_latitude);
  const longitude = numeric(row.lon ?? row.lng ?? row.longitude ?? row.last_longitude);
  if (latitude === undefined || longitude === undefined || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;

  const mmsiValue = row.mmsi ?? row.MMSI;
  const imoValue = row.imo ?? row.IMO;
  const uuid = row.uuid ?? row.id;
  const mmsi = mmsiValue === undefined || mmsiValue === null ? undefined : String(mmsiValue).trim();
  const id = mmsi ? `MMSI-${mmsi}` : uuid ? `DATALASTIC-${uuid}` : imoValue ? `IMO-${imoValue}` : null;
  if (!id) return null;

  const name = String(row.name ?? row.vessel_name ?? row.ship_name ?? (mmsi ? `MMSI ${mmsi}` : id)).trim();
  const destination = String(row.destination ?? row.dest ?? row.destination_port ?? "").trim();
  const speed = numeric(row.speed ?? row.sog ?? row.speed_knots);
  const navigationStatus = row.nav_status ?? row.navigation_status ?? row.status;

  return {
    id,
    mmsi,
    imo: imoValue === undefined || imoValue === null ? undefined : String(imoValue),
    name: name || id,
    route: destination ? `Live AIS → ${destination}` : "Live AIS position",
    cargo: String(row.type_specific ?? row.type ?? row.vessel_type ?? row.ship_type ?? "AIS vessel"),
    eta: String(row.eta_UTC ?? row.eta_utc ?? row.eta ?? "Live AIS"),
    speed: speed === undefined ? "TBD" : `${speed.toFixed(1)} kn`,
    sog: speed,
    status: statusFromNavigation(navigationStatus),
    latitude,
    longitude,
    headingDeg: numeric(row.heading ?? row.true_heading),
    courseDeg: numeric(row.course ?? row.cog),
    timestamp: timestamp(
      row.last_position_UTC
        ?? row.last_position_utc
        ?? row.position_timestamp
        ?? row.updated_at
        ?? row.timestamp,
      now,
    ),
    inputSource: "datalastic-live-ais",
  };
}

function sanitizePoint(point) {
  const latitude = numeric(point?.latitude ?? point?.lat);
  const longitude = numeric(point?.longitude ?? point?.lon ?? point?.lng);
  if (latitude === undefined || longitude === undefined) return null;
  return {
    id: String(point.id ?? point.name ?? `${latitude},${longitude}`),
    latitude,
    longitude,
  };
}

function statusForHttp(statusCode) {
  if (statusCode === 401 || statusCode === 403) return "unauthorized";
  if (statusCode === 402) return "credits-exhausted";
  if (statusCode === 429) return "rate-limited";
  return statusCode >= 500 ? "provider-error" : "request-error";
}

export function createDatalasticLiveAisProvider({
  apiKey,
  baseUrl = DEFAULT_BASE_URL,
  scanPoints = [],
  radiusNm = 50,
  scanIntervalMs = 5 * 60_000,
  timeoutMs = 15_000,
  maxAgeMs = 2 * 60 * 60_000,
  maxVessels = 5000,
  fetchImpl = globalThis.fetch,
  now = Date.now,
} = {}) {
  const key = String(apiKey ?? "").trim();
  const points = scanPoints.map(sanitizePoint).filter(Boolean);
  const cache = new Map();
  const interval = Math.max(1_000, Number(scanIntervalMs) || 5 * 60_000);
  const requestTimeout = Math.max(1_000, Number(timeoutMs) || 15_000);
  const vesselMaxAge = Math.max(60_000, Number(maxAgeMs) || 2 * 60 * 60_000);
  const vesselLimit = Math.max(1, Number(maxVessels) || 5000);
  const scanRadius = Math.min(50, Math.max(1, Number(radiusNm) || 50));

  let inFlight = null;
  let abortController = null;

  const state = {
    provider: "datalastic",
    enabled: Boolean(key && points.length > 0 && typeof fetchImpl === "function"),
    configured: Boolean(key),
    status: key ? (points.length > 0 ? "idle" : "no-scan-points") : "disabled",
    baseUrl: String(baseUrl).replace(/\/$/, ""),
    radiusNm: scanRadius,
    scanIntervalMs: interval,
    scanPoints: points.map((point) => point.id),
    scanIndex: 0,
    currentPoint: null,
    lastAttemptAt: null,
    lastSuccessAt: null,
    lastError: null,
    lastHttpStatus: null,
    requests: 0,
    successfulScans: 0,
    emptyScans: 0,
    rowsReceived: 0,
    cachedVessels: 0,
    nextScanAt: null,
    backoffUntil: null,
  };

  function prune() {
    const cutoff = now() - vesselMaxAge;
    for (const [id, vessel] of cache.entries()) {
      const parsed = Date.parse(String(vessel.timestamp ?? ""));
      if (Number.isFinite(parsed) && parsed < cutoff) cache.delete(id);
    }
    state.cachedVessels = cache.size;
  }

  function rows() {
    prune();
    return [...cache.values()].sort((a, b) => Date.parse(String(b.timestamp ?? "")) - Date.parse(String(a.timestamp ?? "")));
  }

  function merge(vessel) {
    const existing = cache.get(vessel.id);
    const existingTime = Date.parse(String(existing?.timestamp ?? ""));
    const nextTime = Date.parse(String(vessel.timestamp ?? ""));
    if (existing && Number.isFinite(existingTime) && Number.isFinite(nextTime) && nextTime < existingTime) return;
    cache.set(vessel.id, { ...existing, ...vessel });
    while (cache.size > vesselLimit) {
      const oldest = [...cache.entries()]
        .sort((a, b) => Date.parse(String(a[1].timestamp ?? "")) - Date.parse(String(b[1].timestamp ?? "")))[0]?.[0];
      if (!oldest) break;
      cache.delete(oldest);
    }
    state.cachedVessels = cache.size;
  }

  function publicState() {
    prune();
    return { ...state };
  }

  function due(force) {
    if (force) return true;
    if (state.backoffUntil && now() < Date.parse(state.backoffUntil)) return false;
    if (!state.lastAttemptAt) return true;
    return now() - Date.parse(state.lastAttemptAt) >= interval;
  }

  async function refresh({ force = false } = {}) {
    if (!state.enabled || !due(force)) return rows();
    if (inFlight) return inFlight;

    inFlight = (async () => {
      const point = points[state.scanIndex % points.length];
      state.scanIndex = (state.scanIndex + 1) % points.length;
      state.currentPoint = point.id;
      state.status = "scanning";
      state.lastAttemptAt = new Date(now()).toISOString();
      state.nextScanAt = new Date(now() + interval).toISOString();
      state.requests += 1;
      abortController = new AbortController();
      const timer = setTimeout(() => abortController.abort(), requestTimeout);

      try {
        const url = new URL(`${state.baseUrl}/vessel_inradius`);
        url.searchParams.set("lat", String(point.latitude));
        url.searchParams.set("lon", String(point.longitude));
        url.searchParams.set("radius", String(scanRadius));

        const response = await fetchImpl(url, {
          headers: {
            accept: "application/json",
            "x-api-key": key,
            "user-agent": "CHMARL-DataV/1.0 live-AIS-failover",
          },
          signal: abortController.signal,
        });
        state.lastHttpStatus = response.status;
        if (!response.ok) {
          const detail = (await response.text().catch(() => "")).slice(0, 500);
          state.status = statusForHttp(response.status);
          state.lastError = `${response.status} ${response.statusText}${detail ? `: ${detail}` : ""}`;
          const backoffMs = response.status === 429
            ? 10 * 60_000
            : response.status === 401 || response.status === 402 || response.status === 403
              ? 60 * 60_000
              : interval;
          state.backoffUntil = new Date(now() + backoffMs).toISOString();
          return rows();
        }

        const payload = await response.json();
        const normalized = responseRows(payload)
          .map((row) => normalizeDatalasticVessel(row, now))
          .filter(Boolean);
        for (const vessel of normalized) merge(vessel);

        state.rowsReceived += normalized.length;
        state.lastSuccessAt = new Date(now()).toISOString();
        state.lastError = null;
        state.backoffUntil = null;
        if (normalized.length > 0) {
          state.status = "live";
          state.successfulScans += 1;
        } else {
          state.status = "empty-scan";
          state.emptyScans += 1;
        }
        return rows();
      } catch (error) {
        state.status = error?.name === "AbortError" ? "timeout" : "provider-error";
        state.lastError = error instanceof Error ? error.message : String(error);
        state.backoffUntil = new Date(now() + interval).toISOString();
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
