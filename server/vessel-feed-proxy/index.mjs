import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import WebSocket from "ws";

const PORT = Number(process.env.PORT ?? 8787);
const UPSTREAM_URL = process.env.UPSTREAM_VESSEL_DATA_URL;
const UPSTREAM_TOKEN = process.env.UPSTREAM_VESSEL_DATA_TOKEN;
const AISSTREAM_API_KEY = process.env.AISSTREAM_API_KEY;
const AISSTREAM_URL = process.env.AISSTREAM_URL ?? "wss://stream.aisstream.io/v0/stream";
const AISSTREAM_BBOX = process.env.AISSTREAM_BBOX ?? "11,32;31,56";
const AISSTREAM_MAX_VESSELS = Number(process.env.AISSTREAM_MAX_VESSELS ?? 250);
const AISSTREAM_TRAIL_POINTS = Number(process.env.AISSTREAM_TRAIL_POINTS ?? 24);
const AISSTREAM_CACHE_ENABLED = process.env.AISSTREAM_CACHE_ENABLED !== "false";
const AISSTREAM_CACHE_FILE = process.env.AISSTREAM_CACHE_FILE ?? ".runtime/ais-cache.json";
const AISSTREAM_CACHE_FILE_PATH = resolve(AISSTREAM_CACHE_FILE);
const AISSTREAM_CACHE_FLUSH_MS = Number(process.env.AISSTREAM_CACHE_FLUSH_MS ?? 15_000);
const AISSTREAM_FILTER_TYPES = (process.env.AISSTREAM_FILTER_TYPES ?? "PositionReport,StandardClassBPositionReport,ExtendedClassBPositionReport")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);
const CHMARL_EXPERIMENT_URL = process.env.CHMARL_EXPERIMENT_URL;
const CHMARL_EXPERIMENT_TOKEN = process.env.CHMARL_EXPERIMENT_TOKEN;
const CHMARL_EXPERIMENT_FILE = process.env.CHMARL_EXPERIMENT_FILE ?? ".runtime/chmarl_episode.json";
const CHMARL_EXPERIMENT_FILE_PATH = resolve(CHMARL_EXPERIMENT_FILE);
const PORT_EVENTS_URL = process.env.PORT_EVENTS_URL;
const PORT_EVENTS_TOKEN = process.env.PORT_EVENTS_TOKEN;
const PORT_EVENTS_FILE = process.env.PORT_EVENTS_FILE ?? ".runtime/port_events.json";
const PORT_EVENTS_FILE_PATH = resolve(PORT_EVENTS_FILE);
const STATIC_DIR = resolve(process.env.STATIC_DIR ?? "dist");
const STATIC_INDEX = resolve(STATIC_DIR, "index.html");

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
};

const aisCache = new Map();
let cacheSaveTimer;
const aisState = {
  enabled: Boolean(AISSTREAM_API_KEY),
  connected: false,
  lastMessageAt: null,
  lastError: null,
  reconnectAttempt: 0,
  boundingBoxes: [],
  messageCount: 0,
  cachedVessels: 0,
  cacheLimit: AISSTREAM_MAX_VESSELS,
  trailLimit: AISSTREAM_TRAIL_POINTS,
  cacheEnabled: AISSTREAM_CACHE_ENABLED,
  cacheFile: AISSTREAM_CACHE_ENABLED ? AISSTREAM_CACHE_FILE : null,
  cacheFlushMs: AISSTREAM_CACHE_FLUSH_MS,
  cacheLoadedAt: null,
  cacheSavedAt: null,
  cacheSaveError: null,
  restoredVessels: 0,
};

const chmarlState = {
  enabled: Boolean(CHMARL_EXPERIMENT_URL || CHMARL_EXPERIMENT_FILE),
  source: CHMARL_EXPERIMENT_URL ? "url" : "file",
  configuredUrl: Boolean(CHMARL_EXPERIMENT_URL),
  file: CHMARL_EXPERIMENT_FILE,
  steps: 0,
  experimentId: null,
  scenarioId: null,
  lastLoadedAt: null,
  lastError: null,
};

const portOpsState = {
  enabled: Boolean(PORT_EVENTS_URL || PORT_EVENTS_FILE),
  source: PORT_EVENTS_URL ? "url" : "file",
  configuredUrl: Boolean(PORT_EVENTS_URL),
  file: PORT_EVENTS_FILE,
  events: 0,
  utilizationRows: 0,
  queueRows: 0,
  lastLoadedAt: null,
  lastError: null,
};

