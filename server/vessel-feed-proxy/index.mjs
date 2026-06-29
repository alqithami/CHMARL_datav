import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import WebSocket from "ws";

const PORT = Number(process.env.PORT ?? 8787);
const STATIC_DIR = resolve(process.env.STATIC_DIR ?? "dist");
const STATIC_INDEX = resolve(STATIC_DIR, "index.html");

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

const UPSTREAM_URL = process.env.UPSTREAM_VESSEL_DATA_URL;
const UPSTREAM_TOKEN = process.env.UPSTREAM_VESSEL_DATA_TOKEN;
const AISSTREAM_API_KEY = process.env.AISSTREAM_API_KEY;
const AISSTREAM_URL = process.env.AISSTREAM_URL ?? "wss://stream.aisstream.io/v0/stream";
const AISSTREAM_BBOX = process.env.AISSTREAM_USE_SAUDI_PORT_BBOXES === "false" ? (process.env.AISSTREAM_BBOX ?? SAUDI_PORT_BBOX) : SAUDI_PORT_BBOX;
const AISSTREAM_MAX_VESSELS = Number(process.env.AISSTREAM_MAX_VESSELS ?? 750);
const AISSTREAM_TRAIL_POINTS = Number(process.env.AISSTREAM_TRAIL_POINTS ?? 24);
const AISSTREAM_MAX_AGE_MS = Number(process.env.AISSTREAM_MAX_AGE_MS ?? 6 * 60 * 60 * 1000);
const AISSTREAM_CACHE_ENABLED = process.env.AISSTREAM_CACHE_ENABLED !== "false";
const AISSTREAM_CACHE_FILE = process.env.AISSTREAM_CACHE_FILE ?? ".runtime/ais-cache.json";
const AISSTREAM_CACHE_FILE_PATH = resolve(AISSTREAM_CACHE_FILE);
const AISSTREAM_CACHE_FLUSH_MS = Number(process.env.AISSTREAM_CACHE_FLUSH_MS ?? 15_000);
const AISSTREAM_FILTER_TYPES = (process.env.AISSTREAM_FILTER_TYPES ?? "PositionReport,StandardClassBPositionReport,ExtendedClassBPositionReport").split(",").map((item) => item.trim()).filter(Boolean);

const CHMARL_RUNTIME_ENABLED = process.env.CHMARL_RUNTIME_ENABLED !== "false";
const CHMARL_EXPERIMENT_URL = process.env.CHMARL_EXPERIMENT_URL;
const CHMARL_EXPERIMENT_TOKEN = process.env.CHMARL_EXPERIMENT_TOKEN;
const CHMARL_INGEST_TOKEN = process.env.CHMARL_INGEST_TOKEN;
const CHMARL_EXPERIMENT_FILE = process.env.CHMARL_EXPERIMENT_FILE ?? ".runtime/chmarl_episode.json";
const CHMARL_EXPERIMENT_FILE_PATH = resolve(CHMARL_EXPERIMENT_FILE);
const CHMARL_FILE_ENABLED = process.env.CHMARL_FILE_ENABLED === "true";
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

const weatherPoints = [
  { locationId: "suez", name: "Suez", latitude: 29.9668, longitude: 32.5498 },
  { locationId: "jeddah", name: "Jeddah", latitude: 21.4858, longitude: 39.1925 },
  { locationId: "kaec", name: "King Abdullah Port", latitude: 22.3924, longitude: 39.0953 },
  { locationId: "yanbu", name: "Yanbu", latitude: 24.0866, longitude: 38.0637 },
  { locationId: "jizan", name: "Jizan", latitude: 16.8917, longitude: 42.5511 },
  { locationId: "dammam", name: "Dammam", latitude: 26.4318, longitude: 50.1015 },
  { locationId: "jebel-ali", name: "Jebel Ali", latitude: 25.0114, longitude: 55.0611 },
];

const contentTypes = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon" };

