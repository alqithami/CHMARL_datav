#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

function loadEnvFile(fileName) {
  const filePath = resolve(process.cwd(), fileName);
  if (!existsSync(filePath)) return false;
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const equals = trimmed.indexOf("=");
    if (equals === -1) continue;
    const key = trimmed.slice(0, equals).trim();
    let value = trimmed.slice(equals + 1).trim();
    if (!key || process.env[key] !== undefined) continue;
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[key] = value;
  }
  return true;
}

const loaded = [".env", ".env.local"].filter(loadEnvFile);
const checks = [
  ["AISSTREAM_API_KEY", Boolean(process.env.AISSTREAM_API_KEY), "required for live AIS"],
  ["AISSTREAM_BBOX", Boolean(process.env.AISSTREAM_BBOX), "defaults to validated broad regional box when absent"],
  ["AISSTREAM_FILTER_TYPES", process.env.AISSTREAM_FILTER_TYPES === "" || process.env.AISSTREAM_FILTER_TYPES === undefined, "empty is recommended"],
  ["VITE_PORT_EVENTS_DEMO_ENABLED", process.env.VITE_PORT_EVENTS_DEMO_ENABLED !== "false", "true keeps Kpler-like demo visible"],
  ["VITE_ALLOW_SAMPLE_DATA", process.env.VITE_ALLOW_SAMPLE_DATA !== "true", "false avoids bundled fixture data"],
];

console.log("CH-MARL portal environment check");
console.log("-".repeat(64));
console.log(`Loaded files: ${loaded.join(", ") || "none"}`);
console.log(`PORT: ${process.env.PORT ?? "8787"}`);
console.log(`VITE_PORT: ${process.env.VITE_PORT ?? "5173"}`);
console.log(`VITE_MIRROR_PORT: ${process.env.VITE_MIRROR_PORT ?? "3000"}`);
console.log(`AISSTREAM_USE_SAUDI_PORT_BBOXES: ${process.env.AISSTREAM_USE_SAUDI_PORT_BBOXES ?? "false"}`);
console.log(`AISSTREAM_BBOX: ${process.env.AISSTREAM_BBOX ?? "11,32;31,56"}`);
console.log(`AISSTREAM_FILTER_TYPES: ${process.env.AISSTREAM_FILTER_TYPES ?? ""}`);
console.log("-".repeat(64));

let failures = 0;
for (const [name, ok, note] of checks) {
  console.log(`${ok ? "OK  " : "WARN"} ${name.padEnd(32)} ${note}`);
  if (!ok && name === "AISSTREAM_API_KEY") failures += 1;
}

if (failures > 0) process.exit(1);
