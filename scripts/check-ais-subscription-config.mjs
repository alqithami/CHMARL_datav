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

function parseBoxes(text) {
  return String(text ?? "")
    .split("|")
    .filter(Boolean)
    .map((box) => box.split(";").map((corner) => corner.split(",").map((value) => Number(value.trim()))));
}

loadEnvFile(".env");
loadEnvFile(".env.local");

const useFocused = process.env.AISSTREAM_USE_SAUDI_PORT_BBOXES === "true";
const bbox = process.env.AISSTREAM_BBOX ?? "11,32;31,56";
const filters = process.env.AISSTREAM_FILTER_TYPES ?? "";
const boxes = parseBoxes(bbox);

console.log("AIS subscription configuration");
console.log("-".repeat(72));
console.log(`keyLoaded=${Boolean(process.env.AISSTREAM_API_KEY)}`);
console.log(`useFocusedSaudiBoxes=${useFocused}`);
console.log(`bboxText=${bbox}`);
console.log(`boxCount=${boxes.length}`);
console.log(`filters=${filters || "none"}`);
console.log(`maxVessels=${process.env.AISSTREAM_MAX_VESSELS ?? "750"}`);
console.log(`maxAgeMs=${process.env.AISSTREAM_MAX_AGE_MS ?? String(6 * 60 * 60 * 1000)}`);

if (useFocused) console.log("WARN: focused Saudi boxes recently returned no messages in diagnostics; broad regional mode is recommended until validated.");
if (filters) console.log("WARN: message filters may hide valid provider messages; empty AISSTREAM_FILTER_TYPES is recommended.");
if (!process.env.AISSTREAM_API_KEY) process.exit(1);
