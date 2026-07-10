import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import WebSocket from "ws";
import { createEcoFairRuntime } from "./ecofair.mjs";

const PORT = Number(process.env.PORT ?? 8787);
const STATIC_DIR = resolve(process.env.STATIC_DIR ?? "dist");
const STATIC_INDEX = resolve(STATIC_DIR, "index.html");

const WORLD_AIS_BBOX = "-90,-180;90,180";
const REGIONAL_AIS_BBOX = "11,32;31,56";
const SAUDI_PORT_BBOX = [
  "20.70,38.35;22.95,39.85",
  "23.25,37.15;24.90,38.90",
  "16.15,41.75;17.55,43.35",
  "25.70,49.25;27.25,50.90",
  "24.35,54.35;25.65,55.75",
  "29.20,32.00;30.55,33.25",
].join("|");

const PORT_REFERENCE_POINTS = [
  { id: "Jeddah", latitude: 21.4858, longitude: 39.1925 },
  { id: "King Abdullah Port", latitude: 22.3924, longitude: 39.0953 },
  { id: "Yanbu", latitude: 24.0866, longitude: 38.0637 },
  { id: "Jizan", latitude: 16.8917, longitude: 42.5511 },
  { id: "Dammam", latitude: 26.4318, longitude: 50.1015 },
  { id: "Jebel Ali", latitude: 25.0114, longitude: 55.0611 },
  { id: "Suez", latitude: 29.9668, longitude: 32.5498 },
];

const WEATHER_POINTS = [
  { locationId: "suez", name: "Suez", latitude: 29.9668, longitude: 32.5498 },
  { locationId: "jeddah", name: "Jeddah", latitude: 21.4858, longitude: 39.1925 },
  { locationId: "kaec", name: "King Abdullah Port", latitude: 22.3924, longitude: 39.0953 },
  { locationId: "yanbu", name: "Yanbu", latitude: 24.0866, longitude: 38.0637 },
  { locationId: "jizan", name: "Jizan", latitude: 16.8917, longitude: 42.5511 },
  { locationId: "dammam", name: "Dammam", latitude: 26.4318, longitude: 50.1015 },
  { locationId: "jebel-ali", name: "Jebel Ali", latitude: 25.0114, longitude: 55.0611 },
];

function splitBboxes(value) {
  return String(value ?? "").split("|").map((box) => box.trim()).filter(Boolean);
}

function mergeBboxes(...values) {
  return [...new Set(values.flatMap(splitBboxes))].join("|");
}

function parseBoundingBoxes(value) {
  return splitBboxes(value).map((box) => {
    const corners = box.split(";").map((corner) => corner.split(",").map((part) => Number(part.trim())));
    if (corners.length !== 2 || corners.some((corner) => corner.length !== 2 || corner.some((number) => !Number.isFinite(number)))) {
      throw new Error(`Invalid AIS bounding box: ${box}`);
    }
    return corners;
  });
}

