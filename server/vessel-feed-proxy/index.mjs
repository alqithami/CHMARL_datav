import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, extname, resolve } from "node:path";
import WebSocket from "ws";
import { createEcoFairRuntime } from "./ecofair.mjs";

const PORT = Number(process.env.PORT ?? 8787);
const STATIC_DIR = resolve(process.env.STATIC_DIR ?? "dist");
const STATIC_INDEX = resolve(STATIC_DIR, "index.html");

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

const weatherPoints = [
  { locationId: "suez", name: "Suez", latitude: 29.9668, longitude: 32.5498 },
  { locationId: "jeddah", name: "Jeddah", latitude: 21.4858, longitude: 39.1925 },
  { locationId: "kaec", name: "King Abdullah Port", latitude: 22.3924, longitude: 39.0953 },
  { locationId: "yanbu", name: "Yanbu", latitude: 24.0866, longitude: 38.0637 },
  { locationId: "jizan", name: "Jizan", latitude: 16.8917, longitude: 42.5511 },
  { locationId: "dammam", name: "Dammam", latitude: 26.4318, longitude: 50.1015 },
  { locationId: "jebel-ali", name: "Jebel Ali", latitude: 25.0114, longitude: 55.0611 },
];

function mergeBboxText(...values) {
  const boxes = [];
  const seen = new Set();
  for (const value of values) {
    for (const box of String(value ?? "").split("|")) {
      const trimmed = box.trim();
      if (!trimmed || seen.has(trimmed)) continue;
      seen.add(trimmed);
      boxes.push(trimmed);
    }
  }
  return boxes.join("|");
}

function scopedPath(path, scopeSource, fallbackName) {
  const shouldScope = process.env.RUNTIME_CACHE_SCOPE !== "none";
  if (!shouldScope) return path;
  const hash = createHash("sha1").update(scopeSource || "default").digest("hex").slice(0, 8);
  const original = path || fallbackName;
  const dot = original.lastIndexOf(".");
  return dot > -1 ? `${original.slice(0, dot)}-${hash}${original.slice(dot)}` : `${original}-${hash}`;
}

const UPSTREAM_URL = process.env.UPSTREAM_VESSEL_DATA_URL;
const UPSTREAM_TOKEN = process.env.UPSTREAM_VESSEL_DATA_TOKEN;
const AISSTREAM_API_KEY = process.env.AISSTREAM_API_KEY;
const AISSTREAM_URL = process.env.AISSTREAM_URL ?? "wss://stream.aisstream.io/v0/stream";
const BASE_AISSTREAM_BBOX = process.env.AISSTREAM_FORCE_REGIONAL_BBOX === "true" ? REGIONAL_AIS_BBOX : process.env.AISSTREAM_BBOX ?? REGIONAL_AIS_BBOX;
const AISSTREAM_BBOX = process.env.AISSTREAM_USE_SAUDI_PORT_BBOXES === "true"
  ? SAUDI_PORT_BBOX
  : process.env.AISSTREAM_APPEND_SAUDI_PORT_BBOXES === "false"
    ? BASE_AISSTREAM_BBOX
    : mergeBboxText(BASE_AISSTREAM_BBOX, SAUDI_PORT_BBOX);
const AISSTREAM_MAX_VESSELS = Number(process.env.AISSTREAM_MAX_VESSELS ?? 750);
const AISSTREAM_TRAIL_POINTS = Number(process.env.AISSTREAM_TRAIL_POINTS ?? 24);
const AISSTREAM_MAX_AGE_MS = Number(process.env.AISSTREAM_MAX_AGE_MS ?? 6 * 60 * 60 * 1000);
const AISSTREAM_CACHE_ENABLED = process.env.AISSTREAM_CACHE_ENABLED !== "false";
const AISSTREAM_CACHE_FILE = scopedPath(process.env.AISSTREAM_CACHE_FILE ?? ".runtime/ais-cache.json", AISSTREAM_BBOX, ".runtime/ais-cache.json");
const AISSTREAM_CACHE_FILE_PATH = resolve(AISSTREAM_CACHE_FILE);
const AISSTREAM_CACHE_FLUSH_MS = Number(process.env.AISSTREAM_CACHE_FLUSH_MS ?? 15_000);
const AISSTREAM_FILTER_TYPES = (process.env.AISSTREAM_FILTER_TYPES ?? "").split(",").map((item) => item.trim()).filter(Boolean);

const FIXED_VESSEL_DATA_FILE = process.env.FIXED_VESSEL_DATA_FILE ?? ".runtime/manual_vessels.json";
const FIXED_VESSEL_DATA_FILE_PATH = resolve(FIXED_VESSEL_DATA_FILE);
const FIXED_VESSEL_DATA_FILE_ENABLED = process.env.FIXED_VESSEL_DATA_FILE_ENABLED !== "false";
const FIXED_VESSEL_DATA_URL = process.env.FIXED_VESSEL_DATA_URL;
const FIXED_VESSEL_DATA_TOKEN = process.env.FIXED_VESSEL_DATA_TOKEN;
const FIXED_VESSEL_INGEST_TOKEN = process.env.FIXED_VESSEL_INGEST_TOKEN;

