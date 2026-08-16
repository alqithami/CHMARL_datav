import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import WebSocket from "ws";
import { createEcoFairRuntime } from "./ecofair.mjs";
import { createDatalasticLiveAisProvider } from "./datalastic-live-ais.mjs";
import { createPocketWorldLiveAisProvider } from "./pocketworld-live-ais.mjs";

const PORT = Number(process.env.PORT ?? 8787);
const STATIC_DIR = resolve(process.env.STATIC_DIR ?? "dist");
const STATIC_INDEX = resolve(STATIC_DIR, "index.html");
const SERVICE_VERSION = process.env.RENDER_GIT_COMMIT ?? process.env.GIT_COMMIT ?? "development";
const SERVICE_STARTED_AT = new Date().toISOString();

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
  { id: "Jubail Commercial Port", latitude: 27.0333, longitude: 49.6667 },
  { id: "Jebel Ali", latitude: 25.0114, longitude: 55.0611 },
  { id: "Suez", latitude: 29.9668, longitude: 32.5498 },
];

const PRIMARY_PORT_IDS = new Set(["Jeddah", "King Abdullah Port"]);
const PRIMARY_PORT_REFERENCE_POINTS = PORT_REFERENCE_POINTS.filter((port) => PRIMARY_PORT_IDS.has(port.id));
const PRIMARY_PORT_BBOX = "20.70,38.35;22.95,39.85";

const WEATHER_POINTS = [
  { locationId: "suez", name: "Suez", latitude: 29.9668, longitude: 32.5498 },
  { locationId: "jeddah", name: "Jeddah", latitude: 21.4858, longitude: 39.1925 },
  { locationId: "kaec", name: "King Abdullah Port", latitude: 22.3924, longitude: 39.0953 },
  { locationId: "yanbu", name: "Yanbu", latitude: 24.0866, longitude: 38.0637 },
  { locationId: "jizan", name: "Jizan", latitude: 16.8917, longitude: 42.5511 },
  { locationId: "dammam", name: "Dammam", latitude: 26.4318, longitude: 50.1015 },
  { locationId: "jubail", name: "Jubail Commercial Port", latitude: 27.0333, longitude: 49.6667 },
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

function validCoordinates(latitude, longitude) {
  return Number.isFinite(latitude)
    && Number.isFinite(longitude)
    && latitude >= -85.051129
    && latitude <= 85.051129
    && longitude >= -180
    && longitude <= 180;
}

function nearestOperationalPort(vessel) {
  if (!validCoordinates(vessel?.latitude, vessel?.longitude)) return null;
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
    return validCoordinates(latitude, longitude) ? [{ latitude, longitude, ...(point?.timestamp ? { timestamp: point.timestamp } : {}) }] : [];
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
  if (!id || !validCoordinates(latitude, longitude)) return null;
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
    ?? message?.Message?.LongRangeAisBroadcastMessage
    ?? {};
}

function normalizeAisMessage(raw, inputSource) {
  const metadata = raw?.MetaData ?? raw?.Metadata ?? {};
  const body = messageBody(raw);
  const mmsi = metadata.MMSI ?? body.UserID;
  const latitude = numberValue(metadata.latitude ?? metadata.Latitude ?? body.Latitude);
  const longitude = numberValue(metadata.longitude ?? metadata.Longitude ?? body.Longitude);
  if (!mmsi || !validCoordinates(latitude, longitude)) return null;
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
    inputSource,
  });
}

