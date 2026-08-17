import { existsSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { join, resolve } from "node:path";

const WORLD_AIS_BBOX = "-90,-180;90,180";
const REGIONAL_AIS_BBOX = "11,32;31,56";
const SAUDI_PORT_AIS_BBOXES = [
  "20.70,38.35;22.95,39.85",
  "23.25,37.15;24.90,38.90",
  "16.15,41.75;17.55,43.35",
  "25.70,49.25;27.25,50.90",
  "24.35,54.35;25.65,55.75",
  "29.20,32.00;30.55,33.25",
].join("|");

function mergeBboxText(...values) {
  return [...new Set(values.flatMap((value) => String(value ?? "").split("|").map((box) => box.trim()).filter(Boolean)))].join("|");
}

function loadEnvFile(fileName) {
  const filePath = resolve(process.cwd(), fileName);
  if (!existsSync(filePath)) return;
  const source = readFileSync(filePath, "utf8");
  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) continue;
    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();
    if (!key || process.env[key] !== undefined) continue;
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[key] = value;
  }
}

loadEnvFile(".env");
loadEnvFile(".env.local");

const runningOnRender = Boolean(process.env.RENDER || process.env.RENDER_SERVICE_ID || process.env.RENDER_GIT_COMMIT);
process.env.STATIC_DIR ??= "dist";
process.env.PORT ??= "8787";
process.env.RUNTIME_DATA_DIR = runningOnRender ? "/var/data" : (process.env.RUNTIME_DATA_DIR || ".runtime");
process.env.AISSTREAM_URL = runningOnRender
  ? "wss://stream.aisstream.io/v0/stream"
  : (process.env.AISSTREAM_URL?.trim() || "wss://stream.aisstream.io/v0/stream");
process.env.AISSTREAM_GLOBAL_TRACKING_ENABLED = "true";
process.env.AISSTREAM_TRACKING_BBOX = WORLD_AIS_BBOX;
process.env.AISSTREAM_FILTER_TYPES = "";
process.env.AISSTREAM_OPERATIONAL_PRIORITY_ENABLED = "true";
process.env.AISSTREAM_OPERATIONAL_BBOX ??= mergeBboxText(REGIONAL_AIS_BBOX, SAUDI_PORT_AIS_BBOXES);
process.env.AISSTREAM_OPERATIONAL_FILTER_TYPES = "";
process.env.AISSTREAM_RECOVERY_ENABLED = "true";
process.env.AISSTREAM_HEARTBEAT_MS = runningOnRender ? "10000" : (process.env.AISSTREAM_HEARTBEAT_MS || "10000");
process.env.AISSTREAM_FIRST_FRAME_TIMEOUT_MS = runningOnRender ? "30000" : (process.env.AISSTREAM_FIRST_FRAME_TIMEOUT_MS || "30000");
process.env.AISSTREAM_SILENCE_TIMEOUT_MS = runningOnRender ? "90000" : (process.env.AISSTREAM_SILENCE_TIMEOUT_MS || "90000");
process.env.AISSTREAM_RATE_LIMIT_BACKOFF_MS ??= "1800000";
process.env.AISSTREAM_PROFILE_CYCLE_BACKOFF_MS ??= "600000";
process.env.AISSTREAM_MAX_VESSELS = runningOnRender ? "20000" : (process.env.AISSTREAM_MAX_VESSELS || "20000");
process.env.AISSTREAM_OPERATIONAL_MAX_VESSELS ??= "3000";
process.env.AISSTREAM_MAX_AGE_MS ??= String(6 * 60 * 60 * 1000);
process.env.AISSTREAM_TRAIL_POINTS = runningOnRender ? "4" : (process.env.AISSTREAM_TRAIL_POINTS || "4");
process.env.AISSTREAM_CACHE_ENABLED ??= "true";
process.env.AISSTREAM_CACHE_FLUSH_MS ??= "15000";
process.env.DATALASTIC_AIS_ENABLED ??= "true";
process.env.DATALASTIC_API_BASE_URL ??= "https://api.datalastic.com/api/v0";
process.env.DATALASTIC_ACTIVATION_DELAY_MS ??= "45000";
process.env.DATALASTIC_SCAN_INTERVAL_MS ??= "900000";
process.env.DATALASTIC_TIMEOUT_MS ??= "15000";
process.env.DATALASTIC_SCAN_RADIUS_NM ??= "50";
process.env.DATALASTIC_MAX_AGE_MS ??= "2700000";
process.env.DATALASTIC_MAX_VESSELS ??= "5000";
process.env.DATALASTIC_SCAN_POINT_IDS ??= "Jeddah,King Abdullah Port";
process.env.POCKETWORLD_AIS_ENABLED = runningOnRender ? "true" : (process.env.POCKETWORLD_AIS_ENABLED || "true");
process.env.POCKETWORLD_API_URL ??= "https://pocketworld.org/api/ships";
process.env.POCKETWORLD_ACTIVATION_DELAY_MS ??= "5000";
process.env.POCKETWORLD_POLL_INTERVAL_MS ??= "300000";
process.env.POCKETWORLD_TIMEOUT_MS ??= "30000";
process.env.POCKETWORLD_DISPLAY_MAX_AGE_MS ??= "21600000";
process.env.POCKETWORLD_FRESH_AGE_MS ??= "1800000";
process.env.POCKETWORLD_MAX_AGE_MS ??= process.env.POCKETWORLD_DISPLAY_MAX_AGE_MS;
process.env.POCKETWORLD_MAX_VESSELS ??= "50000";
process.env.POCKETWORLD_CACHE_FLUSH_MS ??= "60000";
process.env.AISSTREAM_CACHE_FILE = join(process.env.RUNTIME_DATA_DIR, "ais-tracking-cache.json");
process.env.AISSTREAM_OPERATIONAL_CACHE_FILE = join(process.env.RUNTIME_DATA_DIR, "ais-operational-cache.json");
process.env.POCKETWORLD_CACHE_FILE = join(process.env.RUNTIME_DATA_DIR, "pocketworld-ais-cache.json");
process.env.ECOFAIR_STATE_FILE = join(process.env.RUNTIME_DATA_DIR, "ecofair-state.json");
process.env.CHMARL_EXPERIMENT_FILE ??= join(process.env.RUNTIME_DATA_DIR, "chmarl-episode.json");
process.env.PORT_EVENTS_FILE ??= join(process.env.RUNTIME_DATA_DIR, "port-events.json");
process.env.WEATHER_FILE ??= join(process.env.RUNTIME_DATA_DIR, "weather.json");
process.env.CHMARL_RUNTIME_ENABLED ??= "true";
process.env.ECOFAIR_OPERATIONAL_RADIUS_NM ??= "120";
process.env.ECOFAIR_MAX_VESSEL_AGE_MS ??= "1800000";
process.env.ECOFAIR_EMISSION_BUDGET_TONNES_PER_DAY ??= "0";
process.env.ECOFAIR_BUDGET_TONNES_PER_VESSEL_PER_DAY ??= "60";