const fallbackVessels = [
  {
    id: "MMSI-538214",
    name: "Al Riyadh Trader",
    route: "Jeddah → Suez",
    cargo: "Containers",
    eta: "04:20 UTC",
    speed: "14.8 kn",
    status: "Nominal",
    latitude: 21.45,
    longitude: 39.12,
    courseDeg: 322,
  },
  {
    id: "MMSI-636719",
    name: "Red Sea Pearl",
    route: "Yanbu → Aqaba",
    cargo: "Energy products",
    eta: "11:10 UTC",
    speed: "10.1 kn",
    status: "Constrained",
    latitude: 24.05,
    longitude: 37.88,
    courseDeg: 7,
  },
];

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-headers": "content-type, authorization",
  });
  response.end(JSON.stringify(payload));
}

function sendHtml(response, statusCode, html) {
  response.writeHead(statusCode, {
    "content-type": "text/html; charset=utf-8",
    "access-control-allow-origin": "*",
  });
  response.end(html);
}

function sendFile(response, filePath) {
  const ext = extname(filePath).toLowerCase();
  response.writeHead(200, {
    "content-type": contentTypes[ext] ?? "application/octet-stream",
    "cache-control": ext === ".html" ? "no-cache" : "public, max-age=31536000, immutable",
  });
  response.end(readFileSync(filePath));
}

function normalizeStatus(value) {
  const text = String(value ?? "").toLowerCase();
  if (text.includes("constraint") || text.includes("restricted") || text.includes("alert")) return "Constrained";
  if (text.includes("watch") || text.includes("warning") || text.includes("delay")) return "Watch";
  return "Nominal";
}

function numberToSpeed(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? `${parsed.toFixed(1)} kn` : "TBD";
}

function optionalNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function extractRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === "object") {
    if (Array.isArray(payload.vessels)) return payload.vessels;
    if (Array.isArray(payload.data)) return payload.data;
    if (Array.isArray(payload.items)) return payload.items;
  }
  return [];
}

function rowsFrom(payload, keys) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  for (const key of keys) {
    if (Array.isArray(payload[key])) return payload[key];
  }
  return [];
}

function extractExperimentSteps(payload) {
  return rowsFrom(payload, ["steps", "data", "items"]);
}

function normalizeTrail(points) {
  if (!Array.isArray(points)) return undefined;
  const trail = points
    .map((point) => {
      const latitude = optionalNumber(point.latitude ?? point.lat);
      const longitude = optionalNumber(point.longitude ?? point.lon ?? point.lng);
      if (latitude === undefined || longitude === undefined) return null;
      return { latitude, longitude, timestamp: point.timestamp };
    })
    .filter(Boolean);
  return trail.length > 1 ? trail : undefined;
}

function normalizeVessel(row) {
  const name = row.name ?? row.vesselName ?? row.shipName ?? "Unknown Vessel";
  const id = row.id ?? row.vesselId ?? (row.mmsi ? `MMSI-${row.mmsi}` : row.imo ?? name);
  const origin = row.originPort ?? row.origin ?? "Unknown";
  const destination = row.destinationPort ?? row.destination ?? row.dest ?? "Unknown";
  const speedValue = row.speed ?? row.speedKnots ?? row.sog;

  return {
    id: String(id),
    name: String(name),
    route: row.route ?? `${origin} → ${destination}`,
    cargo: String(row.cargo ?? row.cargoClass ?? row.vesselType ?? row.shipType ?? "Unspecified"),
    eta: String(row.eta ?? row.ETA ?? "TBD"),
    speed: typeof speedValue === "string" && speedValue.includes("kn") ? speedValue : numberToSpeed(speedValue),
    status: normalizeStatus(row.status ?? row.navStatus),
    latitude: optionalNumber(row.latitude ?? row.lat),
    longitude: optionalNumber(row.longitude ?? row.lon ?? row.lng),
    headingDeg: optionalNumber(row.headingDeg ?? row.heading),
    courseDeg: optionalNumber(row.courseDeg ?? row.cog),
    timestamp: row.timestamp,
    trail: normalizeTrail(row.trail ?? row.history ?? row.track),
  };
}