const GLOBAL_TRACKING_ENABLED = true;
const TRACKING_BBOX_TEXT = WORLD_AIS_BBOX;
const OPERATIONAL_PRIORITY_ENABLED = process.env.AISSTREAM_OPERATIONAL_PRIORITY_ENABLED !== "false";
const OPERATIONAL_BBOX_TEXT = process.env.AISSTREAM_OPERATIONAL_BBOX ?? mergeBboxes(REGIONAL_AIS_BBOX, SAUDI_PORT_BBOX);
const TRACKING_BOXES = parseBoundingBoxes(TRACKING_BBOX_TEXT);
const OPERATIONAL_BOXES = parseBoundingBoxes(OPERATIONAL_BBOX_TEXT);
const AISSTREAM_API_KEY = String(process.env.AISSTREAM_API_KEY ?? "").trim();
const AISSTREAM_URL = process.env.AISSTREAM_URL ?? "wss://stream.aisstream.io/v0/stream";
const AISSTREAM_FILTER_TYPES = [];
const AISSTREAM_OPERATIONAL_FILTER_TYPES = [];
const AISSTREAM_POSITION_FILTER_TYPES = [
  "PositionReport",
  "StandardClassBPositionReport",
  "ExtendedClassBPositionReport",
  "LongRangeAisBroadcastMessage",
];
const AISSTREAM_RECOVERY_ENABLED = process.env.AISSTREAM_RECOVERY_ENABLED !== "false";
const AISSTREAM_RECOVERY_PROFILES = [
  { id: "world-unfiltered", description: "worldwide, all AIS message types", boxes: TRACKING_BOXES, filters: AISSTREAM_FILTER_TYPES },
  { id: "primary-ports-position-only", description: "Jeddah Islamic Port and King Abdullah Port approaches", boxes: parseBoundingBoxes(PRIMARY_PORT_BBOX), filters: AISSTREAM_POSITION_FILTER_TYPES },
  { id: "portfolio-position-only", description: "eight monitored port approaches, position-bearing messages", boxes: OPERATIONAL_BOXES, filters: AISSTREAM_POSITION_FILTER_TYPES },
  { id: "red-sea-gulf-position-only", description: "Red Sea and Gulf, position-bearing messages", boxes: parseBoundingBoxes(REGIONAL_AIS_BBOX), filters: AISSTREAM_POSITION_FILTER_TYPES },
  { id: "world-position-only", description: "worldwide, position-bearing messages", boxes: TRACKING_BOXES, filters: AISSTREAM_POSITION_FILTER_TYPES },
];
const AISSTREAM_MAX_VESSELS = Math.max(100, Number(process.env.AISSTREAM_MAX_VESSELS ?? 8000));
const AISSTREAM_OPERATIONAL_MAX_VESSELS = Math.max(100, Number(process.env.AISSTREAM_OPERATIONAL_MAX_VESSELS ?? 2500));
const AISSTREAM_TRAIL_POINTS = Math.max(2, Number(process.env.AISSTREAM_TRAIL_POINTS ?? 12));
const AISSTREAM_MAX_AGE_MS = Math.max(60_000, Number(process.env.AISSTREAM_MAX_AGE_MS ?? 6 * 60 * 60 * 1000));
const AISSTREAM_CACHE_ENABLED = process.env.AISSTREAM_CACHE_ENABLED !== "false";
const AISSTREAM_CACHE_FLUSH_MS = Math.max(5_000, Number(process.env.AISSTREAM_CACHE_FLUSH_MS ?? 30_000));
const AISSTREAM_MAX_IMPLIED_SPEED_KN = Math.max(50, Number(process.env.AISSTREAM_MAX_IMPLIED_SPEED_KN ?? 120));
const AISSTREAM_HEARTBEAT_MS = Math.max(1_000, Number(process.env.AISSTREAM_HEARTBEAT_MS ?? 10_000));
const AISSTREAM_FIRST_FRAME_TIMEOUT_MS = Math.max(1_000, Number(process.env.AISSTREAM_FIRST_FRAME_TIMEOUT_MS ?? 30_000));
const AISSTREAM_SILENCE_TIMEOUT_MS = Math.max(15_000, Number(process.env.AISSTREAM_SILENCE_TIMEOUT_MS ?? 90_000));
const DATALASTIC_AIS_ENABLED = process.env.DATALASTIC_AIS_ENABLED !== "false";
const DATALASTIC_API_KEY = String(process.env.DATALASTIC_API_KEY ?? "").trim();
const DATALASTIC_API_BASE_URL = process.env.DATALASTIC_API_BASE_URL ?? "https://api.datalastic.com/api/v0";
const DATALASTIC_ACTIVATION_DELAY_MS = Math.max(250, Number(process.env.DATALASTIC_ACTIVATION_DELAY_MS ?? 45_000));
const DATALASTIC_SCAN_INTERVAL_MS = Math.max(1_000, Number(process.env.DATALASTIC_SCAN_INTERVAL_MS ?? 15 * 60_000));
const DATALASTIC_TIMEOUT_MS = Math.max(1_000, Number(process.env.DATALASTIC_TIMEOUT_MS ?? 15_000));
const DATALASTIC_SCAN_RADIUS_NM = Math.min(50, Math.max(1, Number(process.env.DATALASTIC_SCAN_RADIUS_NM ?? 50)));
const DATALASTIC_MAX_AGE_MS = Math.max(60_000, Number(process.env.DATALASTIC_MAX_AGE_MS ?? 45 * 60_000));
const DATALASTIC_MAX_VESSELS = Math.max(1, Number(process.env.DATALASTIC_MAX_VESSELS ?? 5000));
const DATALASTIC_SCAN_POINT_SELECTION = String(process.env.DATALASTIC_SCAN_POINT_IDS ?? "Jeddah,King Abdullah Port")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);
const DATALASTIC_SCAN_POINTS = DATALASTIC_SCAN_POINT_SELECTION.some((item) => item.toLowerCase() === "all")
  ? PORT_REFERENCE_POINTS
  : PORT_REFERENCE_POINTS.filter((port) => DATALASTIC_SCAN_POINT_SELECTION.includes(port.id));
const POCKETWORLD_AIS_ENABLED = process.env.POCKETWORLD_AIS_ENABLED !== "false";
const POCKETWORLD_API_URL = process.env.POCKETWORLD_API_URL ?? "https://pocketworld.org/api/ships";
const POCKETWORLD_ACTIVATION_DELAY_MS = Math.max(250, Number(process.env.POCKETWORLD_ACTIVATION_DELAY_MS ?? 45_000));
const POCKETWORLD_POLL_INTERVAL_MS = Math.max(5_000, Number(process.env.POCKETWORLD_POLL_INTERVAL_MS ?? 5 * 60_000));
const POCKETWORLD_TIMEOUT_MS = Math.max(1_000, Number(process.env.POCKETWORLD_TIMEOUT_MS ?? 30_000));
const POCKETWORLD_MAX_AGE_MS = Math.max(60_000, Number(process.env.POCKETWORLD_MAX_AGE_MS ?? 30 * 60_000));
const POCKETWORLD_MAX_VESSELS = Math.max(1, Number(process.env.POCKETWORLD_MAX_VESSELS ?? 2500));
const MAX_INGEST_BODY_BYTES = Math.max(1_024, Number(process.env.MAX_INGEST_BODY_BYTES ?? 5 * 1024 * 1024));
const ECOFAIR_OPERATIONAL_RADIUS_NM = Math.max(1, Number(process.env.ECOFAIR_OPERATIONAL_RADIUS_NM ?? 120));
const ECOFAIR_TICK_MS = Math.max(10_000, Number(process.env.ECOFAIR_TICK_MS ?? 60_000));
const CHMARL_HISTORY_LIMIT = Math.max(5, Number(process.env.CHMARL_HISTORY_LIMIT ?? 96));
const CHMARL_HISTORY_MIN_INTERVAL_MS = Math.max(10_000, Number(process.env.CHMARL_HISTORY_MIN_INTERVAL_MS ?? 60_000));
const WEATHER_CACHE_MS = Math.max(60_000, Number(process.env.WEATHER_CACHE_MS ?? 10 * 60_000));
const WEATHER_TIMEOUT_MS = Math.max(1_000, Number(process.env.WEATHER_TIMEOUT_MS ?? 4_000));

const RUNTIME_DATA_DIR = resolve(process.env.RUNTIME_DATA_DIR ?? ".runtime");
function runtimePath(envName, fallbackName) {
  return resolve(process.env[envName] ?? join(RUNTIME_DATA_DIR, fallbackName));
}

