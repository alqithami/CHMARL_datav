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
  const content = readFileSync(filePath, "utf8");
  for (const line of content.split(/\r?\n/)) {
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

process.env.STATIC_DIR ??= "dist";
process.env.PORT ??= "8787";
process.env.RUNTIME_DATA_DIR ??= ".runtime";
process.env.AISSTREAM_GLOBAL_TRACKING_ENABLED ??= "true";
process.env.AISSTREAM_TRACKING_BBOX ??= WORLD_AIS_BBOX;
process.env.AISSTREAM_OPERATIONAL_PRIORITY_ENABLED ??= "true";
process.env.AISSTREAM_OPERATIONAL_BBOX ??= mergeBboxText(REGIONAL_AIS_BBOX, SAUDI_PORT_AIS_BBOXES);
process.env.AISSTREAM_FILTER_TYPES ??= "PositionReport,StandardClassBPositionReport,ExtendedClassBPositionReport";
process.env.AISSTREAM_OPERATIONAL_FILTER_TYPES ??= "PositionReport,StandardClassBPositionReport,ExtendedClassBPositionReport,LongRangeAisBroadcastMessage";
process.env.AISSTREAM_MAX_VESSELS ??= "8000";
process.env.AISSTREAM_OPERATIONAL_MAX_VESSELS ??= "2500";
process.env.AISSTREAM_MAX_AGE_MS ??= String(6 * 60 * 60 * 1000);
process.env.AISSTREAM_TRAIL_POINTS ??= "12";
process.env.AISSTREAM_CACHE_ENABLED ??= "true";
process.env.AISSTREAM_CACHE_FLUSH_MS ??= "15000";
process.env.AISSTREAM_CACHE_FILE ??= join(process.env.RUNTIME_DATA_DIR, "ais-tracking-cache.json");
process.env.AISSTREAM_OPERATIONAL_CACHE_FILE ??= join(process.env.RUNTIME_DATA_DIR, "ais-operational-cache.json");
process.env.ECOFAIR_STATE_FILE ??= join(process.env.RUNTIME_DATA_DIR, "ecofair-state.json");
process.env.FIXED_VESSEL_DATA_FILE ??= join(process.env.RUNTIME_DATA_DIR, "manual-vessels.json");
process.env.CHMARL_EXPERIMENT_FILE ??= join(process.env.RUNTIME_DATA_DIR, "chmarl-episode.json");
process.env.PORT_EVENTS_FILE ??= join(process.env.RUNTIME_DATA_DIR, "port-events.json");
process.env.WEATHER_FILE ??= join(process.env.RUNTIME_DATA_DIR, "weather.json");
process.env.CHMARL_RUNTIME_ENABLED ??= "true";
process.env.ECOFAIR_OPERATIONAL_RADIUS_NM ??= "120";
process.env.ECOFAIR_EMISSION_BUDGET_TONNES_PER_DAY ??= "0";
process.env.ECOFAIR_BUDGET_TONNES_PER_VESSEL_PER_DAY ??= "60";

console.log(`Starting production CH-MARL service on port ${process.env.PORT}`);
if (process.env.AISSTREAM_API_KEY) console.log("AISStream API key loaded from environment.");
console.log(`Global AIS tracking: ${process.env.AISSTREAM_GLOBAL_TRACKING_ENABLED}`);
console.log(`Global AIS BBOX: ${process.env.AISSTREAM_TRACKING_BBOX}`);
console.log(`Operational AIS priority: ${process.env.AISSTREAM_OPERATIONAL_PRIORITY_ENABLED}`);
console.log(`Operational AIS boxes: ${process.env.AISSTREAM_OPERATIONAL_BBOX.split("|").length}`);
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