function normalizePortEventType(value) {
  const text = String(value ?? "arrival").toLowerCase().replace(/[\s-]+/g, "_");
  if (text === "departure") return "departure";
  if (text === "anchorage_entry") return "anchorage_entry";
  if (text === "anchorage_exit") return "anchorage_exit";
  if (text === "berth_assigned") return "berth_assigned";
  if (text === "service_started") return "service_started";
  if (text === "service_completed") return "service_completed";
  return "arrival";
}

function normalizePortEvent(row, index) {
  if (!row || typeof row !== "object") return null;
  const portId = String(row.portId ?? row.port_id ?? row.port ?? row.portName ?? row.unlocode ?? "").trim();
  if (!portId) return null;
  const eventType = normalizePortEventType(row.eventType ?? row.event_type ?? row.type ?? row.status);
  const timestamp = String(row.timestamp ?? row.time ?? row.updatedAt ?? new Date().toISOString());
  return {
    eventId: String(row.eventId ?? row.event_id ?? row.id ?? `${portId}-${eventType}-${index}`),
    vesselId: row.vesselId || row.vessel_id || row.mmsi ? String(row.vesselId ?? row.vessel_id ?? row.mmsi) : undefined,
    portId,
    berthId: row.berthId || row.berth_id || row.berth ? String(row.berthId ?? row.berth_id ?? row.berth) : undefined,
    eventType,
    timestamp,
    metadata: row.metadata && typeof row.metadata === "object" ? row.metadata : undefined,
  };
}

function normalizePortUtilization(row) {
  if (!row || typeof row !== "object") return null;
  const name = String(row.name ?? row.portName ?? row.port_name ?? row.portId ?? row.port_id ?? row.port ?? "").trim();
  if (!name) return null;
  const value = optionalNumber(
    row.value ??
      row.utilizationPct ??
      row.utilization_pct ??
      row.utilization ??
      row.berthUtilizationPct ??
      row.berth_utilization_pct ??
      row.berthUtilization ??
      row.queueLength ??
      row.waitingVessels
  );
  return { name, value: value ?? 0 };
}

function normalizeQueueStatus(row) {
  if (!row || typeof row !== "object") return null;
  const portId = String(row.portId ?? row.port_id ?? row.port ?? row.name ?? "").trim();
  if (!portId) return null;
  return {
    portId,
    berthId: row.berthId || row.berth_id || row.berth ? String(row.berthId ?? row.berth_id ?? row.berth) : undefined,
    queueLength: optionalNumber(row.queueLength ?? row.queue_length ?? row.queue),
    waitingVessels: optionalNumber(row.waitingVessels ?? row.waiting_vessels ?? row.waiting),
    utilizationPct: optionalNumber(row.utilizationPct ?? row.utilization_pct ?? row.berthUtilizationPct ?? row.berth_utilization_pct),
    timestamp: row.timestamp || row.time || row.updatedAt ? String(row.timestamp ?? row.time ?? row.updatedAt) : undefined,
  };
}

function parseBoundingBoxes(value) {
  return value
    .split("|")
    .map((box) => {
      const corners = box.split(";").map((corner) => corner.split(",").map((item) => Number(item.trim())));
      if (corners.length !== 2 || corners.some((corner) => corner.length !== 2 || corner.some((number) => !Number.isFinite(number)))) {
        throw new Error(`Invalid AISSTREAM_BBOX segment: ${box}`);
      }
      return corners;
    });
}

function safeParseBoundingBoxes() {
  try {
    return parseBoundingBoxes(AISSTREAM_BBOX);
  } catch (error) {
    aisState.lastError = error instanceof Error ? error.message : String(error);
    return [];
  }
}

function getMessageBody(message) {
  if (!message || typeof message !== "object") return {};
  const messageType = message.MessageType;
  const body = message.Message?.[messageType] ?? message.Message?.PositionReport ?? message.Message?.StandardClassBPositionReport ?? message.Message?.ExtendedClassBPositionReport;
  return body && typeof body === "object" ? body : {};
}