const CHMARL_RUNTIME_ENABLED = process.env.CHMARL_RUNTIME_ENABLED !== "false";
const CHMARL_EXPERIMENT_URL = process.env.CHMARL_EXPERIMENT_URL;
const CHMARL_EXPERIMENT_TOKEN = process.env.CHMARL_EXPERIMENT_TOKEN;
const CHMARL_INGEST_TOKEN = process.env.CHMARL_INGEST_TOKEN;
const CHMARL_EXPERIMENT_FILE = process.env.CHMARL_EXPERIMENT_FILE ?? ".runtime/chmarl_episode.json";
const CHMARL_EXPERIMENT_FILE_PATH = resolve(CHMARL_EXPERIMENT_FILE);
const CHMARL_FILE_ENABLED = process.env.CHMARL_FILE_ENABLED === "true";
const CHMARL_HISTORY_LIMIT = Number(process.env.CHMARL_HISTORY_LIMIT ?? 96);
const CHMARL_HISTORY_MIN_INTERVAL_MS = Number(process.env.CHMARL_HISTORY_MIN_INTERVAL_MS ?? 60_000);

const ECOFAIR_STATE_FILE = scopedPath(process.env.ECOFAIR_STATE_FILE ?? ".runtime/ecofair-state.json", AISSTREAM_BBOX, ".runtime/ecofair-state.json");
const ECOFAIR_STATE_FILE_PATH = resolve(ECOFAIR_STATE_FILE);
const ECOFAIR_TICK_MS = Number(process.env.ECOFAIR_TICK_MS ?? 60_000);

const PORT_EVENTS_URL = process.env.PORT_EVENTS_URL;
const PORT_EVENTS_TOKEN = process.env.PORT_EVENTS_TOKEN;
const PORT_EVENTS_FILE = process.env.PORT_EVENTS_FILE ?? ".runtime/port_events.json";
const PORT_EVENTS_FILE_PATH = resolve(PORT_EVENTS_FILE);
const PORT_EVENTS_FILE_ENABLED = process.env.PORT_EVENTS_FILE_ENABLED === "true";

const WEATHER_URL = process.env.WEATHER_URL;
const WEATHER_TOKEN = process.env.WEATHER_TOKEN;
const WEATHER_FILE = process.env.WEATHER_FILE ?? ".runtime/weather.json";
const WEATHER_FILE_PATH = resolve(WEATHER_FILE);
const WEATHER_FILE_ENABLED = process.env.WEATHER_FILE_ENABLED === "true";
const WEATHER_TIMEOUT_MS = Number(process.env.WEATHER_TIMEOUT_MS ?? 4000);

let ecofairPortCapacity = {};
try { ecofairPortCapacity = process.env.ECOFAIR_PORT_CAPACITY ? JSON.parse(process.env.ECOFAIR_PORT_CAPACITY) : {}; } catch { console.warn("Invalid ECOFAIR_PORT_CAPACITY JSON; using defaults."); }
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
let cacheSaveTimer = null;
let chmarlOnlineHistory = [];
let lastChmarlSignature = "";
let lastCombinedVessels = [];

const aisState = {
  enabled: Boolean(AISSTREAM_API_KEY), connected: false, lastMessageAt: null, lastError: null, reconnectAttempt: 0,
  boundingBoxes: [], messageCount: 0, cachedVessels: 0, cacheLimit: AISSTREAM_MAX_VESSELS, trailLimit: AISSTREAM_TRAIL_POINTS,
  maxAgeMs: AISSTREAM_MAX_AGE_MS, cacheEnabled: AISSTREAM_CACHE_ENABLED, cacheFile: AISSTREAM_CACHE_FILE, cacheSavedAt: null,
  cacheLoadedAt: null, cacheSaveError: null, restoredVessels: 0,
};
const chmarlState = { enabled: CHMARL_RUNTIME_ENABLED, source: "runtime", configuredUrl: Boolean(CHMARL_EXPERIMENT_URL), file: CHMARL_FILE_ENABLED ? CHMARL_EXPERIMENT_FILE : null, steps: 0, experimentId: null, scenarioId: null, lastLoadedAt: null, lastIngestedAt: null, lastError: null };
const vesselInputState = { aisRows: 0, upstreamConfigured: Boolean(UPSTREAM_URL), upstreamRows: 0, fixedUrlConfigured: Boolean(FIXED_VESSEL_DATA_URL), fixedFile: FIXED_VESSEL_DATA_FILE, fixedRows: 0, combinedRows: 0, lastLoadedAt: null, lastIngestedAt: null, lastError: null };
const portOpsState = { source: "none", configuredUrl: Boolean(PORT_EVENTS_URL), file: PORT_EVENTS_FILE_ENABLED ? PORT_EVENTS_FILE : null, events: 0, utilizationRows: 0, queueRows: 0, lastLoadedAt: null, lastError: null };
const weatherState = { source: "none", configuredUrl: Boolean(WEATHER_URL), file: WEATHER_FILE_ENABLED ? WEATHER_FILE : null, points: 0, lastLoadedAt: null, lastError: null };