const aisCache = new Map();
let cacheSaveTimer;
const aisState = { enabled: Boolean(AISSTREAM_API_KEY), connected: false, lastMessageAt: null, lastError: null, reconnectAttempt: 0, boundingBoxes: [], messageCount: 0, cachedVessels: 0, cacheLimit: AISSTREAM_MAX_VESSELS, trailLimit: AISSTREAM_TRAIL_POINTS, maxAgeMs: AISSTREAM_MAX_AGE_MS, cacheEnabled: AISSTREAM_CACHE_ENABLED, cacheFile: AISSTREAM_CACHE_ENABLED ? AISSTREAM_CACHE_FILE : null, cacheSavedAt: null, cacheLoadedAt: null, cacheSaveError: null, restoredVessels: 0 };
const chmarlState = { enabled: CHMARL_RUNTIME_ENABLED, source: "runtime", configuredUrl: Boolean(CHMARL_EXPERIMENT_URL), file: CHMARL_FILE_ENABLED ? CHMARL_EXPERIMENT_FILE : null, steps: 0, experimentId: null, scenarioId: null, lastLoadedAt: null, lastIngestedAt: null, lastError: null };
const portOpsState = { source: PORT_EVENTS_URL ? "url" : PORT_EVENTS_FILE_ENABLED ? "file" : "none", configuredUrl: Boolean(PORT_EVENTS_URL), file: PORT_EVENTS_FILE_ENABLED ? PORT_EVENTS_FILE : null, events: 0, utilizationRows: 0, queueRows: 0, lastLoadedAt: null, lastError: null };
const weatherState = { source: WEATHER_URL ? "url" : WEATHER_FILE_ENABLED ? "file" : "open-meteo", configuredUrl: Boolean(WEATHER_URL), file: WEATHER_FILE_ENABLED ? WEATHER_FILE : null, points: 0, lastLoadedAt: null, lastError: null };

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*", "access-control-allow-methods": "GET, POST, OPTIONS", "access-control-allow-headers": "content-type, authorization" });
  response.end(JSON.stringify(payload));
}