function normalizeAisStreamMessage(raw) {
  const metadata = raw.MetaData ?? raw.Metadata ?? {};
  const body = getMessageBody(raw);
  const mmsi = metadata.MMSI ?? body.UserID;
  const latitude = optionalNumber(metadata.latitude ?? metadata.Latitude ?? body.Latitude);
  const longitude = optionalNumber(metadata.longitude ?? metadata.Longitude ?? body.Longitude);
  if (!mmsi || latitude === undefined || longitude === undefined) return null;

  const shipName = metadata.ShipName ?? metadata.ShipNameAis ?? body.Name;
  const sog = optionalNumber(body.Sog ?? metadata.Sog ?? metadata.SOG);
  const cog = optionalNumber(body.Cog ?? metadata.Cog ?? metadata.COG);
  const heading = optionalNumber(body.TrueHeading ?? body.Heading ?? metadata.TrueHeading);
  const timestamp = metadata.time_utc ?? metadata.TimeUtc ?? metadata.timestamp ?? new Date().toISOString();

  return {
    id: `MMSI-${mmsi}`,
    mmsi: String(mmsi),
    name: shipName ? String(shipName).trim() : `MMSI ${mmsi}`,
    route: "AIS live position",
    cargo: raw.MessageType ?? "AIS vessel",
    eta: "Live AIS",
    speed: sog === undefined ? "TBD" : `${sog.toFixed(1)} kn`,
    status: "Nominal",
    latitude,
    longitude,
    headingDeg: heading,
    courseDeg: cog,
    timestamp,
  };
}

function sortedAisVessels() {
  return [...aisCache.values()].sort((a, b) => String(b.timestamp ?? "").localeCompare(String(a.timestamp ?? "")));
}

function persistedVessel(row) {
  if (!row || typeof row !== "object" || !row.id) return null;
  const normalized = normalizeVessel(row);
  return {
    ...row,
    ...normalized,
    id: String(row.id),
    mmsi: row.mmsi ? String(row.mmsi) : undefined,
  };
}

function cacheSnapshot() {
  return {
    version: 1,
    savedAt: new Date().toISOString(),
    source: "aisstream-cache",
    maxVessels: AISSTREAM_MAX_VESSELS,
    trailLimit: AISSTREAM_TRAIL_POINTS,
    vessels: sortedAisVessels().slice(0, AISSTREAM_MAX_VESSELS),
  };
}

function loadAisCacheFromDisk() {
  if (!AISSTREAM_CACHE_ENABLED || !existsSync(AISSTREAM_CACHE_FILE_PATH)) return;
  try {
    const payload = JSON.parse(readFileSync(AISSTREAM_CACHE_FILE_PATH, "utf8"));
    const rows = Array.isArray(payload?.vessels) ? payload.vessels : Array.isArray(payload) ? payload : [];
    let restored = 0;
    for (const row of rows.slice(0, AISSTREAM_MAX_VESSELS)) {
      const vessel = persistedVessel(row);
      if (!vessel) continue;
      aisCache.set(vessel.id, vessel);
      restored += 1;
    }
    aisState.restoredVessels = restored;
    aisState.cachedVessels = aisCache.size;
    aisState.cacheLoadedAt = new Date().toISOString();
    aisState.cacheSaveError = null;
    if (restored > 0) console.log(`Restored ${restored} AIS vessel(s) from ${AISSTREAM_CACHE_FILE}.`);
  } catch (error) {
    aisState.cacheSaveError = error instanceof Error ? error.message : String(error);
    console.error(`Failed to load AIS cache from ${AISSTREAM_CACHE_FILE}:`, error);
  }
}

function saveAisCacheToDisk() {
  if (!AISSTREAM_CACHE_ENABLED) return;
  try {
    const snapshot = cacheSnapshot();
    mkdirSync(dirname(AISSTREAM_CACHE_FILE_PATH), { recursive: true });
    writeFileSync(AISSTREAM_CACHE_FILE_PATH, JSON.stringify(snapshot, null, 2));
    aisState.cacheSavedAt = snapshot.savedAt;
    aisState.cacheSaveError = null;
  } catch (error) {
    aisState.cacheSaveError = error instanceof Error ? error.message : String(error);
  }
}

function scheduleAisCacheSave() {
  if (!AISSTREAM_CACHE_ENABLED) return;
  if (cacheSaveTimer) clearTimeout(cacheSaveTimer);
  cacheSaveTimer = setTimeout(saveAisCacheToDisk, Math.max(1_000, AISSTREAM_CACHE_FLUSH_MS));
  cacheSaveTimer.unref?.();
}