function numberValue(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.trim().replace(/[^0-9.\-]/g, ""));
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function timestampMs(value) {
  const parsed = Date.parse(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function rowsFrom(payload, keys) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  for (const key of keys) if (Array.isArray(payload[key])) return payload[key];
  return [];
}

function haversineNm(a, b) {
  const radiusNm = 3440.065;
  const toRad = (value) => value * Math.PI / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * radiusNm * Math.asin(Math.min(1, Math.sqrt(h)));
}

function nearestOperationalPort(vessel) {
  if (!Number.isFinite(vessel?.latitude) || !Number.isFinite(vessel?.longitude)) return null;
  return PORT_REFERENCE_POINTS
    .map((port) => ({ port, distanceNm: haversineNm(vessel, port) }))
    .sort((a, b) => a.distanceNm - b.distanceNm)[0] ?? null;
}

function normalizeStatus(value) {
  const text = String(value ?? "").toLowerCase();
  if (text.includes("constraint") || text.includes("restricted") || text.includes("alert")) return "Constrained";
  if (text.includes("watch") || text.includes("warning") || text.includes("delay")) return "Watch";
  return "Nominal";
}

function normalizeTrail(points) {
  if (!Array.isArray(points)) return undefined;
  const trail = points.flatMap((point) => {
    const latitude = numberValue(point?.latitude ?? point?.lat);
    const longitude = numberValue(point?.longitude ?? point?.lon ?? point?.lng);
    return latitude === undefined || longitude === undefined ? [] : [{ latitude, longitude, ...(point?.timestamp ? { timestamp: point.timestamp } : {}) }];
  });
  return trail.length > 1 ? trail : undefined;
}

function speedText(value) {
  const speed = numberValue(value);
  return speed === undefined ? "TBD" : `${speed.toFixed(1)} kn`;
}

function normalizeVessel(row) {
  if (!row || typeof row !== "object") return null;
  const name = row.name ?? row.vesselName ?? row.shipName ?? "Unknown Vessel";
  const id = row.id ?? row.vesselId ?? (row.mmsi ? `MMSI-${row.mmsi}` : row.imo ? `IMO-${row.imo}` : name);
  const origin = row.originPort ?? row.origin ?? "Unknown";
  const destination = row.destinationPort ?? row.destination ?? row.dest ?? "Unknown";
  const speed = row.speed ?? row.speedKnots ?? row.sog;
  const latitude = numberValue(row.latitude ?? row.lat);
  const longitude = numberValue(row.longitude ?? row.lon ?? row.lng);
  if (!id || latitude === undefined || longitude === undefined) return null;
  return {
    id: String(id),
    mmsi: row.mmsi === undefined ? undefined : String(row.mmsi),
    name: String(name),
    route: row.route ?? `${origin} → ${destination}`,
    cargo: String(row.cargo ?? row.cargoClass ?? row.vesselType ?? row.shipType ?? "Unspecified"),
    eta: String(row.eta ?? row.ETA ?? "TBD"),
    speed: typeof speed === "string" && speed.toLowerCase().includes("kn") ? speed : speedText(speed),
    sog: numberValue(row.sog ?? row.speedKnots ?? row.speed),
    status: row.status ?? normalizeStatus(row.navStatus),
    latitude,
    longitude,
    headingDeg: numberValue(row.headingDeg ?? row.heading),
    courseDeg: numberValue(row.courseDeg ?? row.cog),
    timestamp: row.timestamp ?? row.time ?? row.updatedAt ?? new Date().toISOString(),
    trail: normalizeTrail(row.trail ?? row.history ?? row.track),
    inputSource: row.inputSource ?? row.source,
  };
}

function messageBody(message) {
  const type = message?.MessageType;
  return message?.Message?.[type]
    ?? message?.Message?.PositionReport
    ?? message?.Message?.StandardClassBPositionReport
    ?? message?.Message?.ExtendedClassBPositionReport
    ?? {};
}

function normalizeAisMessage(raw) {
  const metadata = raw?.MetaData ?? raw?.Metadata ?? {};
  const body = messageBody(raw);
  const mmsi = metadata.MMSI ?? body.UserID;
  const latitude = numberValue(metadata.latitude ?? metadata.Latitude ?? body.Latitude);
  const longitude = numberValue(metadata.longitude ?? metadata.Longitude ?? body.Longitude);
  if (!mmsi || latitude === undefined || longitude === undefined) return null;
  const sog = numberValue(body.Sog ?? metadata.Sog ?? metadata.SOG);
  const name = metadata.ShipName ?? body.Name ?? `MMSI ${mmsi}`;
  return normalizeVessel({
    id: `MMSI-${mmsi}`,
    mmsi,
    name: String(name).trim() || `MMSI ${mmsi}`,
    route: "AIS live position",
    cargo: raw.MessageType ?? "AIS vessel",
    eta: "Live AIS",
    speed: sog,
    sog,
    status: "Nominal",
    latitude,
    longitude,
    heading: body.TrueHeading ?? body.Heading ?? metadata.TrueHeading,
    cog: body.Cog ?? metadata.Cog ?? metadata.COG,
    timestamp: metadata.time_utc ?? metadata.TimeUtc ?? metadata.timestamp ?? new Date().toISOString(),
    inputSource: "aisstream",
  });
}

const GLOBAL_TRACKING_ENABLED = process.env.AISSTREAM_GLOBAL_TRACKING_ENABLED !== "false";
const TRACKING_BBOX_TEXT = GLOBAL_TRACKING_ENABLED
  ? (process.env.AISSTREAM_TRACKING_BBOX ?? WORLD_AIS_BBOX)
  : mergeBboxes(process.env.AISSTREAM_BBOX ?? REGIONAL_AIS_BBOX, process.env.AISSTREAM_APPEND_SAUDI_PORT_BBOXES === "false" ? "" : SAUDI_PORT_BBOX);
const TRACKING_BOXES = parseBoundingBoxes(TRACKING_BBOX_TEXT);
const TRACKING_SCOPE_HASH = createHash("sha1").update(TRACKING_BBOX_TEXT).digest("hex").slice(0, 8);
const AISSTREAM_API_KEY = process.env.AISSTREAM_API_KEY;
const AISSTREAM_URL = process.env.AISSTREAM_URL ?? "wss://stream.aisstream.io/v0/stream";
const AISSTREAM_FILTER_TYPES = (process.env.AISSTREAM_FILTER_TYPES ?? "PositionReport,StandardClassBPositionReport,ExtendedClassBPositionReport").split(",").map((item) => item.trim()).filter(Boolean);
const AISSTREAM_MAX_VESSELS = Math.max(100, Number(process.env.AISSTREAM_MAX_VESSELS ?? 5000));
const AISSTREAM_TRAIL_POINTS = Math.max(2, Number(process.env.AISSTREAM_TRAIL_POINTS ?? 12));
const AISSTREAM_MAX_AGE_MS = Math.max(60_000, Number(process.env.AISSTREAM_MAX_AGE_MS ?? 6 * 60 * 60 * 1000));
const AISSTREAM_CACHE_ENABLED = process.env.AISSTREAM_CACHE_ENABLED !== "false";
const AISSTREAM_CACHE_FLUSH_MS = Math.max(5_000, Number(process.env.AISSTREAM_CACHE_FLUSH_MS ?? 30_000));
const ECOFAIR_OPERATIONAL_RADIUS_NM = Math.max(1, Number(process.env.ECOFAIR_OPERATIONAL_RADIUS_NM ?? 120));
const ECOFAIR_TICK_MS = Math.max(10_000, Number(process.env.ECOFAIR_TICK_MS ?? 60_000));
const CHMARL_HISTORY_LIMIT = Math.max(5, Number(process.env.CHMARL_HISTORY_LIMIT ?? 96));
const CHMARL_HISTORY_MIN_INTERVAL_MS = Math.max(10_000, Number(process.env.CHMARL_HISTORY_MIN_INTERVAL_MS ?? 60_000));
const WEATHER_CACHE_MS = Math.max(60_000, Number(process.env.WEATHER_CACHE_MS ?? 10 * 60_000));
const WEATHER_TIMEOUT_MS = Math.max(1_000, Number(process.env.WEATHER_TIMEOUT_MS ?? 4_000));

const RUNTIME_DATA_DIR = resolve(process.env.RUNTIME_DATA_DIR ?? ".runtime");
function runtimePath(envName, fallbackName, scope = false) {
  const configured = process.env[envName];
  if (configured) return resolve(configured);
  const name = scope ? fallbackName.replace(/(\.[^.]+)$/, `-${TRACKING_SCOPE_HASH}$1`) : fallbackName;
  return join(RUNTIME_DATA_DIR, name);
}

const AIS_CACHE_FILE = runtimePath("AISSTREAM_CACHE_FILE", "ais-cache.json", true);
const ECOFAIR_STATE_FILE = runtimePath("ECOFAIR_STATE_FILE", "ecofair-state.json", true);
const FIXED_VESSEL_DATA_FILE = runtimePath("FIXED_VESSEL_DATA_FILE", "manual-vessels.json");
const CHMARL_EXPERIMENT_FILE = runtimePath("CHMARL_EXPERIMENT_FILE", "chmarl-episode.json");
const PORT_EVENTS_FILE = runtimePath("PORT_EVENTS_FILE", "port-events.json");
const WEATHER_FILE = runtimePath("WEATHER_FILE", "weather.json");

const UPSTREAM_URL = process.env.UPSTREAM_VESSEL_DATA_URL;
const UPSTREAM_TOKEN = process.env.UPSTREAM_VESSEL_DATA_TOKEN;
const FIXED_VESSEL_DATA_URL = process.env.FIXED_VESSEL_DATA_URL;
const FIXED_VESSEL_DATA_TOKEN = process.env.FIXED_VESSEL_DATA_TOKEN;
const FIXED_VESSEL_DATA_FILE_ENABLED = process.env.FIXED_VESSEL_DATA_FILE_ENABLED !== "false";
const FIXED_VESSEL_INGEST_TOKEN = process.env.FIXED_VESSEL_INGEST_TOKEN;
const CHMARL_RUNTIME_ENABLED = process.env.CHMARL_RUNTIME_ENABLED !== "false";
const CHMARL_EXPERIMENT_URL = process.env.CHMARL_EXPERIMENT_URL;
const CHMARL_EXPERIMENT_TOKEN = process.env.CHMARL_EXPERIMENT_TOKEN;
const CHMARL_INGEST_TOKEN = process.env.CHMARL_INGEST_TOKEN;
const CHMARL_FILE_ENABLED = process.env.CHMARL_FILE_ENABLED === "true";
const PORT_EVENTS_URL = process.env.PORT_EVENTS_URL;
const PORT_EVENTS_TOKEN = process.env.PORT_EVENTS_TOKEN;
const PORT_EVENTS_FILE_ENABLED = process.env.PORT_EVENTS_FILE_ENABLED === "true";
const WEATHER_URL = process.env.WEATHER_URL;
const WEATHER_TOKEN = process.env.WEATHER_TOKEN;
const WEATHER_FILE_ENABLED = process.env.WEATHER_FILE_ENABLED === "true";

let ecofairPortCapacity = {};
try {
  ecofairPortCapacity = process.env.ECOFAIR_PORT_CAPACITY ? JSON.parse(process.env.ECOFAIR_PORT_CAPACITY) : {};
} catch {
  console.warn("Invalid ECOFAIR_PORT_CAPACITY JSON; using defaults.");
}

const ecofair = createEcoFairRuntime({
  ports: PORT_REFERENCE_POINTS,
  portCapacity: ecofairPortCapacity,
  emissionBudgetTonnesPerDay: Number(process.env.ECOFAIR_EMISSION_BUDGET_TONNES_PER_DAY ?? 0),
  budgetTonnesPerVesselPerDay: Number(process.env.ECOFAIR_BUDGET_TONNES_PER_VESSEL_PER_DAY ?? 60),
  gammaEmis: Number(process.env.ECOFAIR_GAMMA_EMIS ?? 10),
  gammaFair: Number(process.env.ECOFAIR_GAMMA_FAIR ?? 5),
  lambdaLearningRate: Number(process.env.ECOFAIR_LAMBDA_LR ?? 0.05),
  giniLimit: Number(process.env.ECOFAIR_GINI_LIMIT ?? 0.35),
  minMaxLimit: Number(process.env.ECOFAIR_MINMAX_LIMIT ?? 0.4),
  berthRadiusNm: Number(process.env.ECOFAIR_BERTH_RADIUS_NM ?? 5),
  anchorageRadiusNm: Number(process.env.ECOFAIR_ANCHORAGE_RADIUS_NM ?? 20),
});

const aisCache = new Map();
let aisSocket = null;
let reconnectTimer = null;
let stopping = false;
let tickRunning = false;
let chmarlOnlineHistory = [];
let lastChmarlSignature = "";
let lastCombinedVessels = [];
let lastOperationalVessels = [];
let lastWeatherPayload = null;
let lastWeatherLoadedMs = 0;

const aisState = {
  enabled: Boolean(AISSTREAM_API_KEY),
  connected: false,
  trackingMode: GLOBAL_TRACKING_ENABLED ? "global" : "regional",
  trackingBbox: TRACKING_BBOX_TEXT,
  boundingBoxes: TRACKING_BOXES,
  filterTypes: AISSTREAM_FILTER_TYPES,
  lastMessageAt: null,
  lastError: null,
  reconnectAttempt: 0,
  messageCount: 0,
  usablePositionMessages: 0,
  cachedVessels: 0,
  cacheLimit: AISSTREAM_MAX_VESSELS,
  trailLimit: AISSTREAM_TRAIL_POINTS,
  maxAgeMs: AISSTREAM_MAX_AGE_MS,
  cacheEnabled: AISSTREAM_CACHE_ENABLED,
  cacheFile: AIS_CACHE_FILE,
  cacheSavedAt: null,
  cacheLoadedAt: null,
  cacheSaveError: null,
  restoredVessels: 0,
};

const vesselInputState = {
  aisRows: 0,
  upstreamConfigured: Boolean(UPSTREAM_URL),
  upstreamRows: 0,
  fixedUrlConfigured: Boolean(FIXED_VESSEL_DATA_URL),
  fixedFile: FIXED_VESSEL_DATA_FILE,
  fixedRows: 0,
  trackingRows: 0,
  operationalRows: 0,
  operationalRadiusNm: ECOFAIR_OPERATIONAL_RADIUS_NM,
  lastLoadedAt: null,
  lastIngestedAt: null,
  lastError: null,
};

const chmarlState = {
  enabled: CHMARL_RUNTIME_ENABLED,
  source: "runtime",
  configuredUrl: Boolean(CHMARL_EXPERIMENT_URL),
  file: CHMARL_FILE_ENABLED ? CHMARL_EXPERIMENT_FILE : null,
  steps: 0,
  experimentId: null,
  scenarioId: null,
  lastLoadedAt: null,
  lastIngestedAt: null,
  lastError: null,
};

const portOpsState = { source: "none", configuredUrl: Boolean(PORT_EVENTS_URL), file: PORT_EVENTS_FILE_ENABLED ? PORT_EVENTS_FILE : null, events: 0, utilizationRows: 0, queueRows: 0, lastLoadedAt: null, lastError: null };
const weatherState = { source: "none", configuredUrl: Boolean(WEATHER_URL), file: WEATHER_FILE_ENABLED ? WEATHER_FILE : null, points: 0, lastLoadedAt: null, lastError: null };
const runtimeState = { backgroundTickActive: true, lastTickAt: null, lastTickDurationMs: null, lastTickError: null };

function isFresh(vessel) {
  const timestamp = timestampMs(vessel.timestamp);
  return timestamp === 0 || Date.now() - timestamp <= AISSTREAM_MAX_AGE_MS;
}

function trackingAisVessels() {
  const rows = [];
  for (const [id, vessel] of aisCache.entries()) {
    if (!isFresh(vessel)) {
      aisCache.delete(id);
      continue;
    }
    rows.push(vessel);
  }
  rows.sort((a, b) => timestampMs(b.timestamp) - timestampMs(a.timestamp));
  aisState.cachedVessels = rows.length;
  return rows;
}

function mergeAisVessel(update) {
  const existing = aisCache.get(update.id);
  const trail = [...(existing?.trail ?? []), { latitude: update.latitude, longitude: update.longitude, timestamp: update.timestamp }].slice(-AISSTREAM_TRAIL_POINTS);
  const merged = { ...existing, ...update, trail: trail.length > 1 ? trail : undefined };
  if (aisCache.has(update.id)) aisCache.delete(update.id);
  aisCache.set(update.id, merged);
  while (aisCache.size > AISSTREAM_MAX_VESSELS) {
    const oldestKey = aisCache.keys().next().value;
    if (!oldestKey) break;
    aisCache.delete(oldestKey);
  }
  aisState.cachedVessels = aisCache.size;
}

function loadAisCache() {
  if (!AISSTREAM_CACHE_ENABLED || !existsSync(AIS_CACHE_FILE)) return;
  try {
    const payload = JSON.parse(readFileSync(AIS_CACHE_FILE, "utf8"));
    for (const raw of rowsFrom(payload, ["vessels"]).slice(-AISSTREAM_MAX_VESSELS)) {
      const vessel = normalizeVessel(raw);
      if (vessel && isFresh(vessel)) aisCache.set(vessel.id, vessel);
    }
    aisState.restoredVessels = aisCache.size;
    aisState.cachedVessels = aisCache.size;
    aisState.cacheLoadedAt = new Date().toISOString();
  } catch (error) {
    aisState.cacheSaveError = error instanceof Error ? error.message : String(error);
  }
}

function saveAisCache() {
  if (!AISSTREAM_CACHE_ENABLED) return;
  try {
    mkdirSync(dirname(AIS_CACHE_FILE), { recursive: true });
    const snapshot = { version: 2, savedAt: new Date().toISOString(), trackingBbox: TRACKING_BBOX_TEXT, vessels: trackingAisVessels() };
    writeFileSync(AIS_CACHE_FILE, JSON.stringify(snapshot));
    aisState.cacheSavedAt = snapshot.savedAt;
    aisState.cacheSaveError = null;
  } catch (error) {
    aisState.cacheSaveError = error instanceof Error ? error.message : String(error);
  }
}

function loadEcofairState() {
  if (!existsSync(ECOFAIR_STATE_FILE)) return;
  try {
    ecofair.restore(JSON.parse(readFileSync(ECOFAIR_STATE_FILE, "utf8")));
  } catch (error) {
    console.warn("Could not restore EcoFair state:", error instanceof Error ? error.message : error);
  }
}

function saveEcofairState() {
  try {
    mkdirSync(dirname(ECOFAIR_STATE_FILE), { recursive: true });
    writeFileSync(ECOFAIR_STATE_FILE, JSON.stringify(ecofair.serialize()));
  } catch (error) {
    console.warn("Could not persist EcoFair state:", error instanceof Error ? error.message : error);
  }
}

async function fetchProviderJson(url, token, timeoutMs = 10_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = { accept: "application/json" };
    if (token) headers.authorization = `Bearer ${token}`;
    const response = await fetch(url, { headers, signal: controller.signal });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function loadFixedVessels() {
  const rows = [];
  if (FIXED_VESSEL_DATA_URL) {
    const payload = await fetchProviderJson(FIXED_VESSEL_DATA_URL, FIXED_VESSEL_DATA_TOKEN);
    rows.push(...rowsFrom(payload, ["vessels", "data", "items"]));
  }
  if (FIXED_VESSEL_DATA_FILE_ENABLED && existsSync(FIXED_VESSEL_DATA_FILE)) {
    const payload = JSON.parse(readFileSync(FIXED_VESSEL_DATA_FILE, "utf8"));
    rows.push(...rowsFrom(payload, ["vessels", "data", "items"]));
  }
  return rows.map((row) => normalizeVessel({ ...row, inputSource: row.inputSource ?? "fixed" })).filter(Boolean);
}

async function loadUpstreamVessels() {
  if (!UPSTREAM_URL) return [];
  const payload = await fetchProviderJson(UPSTREAM_URL, UPSTREAM_TOKEN);
  return rowsFrom(payload, ["vessels", "data", "items"]).map((row) => normalizeVessel({ ...row, inputSource: row.inputSource ?? "upstream" })).filter(Boolean);
}

function operationalVessels(vessels) {
  return vessels.filter((vessel) => {
    const nearest = nearestOperationalPort(vessel);
    return nearest && nearest.distanceNm <= ECOFAIR_OPERATIONAL_RADIUS_NM;
  });
}

async function loadCombinedVessels() {
  try {
    const [fixed, upstream] = await Promise.all([loadFixedVessels(), loadUpstreamVessels()]);
    const ais = trackingAisVessels();
    const merged = new Map();
    for (const row of fixed) merged.set(row.id, row);
    for (const row of upstream) merged.set(row.id, row);
    for (const row of ais) merged.set(row.id, row);
    const tracking = [...merged.values()].filter((row) => Number.isFinite(row.latitude) && Number.isFinite(row.longitude));
    const operational = operationalVessels(tracking);
    vesselInputState.aisRows = ais.length;
    vesselInputState.upstreamRows = upstream.length;
    vesselInputState.fixedRows = fixed.length;
    vesselInputState.trackingRows = tracking.length;
    vesselInputState.operationalRows = operational.length;
    vesselInputState.lastLoadedAt = new Date().toISOString();
    vesselInputState.lastError = null;
    lastCombinedVessels = tracking;
    lastOperationalVessels = operational;
    return { tracking, operational };
  } catch (error) {
    vesselInputState.lastLoadedAt = new Date().toISOString();
    vesselInputState.lastError = error instanceof Error ? error.message : String(error);
    return { tracking: lastCombinedVessels, operational: lastOperationalVessels };
  }
}

function sourceForTracking() {
  if (vesselInputState.aisRows > 0) return "aisstream";
  if (vesselInputState.upstreamRows > 0) return "upstream";
  if (vesselInputState.fixedRows > 0) return "remote";
  return AISSTREAM_API_KEY ? "aisstream-waiting" : "none";
}

function authorized(request, token) {
  return !token || request.headers.authorization === `Bearer ${token}`;
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

function writeFixedVessels(payload) {
  const vessels = rowsFrom(payload, ["vessels", "data", "items"]).map((row) => normalizeVessel({ ...row, inputSource: row.inputSource ?? "fixed" })).filter(Boolean);
  const next = { ok: true, version: 2, source: payload?.source ?? "manual-fixed-vessels", updatedAt: new Date().toISOString(), vessels, fixedFile: FIXED_VESSEL_DATA_FILE };
  mkdirSync(dirname(FIXED_VESSEL_DATA_FILE), { recursive: true });
  writeFileSync(FIXED_VESSEL_DATA_FILE, JSON.stringify(next, null, 2));
  vesselInputState.lastIngestedAt = next.updatedAt;
  return next;
}

function updateChmarlState(payload, source) {
  const steps = rowsFrom(payload, ["steps", "data", "items"]);
  chmarlState.source = source;
  chmarlState.steps = steps.length;
  chmarlState.experimentId = payload?.experimentId ?? steps[0]?.experimentId ?? null;
  chmarlState.scenarioId = payload?.scenarioId ?? steps[0]?.scenarioId ?? null;
  chmarlState.lastLoadedAt = new Date().toISOString();
  chmarlState.lastError = null;
  return { source, experimentId: chmarlState.experimentId, scenarioId: chmarlState.scenarioId, steps };
}

function readChmarlFile() {
  if (!CHMARL_FILE_ENABLED || !existsSync(CHMARL_EXPERIMENT_FILE)) return null;
  return JSON.parse(readFileSync(CHMARL_EXPERIMENT_FILE, "utf8"));
}

function ingestChmarl(payload) {
  const incoming = Array.isArray(payload) ? payload : rowsFrom(payload, ["steps", "data", "items"]);
  const existing = readChmarlFile();
  const steps = [...rowsFrom(existing, ["steps", "data", "items"]), ...incoming].slice(-5000);
  const next = {
    experimentId: payload?.experimentId ?? existing?.experimentId ?? steps[0]?.experimentId ?? "runtime-chmarl",
    scenarioId: payload?.scenarioId ?? existing?.scenarioId ?? steps[0]?.scenarioId ?? "live-operations",
    updatedAt: new Date().toISOString(),
    steps,
  };
  mkdirSync(dirname(CHMARL_EXPERIMENT_FILE), { recursive: true });
  writeFileSync(CHMARL_EXPERIMENT_FILE, JSON.stringify(next, null, 2));
  chmarlState.lastIngestedAt = next.updatedAt;
  return updateChmarlState(next, "ingest");
}

function recordOnlineStep() {
  const step = ecofair.buildStep(chmarlOnlineHistory.length + 1);
  const signature = JSON.stringify({ reward: step.rewards?.[0]?.value, co2: step.state?.totalCo2Tonnes, gini: step.state?.giniFuel, vessels: step.state?.trackedVessels });
  const previous = chmarlOnlineHistory.at(-1);
  const previousMs = previous ? timestampMs(previous.timestamp) : 0;
  if (signature !== lastChmarlSignature || Date.now() - previousMs >= CHMARL_HISTORY_MIN_INTERVAL_MS) {
    chmarlOnlineHistory = [...chmarlOnlineHistory, step].slice(-CHMARL_HISTORY_LIMIT);
    lastChmarlSignature = signature;
  }
  return updateChmarlState({ experimentId: step.experimentId, scenarioId: step.scenarioId, source: "ecofair-online", steps: chmarlOnlineHistory }, "ecofair-online");
}

async function currentChmarlExperiment() {
  try {
    if (CHMARL_EXPERIMENT_URL) return updateChmarlState(await fetchProviderJson(CHMARL_EXPERIMENT_URL, CHMARL_EXPERIMENT_TOKEN), "url");
    const filePayload = readChmarlFile();
    if (filePayload) return updateChmarlState(filePayload, "file");
    if (chmarlOnlineHistory.length > 0) return updateChmarlState({ experimentId: chmarlOnlineHistory[0].experimentId, scenarioId: chmarlOnlineHistory[0].scenarioId, steps: chmarlOnlineHistory }, "ecofair-online");
    return null;
  } catch (error) {
    chmarlState.lastError = error instanceof Error ? error.message : String(error);
    return null;
  }
}

function updatePortOpsState(payload, source) {
  const portEvents = rowsFrom(payload, ["portEvents", "port_events", "events", "data", "items"]);
  const portUtilization = rowsFrom(payload, ["portUtilization", "port_utilization", "utilization", "ports"]);
  const queueStatus = rowsFrom(payload, ["queueStatus", "queue_status", "queues", "berths"]);
  Object.assign(portOpsState, { source, events: portEvents.length, utilizationRows: portUtilization.length, queueRows: queueStatus.length, lastLoadedAt: new Date().toISOString(), lastError: null });
  return { source, portEvents, portUtilization, queueStatus, portOps: portOpsState };
}

async function currentPortOperations() {
  try {
    if (PORT_EVENTS_URL) return updatePortOpsState(await fetchProviderJson(PORT_EVENTS_URL, PORT_EVENTS_TOKEN), "url");
    if (PORT_EVENTS_FILE_ENABLED && existsSync(PORT_EVENTS_FILE)) return updatePortOpsState(JSON.parse(readFileSync(PORT_EVENTS_FILE, "utf8")), "file");
    return updatePortOpsState(ecofair.buildPortOperations(), "ecofair-derived");
  } catch (error) {
    portOpsState.lastError = error instanceof Error ? error.message : String(error);
    return null;
  }
}

function nearestHourIndex(times) {
  const now = Date.now();
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < times.length; index += 1) {
    const parsed = Date.parse(times[index]);
    if (!Number.isFinite(parsed)) continue;
    const distance = Math.abs(parsed - now);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }
  return bestIndex;
}

async function openMeteoPoint(point) {
  const marineUrl = `https://marine-api.open-meteo.com/v1/marine?latitude=${point.latitude}&longitude=${point.longitude}&hourly=wave_height,sea_surface_temperature&timezone=UTC`;
  const forecastUrl = `https://api.open-meteo.com/v1/forecast?latitude=${point.latitude}&longitude=${point.longitude}&hourly=wind_speed_10m,temperature_2m&timezone=UTC`;
  const [marine, forecast] = await Promise.allSettled([fetchProviderJson(marineUrl, undefined, WEATHER_TIMEOUT_MS), fetchProviderJson(forecastUrl, undefined, WEATHER_TIMEOUT_MS)]);
  const output = { ...point, provider: "open-meteo", updatedAt: new Date().toISOString() };
  if (marine.status === "fulfilled") {
    const index = nearestHourIndex(marine.value.hourly?.time ?? []);
    output.waveHeightM = numberValue(marine.value.hourly?.wave_height?.[index]);
    output.seaSurfaceTemperatureC = numberValue(marine.value.hourly?.sea_surface_temperature?.[index]);
  }
  if (forecast.status === "fulfilled") {
    const index = nearestHourIndex(forecast.value.hourly?.time ?? []);
    output.windSpeedMs = numberValue(forecast.value.hourly?.wind_speed_10m?.[index]);
    output.airTemperatureC = numberValue(forecast.value.hourly?.temperature_2m?.[index]);
  }
  return output;
}

async function currentWeather(force = false) {
  if (!force && lastWeatherPayload && Date.now() - lastWeatherLoadedMs < WEATHER_CACHE_MS) return lastWeatherPayload;
  try {
    let payload;
    if (WEATHER_URL) payload = { source: "runtime", points: rowsFrom(await fetchProviderJson(WEATHER_URL, WEATHER_TOKEN), ["points", "weather", "data", "items"]) };
    else if (WEATHER_FILE_ENABLED && existsSync(WEATHER_FILE)) payload = { source: "runtime", points: rowsFrom(JSON.parse(readFileSync(WEATHER_FILE, "utf8")), ["points", "weather", "data", "items"]) };
    else payload = { source: "open-meteo", points: await Promise.all(WEATHER_POINTS.map(openMeteoPoint)) };
    Object.assign(weatherState, { source: payload.source, points: payload.points.length, lastLoadedAt: new Date().toISOString(), lastError: null });
    lastWeatherPayload = { ...payload, weather: weatherState };
    lastWeatherLoadedMs = Date.now();
    return lastWeatherPayload;
  } catch (error) {
    weatherState.lastError = error instanceof Error ? error.message : String(error);
    return lastWeatherPayload;
  }
}

async function runBackgroundTick() {
  if (tickRunning) return;
  tickRunning = true;
  const started = Date.now();
  try {
    const { operational } = await loadCombinedVessels();
    ecofair.update(operational);
    if (CHMARL_RUNTIME_ENABLED && (operational.length > 0 || ecofair.summary().trackedVessels > 0)) recordOnlineStep();
    saveEcofairState();
    runtimeState.lastTickAt = new Date().toISOString();
    runtimeState.lastTickDurationMs = Date.now() - started;
    runtimeState.lastTickError = null;
  } catch (error) {
    runtimeState.lastTickAt = new Date().toISOString();
    runtimeState.lastTickDurationMs = Date.now() - started;
    runtimeState.lastTickError = error instanceof Error ? error.message : String(error);
  } finally {
    tickRunning = false;
  }
}

function startAisStream() {
  if (!AISSTREAM_API_KEY || stopping) return;
  aisSocket = new WebSocket(AISSTREAM_URL);
  aisSocket.on("open", () => {
    aisState.connected = true;
    aisState.reconnectAttempt = 0;
    aisState.lastError = null;
    aisSocket.send(JSON.stringify({ APIKey: AISSTREAM_API_KEY, BoundingBoxes: TRACKING_BOXES, ...(AISSTREAM_FILTER_TYPES.length > 0 ? { FilterMessageTypes: AISSTREAM_FILTER_TYPES } : {}) }));
  });
  aisSocket.on("message", (data) => {
    try {
      aisState.messageCount += 1;
      const raw = JSON.parse(data.toString());
      if (raw.error) {
        aisState.lastError = String(raw.error);
        return;
      }
      const vessel = normalizeAisMessage(raw);
      if (!vessel) return;
      aisState.usablePositionMessages += 1;
      aisState.lastMessageAt = new Date().toISOString();
      mergeAisVessel(vessel);
    } catch (error) {
      aisState.lastError = error instanceof Error ? error.message : String(error);
    }
  });
  aisSocket.on("close", () => {
    aisState.connected = false;
    if (stopping) return;
    const delay = Math.min(30_000, 2_000 * 2 ** aisState.reconnectAttempt);
    aisState.reconnectAttempt += 1;
    reconnectTimer = setTimeout(startAisStream, delay);
  });
  aisSocket.on("error", (error) => {
    aisState.connected = false;
    aisState.lastError = error.message;
  });
}

function scopedReport() {
  const base = ecofair.buildReport();
  const scopeSection = [
    "## Input scope",
    "",
    `- Tracking feed: ${vesselInputState.trackingRows} vessels shown on the map (${aisState.trackingMode} AIS scope).`,
    `- Operational calculation feed: ${vesselInputState.operationalRows} vessels within ${ECOFAIR_OPERATIONAL_RADIUS_NM} nm of monitored ports.`,
    "- EcoFair-CH-MARL fuel, emissions, fairness, queue, reward, and constraint calculations use only the operational calculation feed.",
    "",
  ].join("\n");
  return base.replace("## Fleet measures", `${scopeSection}## Fleet measures`).replace("- Vessel positions: aisstream.io live AIS (Red Sea / Gulf bounding boxes).", `- Vessel tracking: AISStream ${aisState.trackingMode} feed; operational calculations are restricted to monitored-port geofences.`);
}

function staticFileForUrl(requestUrl) {
  if (!existsSync(STATIC_INDEX)) return null;
  const url = new URL(requestUrl ?? "/", "http://localhost");
  const requestedPath = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const candidate = resolve(STATIC_DIR, `.${requestedPath}`);
  if (!candidate.startsWith(STATIC_DIR)) return { statusCode: 403, path: null };
  if (existsSync(candidate) && statSync(candidate).isFile()) return { statusCode: 200, path: candidate };
  if (extname(requestedPath)) return { statusCode: 404, path: null };
  return { statusCode: 200, path: STATIC_INDEX };
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type, authorization",
    "cache-control": "no-store",
  });
  response.end(statusCode === 204 ? "" : JSON.stringify(payload, null, 2));
}