function sendFile(response, filePath) {
  const ext = extname(filePath).toLowerCase();
  response.writeHead(200, { "content-type": contentTypes[ext] ?? "application/octet-stream", "cache-control": ext === ".html" ? "no-cache" : "public, max-age=31536000, immutable" });
  response.end(readFileSync(filePath));
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (chunks.length === 0) return null;
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function authorizedIngest(request) {
  if (!CHMARL_INGEST_TOKEN) return true;
  const auth = request.headers.authorization ?? "";
  return auth === `Bearer ${CHMARL_INGEST_TOKEN}`;
}

function clamp(value, min = 0, max = 1) { return Math.max(min, Math.min(max, value)); }
function numberValue(value) { if (typeof value === "number") return Number.isFinite(value) ? value : undefined; if (typeof value === "string") { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : undefined; } return undefined; }
function rowsFrom(payload, keys) { if (Array.isArray(payload)) return payload; if (!payload || typeof payload !== "object") return []; for (const key of keys) if (Array.isArray(payload[key])) return payload[key]; return []; }
function timestampMs(value) { const parsed = Date.parse(String(value ?? "")); return Number.isFinite(parsed) ? parsed : 0; }
function freshVessel(row) { const ts = timestampMs(row?.timestamp); return !AISSTREAM_MAX_AGE_MS || ts === 0 || Date.now() - ts <= AISSTREAM_MAX_AGE_MS; }
function parseBoundingBoxes(value) { return value.split("|").map((box) => { const corners = box.split(";").map((corner) => corner.split(",").map((item) => Number(item.trim()))); if (corners.length !== 2 || corners.some((corner) => corner.length !== 2 || corner.some((number) => !Number.isFinite(number)))) throw new Error(`Invalid AISSTREAM_BBOX segment: ${box}`); return corners; }); }
function normalizeStatus(value) { const text = String(value ?? "").toLowerCase(); if (text.includes("constraint") || text.includes("restricted") || text.includes("alert")) return "Constrained"; if (text.includes("watch") || text.includes("warning") || text.includes("delay")) return "Watch"; return "Nominal"; }
function normalizeTrail(points) { if (!Array.isArray(points)) return undefined; const trail = points.map((point) => { const latitude = numberValue(point.latitude ?? point.lat); const longitude = numberValue(point.longitude ?? point.lon ?? point.lng); if (latitude === undefined || longitude === undefined) return null; return { latitude, longitude, timestamp: point.timestamp }; }).filter(Boolean); return trail.length > 1 ? trail : undefined; }
function speedText(value) { const speed = numberValue(value); return speed === undefined ? "TBD" : `${speed.toFixed(1)} kn`; }
function speedKnots(vessel) { const parsed = Number.parseFloat(String(vessel.speed ?? "").replace(/[^0-9.\-]/g, "")); return Number.isFinite(parsed) ? parsed : undefined; }

function distanceNm(a, b) {
  const radiusNm = 3440.065;
  const toRad = (value) => (value * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * radiusNm * Math.asin(Math.min(1, Math.sqrt(h)));
}

function nearestPort(vessel) {
  if (!Number.isFinite(vessel.latitude) || !Number.isFinite(vessel.longitude)) return null;
  return PORT_REFERENCE_POINTS.map((port) => ({ port, distance: distanceNm(vessel, port) })).sort((a, b) => a.distance - b.distance)[0] ?? null;
}

function normalizeVessel(row) {
  const name = row.name ?? row.vesselName ?? row.shipName ?? "Unknown Vessel";
  const id = row.id ?? row.vesselId ?? (row.mmsi ? `MMSI-${row.mmsi}` : row.imo ? `IMO-${row.imo}` : name);
  const origin = row.originPort ?? row.origin ?? "Unknown";
  const destination = row.destinationPort ?? row.destination ?? row.dest ?? "Unknown";
  const speed = row.speed ?? row.speedKnots ?? row.sog;
  return { id: String(id), name: String(name), route: row.route ?? `${origin} → ${destination}`, cargo: String(row.cargo ?? row.cargoClass ?? row.vesselType ?? row.shipType ?? "Unspecified"), eta: String(row.eta ?? row.ETA ?? "TBD"), speed: typeof speed === "string" && speed.toLowerCase().includes("kn") ? speed : speedText(speed), status: row.status ?? normalizeStatus(row.navStatus), latitude: numberValue(row.latitude ?? row.lat), longitude: numberValue(row.longitude ?? row.lon ?? row.lng), headingDeg: numberValue(row.headingDeg ?? row.heading), courseDeg: numberValue(row.courseDeg ?? row.cog), timestamp: row.timestamp, trail: normalizeTrail(row.trail ?? row.history ?? row.track) };
}

function messageBody(message) { const type = message?.MessageType; const body = message?.Message?.[type] ?? message?.Message?.PositionReport ?? message?.Message?.StandardClassBPositionReport ?? message?.Message?.ExtendedClassBPositionReport; return body && typeof body === "object" ? body : {}; }
function normalizeAisMessage(raw) { const metadata = raw.MetaData ?? raw.Metadata ?? {}; const body = messageBody(raw); const mmsi = metadata.MMSI ?? body.UserID; const latitude = numberValue(metadata.latitude ?? metadata.Latitude ?? body.Latitude); const longitude = numberValue(metadata.longitude ?? metadata.Longitude ?? body.Longitude); if (!mmsi || latitude === undefined || longitude === undefined) return null; const sog = numberValue(body.Sog ?? metadata.Sog ?? metadata.SOG); return { id: `MMSI-${mmsi}`, mmsi: String(mmsi), name: metadata.ShipName ? String(metadata.ShipName).trim() : `MMSI ${mmsi}`, route: "AIS live position", cargo: raw.MessageType ?? "AIS vessel", eta: "Live AIS", speed: sog === undefined ? "TBD" : `${sog.toFixed(1)} kn`, status: "Nominal", latitude, longitude, headingDeg: numberValue(body.TrueHeading ?? body.Heading ?? metadata.TrueHeading), courseDeg: numberValue(body.Cog ?? metadata.Cog ?? metadata.COG), timestamp: metadata.time_utc ?? metadata.TimeUtc ?? metadata.timestamp ?? new Date().toISOString() }; }
function sortedAisVessels() { return [...aisCache.values()].filter(freshVessel).sort((a, b) => String(b.timestamp ?? "").localeCompare(String(a.timestamp ?? ""))); }
function mergeAisVessel(update) { const existing = aisCache.get(update.id); const trail = [...(existing?.trail ?? []), { latitude: update.latitude, longitude: update.longitude, timestamp: update.timestamp }].slice(-AISSTREAM_TRAIL_POINTS); aisCache.set(update.id, { ...existing, ...update, trail: trail.length > 1 ? trail : undefined }); for (const [key, value] of aisCache.entries()) if (!freshVessel(value)) aisCache.delete(key); if (aisCache.size > AISSTREAM_MAX_VESSELS) { const oldestKey = sortedAisVessels().at(-1)?.id; if (oldestKey) aisCache.delete(oldestKey); } aisState.cachedVessels = sortedAisVessels().length; scheduleAisCacheSave(); }
function loadAisCacheFromDisk() { if (!AISSTREAM_CACHE_ENABLED || !existsSync(AISSTREAM_CACHE_FILE_PATH)) return; try { const payload = JSON.parse(readFileSync(AISSTREAM_CACHE_FILE_PATH, "utf8")); const rows = Array.isArray(payload?.vessels) ? payload.vessels : []; for (const row of rows.slice(0, AISSTREAM_MAX_VESSELS)) { const vessel = row?.id ? normalizeVessel(row) : null; if (vessel && freshVessel(vessel)) aisCache.set(String(vessel.id), vessel); } aisState.cachedVessels = sortedAisVessels().length; aisState.restoredVessels = aisState.cachedVessels; aisState.cacheLoadedAt = new Date().toISOString(); } catch (error) { aisState.cacheSaveError = error instanceof Error ? error.message : String(error); } }
function saveAisCacheToDisk() { if (!AISSTREAM_CACHE_ENABLED) return; try { mkdirSync(dirname(AISSTREAM_CACHE_FILE_PATH), { recursive: true }); const snapshot = { version: 1, savedAt: new Date().toISOString(), vessels: sortedAisVessels().slice(0, AISSTREAM_MAX_VESSELS) }; writeFileSync(AISSTREAM_CACHE_FILE_PATH, JSON.stringify(snapshot, null, 2)); aisState.cacheSavedAt = snapshot.savedAt; aisState.cacheSaveError = null; } catch (error) { aisState.cacheSaveError = error instanceof Error ? error.message : String(error); } }
function scheduleAisCacheSave() { if (!AISSTREAM_CACHE_ENABLED) return; if (cacheSaveTimer) clearTimeout(cacheSaveTimer); cacheSaveTimer = setTimeout(saveAisCacheToDisk, Math.max(1_000, AISSTREAM_CACHE_FLUSH_MS)); cacheSaveTimer.unref?.(); }

function normalizePortEventType(value) { const text = String(value ?? "arrival").toLowerCase().replace(/[\s-]+/g, "_"); if (["departure", "anchorage_entry", "anchorage_exit", "berth_assigned", "service_started", "service_completed"].includes(text)) return text; return "arrival"; }
function normalizePortEvent(row, index) { if (!row || typeof row !== "object") return null; const portId = String(row.portId ?? row.port_id ?? row.port ?? row.portName ?? row.unlocode ?? "").trim(); if (!portId) return null; return { eventId: String(row.eventId ?? row.event_id ?? row.id ?? `${portId}-${index}`), vesselId: row.vesselId || row.vessel_id || row.mmsi ? String(row.vesselId ?? row.vessel_id ?? row.mmsi) : undefined, portId, berthId: row.berthId || row.berth_id || row.berth ? String(row.berthId ?? row.berth_id ?? row.berth) : undefined, eventType: normalizePortEventType(row.eventType ?? row.event_type ?? row.type ?? row.status), timestamp: String(row.timestamp ?? row.time ?? row.updatedAt ?? new Date().toISOString()), metadata: row.metadata && typeof row.metadata === "object" ? row.metadata : undefined }; }
function normalizePortUtilization(row) { if (!row || typeof row !== "object") return null; const name = String(row.name ?? row.portName ?? row.port_name ?? row.portId ?? row.port_id ?? row.port ?? "").trim(); if (!name) return null; return { name, value: numberValue(row.value ?? row.utilizationPct ?? row.utilization_pct ?? row.utilization ?? row.berthUtilizationPct ?? row.queueLength ?? row.waitingVessels) ?? 0 }; }
function normalizeQueueStatus(row) { if (!row || typeof row !== "object") return null; const portId = String(row.portId ?? row.port_id ?? row.port ?? row.name ?? "").trim(); if (!portId) return null; return { portId, berthId: row.berthId || row.berth_id || row.berth ? String(row.berthId ?? row.berth_id ?? row.berth) : undefined, queueLength: numberValue(row.queueLength ?? row.queue_length ?? row.queue), waitingVessels: numberValue(row.waitingVessels ?? row.waiting_vessels ?? row.waiting), utilizationPct: numberValue(row.utilizationPct ?? row.utilization_pct ?? row.berthUtilizationPct ?? row.berth_utilization_pct), timestamp: row.timestamp || row.time || row.updatedAt ? String(row.timestamp ?? row.time ?? row.updatedAt) : undefined }; }
async function fetchProviderJson(url, token) { const headers = { accept: "application/json" }; if (token) headers.authorization = `Bearer ${token}`; const response = await fetch(url, { headers }); if (!response.ok) throw new Error(`${response.status} ${response.statusText}`); return response.json(); }
async function loadVessels() { const live = sortedAisVessels(); if (live.length > 0) return { vessels: live, source: "aisstream" }; if (UPSTREAM_URL) { const payload = await fetchProviderJson(UPSTREAM_URL, UPSTREAM_TOKEN); const rows = rowsFrom(payload, ["vessels", "data", "items"]); return { vessels: rows.map(normalizeVessel), source: "upstream" }; } return { vessels: [], source: AISSTREAM_API_KEY ? "aisstream-waiting" : "none" }; }

function updateChmarlState(payload, source) { const steps = rowsFrom(payload, ["steps", "data", "items"]); chmarlState.source = source; chmarlState.steps = steps.length; chmarlState.experimentId = payload?.experimentId ?? steps[0]?.experimentId ?? null; chmarlState.scenarioId = payload?.scenarioId ?? steps[0]?.scenarioId ?? null; chmarlState.lastLoadedAt = new Date().toISOString(); chmarlState.lastError = null; return { source, experimentId: chmarlState.experimentId, scenarioId: chmarlState.scenarioId, steps } }
function readChmarlFilePayload() { if (!CHMARL_FILE_ENABLED || !existsSync(CHMARL_EXPERIMENT_FILE_PATH)) return null; return JSON.parse(readFileSync(CHMARL_EXPERIMENT_FILE_PATH, "utf8")); }
function writeChmarlFilePayload(payload) { mkdirSync(dirname(CHMARL_EXPERIMENT_FILE_PATH), { recursive: true }); writeFileSync(CHMARL_EXPERIMENT_FILE_PATH, JSON.stringify(payload, null, 2)); }
async function ingestChmarl(payload) { const incomingSteps = Array.isArray(payload) ? payload : rowsFrom(payload, ["steps", "data", "items"]); const existing = CHMARL_FILE_ENABLED ? readChmarlFilePayload() : null; const existingSteps = existing ? rowsFrom(existing, ["steps", "data", "items"]) : []; const mergedSteps = [...existingSteps, ...incomingSteps]; const nextPayload = { experimentId: payload?.experimentId ?? existing?.experimentId ?? mergedSteps[0]?.experimentId ?? "runtime-chmarl", scenarioId: payload?.scenarioId ?? existing?.scenarioId ?? mergedSteps[0]?.scenarioId ?? "baseline", updatedAt: new Date().toISOString(), steps: mergedSteps.slice(-5000) }; writeChmarlFilePayload(nextPayload); chmarlState.lastIngestedAt = nextPayload.updatedAt; return updateChmarlState(nextPayload, "ingest"); }
function gini(values) { const nums = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b); if (nums.length === 0) return 0; const sum = nums.reduce((a, b) => a + b, 0); if (sum === 0) return 0; return (2 * nums.reduce((acc, value, index) => acc + (index + 1) * value, 0)) / (nums.length * sum) - (nums.length + 1) / nums.length; }
function minMaxRatio(values) { const nums = values.filter((value) => Number.isFinite(value) && value >= 0); if (nums.length === 0) return 1; const max = Math.max(...nums); if (max === 0) return 1; return Math.min(...nums) / max; }
function buildRuntimeChmarlExperiment() { const vessels = sortedAisVessels(); if (!CHMARL_RUNTIME_ENABLED || vessels.length === 0) return null; const speeds = vessels.map(speedKnots).filter((value) => value !== undefined); const lowSpeed = vessels.filter((vessel) => (speedKnots(vessel) ?? 99) <= 0.5).length; const stale = vessels.filter((vessel) => !freshVessel(vessel)).length; const missingPosition = vessels.filter((vessel) => !Number.isFinite(vessel.latitude) || !Number.isFinite(vessel.longitude)).length; const nearestCounts = new Map(); for (const vessel of vessels) { const nearest = nearestPort(vessel); if (nearest && nearest.distance <= 75) nearestCounts.set(nearest.port.id, (nearestCounts.get(nearest.port.id) ?? 0) + 1); } const busiest = [...nearestCounts.entries()].sort((a, b) => b[1] - a[1])[0]; const giniSpeed = gini(speeds); const minmaxSpeed = minMaxRatio(speeds); const lowSpeedPct = vessels.length > 0 ? lowSpeed / vessels.length : 0; const missingPct = vessels.length > 0 ? missingPosition / vessels.length : 0; const proximityPressure = busiest ? Math.min(1, busiest[1] / Math.max(10, vessels.length)) : 0; const feasibility = clamp(1 - Math.max(lowSpeedPct, missingPct, proximityPressure * 0.7)); const now = new Date().toISOString(); const experimentId = `online-${now.slice(0, 10)}`; const constraints = [ { constraintId: "ais-low-speed", name: "Low speed", value: Number((lowSpeedPct * 100).toFixed(1)), limit: 35, satisfied: lowSpeedPct <= 0.35, severity: lowSpeedPct > 0.6 ? "high" : lowSpeedPct > 0.35 ? "medium" : "low" }, { constraintId: "ais-position-completeness", name: "Missing position", value: Number((missingPct * 100).toFixed(1)), limit: 5, satisfied: missingPct <= 0.05, severity: missingPct > 0.2 ? "high" : missingPct > 0.05 ? "medium" : "low" }, { constraintId: "port-proximity-pressure", name: busiest ? `Proximity pressure ${busiest[0]}` : "Port proximity pressure", value: Number((proximityPressure * 100).toFixed(1)), limit: 65, satisfied: proximityPressure <= 0.65, severity: proximityPressure > 0.8 ? "high" : proximityPressure > 0.65 ? "medium" : "low" } ]; const actions = [ { agentId: "coordinator", agentType: "fleet", actionType: "monitor_live_ais", actionValue: "active" }, { agentId: "constraint-shield", agentType: "constraint_shield", actionType: "apply_feasibility_guard", actionValue: feasibility >= 0.7 } ]; if (busiest) actions.push({ agentId: "port-agent", agentType: "port", actionType: "review_port_cluster", actionValue: busiest[0], targetId: busiest[0] }); const hierarchyDecisions = [ { level: "coordinator", decisionId: "online-live-policy", decisionLabel: feasibility >= 0.7 ? "Maintain live monitoring policy" : "Escalate operational review", rationale: "Decision derived from current AIS speed, freshness, position completeness, and nearest-port pressure." }, { level: "shield", decisionId: "online-constraint-shield", decisionLabel: constraints.some((item) => !item.satisfied) ? "Constraint shield active" : "Constraint shield nominal", rationale: "Constraint state computed from live vessel rows; no bundled sample CH-MARL data used." } ]; const step = { experimentId, scenarioId: "live-operations", episode: 1, step: Math.floor(Date.now() / 1000), timestamp: now, state: { vesselCount: vessels.length, nearestPortCounts: Object.fromEntries(nearestCounts), source: "live-ais" }, actions, rewards: [ { agentId: "coordinator", component: "global", value: Number(feasibility.toFixed(3)) }, { agentId: "coordinator", component: "fairness", value: Number((1 - giniSpeed).toFixed(3)) }, { agentId: "constraint-shield", component: "constraint_penalty", value: Number((-constraints.filter((item) => !item.satisfied).length / constraints.length).toFixed(3)) } ], constraints, fairness: [ { metricId: "speed-gini", name: "Speed Gini", value: Number(giniSpeed.toFixed(3)), groupBy: "vessel" }, { metricId: "speed-minmax", name: "Speed max-min ratio", value: Number(minmaxSpeed.toFixed(3)), groupBy: "vessel" } ], hierarchyDecisions }; return updateChmarlState({ experimentId, scenarioId: "live-operations", source: "online-runtime", steps: [step] }, "online-runtime"); }
async function loadChmarlExperiment() { try { if (CHMARL_EXPERIMENT_URL) return updateChmarlState(await fetchProviderJson(CHMARL_EXPERIMENT_URL, CHMARL_EXPERIMENT_TOKEN), "url"); const filePayload = readChmarlFilePayload(); if (filePayload) return updateChmarlState(filePayload, "file"); const online = buildRuntimeChmarlExperiment(); if (online) return online; chmarlState.steps = 0; chmarlState.lastError = null; return null; } catch (error) { chmarlState.lastError = error instanceof Error ? error.message : String(error); return null; } }

function updatePortOpsState(payload, source) { const portEvents = rowsFrom(payload, ["portEvents", "port_events", "events", "data", "items"]).map(normalizePortEvent).filter(Boolean); const portUtilization = rowsFrom(payload, ["portUtilization", "port_utilization", "utilization", "ports"]).map(normalizePortUtilization).filter(Boolean); const queueStatus = rowsFrom(payload, ["queueStatus", "queue_status", "queues", "berths"]).map(normalizeQueueStatus).filter(Boolean); portOpsState.source = source; portOpsState.events = portEvents.length; portOpsState.utilizationRows = portUtilization.length; portOpsState.queueRows = queueStatus.length; portOpsState.lastLoadedAt = new Date().toISOString(); portOpsState.lastError = null; return { source, portEvents, portUtilization, queueStatus, portOps: portOpsState }; }
async function loadPortOperations() { try { if (PORT_EVENTS_URL) return updatePortOpsState(await fetchProviderJson(PORT_EVENTS_URL, PORT_EVENTS_TOKEN), "url"); if (PORT_EVENTS_FILE_ENABLED && existsSync(PORT_EVENTS_FILE_PATH)) return updatePortOpsState(JSON.parse(readFileSync(PORT_EVENTS_FILE_PATH, "utf8")), "file"); portOpsState.events = 0; portOpsState.utilizationRows = 0; portOpsState.queueRows = 0; portOpsState.lastError = null; return null; } catch (error) { portOpsState.lastError = error instanceof Error ? error.message : String(error); return null; } }
function nearestHourIndex(times) { const now = Date.now(); let bestIndex = 0; let bestDistance = Number.POSITIVE_INFINITY; for (let index = 0; index < times.length; index += 1) { const timestamp = Date.parse(times[index]); if (!Number.isFinite(timestamp)) continue; const distance = Math.abs(timestamp - now); if (distance < bestDistance) { bestIndex = index; bestDistance = distance; } } return bestIndex; }
function hourlyValue(hourly, key, index) { return Array.isArray(hourly[key]) ? numberValue(hourly[key][index]) : undefined; }
async function loadOpenMeteoPoint(point) { const params = new URLSearchParams({ latitude: String(point.latitude), longitude: String(point.longitude), hourly: "wave_height,wave_period,wave_direction,ocean_current_velocity,ocean_current_direction,sea_surface_temperature", forecast_days: "1", timezone: "UTC" }); const response = await fetch(`https://marine-api.open-meteo.com/v1/marine?${params.toString()}`); if (!response.ok) return null; const payload = await response.json(); const hourly = payload.hourly; if (!hourly || !Array.isArray(hourly.time)) return null; const index = nearestHourIndex(hourly.time); return { ...point, timestamp: hourly.time[index], waveHeightM: hourlyValue(hourly, "wave_height", index), wavePeriodS: hourlyValue(hourly, "wave_period", index), waveDirectionDeg: hourlyValue(hourly, "wave_direction", index), currentVelocityMs: hourlyValue(hourly, "ocean_current_velocity", index), currentDirectionDeg: hourlyValue(hourly, "ocean_current_direction", index), seaSurfaceTemperatureC: hourlyValue(hourly, "sea_surface_temperature", index) }; }
async function loadWeather() { try { if (WEATHER_URL) { const payload = await fetchProviderJson(WEATHER_URL, WEATHER_TOKEN); const points = rowsFrom(payload, ["points", "data", "items"]); weatherState.source = "url"; weatherState.points = points.length; weatherState.lastLoadedAt = new Date().toISOString(); weatherState.lastError = null; return { source: "runtime", updatedAt: payload.updatedAt ?? new Date().toISOString(), points }; } if (WEATHER_FILE_ENABLED && existsSync(WEATHER_FILE_PATH)) { const payload = JSON.parse(readFileSync(WEATHER_FILE_PATH, "utf8")); const points = rowsFrom(payload, ["points", "data", "items"]); weatherState.source = "file"; weatherState.points = points.length; weatherState.lastLoadedAt = new Date().toISOString(); weatherState.lastError = null; return { source: "runtime", updatedAt: payload.updatedAt ?? new Date().toISOString(), points }; } const settled = await Promise.allSettled(weatherPoints.map(loadOpenMeteoPoint)); const points = settled.map((result) => result.status === "fulfilled" ? result.value : null).filter(Boolean); weatherState.source = "open-meteo"; weatherState.points = points.length; weatherState.lastLoadedAt = new Date().toISOString(); weatherState.lastError = null; return { source: "open-meteo", updatedAt: new Date().toISOString(), points }; } catch (error) { weatherState.lastError = error instanceof Error ? error.message : String(error); return null; } }
function startAisStream() { if (!AISSTREAM_API_KEY) return; let boundingBoxes = []; try { boundingBoxes = parseBoundingBoxes(AISSTREAM_BBOX); } catch (error) { aisState.lastError = error instanceof Error ? error.message : String(error); return; } aisState.boundingBoxes = boundingBoxes; const socket = new WebSocket(AISSTREAM_URL); socket.on("open", () => { aisState.connected = true; aisState.reconnectAttempt = 0; socket.send(JSON.stringify({ APIKey: AISSTREAM_API_KEY, BoundingBoxes: boundingBoxes, ...(AISSTREAM_FILTER_TYPES.length > 0 ? { FilterMessageTypes: AISSTREAM_FILTER_TYPES } : {}) })); console.log(`AISStream connected with ${boundingBoxes.length} bounding box(es). Cache limit: ${AISSTREAM_MAX_VESSELS}.`); }); socket.on("message", (data) => { try { aisState.messageCount += 1; const raw = JSON.parse(data.toString()); if (raw.error) { aisState.lastError = raw.error; return; } const vessel = normalizeAisMessage(raw); if (!vessel) return; aisState.lastMessageAt = new Date().toISOString(); mergeAisVessel(vessel); } catch (error) { aisState.lastError = error instanceof Error ? error.message : String(error); } }); socket.on("close", () => { aisState.connected = false; const delay = Math.min(30_000, 2_000 * 2 ** aisState.reconnectAttempt); aisState.reconnectAttempt += 1; setTimeout(startAisStream, delay); }); socket.on("error", (error) => { aisState.connected = false; aisState.lastError = error.message; }); }
function staticFileForUrl(requestUrl) { if (!existsSync(STATIC_INDEX)) return null; const url = new URL(requestUrl ?? "/", "http://localhost"); const pathname = decodeURIComponent(url.pathname); const requestedPath = pathname === "/" ? "/index.html" : pathname; const candidate = resolve(STATIC_DIR, `.${requestedPath}`); if (!candidate.startsWith(STATIC_DIR)) return { statusCode: 403, path: null }; if (existsSync(candidate) && statSync(candidate).isFile()) return { statusCode: 200, path: candidate }; if (extname(requestedPath)) return { statusCode: 404, path: null }; return { statusCode: 200, path: STATIC_INDEX }; }
function healthPayload() { return { ok: true, upstreamConfigured: Boolean(UPSTREAM_URL), staticDashboard: existsSync(STATIC_INDEX), aisstream: { ...aisState, cachedVessels: sortedAisVessels().length }, chmarl: { ...chmarlState, active: chmarlState.steps > 0 }, portOps: { ...portOpsState, active: portOpsState.events > 0 || portOpsState.utilizationRows > 0 || portOpsState.queueRows > 0 }, weather: { ...weatherState, active: weatherState.points > 0 } }; }
function shutdown() { saveAisCacheToDisk(); process.exit(0); }
process.on("SIGINT", shutdown); process.on("SIGTERM", shutdown); process.on("beforeExit", saveAisCacheToDisk);
loadAisCacheFromDisk(); if (AISSTREAM_CACHE_ENABLED && AISSTREAM_CACHE_FLUSH_MS > 0) { const interval = setInterval(saveAisCacheToDisk, AISSTREAM_CACHE_FLUSH_MS); interval.unref?.(); } startAisStream();

createServer(async (request, response) => {
  if (request.method === "OPTIONS") return sendJson(response, 204, {});
  if (request.url === "/health") { await Promise.all([loadChmarlExperiment(), loadPortOperations(), loadWeather()]); return sendJson(response, 200, healthPayload()); }
  if (request.url === "/api/vessels") { try { const result = await loadVessels(); return sendJson(response, 200, { ...result, health: { ...aisState, cachedVessels: sortedAisVessels().length } }); } catch (error) { return sendJson(response, 502, { error: "Failed to load vessel feed", detail: error instanceof Error ? error.message : String(error), vessels: [], source: "none", health: aisState }); } }
  if ((request.url === "/api/chmarl/episode" || request.url === "/api/chmarl/ingest") && request.method === "POST") { if (!authorizedIngest(request)) return sendJson(response, 401, { error: "Unauthorized CH-MARL ingest" }); try { const result = await ingestChmarl(await readJsonBody(request)); return sendJson(response, 200, result); } catch (error) { return sendJson(response, 400, { error: "Failed to ingest CH-MARL payload", detail: error instanceof Error ? error.message : String(error) }); } }
  if (request.url === "/api/chmarl/episode") { const experiment = await loadChmarlExperiment(); if (!experiment || experiment.steps.length === 0) return sendJson(response, 404, { error: "No CH-MARL experiment feed is active", chmarl: chmarlState }); return sendJson(response, 200, experiment); }
  if (request.url === "/api/port-events") { const portOps = await loadPortOperations(); if (!portOps) return sendJson(response, 404, { error: "No port operations feed is active", portOps: portOpsState }); return sendJson(response, 200, portOps); }
  if (request.url === "/api/weather") { const weather = await loadWeather(); if (!weather) return sendJson(response, 502, { error: "No weather feed is active", weather: weatherState }); return sendJson(response, 200, weather); }
  const staticMatch = staticFileForUrl(request.url); if (staticMatch?.path) return sendFile(response, staticMatch.path); if (staticMatch?.statusCode === 403) return sendJson(response, 403, { error: "Forbidden" }); if (request.url === "/" || request.url === "") return sendJson(response, 200, { service: "chmarl-backend", endpoints: ["/health", "/api/vessels", "/api/chmarl/episode", "/api/chmarl/ingest", "/api/port-events", "/api/weather"] }); return sendJson(response, 404, { error: "Not found", availableEndpoints: ["/", "/health", "/api/vessels", "/api/chmarl/episode", "/api/chmarl/ingest", "/api/port-events", "/api/weather"] });
}).listen(PORT, () => { console.log(`CH-MARL backend listening at http://localhost:${PORT}`); console.log(`AISStream bounding boxes: ${AISSTREAM_BBOX.split("|").length}`); if (AISSTREAM_API_KEY) console.log("AISStream live mode enabled."); });
