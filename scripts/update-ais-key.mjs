#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const envPath = resolve(process.env.AIS_ENV_FILE ?? ".env.local");
const newKey = process.env.AISSTREAM_API_KEY_NEW?.trim();

if (!newKey) {
  console.error("Missing AISSTREAM_API_KEY_NEW. Usage:");
  console.error("  read -rsp 'New AISStream key: ' AISSTREAM_API_KEY_NEW; echo; export AISSTREAM_API_KEY_NEW; pnpm run env:ais-key; unset AISSTREAM_API_KEY_NEW");
  process.exit(2);
}

const operationalBbox = [
  "11,32;31,56",
  "20.70,38.35;22.95,39.85",
  "23.25,37.15;24.90,38.90",
  "16.15,41.75;17.55,43.35",
  "25.70,49.25;27.25,50.90",
  "24.35,54.35;25.65,55.75",
  "29.20,32.00;30.55,33.25",
].join("|");

const requiredDefaults = new Map([
  ["AISSTREAM_API_KEY", newKey],
  ["AISSTREAM_URL", "wss://stream.aisstream.io/v0/stream"],
  ["AISSTREAM_GLOBAL_TRACKING_ENABLED", "true"],
  ["AISSTREAM_TRACKING_BBOX", "-90,-180;90,180"],
  ["AISSTREAM_FILTER_TYPES", "PositionReport,StandardClassBPositionReport,ExtendedClassBPositionReport"],
  ["AISSTREAM_OPERATIONAL_PRIORITY_ENABLED", "true"],
  ["AISSTREAM_OPERATIONAL_BBOX", operationalBbox],
  ["AISSTREAM_OPERATIONAL_FILTER_TYPES", "PositionReport,StandardClassBPositionReport,ExtendedClassBPositionReport,LongRangeAisBroadcastMessage"],
  ["AISSTREAM_MAX_VESSELS", "8000"],
  ["AISSTREAM_OPERATIONAL_MAX_VESSELS", "2500"],
  ["AISSTREAM_MAX_AGE_MS", "21600000"],
  ["AISSTREAM_TRAIL_POINTS", "12"],
  ["AISSTREAM_MAX_IMPLIED_SPEED_KN", "120"],
  ["AISSTREAM_CACHE_ENABLED", "true"],
  ["RUNTIME_DATA_DIR", ".runtime"],
  ["ECOFAIR_OPERATIONAL_RADIUS_NM", "120"],
  ["VITE_REQUIRE_OPERATIONAL_REGION", "false"],
]);

const obsoleteKeys = new Set([
  "AISSTREAM_FORCE_REGIONAL_BBOX",
  "AISSTREAM_USE_SAUDI_PORT_BBOXES",
  "AISSTREAM_APPEND_SAUDI_PORT_BBOXES",
  "AISSTREAM_BBOX",
  "RUNTIME_CACHE_SCOPE",
]);

const existingLines = existsSync(envPath) ? readFileSync(envPath, "utf8").split(/\r?\n/) : [];
const seen = new Set();
const nextLines = [];

for (const line of existingLines) {
  const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
  if (!match) {
    if (line.trim()) nextLines.push(line);
    continue;
  }
  const key = match[1];
  if (obsoleteKeys.has(key)) continue;
  if (requiredDefaults.has(key)) {
    nextLines.push(`${key}=${requiredDefaults.get(key)}`);
    seen.add(key);
  } else {
    nextLines.push(line);
  }
}

for (const [key, value] of requiredDefaults) {
  if (!seen.has(key)) nextLines.push(`${key}=${value}`);
}

mkdirSync(dirname(envPath), { recursive: true });
if (existsSync(envPath)) {
  const backup = `${envPath}.backup-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  renameSync(envPath, backup);
  console.log(`Backed up old env file to ${backup}`);
}
writeFileSync(envPath, `${nextLines.join("\n")}\n`, { mode: 0o600 });

console.log(`Updated ${envPath}`);
console.log("AISSTREAM_API_KEY=<redacted>");
console.log("AISSTREAM_GLOBAL_TRACKING_ENABLED=true");
console.log("AISSTREAM_TRACKING_BBOX=-90,-180;90,180");
console.log("AISSTREAM_OPERATIONAL_PRIORITY_ENABLED=true");
console.log(`AISSTREAM_OPERATIONAL_BBOX=${operationalBbox}`);
console.log("ECOFAIR_OPERATIONAL_RADIUS_NM=120");
console.log("Next: restart pnpm dev:proxy. Clear runtime state only if you intentionally want to discard cached tracking/history.");