function mergeAisVessel(update) {
  const existing = aisCache.get(update.id);
  const priorTrail = existing?.trail ?? [];
  const nextTrail = [...priorTrail, { latitude: update.latitude, longitude: update.longitude, timestamp: update.timestamp }].slice(-AISSTREAM_TRAIL_POINTS);
  aisCache.set(update.id, {
    ...existing,
    ...update,
    trail: nextTrail.length > 1 ? nextTrail : undefined,
  });
  if (aisCache.size > AISSTREAM_MAX_VESSELS) {
    const oldestKey = sortedAisVessels().at(-1)?.id;
    if (oldestKey) aisCache.delete(oldestKey);
  }
  aisState.cachedVessels = aisCache.size;
  scheduleAisCacheSave();
}

function updateChmarlState(payload, source) {
  const steps = extractExperimentSteps(payload);
  chmarlState.source = source;
  chmarlState.steps = steps.length;
  chmarlState.experimentId = payload?.experimentId ?? steps[0]?.experimentId ?? null;
  chmarlState.scenarioId = payload?.scenarioId ?? steps[0]?.scenarioId ?? null;
  chmarlState.lastLoadedAt = new Date().toISOString();
  chmarlState.lastError = null;
  return {
    source,
    experimentId: chmarlState.experimentId,
    scenarioId: chmarlState.scenarioId,
    steps,
  };
}

function updatePortOpsState(payload, source) {
  const portEvents = rowsFrom(payload, ["portEvents", "port_events", "events", "data", "items"])
    .map(normalizePortEvent)
    .filter(Boolean);
  const portUtilization = rowsFrom(payload, ["portUtilization", "port_utilization", "utilization", "ports"])
    .map(normalizePortUtilization)
    .filter(Boolean);
  const queueStatus = rowsFrom(payload, ["queueStatus", "queue_status", "queues", "berths"])
    .map(normalizeQueueStatus)
    .filter(Boolean);

  portOpsState.source = source;
  portOpsState.events = portEvents.length;
  portOpsState.utilizationRows = portUtilization.length;
  portOpsState.queueRows = queueStatus.length;
  portOpsState.lastLoadedAt = new Date().toISOString();
  portOpsState.lastError = null;

  return { source, portEvents, portUtilization, queueStatus, portOps: portOpsState };
}

async function loadChmarlExperiment() {
  try {
    if (CHMARL_EXPERIMENT_URL) {
      const headers = { accept: "application/json" };
      if (CHMARL_EXPERIMENT_TOKEN) headers.authorization = `Bearer ${CHMARL_EXPERIMENT_TOKEN}`;
      const response = await fetch(CHMARL_EXPERIMENT_URL, { headers });
      if (!response.ok) throw new Error(`CH-MARL upstream failed: ${response.status} ${response.statusText}`);
      return updateChmarlState(await response.json(), "url");
    }
    if (existsSync(CHMARL_EXPERIMENT_FILE_PATH)) {
      return updateChmarlState(JSON.parse(readFileSync(CHMARL_EXPERIMENT_FILE_PATH, "utf8")), "file");
    }
    chmarlState.steps = 0;
    chmarlState.lastError = null;
    return null;
  } catch (error) {
    chmarlState.lastError = error instanceof Error ? error.message : String(error);
    return null;
  }
}

async function loadPortOperations() {
  try {
    if (PORT_EVENTS_URL) {
      const headers = { accept: "application/json" };
      if (PORT_EVENTS_TOKEN) headers.authorization = `Bearer ${PORT_EVENTS_TOKEN}`;
      const response = await fetch(PORT_EVENTS_URL, { headers });
      if (!response.ok) throw new Error(`Port operations upstream failed: ${response.status} ${response.statusText}`);
      return updatePortOpsState(await response.json(), "url");
    }
    if (existsSync(PORT_EVENTS_FILE_PATH)) {
      return updatePortOpsState(JSON.parse(readFileSync(PORT_EVENTS_FILE_PATH, "utf8")), "file");
    }
    portOpsState.events = 0;
    portOpsState.utilizationRows = 0;
    portOpsState.queueRows = 0;
    portOpsState.lastError = null;
    return null;
  } catch (error) {
    portOpsState.lastError = error instanceof Error ? error.message : String(error);
    return null;
  }
}

