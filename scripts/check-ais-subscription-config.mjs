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

function parseBoxes(text) {
  return String(text ?? "")
    .split("|")
    .filter(Boolean)
    .map((box) => box.split(";").map((corner) => corner.split(",").map((value) => Number(value.trim()))));
}

loadEnvFile(".env");
loadEnvFile(".env.local");

const regionalBbox = "11,32;31,56";
const focusedBbox = [
  "20.70,38.35;22.95,39.85",
  "23.25,37.15;24.90,38.90",
  "16.15,41.75;17.55,43.35",
  "25.70,49.25;27.25,50.90",
  "24.35,54.35;25.65,55.75",
  "29.20,32.00;30.55,33.25",
].join("|");

const legacyFocused = process.env.AISSTREAM_USE_SAUDI_PORT_BBOXES === "true";
const appendSaudi = process.env.AISSTREAM_APPEND_SAUDI_PORT_BBOXES !== "false" || legacyFocused;
const baseBbox = process.env.AISSTREAM_BBOX ?? regionalBbox;
const effectiveBbox = appendSaudi ? mergeBboxText(baseBbox, focusedBbox) : baseBbox;
const filters = process.env.AISSTREAM_FILTER_TYPES ?? "";
const boxes = parseBoxes(effectiveBbox);

console.log("AIS subscription configuration");
console.log("-".repeat(72));
console.log(`keyLoaded=${Boolean(process.env.AISSTREAM_API_KEY)}`);
console.log(`legacyFocusedSaudiFlag=${legacyFocused}`);
console.log(`appendSaudiPortBoxes=${appendSaudi}`);
console.log(`baseBboxText=${baseBbox}`);
console.log(`effectiveBboxText=${effectiveBbox}`);
console.log(`boxCount=${boxes.length}`);
console.log(`filters=${filters || "none"}`);
console.log(`maxVessels=${process.env.AISSTREAM_MAX_VESSELS ?? "750"}`);
console.log(`maxAgeMs=${process.env.AISSTREAM_MAX_AGE_MS ?? String(6 * 60 * 60 * 1000)}`);

if (legacyFocused) console.log("INFO: AISSTREAM_USE_SAUDI_PORT_BBOXES=true is now treated by dev scripts as append-focused-boxes, not replace-regional-box.");
if (!appendSaudi) console.log("WARN: Saudi port approach boxes are not appended; set AISSTREAM_APPEND_SAUDI_PORT_BBOXES=true for port coverage.");
if (filters) console.log("WARN: message filters may hide valid provider messages; empty AISSTREAM_FILTER_TYPES is recommended.");
if (!process.env.AISSTREAM_API_KEY) process.exit(1);