const TRACKING_AIS_CACHE_FILE = runtimePath("AISSTREAM_CACHE_FILE", "ais-tracking-cache.json");
const OPERATIONAL_AIS_CACHE_FILE = runtimePath("AISSTREAM_OPERATIONAL_CACHE_FILE", "ais-operational-cache.json");
const ECOFAIR_STATE_FILE = runtimePath("ECOFAIR_STATE_FILE", "ecofair-state.json");
const CHMARL_EXPERIMENT_FILE = runtimePath("CHMARL_EXPERIMENT_FILE", "chmarl-episode.json");
const PORT_EVENTS_FILE = runtimePath("PORT_EVENTS_FILE", "port-events.json");
const WEATHER_FILE = runtimePath("WEATHER_FILE", "weather.json");

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

const trackingAisCache = new Map();
const operationalAisCache = new Map();
let stopping = false;
let tickRunning = false;
let chmarlOnlineHistory = [];
let lastChmarlSignature = "";
let lastCombinedVessels = [];
let lastOperationalVessels = [];
let lastPrimaryOperationalVessels = [];
let lastWeatherPayload = null;
let lastWeatherLoadedMs = 0;

function createAisState(label, boxes, filters, cacheFile, cacheLimit) {
  return {
    label,
    enabled: Boolean(AISSTREAM_API_KEY),
    connected: false,
    boundingBoxes: boxes,
    filterTypes: filters,
    lastMessageAt: null,
    lastFrameAt: null,
    subscriptionSentAt: null,
    subscription: null,
    lastError: null,
    reconnectAttempt: 0,
    status: AISSTREAM_API_KEY ? "connecting" : "disabled",
    openedAt: null,
    lastPongAt: null,
    lastCloseAt: null,
    watchdogRestarts: 0,
    profileIndex: 0,
    activeProfile: AISSTREAM_RECOVERY_PROFILES[0].id,
    activeProfileDescription: AISSTREAM_RECOVERY_PROFILES[0].description,
    profileSwitches: 0,
    profileCycles: 0,
    lastProfileSwitchAt: null,
    lastRecoveryReason: null,
    lastSuccessfulProfile: null,
    lastSuccessfulAt: null,
    profileAdvancedForCurrentSocket: false,
    connectionMessageCount: 0,
    firstFrameDeadlineAt: null,
    profileHistory: [],
    messageCount: 0,
    usablePositionMessages: 0,
    rejectedOutOfOrder: 0,
    rejectedImplausible: 0,
    cachedVessels: 0,
    cacheLimit,
    cacheFile,
    cacheSavedAt: null,
    cacheLoadedAt: null,
    cacheSaveError: null,
    restoredVessels: 0,
    socket: null,
    reconnectTimer: null,
  };
}

const trackingAisState = createAisState("global-tracking", TRACKING_BOXES, AISSTREAM_FILTER_TYPES, TRACKING_AIS_CACHE_FILE, AISSTREAM_MAX_VESSELS);
const operationalAisState = createAisState("operational-priority", OPERATIONAL_BOXES, AISSTREAM_OPERATIONAL_FILTER_TYPES, OPERATIONAL_AIS_CACHE_FILE, AISSTREAM_OPERATIONAL_MAX_VESSELS);
const datalasticProvider = createDatalasticLiveAisProvider({
  apiKey: DATALASTIC_AIS_ENABLED ? DATALASTIC_API_KEY : "",
  baseUrl: DATALASTIC_API_BASE_URL,
  scanPoints: DATALASTIC_SCAN_POINTS,
  radiusNm: DATALASTIC_SCAN_RADIUS_NM,
  scanIntervalMs: DATALASTIC_SCAN_INTERVAL_MS,
  timeoutMs: DATALASTIC_TIMEOUT_MS,
  maxAgeMs: DATALASTIC_MAX_AGE_MS,
  maxVessels: DATALASTIC_MAX_VESSELS,
});
const pocketWorldProvider = createPocketWorldLiveAisProvider({
  enabled: POCKETWORLD_AIS_ENABLED,
  url: POCKETWORLD_API_URL,
  pollIntervalMs: POCKETWORLD_POLL_INTERVAL_MS,
  timeoutMs: POCKETWORLD_TIMEOUT_MS,
  maxAgeMs: POCKETWORLD_MAX_AGE_MS,
  maxVessels: POCKETWORLD_MAX_VESSELS,
});

const vesselInputState = {
  aisRows: 0,
  aisstreamRows: 0,
  datalasticRows: 0,
  pocketworldRows: 0,
  activeProviders: [],
  priorityAisRows: 0,
  trackingRows: 0,
  primaryOperationalRows: 0,
  portfolioOperationalRows: 0,
  operationalRows: 0,
  operationalRadiusNm: ECOFAIR_OPERATIONAL_RADIUS_NM,
  lastLoadedAt: null,
  lastError: null,
};

const chmarlState = { enabled: CHMARL_RUNTIME_ENABLED, source: "runtime", configuredUrl: Boolean(CHMARL_EXPERIMENT_URL), file: CHMARL_FILE_ENABLED ? CHMARL_EXPERIMENT_FILE : null, steps: 0, experimentId: null, scenarioId: null, lastLoadedAt: null, lastIngestedAt: null, lastError: null };
const portOpsState = { source: "none", configuredUrl: Boolean(PORT_EVENTS_URL), file: PORT_EVENTS_FILE_ENABLED ? PORT_EVENTS_FILE : null, events: 0, utilizationRows: 0, queueRows: 0, lastLoadedAt: null, lastError: null };
const weatherState = { source: "none", configuredUrl: Boolean(WEATHER_URL), file: WEATHER_FILE_ENABLED ? WEATHER_FILE : null, points: 0, lastLoadedAt: null, lastError: null };
const runtimeState = { backgroundTickActive: true, lastTickAt: null, lastTickDurationMs: null, lastTickError: null };

function isFresh(vessel) {
  const timestamp = timestampMs(vessel.timestamp);
  return timestamp === 0 || Date.now() - timestamp <= AISSTREAM_MAX_AGE_MS;
}

function cacheRows(cache, state) {
  const rows = [];
  for (const [id, vessel] of cache.entries()) {
    if (!isFresh(vessel)) {
      cache.delete(id);
      continue;
    }
    rows.push(vessel);
  }
  rows.sort((a, b) => timestampMs(b.timestamp) - timestampMs(a.timestamp));
  state.cachedVessels = rows.length;
  return rows;
}