function startAisStream() {
  if (!AISSTREAM_API_KEY) return;
  const boundingBoxes = safeParseBoundingBoxes();
  aisState.boundingBoxes = boundingBoxes;
  if (boundingBoxes.length === 0) return;
  const socket = new WebSocket(AISSTREAM_URL);
  aisState.lastError = null;
  socket.on("open", () => {
    aisState.connected = true;
    aisState.reconnectAttempt = 0;
    const subscription = {
      APIKey: AISSTREAM_API_KEY,
      BoundingBoxes: boundingBoxes,
      ...(AISSTREAM_FILTER_TYPES.length > 0 ? { FilterMessageTypes: AISSTREAM_FILTER_TYPES } : {}),
    };
    socket.send(JSON.stringify(subscription));
    console.log(`AISStream connected with ${boundingBoxes.length} bounding box(es). Cache limit: ${AISSTREAM_MAX_VESSELS}.`);
  });
  socket.on("message", (data) => {
    try {
      aisState.messageCount += 1;
      const raw = JSON.parse(data.toString());
      if (raw.error) {
        aisState.lastError = raw.error;
        return;
      }
      const vessel = normalizeAisStreamMessage(raw);
      if (!vessel) return;
      aisState.lastMessageAt = new Date().toISOString();
      mergeAisVessel(vessel);
    } catch (error) {
      aisState.lastError = error instanceof Error ? error.message : String(error);
    }
  });
  socket.on("close", () => {
    aisState.connected = false;
    const delay = Math.min(30_000, 2_000 * 2 ** aisState.reconnectAttempt);
    aisState.reconnectAttempt += 1;
    setTimeout(startAisStream, delay);
  });
  socket.on("error", (error) => {
    aisState.connected = false;
    aisState.lastError = error.message;
  });
}

async function loadVessels() {
  const liveAisVessels = sortedAisVessels();
  if (liveAisVessels.length > 0) return { vessels: liveAisVessels, source: "aisstream" };
  if (!UPSTREAM_URL) return { vessels: AISSTREAM_API_KEY ? [] : fallbackVessels, source: AISSTREAM_API_KEY ? "aisstream-waiting" : "fallback" };
  const headers = { accept: "application/json" };
  if (UPSTREAM_TOKEN) headers.authorization = `Bearer ${UPSTREAM_TOKEN}`;
  const response = await fetch(UPSTREAM_URL, { headers });
  if (!response.ok) throw new Error(`Upstream request failed: ${response.status} ${response.statusText}`);
  const payload = await response.json();
  const rows = extractRows(payload);
  return { vessels: rows.map(normalizeVessel), source: "upstream" };
}