function sendFile(response, path) {
  const type = path.endsWith(".html") ? "text/html" : path.endsWith(".js") ? "text/javascript" : path.endsWith(".css") ? "text/css" : path.endsWith(".json") ? "application/json" : "application/octet-stream";
  response.writeHead(200, { "content-type": type, "cache-control": path.endsWith(".html") ? "no-cache" : "public, max-age=3600" });
  response.end(readFileSync(path));
}

function healthPayload() {
  return {
    ok: true,
    staticDashboard: existsSync(STATIC_INDEX),
    runtime: runtimeState,
    trackingScope: { mode: aisState.trackingMode, bbox: TRACKING_BBOX_TEXT, rows: vesselInputState.trackingRows, maxRows: AISSTREAM_MAX_VESSELS },
    operationalScope: { radiusNm: ECOFAIR_OPERATIONAL_RADIUS_NM, rows: vesselInputState.operationalRows, ports: PORT_REFERENCE_POINTS.map((port) => port.id) },
    vesselInputs: vesselInputState,
    aisstream: aisState,
    chmarl: { ...chmarlState, active: chmarlState.steps > 0 },
    ecofair: ecofair.summary(),
    portOps: { ...portOpsState, active: portOpsState.events > 0 || portOpsState.utilizationRows > 0 || portOpsState.queueRows > 0 },
    weather: { ...weatherState, active: weatherState.points > 0 },
    persistence: { dataDir: RUNTIME_DATA_DIR, aisCacheFile: AIS_CACHE_FILE, ecofairStateFile: ECOFAIR_STATE_FILE, fixedVesselFile: FIXED_VESSEL_DATA_FILE },
  };
}