function plausibleUpdate(existing, update, state) {
  if (!existing) return true;
  const oldMs = timestampMs(existing.timestamp);
  const newMs = timestampMs(update.timestamp);
  if (oldMs > 0 && newMs > 0 && newMs < oldMs) {
    state.rejectedOutOfOrder += 1;
    return false;
  }
  if (oldMs > 0 && newMs > oldMs) {
    const hours = (newMs - oldMs) / 3_600_000;
    const distance = haversineNm(existing, update);
    const impliedSpeed = hours > 0 ? distance / hours : 0;
    if (distance > 5 && impliedSpeed > AISSTREAM_MAX_IMPLIED_SPEED_KN) {
      state.rejectedImplausible += 1;
      return false;
    }
  }
  return true;
}

function mergeAisVessel(cache, state, update) {
  const existing = cache.get(update.id);
  if (!plausibleUpdate(existing, update, state)) return;
  const genericName = String(update.name ?? "").startsWith("MMSI ");
  const name = genericName && existing?.name ? existing.name : update.name;
  const lastTrailPoint = existing?.trail?.at(-1);
  const samePoint = lastTrailPoint
    && lastTrailPoint.latitude === update.latitude
    && lastTrailPoint.longitude === update.longitude
    && lastTrailPoint.timestamp === update.timestamp;
  const trail = samePoint
    ? existing?.trail
    : [...(existing?.trail ?? []), { latitude: update.latitude, longitude: update.longitude, timestamp: update.timestamp }].slice(-AISSTREAM_TRAIL_POINTS);
  const merged = { ...existing, ...update, name, trail: trail && trail.length > 1 ? trail : undefined };
  if (cache.has(update.id)) cache.delete(update.id);
  cache.set(update.id, merged);
  while (cache.size > state.cacheLimit) {
    const oldestKey = cache.keys().next().value;
    if (!oldestKey) break;
    cache.delete(oldestKey);
  }
  state.cachedVessels = cache.size;
}

function loadCache(cache, state) {
  if (!AISSTREAM_CACHE_ENABLED || !existsSync(state.cacheFile)) return;
  try {
    const payload = JSON.parse(readFileSync(state.cacheFile, "utf8"));
    for (const raw of rowsFrom(payload, ["vessels"]).slice(-state.cacheLimit)) {
      const vessel = normalizeVessel(raw);
      if (vessel && isFresh(vessel)) cache.set(vessel.id, vessel);
    }
    state.restoredVessels = cache.size;
    state.cachedVessels = cache.size;
    state.cacheLoadedAt = new Date().toISOString();
  } catch (error) {
    state.cacheSaveError = error instanceof Error ? error.message : String(error);
  }
}

function saveCache(cache, state) {
  if (!AISSTREAM_CACHE_ENABLED) return;
  try {
    mkdirSync(dirname(state.cacheFile), { recursive: true });
    const snapshot = { version: 3, savedAt: new Date().toISOString(), label: state.label, vessels: cacheRows(cache, state) };
    writeFileSync(state.cacheFile, JSON.stringify(snapshot));
    state.cacheSavedAt = snapshot.savedAt;
    state.cacheSaveError = null;
  } catch (error) {
    state.cacheSaveError = error instanceof Error ? error.message : String(error);
  }
}

