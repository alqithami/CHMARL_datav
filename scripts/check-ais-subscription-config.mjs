#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

function loadEnvFile(fileName) {
  const path = resolve(fileName);
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
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
}

loadEnvFile(".env");
loadEnvFile(".env.local");

console.log("AIS-only subscription configuration");
console.log("-".repeat(72));
console.log(`keyLoaded=${Boolean(process.env.AISSTREAM_API_KEY?.trim())}`);
console.log("trackingMode=global");
console.log("boundingBoxes=-90,-180;90,180");
console.log("filters=none");
console.log(`maxVessels=${process.env.AISSTREAM_MAX_VESSELS ?? "20000"}`);
console.log("vesselSources=aisstream-only");

if (!process.env.AISSTREAM_API_KEY?.trim()) process.exit(1);