function parseBoundingBoxes(value) {
  return value.split("|").map((box) => {
    const corners = box.split(";").map((corner) => corner.split(",").map((item) => Number(item.trim())));
    if (corners.length !== 2 || corners.some((corner) => corner.length !== 2 || corner.some((number) => !Number.isFinite(number)))) throw new Error(`Invalid AISSTREAM_BBOX segment: ${box}`);
    return corners;
  });
}
function rowsFrom(payload, keys) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  for (const key of keys) if (Array.isArray(payload[key])) return payload[key];
  return [];
}
function numberValue(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string" && value.trim()) { const parsed = Number(value.trim()); return Number.isFinite(parsed) ? parsed : undefined; }
  return undefined;
}
function timestampMs(value) {
  const parsed = Date.parse(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : 0;
}
function freshVessel(vessel) {
  const timestamp = timestampMs(vessel.timestamp);
  return timestamp === 0 || Date.now() - timestamp <= AISSTREAM_MAX_AGE_MS;
}
function normalizeStatus(value) {
  const text = String(value ?? "").toLowerCase();
  if (text.includes("constraint") || text.includes("restricted") || text.includes("alert")) return "Constrained";
  if (text.includes("watch") || text.includes("warning") || text.includes("delay")) return "Watch";
  return "Nominal";
}
function normalizeTrail(points) {
  if (!Array.isArray(points)) return undefined;
  const trail = [];
  for (const point of points) {
    const latitude = numberValue(point.latitude ?? point.lat);
    const longitude = numberValue(point.longitude ?? point.lon ?? point.lng);
    if (latitude === undefined || longitude === undefined) continue;
    const next = { latitude, longitude };
    if (point.timestamp !== undefined) next.timestamp = point.timestamp;
    trail.push(next);
  }
  return trail.length > 1 ? trail : undefined;
}
function speedText(value) {
  const speed = numberValue(value);
  return speed === undefined ? "TBD" : `${speed.toFixed(1)} kn`;
}
function normalizeVessel(row) {
  const name = row.name ?? row.vesselName ?? row.shipName ?? "Unknown Vessel";
  const id = row.id ?? row.vesselId ?? (row.mmsi ? `MMSI-${row.mmsi}` : row.imo ? `IMO-${row.imo}` : name);
  const origin = row.originPort ?? row.origin ?? "Unknown";
  const destination = row.destinationPort ?? row.destination ?? row.dest ?? "Unknown";
  const speed = row.speed ?? row.speedKnots ?? row.sog;
  return {
    id: String(id), name: String(name), route: row.route ?? `${origin} → ${destination}`,
    cargo: String(row.cargo ?? row.cargoClass ?? row.vesselType ?? row.shipType ?? "Unspecified"),
    eta: String(row.eta ?? row.ETA ?? "TBD"), speed: typeof speed === "string" && speed.toLowerCase().includes("kn") ? speed : speedText(speed),
    status: row.status ?? normalizeStatus(row.navStatus), latitude: numberValue(row.latitude ?? row.lat), longitude: numberValue(row.longitude ?? row.lon ?? row.lng),
    headingDeg: numberValue(row.headingDeg ?? row.heading), courseDeg: numberValue(row.courseDeg ?? row.cog), timestamp: row.timestamp ?? row.time ?? row.updatedAt,
    trail: normalizeTrail(row.trail ?? row.history ?? row.track), sog: numberValue(row.sog ?? row.speedKnots ?? row.speed),
  };
}
function messageBody(message) {
  const type = message?.MessageType;
  return message?.Message?.[type] ?? message?.Message?.PositionReport ?? message?.Message?.StandardClassBPositionReport ?? message?.Message?.ExtendedClassBPositionReport ?? {};
}
function normalizeAisMessage(raw) {
  const metadata = raw.MetaData ?? raw.Metadata ?? {};
  const body = messageBody(raw);
  const mmsi = metadata.MMSI ?? body.UserID;
  const latitude = numberValue(metadata.latitude ?? metadata.Latitude ?? body.Latitude);
  const longitude = numberValue(metadata.longitude ?? metadata.Longitude ?? body.Longitude);
  if (!mmsi || latitude === undefined || longitude === undefined) return null;
  const sog = numberValue(body.Sog ?? metadata.Sog ?? metadata.SOG);
  return { id: `MMSI-${mmsi}`, mmsi: String(mmsi), name: metadata.ShipName ? String(metadata.ShipName).trim() : `MMSI ${mmsi}`, route: "AIS live position", cargo: raw.MessageType ?? "AIS vessel", eta: "Live AIS", speed: sog === undefined ? "TBD" : `${sog.toFixed(1)} kn`, sog, status: "Nominal", latitude, longitude, headingDeg: numberValue(body.TrueHeading ?? body.Heading ?? metadata.TrueHeading), courseDeg: numberValue(body.Cog ?? metadata.Cog ?? metadata.COG), timestamp: metadata.time_utc ?? metadata.TimeUtc ?? metadata.timestamp ?? new Date().toISOString() };
}
function sortedAisVessels() {
  return [...aisCache.values()].filter(freshVessel).sort((a, b) => String(b.timestamp ?? "").localeCompare(String(a.timestamp ?? "")));
}
function mergeAisVessel(update) {
  const existing = aisCache.get(update.id);
  const trail = [...(existing?.trail ?? []), { latitude: update.latitude, longitude: update.longitude, timestamp: update.timestamp }].slice(-AISSTREAM_TRAIL_POINTS);
  aisCache.set(update.id, { ...existing, ...update, trail: trail.length > 1 ? trail : undefined });
  for (const [key, value] of aisCache.entries()) if (!freshVessel(value)) aisCache.delete(key);
  while (aisCache.size > AISSTREAM_MAX_VESSELS) {
    const oldestKey = sortedAisVessels().at(-1)?.id;
    if (!oldestKey) break;
    aisCache.delete(oldestKey);
  }
  aisState.cachedVessels = sortedAisVessels().length;
  scheduleAisCacheSave();
}
function loadAisCacheFromDisk() {
  if (!AISSTREAM_CACHE_ENABLED || !existsSync(AISSTREAM_CACHE_FILE_PATH)) return;
  try {
    const payload = JSON.parse(readFileSync(AISSTREAM_CACHE_FILE_PATH, "utf8"));
    for (const row of rowsFrom(payload, ["vessels"]).slice(0, AISSTREAM_MAX_VESSELS)) {
      const vessel = row?.id ? normalizeVessel(row) : null;
      if (vessel && freshVessel(vessel)) aisCache.set(String(vessel.id), vessel);
    }
    aisState.cachedVessels = sortedAisVessels().length;
    aisState.restoredVessels = aisState.cachedVessels;
    aisState.cacheLoadedAt = new Date().toISOString();
  } catch (error) { aisState.cacheSaveError = error instanceof Error ? error.message : String(error); }
}
function saveAisCacheToDisk() {
  if (!AISSTREAM_CACHE_ENABLED) return;
  try {
    mkdirSync(dirname(AISSTREAM_CACHE_FILE_PATH), { recursive: true });
    const snapshot = { version: 1, savedAt: new Date().toISOString(), vessels: sortedAisVessels().slice(0, AISSTREAM_MAX_VESSELS) };
    writeFileSync(AISSTREAM_CACHE_FILE_PATH, JSON.stringify(snapshot, null, 2));
    aisState.cacheSavedAt = snapshot.savedAt;
    aisState.cacheSaveError = null;
  } catch (error) { aisState.cacheSaveError = error instanceof Error ? error.message : String(error); }
}
function scheduleAisCacheSave() {
  if (!AISSTREAM_CACHE_ENABLED) return;
  if (cacheSaveTimer) clearTimeout(cacheSaveTimer);
  cacheSaveTimer = setTimeout(saveAisCacheToDisk, Math.max(1_000, AISSTREAM_CACHE_FLUSH_MS));
  cacheSaveTimer.unref?.();
}
async function fetchProviderJson(url, token) {
  const headers = { accept: "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}
async function loadFixedVessels() {
  const rows = [];
  if (FIXED_VESSEL_DATA_URL) rows.push(...rowsFrom(await fetchProviderJson(FIXED_VESSEL_DATA_URL, FIXED_VESSEL_DATA_TOKEN), ["vessels", "data", "items"]));
  if (FIXED_VESSEL_DATA_FILE_ENABLED && existsSync(FIXED_VESSEL_DATA_FILE_PATH)) rows.push(...rowsFrom(JSON.parse(readFileSync(FIXED_VESSEL_DATA_FILE_PATH, "utf8")), ["vessels", "data", "items"]));
  return rows.map(normalizeVessel).filter((row) => row.id && Number.isFinite(row.latitude) && Number.isFinite(row.longitude));
}
async function loadUpstreamVessels() {
  if (!UPSTREAM_URL) return [];
  const payload = await fetchProviderJson(UPSTREAM_URL, UPSTREAM_TOKEN);
  return rowsFrom(payload, ["vessels", "data", "items"]).map(normalizeVessel);
}
async function loadCombinedVessels() {
  try {
    const fixed = await loadFixedVessels();
    const upstream = await loadUpstreamVessels();
    const ais = sortedAisVessels();
    const merged = new Map();
    for (const row of fixed) merged.set(row.id, row);
    for (const row of upstream) merged.set(row.id, row);
    for (const row of ais) merged.set(row.id, row);
    const vessels = [...merged.values()].filter((row) => Number.isFinite(row.latitude) && Number.isFinite(row.longitude));
    vesselInputState.aisRows = ais.length;
    vesselInputState.upstreamRows = upstream.length;
    vesselInputState.fixedRows = fixed.length;
    vesselInputState.combinedRows = vessels.length;
    vesselInputState.lastLoadedAt = new Date().toISOString();
    vesselInputState.lastError = null;
    lastCombinedVessels = vessels;
    return vessels;
  } catch (error) {
    vesselInputState.lastLoadedAt = new Date().toISOString();
    vesselInputState.lastError = error instanceof Error ? error.message : String(error);
    return lastCombinedVessels;
  }
}
async function loadVessels() {
  const vessels = await loadCombinedVessels();
  if (vessels.length > 0) return { vessels, source: sortedAisVessels().length > 0 ? "aisstream" : "remote", inputs: { aisRows: vesselInputState.aisRows, upstreamRows: vesselInputState.upstreamRows, fixedRows: vesselInputState.fixedRows, combinedRows: vesselInputState.combinedRows } };
  return { vessels: [], source: AISSTREAM_API_KEY ? "aisstream-waiting" : "none", inputs: { aisRows: 0, upstreamRows: 0, fixedRows: 0, combinedRows: 0 } };
}
function authorized(request, token) {
  if (!token) return true;
  const auth = request.headers.authorization ?? "";
  return auth === `Bearer ${token}`;
}
async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}
function writeFixedVesselPayload(payload) {
  mkdirSync(dirname(FIXED_VESSEL_DATA_FILE_PATH), { recursive: true });
  const rows = rowsFrom(payload, ["vessels", "data", "items"]).map(normalizeVessel).filter((row) => row.id && Number.isFinite(row.latitude) && Number.isFinite(row.longitude));
  const next = { ok: true, version: 1, source: payload?.source ?? "manual-fixed-vessels", updatedAt: new Date().toISOString(), vessels: rows, fixedFile: FIXED_VESSEL_DATA_FILE };
  writeFileSync(FIXED_VESSEL_DATA_FILE_PATH, JSON.stringify(next, null, 2));
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
function readChmarlFilePayload() { if (!CHMARL_FILE_ENABLED || !existsSync(CHMARL_EXPERIMENT_FILE_PATH)) return null; return JSON.parse(readFileSync(CHMARL_EXPERIMENT_FILE_PATH, "utf8")); }
function writeChmarlFilePayload(payload) { mkdirSync(dirname(CHMARL_EXPERIMENT_FILE_PATH), { recursive: true }); writeFileSync(CHMARL_EXPERIMENT_FILE_PATH, JSON.stringify(payload, null, 2)); }
async function ingestChmarl(payload) {
  const incomingSteps = Array.isArray(payload) ? payload : rowsFrom(payload, ["steps", "data", "items"]);
  const existing = CHMARL_FILE_ENABLED ? readChmarlFilePayload() : null;
  const existingSteps = existing ? rowsFrom(existing, ["steps", "data", "items"]) : [];
  const mergedSteps = [...existingSteps, ...incomingSteps];
  const nextPayload = { experimentId: payload?.experimentId ?? existing?.experimentId ?? mergedSteps[0]?.experimentId ?? "runtime-chmarl", scenarioId: payload?.scenarioId ?? existing?.scenarioId ?? mergedSteps[0]?.scenarioId ?? "baseline", updatedAt: new Date().toISOString(), steps: mergedSteps.slice(-5000) };
  writeChmarlFilePayload(nextPayload);
  chmarlState.lastIngestedAt = nextPayload.updatedAt;
  return updateChmarlState(nextPayload, "ingest");
}
async function buildRuntimeChmarlExperiment() {
  if (!CHMARL_RUNTIME_ENABLED) return null;
  const vessels = await loadCombinedVessels();
  ecofair.update(vessels);
  if (vessels.length === 0 && ecofair.summary().trackedVessels === 0) return null;
  const step = ecofair.buildStep(chmarlOnlineHistory.length + 1);
  const signature = JSON.stringify({ reward: step.rewards[0].value, co2: step.state.totalCo2Tonnes, gini: step.state.giniFuel, vessels: step.state.trackedVessels });
  const previous = chmarlOnlineHistory.at(-1);
  const previousMs = previous ? timestampMs(previous.timestamp) : 0;
  if (signature !== lastChmarlSignature || Date.now() - previousMs >= CHMARL_HISTORY_MIN_INTERVAL_MS) {
    chmarlOnlineHistory = [...chmarlOnlineHistory, step].slice(-CHMARL_HISTORY_LIMIT);
    lastChmarlSignature = signature;
  }
  return updateChmarlState({ experimentId: step.experimentId, scenarioId: step.scenarioId, source: "ecofair-online", steps: chmarlOnlineHistory }, "ecofair-online");
}
function loadEcofairStateFromDisk() { try { if (existsSync(ECOFAIR_STATE_FILE_PATH)) ecofair.restore(JSON.parse(readFileSync(ECOFAIR_STATE_FILE_PATH, "utf8"))); } catch (error) { console.warn("Could not restore EcoFair state:", error instanceof Error ? error.message : error); } }
function saveEcofairStateToDisk() { try { mkdirSync(dirname(ECOFAIR_STATE_FILE_PATH), { recursive: true }); writeFileSync(ECOFAIR_STATE_FILE_PATH, JSON.stringify(ecofair.serialize())); } catch (error) { console.warn("Could not persist EcoFair state:", error instanceof Error ? error.message : error); } }
async function loadChmarlExperiment() {
  try {
    if (CHMARL_EXPERIMENT_URL) return updateChmarlState(await fetchProviderJson(CHMARL_EXPERIMENT_URL, CHMARL_EXPERIMENT_TOKEN), "url");
    const filePayload = readChmarlFilePayload();
    if (filePayload) return updateChmarlState(filePayload, "file");
    const online = await buildRuntimeChmarlExperiment();
    if (online) return online;
    chmarlState.steps = 0; chmarlState.lastError = null; return null;
  } catch (error) { chmarlState.lastError = error instanceof Error ? error.message : String(error); return null; }
}
function updatePortOpsState(payload, source) {
  const portEvents = rowsFrom(payload, ["portEvents", "port_events", "events", "data", "items"]);
  const portUtilization = rowsFrom(payload, ["portUtilization", "port_utilization", "utilization", "ports"]);
  const queueStatus = rowsFrom(payload, ["queueStatus", "queue_status", "queues", "berths"]);
  portOpsState.source = source; portOpsState.events = portEvents.length; portOpsState.utilizationRows = portUtilization.length; portOpsState.queueRows = queueStatus.length; portOpsState.lastLoadedAt = new Date().toISOString(); portOpsState.lastError = null;
  return { source, portEvents, portUtilization, queueStatus, portOps: portOpsState };
}
async function loadPortOperations() {
  try {
    if (PORT_EVENTS_URL) return updatePortOpsState(await fetchProviderJson(PORT_EVENTS_URL, PORT_EVENTS_TOKEN), "url");
    if (PORT_EVENTS_FILE_ENABLED && existsSync(PORT_EVENTS_FILE_PATH)) return updatePortOpsState(JSON.parse(readFileSync(PORT_EVENTS_FILE_PATH, "utf8")), "file");
    ecofair.update(await loadCombinedVessels());
    return updatePortOpsState(ecofair.buildPortOperations(), "ecofair-derived");
  } catch (error) { portOpsState.lastError = error instanceof Error ? error.message : String(error); return null; }
}
async function fetchJsonWithTimeout(url, timeoutMs = WEATHER_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { const response = await fetch(url, { signal: controller.signal, headers: { accept: "application/json" } }); if (!response.ok) throw new Error(`${response.status} ${response.statusText}`); return response.json(); } finally { clearTimeout(timer); }
}
function nearestHourIndex(times) { const now = Date.now(); let bestIndex = 0; let bestDistance = Number.POSITIVE_INFINITY; for (let i = 0; i < times.length; i += 1) { const timestamp = Date.parse(times[i]); if (!Number.isFinite(timestamp)) continue; const distance = Math.abs(timestamp - now); if (distance < bestDistance) { bestDistance = distance; bestIndex = i; } } return bestIndex; }
async function openMeteoPoint(point) {
  const marineUrl = `https://marine-api.open-meteo.com/v1/marine?latitude=${point.latitude}&longitude=${point.longitude}&hourly=wave_height,sea_surface_temperature&timezone=UTC`;
  const forecastUrl = `https://api.open-meteo.com/v1/forecast?latitude=${point.latitude}&longitude=${point.longitude}&hourly=wind_speed_10m,temperature_2m&timezone=UTC`;
  const [marine, forecast] = await Promise.allSettled([fetchJsonWithTimeout(marineUrl), fetchJsonWithTimeout(forecastUrl)]);
  const out = { ...point, provider: "open-meteo", updatedAt: new Date().toISOString() };
  if (marine.status === "fulfilled") { const idx = nearestHourIndex(marine.value.hourly?.time ?? []); out.waveHeightM = numberValue(marine.value.hourly?.wave_height?.[idx]); out.seaSurfaceTemperatureC = numberValue(marine.value.hourly?.sea_surface_temperature?.[idx]); }
  if (forecast.status === "fulfilled") { const idx = nearestHourIndex(forecast.value.hourly?.time ?? []); out.windSpeedMs = numberValue(forecast.value.hourly?.wind_speed_10m?.[idx]); out.airTemperatureC = numberValue(forecast.value.hourly?.temperature_2m?.[idx]); }
  return out;
}
async function loadWeather() {
  try {
    if (WEATHER_URL) { const payload = await fetchProviderJson(WEATHER_URL, WEATHER_TOKEN); const points = rowsFrom(payload, ["points", "weather", "data", "items"]); weatherState.source = "runtime"; weatherState.points = points.length; weatherState.lastLoadedAt = new Date().toISOString(); weatherState.lastError = null; return { source: "runtime", points, weather: weatherState }; }
    if (WEATHER_FILE_ENABLED && existsSync(WEATHER_FILE_PATH)) { const payload = JSON.parse(readFileSync(WEATHER_FILE_PATH, "utf8")); const points = rowsFrom(payload, ["points", "weather", "data", "items"]); weatherState.source = "runtime"; weatherState.points = points.length; weatherState.lastLoadedAt = new Date().toISOString(); weatherState.lastError = null; return { source: "runtime", points, weather: weatherState }; }
    const points = await Promise.all(weatherPoints.map(openMeteoPoint));
    weatherState.source = "open-meteo"; weatherState.points = points.length; weatherState.lastLoadedAt = new Date().toISOString(); weatherState.lastError = null; return { source: "open-meteo", points, weather: weatherState };
  } catch (error) { weatherState.lastError = error instanceof Error ? error.message : String(error); return null; }
}
function startAisStream() {
  if (!AISSTREAM_API_KEY) return;
  const boxes = parseBoundingBoxes(AISSTREAM_BBOX);
  aisState.boundingBoxes = boxes;
  const socket = new WebSocket(AISSTREAM_URL);
  socket.on("open", () => { aisState.connected = true; aisState.reconnectAttempt = 0; aisState.lastError = null; socket.send(JSON.stringify({ APIKey: AISSTREAM_API_KEY, BoundingBoxes: boxes, ...(AISSTREAM_FILTER_TYPES.length > 0 ? { FilterMessageTypes: AISSTREAM_FILTER_TYPES } : {}) })); });
  socket.on("message", (data) => { try { aisState.messageCount += 1; const raw = JSON.parse(data.toString()); if (raw.error) { aisState.lastError = raw.error; return; } const vessel = normalizeAisMessage(raw); if (!vessel) return; aisState.lastMessageAt = new Date().toISOString(); mergeAisVessel(vessel); } catch (error) { aisState.lastError = error instanceof Error ? error.message : String(error); } });
  socket.on("close", () => { aisState.connected = false; const delay = Math.min(30_000, 2_000 * 2 ** aisState.reconnectAttempt); aisState.reconnectAttempt += 1; setTimeout(startAisStream, delay); });
  socket.on("error", (error) => { aisState.connected = false; aisState.lastError = error.message; });
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
function sendJson(response, statusCode, payload) { response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*", "access-control-allow-methods": "GET, POST, OPTIONS", "access-control-allow-headers": "content-type, authorization" }); response.end(statusCode === 204 ? "" : JSON.stringify(payload, null, 2)); }
function sendFile(response, path) { const type = path.endsWith(".html") ? "text/html" : path.endsWith(".js") ? "text/javascript" : path.endsWith(".css") ? "text/css" : "application/octet-stream"; response.writeHead(200, { "content-type": type }); response.end(readFileSync(path)); }
function healthPayload() { return { ok: true, upstreamConfigured: Boolean(UPSTREAM_URL), staticDashboard: existsSync(STATIC_INDEX), vesselInputs: vesselInputState, aisstream: { ...aisState, cachedVessels: sortedAisVessels().length }, chmarl: { ...chmarlState, active: chmarlState.steps > 0 }, ecofair: ecofair.summary(), portOps: { ...portOpsState, active: portOpsState.events > 0 || portOpsState.utilizationRows > 0 || portOpsState.queueRows > 0 }, weather: { ...weatherState, active: weatherState.points > 0 } }; }
function shutdown() { saveAisCacheToDisk(); saveEcofairStateToDisk(); process.exit(0); }
process.on("SIGINT", shutdown); process.on("SIGTERM", shutdown); process.on("beforeExit", saveAisCacheToDisk);
loadAisCacheFromDisk(); loadEcofairStateFromDisk();
if (AISSTREAM_CACHE_ENABLED && AISSTREAM_CACHE_FLUSH_MS > 0) { const interval = setInterval(saveAisCacheToDisk, AISSTREAM_CACHE_FLUSH_MS); interval.unref?.(); }
if (ECOFAIR_TICK_MS > 0) { const tick = setInterval(async () => { try { ecofair.update(await loadCombinedVessels()); await buildRuntimeChmarlExperiment(); saveEcofairStateToDisk(); } catch (error) { console.warn("EcoFair tick failed:", error instanceof Error ? error.message : error); } }, ECOFAIR_TICK_MS); tick.unref?.(); }
startAisStream();

createServer(async (request, response) => {
  if (request.method === "OPTIONS") return sendJson(response, 204, {});
  if (request.url === "/health") { await Promise.all([loadChmarlExperiment(), loadPortOperations(), loadWeather()]); return sendJson(response, 200, healthPayload()); }
  if (request.url === "/api/vessels") { try { const result = await loadVessels(); return sendJson(response, 200, { ...result, health: { ...aisState, cachedVessels: sortedAisVessels().length }, vesselInputs: vesselInputState }); } catch (error) { return sendJson(response, 502, { error: "Failed to load vessel feed", detail: error instanceof Error ? error.message : String(error), vessels: [], source: "none", health: aisState, vesselInputs: vesselInputState }); } }
  if (request.url === "/api/vessels/ingest" && request.method === "POST") { if (!authorized(request, FIXED_VESSEL_INGEST_TOKEN)) return sendJson(response, 401, { error: "Unauthorized vessel ingest" }); try { return sendJson(response, 200, writeFixedVesselPayload(await readJsonBody(request))); } catch (error) { return sendJson(response, 400, { error: "Failed to ingest fixed vessel payload", detail: error instanceof Error ? error.message : String(error) }); } }
  if ((request.url === "/api/chmarl/episode" || request.url === "/api/chmarl/ingest") && request.method === "POST") { if (!authorized(request, CHMARL_INGEST_TOKEN)) return sendJson(response, 401, { error: "Unauthorized CH-MARL ingest" }); try { return sendJson(response, 200, await ingestChmarl(await readJsonBody(request))); } catch (error) { return sendJson(response, 400, { error: "Failed to ingest CH-MARL payload", detail: error instanceof Error ? error.message : String(error) }); } }
  if (request.url?.startsWith("/api/chmarl/episode")) { const wantsExperiment = new URL(request.url, "http://localhost").searchParams.get("source") === "experiment"; if (wantsExperiment) { if (!existsSync(CHMARL_EXPERIMENT_FILE_PATH)) return sendJson(response, 404, { error: "No ingested experiment available. POST results via /api/chmarl/ingest first.", chmarl: chmarlState }); try { return sendJson(response, 200, JSON.parse(readFileSync(CHMARL_EXPERIMENT_FILE_PATH, "utf8"))); } catch (error) { return sendJson(response, 500, { error: "Stored experiment payload is unreadable", detail: error instanceof Error ? error.message : String(error) }); } } const experiment = await loadChmarlExperiment(); if (!experiment || experiment.steps.length === 0) return sendJson(response, 404, { error: "No CH-MARL experiment feed is active", chmarl: chmarlState }); return sendJson(response, 200, experiment); }
  if (request.url === "/api/port-events") { const portOps = await loadPortOperations(); if (!portOps) return sendJson(response, 404, { error: "No port operations feed is active", portOps: portOpsState }); return sendJson(response, 200, portOps); }
  if (request.url === "/api/weather") { const weather = await loadWeather(); if (!weather) return sendJson(response, 502, { error: "No weather feed is active", weather: weatherState }); return sendJson(response, 200, weather); }
  if (request.url?.startsWith("/api/report")) { ecofair.update(await loadCombinedVessels()); const wantsJson = new URL(request.url, "http://localhost").searchParams.get("format") === "json"; if (wantsJson) return sendJson(response, 200, { generatedAt: new Date().toISOString(), summary: ecofair.summary(), state: ecofair.serialize(), markdown: ecofair.buildReport() }); response.writeHead(200, { "content-type": "text/markdown; charset=utf-8", "access-control-allow-origin": "*" }); return response.end(ecofair.buildReport()); }
  const staticMatch = staticFileForUrl(request.url); if (staticMatch?.path) return sendFile(response, staticMatch.path); if (staticMatch?.statusCode === 403) return sendJson(response, 403, { error: "Forbidden" });
  return sendJson(response, 404, { error: "Not found", availableEndpoints: ["/", "/health", "/api/vessels", "/api/vessels/ingest", "/api/chmarl/episode", "/api/chmarl/ingest", "/api/port-events", "/api/weather", "/api/report"] });
}).listen(PORT, () => {
  console.log(`CH-MARL backend listening at http://localhost:${PORT}`);
  console.log(`AISStream bounding boxes: ${AISSTREAM_BBOX.split("|").length}`);
  console.log(`AISStream cache file: ${AISSTREAM_CACHE_FILE}`);
  console.log(`EcoFair state file: ${ECOFAIR_STATE_FILE}`);
  if (AISSTREAM_API_KEY) console.log("AISStream live mode enabled.");
});