function loadEcofairState() {
  if (!existsSync(ECOFAIR_STATE_FILE)) return;
  try { ecofair.restore(JSON.parse(readFileSync(ECOFAIR_STATE_FILE, "utf8"))); }
  catch (error) { console.warn("Could not restore EcoFair state:", error instanceof Error ? error.message : error); }
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

function vesselsNearPorts(vessels, ports) {
  return vessels.filter((vessel) => {
    if (!validCoordinates(vessel?.latitude, vessel?.longitude)) return false;
    return ports.some((port) => haversineNm(vessel, port) <= ECOFAIR_OPERATIONAL_RADIUS_NM);
  });
}

function operationalVessels(vessels) {
  return vesselsNearPorts(vessels, PORT_REFERENCE_POINTS);
}

function primaryOperationalVessels(vessels) {
  return vesselsNearPorts(vessels, PRIMARY_PORT_REFERENCE_POINTS);
}

function datalasticFailoverDue() {
  if (!DATALASTIC_AIS_ENABLED || !DATALASTIC_API_KEY || DATALASTIC_SCAN_POINTS.length === 0) return false;
  const lastPrimaryFrame = timestampMs(trackingAisState.lastFrameAt);
  if (lastPrimaryFrame > 0 && Date.now() - lastPrimaryFrame < AISSTREAM_SILENCE_TIMEOUT_MS) return false;
  const serviceStartedAt = timestampMs(SERVICE_STARTED_AT);
  return serviceStartedAt === 0 || Date.now() - serviceStartedAt >= DATALASTIC_ACTIVATION_DELAY_MS;
}

function pocketWorldFailoverDue(datalasticRows) {
  if (!POCKETWORLD_AIS_ENABLED || datalasticRows > 0) return false;
  const lastPrimaryFrame = timestampMs(trackingAisState.lastFrameAt);
  if (lastPrimaryFrame > 0 && Date.now() - lastPrimaryFrame < AISSTREAM_SILENCE_TIMEOUT_MS) return false;
  const serviceStartedAt = timestampMs(SERVICE_STARTED_AT);
  return serviceStartedAt === 0 || Date.now() - serviceStartedAt >= POCKETWORLD_ACTIVATION_DELAY_MS;
}

async function loadCombinedVessels() {
  try {
    if (datalasticFailoverDue()) await datalasticProvider.refresh();
    const trackingAis = cacheRows(trackingAisCache, trackingAisState);
    const datalasticAis = datalasticProvider.rows().map((row) => normalizeVessel(row)).filter(Boolean);
    if (pocketWorldFailoverDue(datalasticAis.length)) await pocketWorldProvider.refresh();
    const pocketWorldAis = pocketWorldProvider.rows().map((row) => normalizeVessel(row)).filter(Boolean);
    const priorityAis = OPERATIONAL_PRIORITY_ENABLED ? cacheRows(operationalAisCache, operationalAisState) : [];
    const merged = new Map();
    for (const row of pocketWorldAis) merged.set(row.id, row);
    for (const row of datalasticAis) merged.set(row.id, row);
    for (const row of trackingAis) merged.set(row.id, row);
    const tracking = [...merged.values()].filter((row) => validCoordinates(row.latitude, row.longitude));
    const operational = operationalVessels(tracking);
    const primaryOperational = primaryOperationalVessels(tracking);
    const activeProviders = [
      ...(trackingAis.length > 0 ? ["aisstream"] : []),
      ...(datalasticAis.length > 0 ? ["datalastic"] : []),
      ...(pocketWorldAis.length > 0 ? ["pocketworld"] : []),
    ];
    Object.assign(vesselInputState, {
      aisRows: tracking.length,
      aisstreamRows: trackingAis.length,
      datalasticRows: datalasticAis.length,
      pocketworldRows: pocketWorldAis.length,
      activeProviders,
      priorityAisRows: priorityAis.length,
      trackingRows: tracking.length,
      primaryOperationalRows: primaryOperational.length,
      portfolioOperationalRows: operational.length,
      operationalRows: operational.length,
      lastLoadedAt: new Date().toISOString(),
      lastError: null,
    });
    lastCombinedVessels = tracking;
    lastOperationalVessels = operational;
    lastPrimaryOperationalVessels = primaryOperational;
    return { tracking, operational, primaryOperational };
  } catch (error) {
    vesselInputState.lastLoadedAt = new Date().toISOString();
    vesselInputState.lastError = error instanceof Error ? error.message : String(error);
    return {
      tracking: lastCombinedVessels,
      operational: lastOperationalVessels,
      primaryOperational: lastPrimaryOperationalVessels,
    };
  }
}

function sourceForTracking() {
  const activeProviders = [
    ...(Number(vesselInputState.aisstreamRows ?? 0) > 0 ? ["aisstream"] : []),
    ...(Number(vesselInputState.datalasticRows ?? 0) > 0 ? ["datalastic"] : []),
    ...(Number(vesselInputState.pocketworldRows ?? 0) > 0 ? ["pocketworld"] : []),
  ];
  if (activeProviders.length > 1) return "ais-multi-provider";
  if (activeProviders.length === 1) return activeProviders[0];
  return AISSTREAM_API_KEY || DATALASTIC_API_KEY || POCKETWORLD_AIS_ENABLED ? "aisstream-waiting" : "none";
}

function authorized(request, token) {
  return Boolean(token) && request.headers.authorization === `Bearer ${token}`;
}

async function readJsonBody(request) {
  const chunks = [];
  let receivedBytes = 0;
  for await (const chunk of request) {
    receivedBytes += Buffer.byteLength(chunk);
    if (receivedBytes > MAX_INGEST_BODY_BYTES) throw new Error(`Request body exceeds ${MAX_INGEST_BODY_BYTES} bytes`);
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

function updateChmarlState(payload, source) {
  const steps = rowsFrom(payload, ["steps", "data", "items"]);
  Object.assign(chmarlState, {
    source,
    steps: steps.length,
    experimentId: payload?.experimentId ?? steps[0]?.experimentId ?? null,
    scenarioId: payload?.scenarioId ?? steps[0]?.scenarioId ?? null,
    lastLoadedAt: new Date().toISOString(),
    lastError: null,
  });
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

function recordOnlineStep(trackingCount, operationalCount, primaryOperationalCount) {
  const step = ecofair.buildStep(chmarlOnlineHistory.length + 1);
  Object.assign(step.state, {
    trackingVessels: trackingCount,
    operationalVessels: operationalCount,
    portfolioOperationalVessels: operationalCount,
    primaryOperationalVessels: primaryOperationalCount,
    outOfScopeVessels: Math.max(0, trackingCount - operationalCount),
    operationalRadiusNm: ECOFAIR_OPERATIONAL_RADIUS_NM,
    monitoredPorts: PORT_REFERENCE_POINTS.map((port) => port.id),
    primaryPorts: PRIMARY_PORT_REFERENCE_POINTS.map((port) => port.id),
    measurementScope: "eight monitored port approaches; Jeddah and King Abdullah highlighted",
  });
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
    const { tracking, operational, primaryOperational } = await loadCombinedVessels();
    ecofair.update(operational);
    if (CHMARL_RUNTIME_ENABLED && (operational.length > 0 || ecofair.summary().trackedVessels > 0)) {
      recordOnlineStep(tracking.length, operational.length, primaryOperational.length);
    }
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

function activeAisProfile(state) {
  return AISSTREAM_RECOVERY_PROFILES[state.profileIndex % AISSTREAM_RECOVERY_PROFILES.length];
}

function setAisProfileState(state, profile) {
  state.activeProfile = profile.id;
  state.activeProfileDescription = profile.description;
  state.boundingBoxes = profile.boxes;
  state.filterTypes = profile.filters;
}

function advanceAisProfile(state, reason) {
  state.lastRecoveryReason = reason;
  if (!AISSTREAM_RECOVERY_ENABLED || AISSTREAM_RECOVERY_PROFILES.length < 2) return;
  const previousIndex = state.profileIndex;
  state.profileIndex = (state.profileIndex + 1) % AISSTREAM_RECOVERY_PROFILES.length;
  if (state.profileIndex <= previousIndex) state.profileCycles += 1;
  state.profileSwitches += 1;
  state.lastProfileSwitchAt = new Date().toISOString();
  state.profileAdvancedForCurrentSocket = true;
  const profile = activeAisProfile(state);
  setAisProfileState(state, profile);
  state.profileHistory = [...state.profileHistory, {
    at: state.lastProfileSwitchAt,
    event: "recovery",
    profile: profile.id,
    reason,
  }].slice(-12);
}

function scheduleAisReconnect(options) {
  const { state } = options;
  if (stopping || !AISSTREAM_API_KEY || state.reconnectTimer) return;
  const delay = Math.min(30_000, 2_000 * 2 ** state.reconnectAttempt);
  state.reconnectAttempt += 1;
  state.status = "reconnecting";
  state.reconnectTimer = setTimeout(() => {
    state.reconnectTimer = null;
    startAisStream(options);
  }, delay);
  state.reconnectTimer.unref?.();
}

function startAisStream({ state, cache, deriveOperational = false }) {
  const options = { state, cache, deriveOperational };
  if (!AISSTREAM_API_KEY || stopping) {
    state.status = AISSTREAM_API_KEY ? "stopped" : "disabled";
    return;
  }
  if (state.reconnectTimer) {
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = null;
  }
  const profile = activeAisProfile(state);
  setAisProfileState(state, profile);
  const socket = new WebSocket(AISSTREAM_URL, {
    perMessageDeflate: false,
    handshakeTimeout: 15_000,
  });
  state.socket = socket;
  state.status = "connecting";
  socket.on("open", () => {
    const openedAt = new Date().toISOString();
    state.connected = true;
    state.reconnectAttempt = 0;
    state.lastError = null;
    state.openedAt = openedAt;
    state.lastPongAt = openedAt;
    state.status = "connected-waiting";
    state.connectionMessageCount = 0;
    state.profileAdvancedForCurrentSocket = false;
    state.firstFrameDeadlineAt = new Date(Date.now() + AISSTREAM_FIRST_FRAME_TIMEOUT_MS).toISOString();
    state.profileHistory = [...state.profileHistory, {
      at: openedAt,
      event: "subscription",
      profile: profile.id,
      reason: state.lastRecoveryReason,
    }].slice(-12);
    if (deriveOperational) {
      operationalAisState.enabled = true;
      operationalAisState.connected = true;
      operationalAisState.openedAt = openedAt;
      operationalAisState.status = "derived-waiting";
      operationalAisState.lastError = null;
    }
    const subscription = { APIKey: AISSTREAM_API_KEY, BoundingBoxes: profile.boxes };
    if (profile.filters.length > 0) subscription.FilterMessageTypes = profile.filters;
    state.subscriptionSentAt = new Date().toISOString();
    state.subscription = {
      profile: profile.id,
      description: profile.description,
      boundingBoxes: profile.boxes,
      filterMessageTypes: profile.filters,
    };
    socket.send(JSON.stringify(subscription));
  });
  socket.on("pong", () => {
    state.lastPongAt = new Date().toISOString();
  });
  socket.on("message", (data) => {
    try {
      state.messageCount += 1;
      state.connectionMessageCount += 1;
      state.lastFrameAt = new Date().toISOString();
      state.firstFrameDeadlineAt = null;
      const raw = JSON.parse(data.toString());
      if (raw.error) {
        state.lastError = String(raw.error);
        state.status = "provider-error";
        return;
      }
      const vessel = normalizeAisMessage(raw, state.label);
      if (!vessel) return;
      const receivedAt = new Date().toISOString();
      state.usablePositionMessages += 1;
      state.lastMessageAt = receivedAt;
      state.lastSuccessfulProfile = state.activeProfile;
      state.lastSuccessfulAt = receivedAt;
      state.lastRecoveryReason = null;
      state.status = "live";
      mergeAisVessel(cache, state, vessel);
      if (deriveOperational) {
        const nearest = nearestOperationalPort(vessel);
        if (nearest && nearest.distanceNm <= ECOFAIR_OPERATIONAL_RADIUS_NM) {
          operationalAisState.messageCount += 1;
          operationalAisState.usablePositionMessages += 1;
          operationalAisState.lastMessageAt = receivedAt;
          operationalAisState.status = "derived-live";
          mergeAisVessel(operationalAisCache, operationalAisState, vessel);
        } else {
          operationalAisCache.delete(vessel.id);
          operationalAisState.cachedVessels = operationalAisCache.size;
        }
      }
    } catch (error) {
      state.lastError = error instanceof Error ? error.message : String(error);
      state.status = "message-error";
    }
  });
  socket.on("close", (code, reason) => {
    const closedAt = new Date().toISOString();
    const closedBeforeFirstFrame = state.connectionMessageCount === 0;
    state.connected = false;
    state.lastCloseAt = closedAt;
    state.firstFrameDeadlineAt = null;
    state.socket = null;
    if (reason?.length) state.lastError = "AIS websocket closed (" + code + "): " + reason.toString();
    if (!stopping && closedBeforeFirstFrame && !state.profileAdvancedForCurrentSocket) {
      advanceAisProfile(state, "socket closed before the first AIS frame (code " + code + ")");
    }
    if (deriveOperational) {
      operationalAisState.connected = false;
      operationalAisState.lastCloseAt = closedAt;
      operationalAisState.status = stopping ? "stopped" : "derived-reconnecting";
    }
    if (!stopping) scheduleAisReconnect(options);
  });
  socket.on("error", (error) => {
    state.connected = false;
    state.lastError = error.message;
    state.status = "socket-error";
  });
  socket.on("unexpected-response", (_request, response) => {
    state.lastError = "AIS websocket rejected the subscription with HTTP " + (response.statusCode ?? "unknown");
    state.status = "provider-error";
  });
}

function scopedReport() {
  const base = ecofair.buildReport();
  const scopeSection = [
    "## Input scope",
    "",
    `- Tracking feed: ${vesselInputState.trackingRows} vessels shown on the map.`,
    `- Monitored-port AIS cache: ${vesselInputState.priorityAisRows} vessels derived from the active live AIS subscription.`,
    `- Operational calculation feed: ${vesselInputState.operationalRows} vessels within ${ECOFAIR_OPERATIONAL_RADIUS_NM} nm of monitored ports.`,
    "- EcoFair-CH-MARL fuel, emissions, fairness, queue, reward, and constraint calculations use only the operational calculation feed.",
    "",
  ].join("\n");
  return base.replace("## Fleet measures", `${scopeSection}## Fleet measures`).replace("- Vessel positions: aisstream.io live AIS (Red Sea / Gulf bounding boxes).", "- Vessel tracking: AISStream remains the primary worldwide source. When it produces no frames, the runtime first uses a configured Datalastic port scan and then a public PocketWorld mirror of current BarentsWatch, Fintraffic, and Singapore MPA AIS observations. Every row retains its source timestamp and provenance; no manual or synthetic vessel rows are accepted.");
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

function publicAisState(state) {
  const { socket, reconnectTimer, ...publicState } = state;
  return publicState;
}

function vesselProviderConfigured() {
  return Boolean(AISSTREAM_API_KEY || DATALASTIC_API_KEY || POCKETWORLD_AIS_ENABLED);
}

function providerState() {
  if (!vesselProviderConfigured()) return "unconfigured";
  if (vesselInputState.trackingRows > 0) return sourceForTracking() === "ais-multi-provider" ? "live-multi-provider" : "live";
  const datalasticState = datalasticProvider.publicState();
  const pocketWorldState = pocketWorldProvider.publicState();
  if (["unauthorized", "credits-exhausted", "rate-limited", "provider-error", "request-error", "timeout"].includes(datalasticState.status)) {
    if (!POCKETWORLD_AIS_ENABLED) return "datalastic-" + datalasticState.status;
  }
  if (["rate-limited", "provider-error", "request-error", "timeout"].includes(pocketWorldState.status)) {
    return "pocketworld-" + pocketWorldState.status;
  }
  if (trackingAisState.connected) return "aisstream-silent-public-fallback-waiting";
  if (AISSTREAM_API_KEY || DATALASTIC_API_KEY || POCKETWORLD_AIS_ENABLED) return "reconnecting";
  return "unavailable";
}

function readinessPayload() {
  const staticDashboard = existsSync(STATIC_INDEX);
  const dataReady = vesselInputState.trackingRows > 0;
  const providerConfigured = vesselProviderConfigured();
  return {
    ok: staticDashboard && dataReady,
    staticDashboard,
    dataReady,
    providerConfigured,
    providerState: providerState(),
    reason: !staticDashboard ? "production dashboard bundle is missing" : dataReady ? null : providerConfigured ? "provider is configured but no vessel rows are currently available" : "no vessel provider is configured",
  };
}

function healthPayload() {
  return {
    ok: true,
    service: { version: SERVICE_VERSION, startedAt: SERVICE_STARTED_AT, uptimeSeconds: Math.round(process.uptime()) },
    providerState: providerState(),
    readiness: readinessPayload(),
    staticDashboard: existsSync(STATIC_INDEX),
    runtime: runtimeState,
    trackingScope: {
      mode: sourceForTracking() === "datalastic" ? "monitored-port-failover" : sourceForTracking() === "pocketworld" ? "regional-public-fallback" : (GLOBAL_TRACKING_ENABLED ? "global" : "regional"),
      source: sourceForTracking(),
      bbox: TRACKING_BBOX_TEXT,
      activeProfile: trackingAisState.activeProfile,
      activeProfileDescription: trackingAisState.activeProfileDescription,
      activeBoundingBoxes: trackingAisState.boundingBoxes,
      profileSwitches: trackingAisState.profileSwitches,
      profileCycles: trackingAisState.profileCycles,
      rows: vesselInputState.trackingRows,
      maxRows: AISSTREAM_MAX_VESSELS,
    },
    operationalScope: {
      radiusNm: ECOFAIR_OPERATIONAL_RADIUS_NM,
      rows: vesselInputState.operationalRows,
      portfolioRows: vesselInputState.portfolioOperationalRows,
      primaryRows: vesselInputState.primaryOperationalRows,
      ports: PORT_REFERENCE_POINTS.map((port) => port.id),
      primaryPorts: PRIMARY_PORT_REFERENCE_POINTS.map((port) => port.id),
    },
    vesselInputs: vesselInputState,
    aisstream: publicAisState(trackingAisState),
    operationalAisstream: publicAisState(operationalAisState),
    datalastic: datalasticProvider.publicState(),
    pocketworld: pocketWorldProvider.publicState(),
    chmarl: { ...chmarlState, active: chmarlState.steps > 0 },
    ecofair: ecofair.summary(),
    portOps: { ...portOpsState, active: portOpsState.events > 0 || portOpsState.utilizationRows > 0 || portOpsState.queueRows > 0 },
    weather: { ...weatherState, active: weatherState.points > 0 },
    persistence: { dataDir: RUNTIME_DATA_DIR, trackingCacheFile: TRACKING_AIS_CACHE_FILE, operationalCacheFile: OPERATIONAL_AIS_CACHE_FILE, ecofairStateFile: ECOFAIR_STATE_FILE },
  };
}

function shutdown() {
  stopping = true;
  datalasticProvider.shutdown();
  pocketWorldProvider.shutdown();
  for (const state of [trackingAisState, operationalAisState]) {
    if (state.reconnectTimer) clearTimeout(state.reconnectTimer);
    try { state.socket?.close(); } catch {}
  }
  saveCache(trackingAisCache, trackingAisState);
  saveCache(operationalAisCache, operationalAisState);
  saveEcofairState();
  process.exit(0);
}

mkdirSync(RUNTIME_DATA_DIR, { recursive: true });
loadCache(trackingAisCache, trackingAisState);
loadCache(operationalAisCache, operationalAisState);
loadEcofairState();
startAisStream({
  state: trackingAisState,
  cache: trackingAisCache,
  deriveOperational: OPERATIONAL_PRIORITY_ENABLED,
});
operationalAisState.enabled = Boolean(AISSTREAM_API_KEY && OPERATIONAL_PRIORITY_ENABLED);
operationalAisState.status = OPERATIONAL_PRIORITY_ENABLED && AISSTREAM_API_KEY ? "derived-waiting" : "disabled";
void runBackgroundTick();
void currentWeather();

const cacheInterval = setInterval(() => {
  saveCache(trackingAisCache, trackingAisState);
  saveCache(operationalAisCache, operationalAisState);
}, AISSTREAM_CACHE_FLUSH_MS);
cacheInterval.unref?.();
const ecofairInterval = setInterval(() => void runBackgroundTick(), ECOFAIR_TICK_MS);
ecofairInterval.unref?.();
const pruneInterval = setInterval(() => {
  cacheRows(trackingAisCache, trackingAisState);
  cacheRows(operationalAisCache, operationalAisState);
}, 60_000);
pruneInterval.unref?.();
const aisWatchdogInterval = setInterval(() => {
  if (stopping || !AISSTREAM_API_KEY) return;
  const state = trackingAisState;
  const socket = state.socket;
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    scheduleAisReconnect({
      state,
      cache: trackingAisCache,
      deriveOperational: OPERATIONAL_PRIORITY_ENABLED,
    });
    return;
  }
  try { socket.ping(); }
  catch (error) { state.lastError = error instanceof Error ? error.message : String(error); }
  const openedAt = timestampMs(state.openedAt);
  const lastFrameAt = timestampMs(state.lastFrameAt);
  const lastPongAt = timestampMs(state.lastPongAt);
  const now = Date.now();
  const firstFrameTimedOut = state.connectionMessageCount === 0
    && openedAt > 0
    && now - openedAt > AISSTREAM_FIRST_FRAME_TIMEOUT_MS;
  const streamBecameSilent = state.connectionMessageCount > 0
    && lastFrameAt > 0
    && now - lastFrameAt > AISSTREAM_SILENCE_TIMEOUT_MS;
  const heartbeatLost = lastPongAt > 0 && now - lastPongAt > AISSTREAM_HEARTBEAT_MS * 3;
  if (firstFrameTimedOut || streamBecameSilent || heartbeatLost) {
    state.watchdogRestarts += 1;
    const reason = firstFrameTimedOut
      ? "connected AIS socket produced no first frame within " + Math.round(AISSTREAM_FIRST_FRAME_TIMEOUT_MS / 1000) + " seconds"
      : streamBecameSilent
        ? "AIS provider produced no frames for " + Math.round((now - lastFrameAt) / 1000) + " seconds"
        : "AIS websocket heartbeat timed out";
    state.lastError = reason;
    advanceAisProfile(state, reason);
    state.status = "profile-recovery";
    try { socket.terminate(); } catch {}
  }
}, AISSTREAM_HEARTBEAT_MS);
aisWatchdogInterval.unref?.();

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.on("beforeExit", () => {
  saveCache(trackingAisCache, trackingAisState);
  saveCache(operationalAisCache, operationalAisState);
  saveEcofairState();
});

createServer(async (request, response) => {
  if (request.method === "OPTIONS") return sendJson(response, 204, {});
  const url = new URL(request.url ?? "/", "http://localhost");
  const path = url.pathname;

  if (path === "/health/live") {
    const staticDashboard = existsSync(STATIC_INDEX);
    return sendJson(response, staticDashboard ? 200 : 503, {
      ok: staticDashboard,
      staticDashboard,
      service: { version: SERVICE_VERSION, startedAt: SERVICE_STARTED_AT, uptimeSeconds: Math.round(process.uptime()) },
    });
  }

  if (path === "/health" || path === "/health/ready") {
    await loadCombinedVessels();
    if (path === "/health") {
      await currentPortOperations();
      await currentWeather();
      return sendJson(response, 200, healthPayload());
    }
    const readiness = readinessPayload();
    return sendJson(response, readiness.ok ? 200 : 503, readiness);
  }

  if (path === "/version") {
    return sendJson(response, 200, { version: SERVICE_VERSION, startedAt: SERVICE_STARTED_AT });
  }

  if (path === "/api/vessels" || path === "/api/vessels/operations") {
    const { tracking, operational, primaryOperational } = await loadCombinedVessels();
    const requestedScope = url.searchParams.get("scope");
    const scope = path === "/api/vessels/operations" || requestedScope === "operational"
      ? "operational"
      : requestedScope === "primary"
        ? "primary"
        : "tracking";
    const vessels = scope === "operational" ? operational : scope === "primary" ? primaryOperational : tracking;
    return sendJson(response, 200, {
      vessels,
      source: sourceForTracking(),
      scope,
      counts: {
        tracking: tracking.length,
        operational: operational.length,
        portfolioOperational: operational.length,
        primaryOperational: primaryOperational.length,
      },
      inputs: vesselInputState,
      health: publicAisState(trackingAisState),
      operationalHealth: publicAisState(operationalAisState),
      providers: {
        aisstream: publicAisState(trackingAisState),
        datalastic: datalasticProvider.publicState(),
        pocketworld: pocketWorldProvider.publicState(),
      },
    });
  }

  if ((path === "/api/chmarl/episode" || path === "/api/chmarl/ingest") && request.method === "POST") {
    if (!CHMARL_INGEST_TOKEN) return sendJson(response, 503, { error: "CH-MARL ingest is disabled; configure CHMARL_INGEST_TOKEN" });
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

  if (path.startsWith("/api/")) return sendJson(response, 404, { error: "API endpoint not found" });

  const staticMatch = staticFileForUrl(request.url);
  if (staticMatch?.path) return sendFile(response, staticMatch.path);
  if (staticMatch?.statusCode === 403) return sendJson(response, 403, { error: "Forbidden" });
  return sendJson(response, 404, { error: "Not found", availableEndpoints: ["/health", "/health/live", "/health/ready", "/version", "/api/vessels", "/api/vessels/operations", "/api/vessels?scope=operational", "/api/vessels?scope=primary", "/api/chmarl/episode", "/api/chmarl/ingest", "/api/port-events", "/api/weather", "/api/report"] });
}).listen(PORT, "0.0.0.0", () => {
  console.log(`CH-MARL backend listening at http://0.0.0.0:${PORT}`);
  console.log(`Global AIS boxes: ${TRACKING_BOXES.length}; cache limit: ${AISSTREAM_MAX_VESSELS}`);
  console.log(`Operational AIS derivation: ${OPERATIONAL_PRIORITY_ENABLED ? "enabled" : "disabled"}; monitored boxes: ${OPERATIONAL_BOXES.length}; cache limit: ${AISSTREAM_OPERATIONAL_MAX_VESSELS}`);
  console.log(`EcoFair operational radius: ${ECOFAIR_OPERATIONAL_RADIUS_NM} nm around ${PORT_REFERENCE_POINTS.length} monitored ports`);
  console.log(`Runtime data directory: ${RUNTIME_DATA_DIR}`);
  if (AISSTREAM_API_KEY) console.log("AISStream live mode enabled.");
  if (DATALASTIC_API_KEY) console.log(`Datalastic live AIS failover enabled for ${DATALASTIC_SCAN_POINTS.map((point) => point.id).join(", ") || "no scan points"}.`);
  else console.log("Datalastic live AIS failover is not configured.");
  console.log(`PocketWorld public AIS fallback: ${POCKETWORLD_AIS_ENABLED ? "enabled" : "disabled"}; max rows: ${POCKETWORLD_MAX_VESSELS}.`);
});
