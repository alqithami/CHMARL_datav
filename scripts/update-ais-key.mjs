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

const requiredDefaults = new Map([
  ["AISSTREAM_API_KEY", newKey],
  ["AISSTREAM_URL", "wss://stream.aisstream.io/v0/stream"],
  ["AISSTREAM_FORCE_REGIONAL_BBOX", "true"],
  ["AISSTREAM_BBOX", "11,32;31,56"],
  ["AISSTREAM_APPEND_SAUDI_PORT_BBOXES", "true"],
  ["AISSTREAM_USE_SAUDI_PORT_BBOXES", "false"],
  ["AISSTREAM_FILTER_TYPES", ""],
  ["AISSTREAM_MAX_VESSELS", "750"],
  ["AISSTREAM_MAX_AGE_MS", "21600000"],
  ["AISSTREAM_TRAIL_POINTS", "24"],
  ["AISSTREAM_CACHE_ENABLED", "true"],
  ["RUNTIME_CACHE_SCOPE", "bbox"],
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
console.log("AISSTREAM_BBOX=11,32;31,56");
console.log("AISSTREAM_APPEND_SAUDI_PORT_BBOXES=true");
console.log("AISSTREAM_FORCE_REGIONAL_BBOX=true");
console.log("Next: pnpm cache:clear -- --yes, then restart pnpm dev:proxy.");