console.log(`Starting production CH-MARL service on port ${process.env.PORT}`);
console.log("Vessel input policy: genuine live AIS only; AISStream is primary, Datalastic is optional port failover, and PocketWorld supplies a public regional AIS fallback. Manual, fixed, sample, and synthetic vessel rows are disabled.");
if (process.env.AISSTREAM_API_KEY?.trim()) console.log("AISStream API key loaded from environment.");
if (process.env.DATALASTIC_API_KEY?.trim()) console.log("Datalastic live AIS failover key loaded from environment.");
else console.log("Datalastic live AIS failover key is not configured.");
console.log(`PocketWorld public AIS fallback: ${process.env.POCKETWORLD_AIS_ENABLED}; complete-snapshot capacity ${process.env.POCKETWORLD_MAX_VESSELS}; display retention ${process.env.POCKETWORLD_DISPLAY_MAX_AGE_MS} ms; fresh threshold ${process.env.POCKETWORLD_FRESH_AGE_MS} ms.`);
console.log("PocketWorld pagination: server snapshot_id/cursor traversal is enabled by the provider adapter.");
console.log("Global AIS tracking: true");
console.log(`Global AIS BBOX: ${WORLD_AIS_BBOX}`);
console.log("AIS message filter: none on the primary world profile; recovery profiles reduce scope only after a silent socket.");
console.log("AIS silent-session recovery: enabled; first-frame timeout " + process.env.AISSTREAM_FIRST_FRAME_TIMEOUT_MS + " ms; silence timeout " + process.env.AISSTREAM_SILENCE_TIMEOUT_MS + " ms.");
console.log(`Operational AIS derivation: ${process.env.AISSTREAM_OPERATIONAL_PRIORITY_ENABLED}`);
console.log(`Runtime data directory: ${process.env.RUNTIME_DATA_DIR}`);
console.log(`EcoFair operational radius: ${process.env.ECOFAIR_OPERATIONAL_RADIUS_NM} nm`);

const child = spawn("node", ["server/vessel-feed-proxy/index.mjs"], {
  stdio: "inherit",
  env: process.env,
});

child.on("exit", (code, signal) => {
  if (signal) process.exit(0);
  process.exit(code ?? 0);
});