function rootHtml(staticAvailable) {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>CH-MARL Vessel Proxy</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:Inter,system-ui,sans-serif;color:#e6f7ff;background:#04111f}main{max-width:760px;padding:28px;border:1px solid rgba(141,220,255,.18);border-radius:20px;background:rgba(3,13,24,.72)}h1{margin:0 0 10px;font-size:24px}p{color:rgba(230,247,255,.72);line-height:1.5}code{color:#65e4cb}a{color:#8ddcff}</style>
</head><body><main><h1>CH-MARL Vessel Feed Proxy</h1><p>This backend is running on port <code>${PORT}</code>.</p><p>${staticAvailable ? "A production dashboard build is available from this same service." : "No production dashboard build was found. In Codespaces development, open the forwarded Vite port <code>5173</code>."}</p><p>Proxy endpoints: <a href="/health">/health</a>, <a href="/api/vessels">/api/vessels</a>, <a href="/api/chmarl/episode">/api/chmarl/episode</a>, and <a href="/api/port-events">/api/port-events</a>.</p></main></body></html>`;
}

function staticFileForUrl(requestUrl) {
  if (!existsSync(STATIC_INDEX)) return null;
  const url = new URL(requestUrl ?? "/", "http://localhost");
  const pathname = decodeURIComponent(url.pathname);
  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  const candidate = resolve(STATIC_DIR, `.${requestedPath}`);
  if (!candidate.startsWith(STATIC_DIR)) return { statusCode: 403, path: null };
  if (existsSync(candidate) && statSync(candidate).isFile()) return { statusCode: 200, path: candidate };
  if (extname(requestedPath)) return { statusCode: 404, path: null };
  return { statusCode: 200, path: STATIC_INDEX };
}

function healthPayload() {
  return {
    ok: true,
    upstreamConfigured: Boolean(UPSTREAM_URL),
    staticDashboard: existsSync(STATIC_INDEX),
    aisstream: { ...aisState, cachedVessels: aisCache.size },
    chmarl: { ...chmarlState, active: chmarlState.steps > 0 },
    portOps: { ...portOpsState, active: portOpsState.events > 0 || portOpsState.utilizationRows > 0 || portOpsState.queueRows > 0 },
  };
}

function shutdown() {
  saveAisCacheToDisk();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.on("beforeExit", saveAisCacheToDisk);

loadAisCacheFromDisk();
if (AISSTREAM_CACHE_ENABLED && AISSTREAM_CACHE_FLUSH_MS > 0) {
  const interval = setInterval(saveAisCacheToDisk, AISSTREAM_CACHE_FLUSH_MS);
  interval.unref?.();
}
startAisStream();

createServer(async (request, response) => {
  if (request.method === "OPTIONS") {
    sendJson(response, 204, {});
    return;
  }
  if (request.url === "/health") {
    await Promise.all([loadChmarlExperiment(), loadPortOperations()]);
    sendJson(response, 200, healthPayload());
    return;
  }
  if (request.url === "/api/chmarl/episode") {
    const experiment = await loadChmarlExperiment();
    if (!experiment || experiment.steps.length === 0) {
      sendJson(response, 404, {
        error: "No CH-MARL experiment feed is active",
        detail: CHMARL_EXPERIMENT_URL ? "Configured CHMARL_EXPERIMENT_URL returned no steps or failed." : `Place a CH-MARL episode JSON file at ${CHMARL_EXPERIMENT_FILE}.`,
        chmarl: chmarlState,
      });
      return;
    }
    sendJson(response, 200, experiment);
    return;
  }
  if (request.url === "/api/port-events") {
    const portOps = await loadPortOperations();
    if (!portOps) {
      sendJson(response, 404, {
        error: "No port operations feed is active",
        detail: PORT_EVENTS_URL ? "Configured PORT_EVENTS_URL returned no rows or failed." : `Place a port operations JSON file at ${PORT_EVENTS_FILE}.`,
        portOps: portOpsState,
      });
      return;
    }
    sendJson(response, 200, portOps);
    return;
  }
  if (request.url === "/api/vessels") {
    try {
      const result = await loadVessels();
      sendJson(response, 200, { vessels: result.vessels, source: result.source, health: { ...aisState, cachedVessels: aisCache.size } });
    } catch (error) {
      sendJson(response, 502, {
        error: "Failed to load vessel feed",
        detail: error instanceof Error ? error.message : String(error),
        vessels: AISSTREAM_API_KEY ? [] : fallbackVessels,
        source: AISSTREAM_API_KEY ? "aisstream-waiting" : "fallback",
        health: aisState,
      });
    }
    return;
  }
  const staticMatch = staticFileForUrl(request.url);
  if (staticMatch?.path) {
    sendFile(response, staticMatch.path);
    return;
  }
  if (staticMatch?.statusCode === 403) {
    sendJson(response, 403, { error: "Forbidden" });
    return;
  }
  if (request.url === "/" || request.url === "") {
    sendHtml(response, 200, rootHtml(Boolean(staticMatch)));
    return;
  }
  sendJson(response, 404, { error: "Not found", availableEndpoints: ["/", "/health", "/api/vessels", "/api/chmarl/episode", "/api/port-events"] });
}).listen(PORT, () => {
  const staticAvailable = existsSync(STATIC_INDEX);
  console.log(`Vessel feed proxy listening at http://localhost:${PORT}/api/vessels`);
  console.log(`Port operations endpoint at http://localhost:${PORT}/api/port-events`);
  console.log(`CH-MARL experiment endpoint at http://localhost:${PORT}/api/chmarl/episode`);
  console.log(`Vessel feed proxy health at http://localhost:${PORT}/health`);
  console.log(staticAvailable ? `Serving production dashboard from ${STATIC_DIR}` : "No dist/ build found; use Vite port 5173 for development.");
  if (AISSTREAM_CACHE_ENABLED) console.log(`AIS cache persistence enabled at ${AISSTREAM_CACHE_FILE}.`);
  if (PORT_EVENTS_URL || existsSync(PORT_EVENTS_FILE_PATH)) console.log("Port operations feed configured.");
  if (CHMARL_EXPERIMENT_URL || existsSync(CHMARL_EXPERIMENT_FILE_PATH)) console.log("CH-MARL experiment feed configured.");
  if (AISSTREAM_API_KEY) console.log("AISStream live mode enabled.");
});
