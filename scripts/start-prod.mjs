import { existsSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

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
process.env.AISSTREAM_TRACKING_BBOX ??= "-90,-180;90,180";
process.env.AISSTREAM_FILTER_TYPES ??= "PositionReport,StandardClassBPositionReport,ExtendedClassBPositionReport";
process.env.AISSTREAM_MAX_VESSELS ??= "5000";
process.env.AISSTREAM_MAX_AGE_MS ??= String(6 * 60 * 60 * 1000);
process.env.AISSTREAM_TRAIL_POINTS ??= "12";
process.env.AISSTREAM_CACHE_ENABLED ??= "true";
process.env.ECOFAIR_OPERATIONAL_RADIUS_NM ??= "120";
process.env.ECOFAIR_EMISSION_BUDGET_TONNES_PER_DAY ??= "0";
process.env.ECOFAIR_BUDGET_TONNES_PER_VESSEL_PER_DAY ??= "60";
process.env.CHMARL_RUNTIME_ENABLED ??= "true";

console.log(`Starting production CH-MARL service on port ${process.env.PORT}`);
console.log(`Runtime data directory: ${process.env.RUNTIME_DATA_DIR}`);
console.log(`AIS tracking mode: ${process.env.AISSTREAM_GLOBAL_TRACKING_ENABLED === "false" ? "regional" : "global"}`);
console.log(`AIS tracking BBOX: ${process.env.AISSTREAM_TRACKING_BBOX}`);
console.log(`AIS cache capacity: ${process.env.AISSTREAM_MAX_VESSELS}`);
console.log(`EcoFair operational radius: ${process.env.ECOFAIR_OPERATIONAL_RADIUS_NM} nm`);
if (process.env.AISSTREAM_API_KEY) console.log("AISStream API key loaded from environment.");

const child = spawn("node", ["server/vessel-feed-proxy/index.mjs"], {
  stdio: "inherit",
  env: process.env,
});

child.on("exit", (code, signal) => {
  if (signal) process.exit(0);
  process.exit(code ?? 0);
});