function shutdown() {
  stopping = true;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  try { aisSocket?.close(); } catch {}
  saveAisCache();
  saveEcofairState();
  process.exit(0);
}

mkdirSync(RUNTIME_DATA_DIR, { recursive: true });
loadAisCache();
loadEcofairState();
startAisStream();
void runBackgroundTick();
void currentWeather();

const cacheInterval = setInterval(saveAisCache, AISSTREAM_CACHE_FLUSH_MS);
cacheInterval.unref?.();
const ecofairInterval = setInterval(() => void runBackgroundTick(), ECOFAIR_TICK_MS);
ecofairInterval.unref?.();
const pruneInterval = setInterval(trackingAisVessels, 60_000);
pruneInterval.unref?.();

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.on("beforeExit", () => { saveAisCache(); saveEcofairState(); });

createServer(async (request, response) => {
  if (request.method === "OPTIONS") return sendJson(response, 204, {});
  const url = new URL(request.url ?? "/", "http://localhost");
  const path = url.pathname;

  if (path === "/health") {
    await loadCombinedVessels();
    await currentPortOperations();
    await currentWeather();
    return sendJson(response, 200, healthPayload());
  }

  if (path === "/api/vessels") {
    const { tracking, operational } = await loadCombinedVessels();
    const scope = url.searchParams.get("scope") === "operational" ? "operational" : "tracking";
    const vessels = scope === "operational" ? operational : tracking;
    return sendJson(response, 200, {
      vessels,
      source: sourceForTracking(),
      scope,
      counts: { tracking: tracking.length, operational: operational.length },
      inputs: vesselInputState,
      health: aisState,
    });
  }

  if (path === "/api/vessels/ingest" && request.method === "POST") {
    if (!authorized(request, FIXED_VESSEL_INGEST_TOKEN)) return sendJson(response, 401, { error: "Unauthorized vessel ingest" });
    try {
      const result = writeFixedVessels(await readJsonBody(request));
      await runBackgroundTick();
      return sendJson(response, 200, result);
    } catch (error) {
      return sendJson(response, 400, { error: "Failed to ingest fixed vessel payload", detail: error instanceof Error ? error.message : String(error) });
    }
  }

  if ((path === "/api/chmarl/episode" || path === "/api/chmarl/ingest") && request.method === "POST") {
    if (!authorized(request, CHMARL_INGEST_TOKEN)) return sendJson(response, 401, { error: "Unauthorized CH-MARL ingest" });
    try { return sendJson(response, 200, ingestChmarl(await readJsonBody(request))); }
    catch (error) { return sendJson(response, 400, { error: "Failed to ingest CH-MARL payload", detail: error instanceof Error ? error.message : String(error) }); }
  }

  if (path === "/api/chmarl/episode") {
    if (url.searchParams.get("source") === "experiment") {
      if (!existsSync(CHMARL_EXPERIMENT_FILE)) return sendJson(response, 404, { error: "No ingested experiment available", chmarl: chmarlState });
      return sendJson(response, 200, JSON.parse(readFileSync(CHMARL_EXPERIMENT_FILE, "utf8")));
    }
    if (chmarlOnlineHistory.length === 0) await runBackgroundTick();
    const experiment = await currentChmarlExperiment();
    if (!experiment || experiment.steps.length === 0) return sendJson(response, 404, { error: "No CH-MARL experiment feed is active", chmarl: chmarlState, operationalScope: healthPayload().operationalScope });
    return sendJson(response, 200, experiment);
  }

  if (path === "/api/port-events") {
    const payload = await currentPortOperations();
    return payload ? sendJson(response, 200, payload) : sendJson(response, 404, { error: "No port operations feed is active", portOps: portOpsState });
  }

  if (path === "/api/weather") {
    const payload = await currentWeather();
    return payload ? sendJson(response, 200, payload) : sendJson(response, 502, { error: "No weather feed is active", weather: weatherState });
  }

  if (path === "/api/report") {
    const report = scopedReport();
    if (url.searchParams.get("format") === "json") return sendJson(response, 200, { generatedAt: new Date().toISOString(), trackingScope: healthPayload().trackingScope, operationalScope: healthPayload().operationalScope, summary: ecofair.summary(), state: ecofair.serialize(), markdown: report });
    response.writeHead(200, { "content-type": "text/markdown; charset=utf-8", "access-control-allow-origin": "*", "cache-control": "no-store" });
    return response.end(report);
  }

  const staticMatch = staticFileForUrl(request.url);
  if (staticMatch?.path) return sendFile(response, staticMatch.path);
  if (staticMatch?.statusCode === 403) return sendJson(response, 403, { error: "Forbidden" });
  return sendJson(response, 404, { error: "Not found", availableEndpoints: ["/health", "/api/vessels", "/api/vessels?scope=operational", "/api/vessels/ingest", "/api/chmarl/episode", "/api/chmarl/ingest", "/api/port-events", "/api/weather", "/api/report"] });
}).listen(PORT, "0.0.0.0", () => {
  console.log(`CH-MARL backend listening at http://0.0.0.0:${PORT}`);
  console.log(`AIS tracking mode: ${aisState.trackingMode}`);
  console.log(`AIS tracking boxes: ${TRACKING_BOXES.length}`);
  console.log(`AIS tracking cache limit: ${AISSTREAM_MAX_VESSELS}`);
  console.log(`EcoFair operational radius: ${ECOFAIR_OPERATIONAL_RADIUS_NM} nm around ${PORT_REFERENCE_POINTS.length} monitored ports`);
  console.log(`Runtime data directory: ${RUNTIME_DATA_DIR}`);
  if (AISSTREAM_API_KEY) console.log("AISStream live mode enabled.");
});
