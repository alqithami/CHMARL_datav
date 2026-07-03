import { existsSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

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

    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}

loadEnvFile(".env");
loadEnvFile(".env.local");

process.env.STATIC_DIR ??= "dist";
process.env.PORT ??= "8787";
process.env.AISSTREAM_BBOX ??= REGIONAL_AIS_BBOX;
process.env.AISSTREAM_APPEND_SAUDI_PORT_BBOXES ??= "true";
if (process.env.AISSTREAM_APPEND_SAUDI_PORT_BBOXES !== "false" || process.env.AISSTREAM_USE_SAUDI_PORT_BBOXES === "true") {
  process.env.AISSTREAM_BBOX = mergeBboxText(process.env.AISSTREAM_BBOX, SAUDI_PORT_AIS_BBOXES);
  process.env.AISSTREAM_USE_SAUDI_PORT_BBOXES = "false";
}

console.log(`Starting production CH-MARL service on port ${process.env.PORT}`);
if (process.env.AISSTREAM_API_KEY) console.log("AISStream API key loaded from environment.");
console.log(`AISStream bounding boxes: ${process.env.AISSTREAM_BBOX?.split("|").length ?? 0}`);
console.log(`AISStream Saudi boxes appended: ${process.env.AISSTREAM_APPEND_SAUDI_PORT_BBOXES !== "false" ? "yes" : "no"}`);

const child = spawn("node", ["server/vessel-feed-proxy/index.mjs"], {
  stdio: "inherit",
  env: process.env,
});

child.on("exit", (code, signal) => {
  if (signal) process.exit(0);
  process.exit(code ?? 0);
});
