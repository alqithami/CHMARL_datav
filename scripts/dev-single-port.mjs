import { existsSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

const REGIONAL_AIS_BBOX = "11,32;31,56";
const SAUDI_PORT_AIS_BBOXES = [
  "20.70,38.35;22.95,39.85", // Jeddah + King Abdullah Port approaches
  "23.25,37.15;24.90,38.90", // Yanbu approaches
  "16.15,41.75;17.55,43.35", // Jizan approaches
  "25.70,49.25;27.25,50.90", // Dammam / Ras Tanura approaches
  "24.35,54.35;25.65,55.75", // Jebel Ali reference
  "29.20,32.00;30.55,33.25", // Suez reference
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
}

function codespacesUrl(port) {
  const name = process.env.CODESPACE_NAME;
  const domain = process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN ?? "app.github.dev";
  return name ? `https://${name}-${port}.${domain}` : undefined;
}

function runBlocking(name, command, args, env = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      shell: process.platform === "win32",
      env: { ...process.env, ...env },
    });
    child.on("exit", (code, signal) => {
      if (signal) reject(new Error(`${name} exited by signal ${signal}`));
      else if (code && code !== 0) reject(new Error(`${name} exited with code ${code}`));
      else resolvePromise();
    });
  });
}

async function probe(name, url) {
  try {
    const response = await fetch(url, { headers: { Accept: "application/json,text/html" } });
    console.log(`${name} probe: ${response.status} ${response.statusText} · ${url}`);
  } catch (error) {
    console.log(`${name} probe failed: ${error instanceof Error ? error.message : String(error)} · ${url}`);
  }
}

loadEnvFile(".env");
loadEnvFile(".env.local");

process.env.PORT ??= "8787";
process.env.STATIC_DIR ??= "dist";
process.env.VITE_VESSEL_DATA_URL ??= "/api/vessels";
process.env.VITE_CHMARL_EXPERIMENT_URL ??= "/api/chmarl/episode";
process.env.VITE_PORT_EVENTS_URL ??= "/api/port-events";
process.env.VITE_PORT_EVENTS_DEMO_ENABLED ??= "true";
process.env.VITE_WEATHER_URL ??= "/api/weather";
process.env.VITE_ALLOW_SAMPLE_DATA ??= "false";
process.env.VITE_ALLOW_SAMPLE_CHMARL ??= "false";
process.env.AISSTREAM_BBOX ??= REGIONAL_AIS_BBOX;
process.env.AISSTREAM_APPEND_SAUDI_PORT_BBOXES ??= "true";
if (process.env.AISSTREAM_APPEND_SAUDI_PORT_BBOXES !== "false" || process.env.AISSTREAM_USE_SAUDI_PORT_BBOXES === "true") {
  process.env.AISSTREAM_BBOX = mergeBboxText(process.env.AISSTREAM_BBOX, SAUDI_PORT_AIS_BBOXES);
  process.env.AISSTREAM_USE_SAUDI_PORT_BBOXES = "false";
}
process.env.AISSTREAM_FILTER_TYPES ??= "";
process.env.AISSTREAM_MAX_VESSELS ??= "750";
process.env.AISSTREAM_MAX_AGE_MS ??= String(6 * 60 * 60 * 1000);
process.env.CHMARL_RUNTIME_ENABLED ??= "true";
process.env.PORT_EVENTS_FILE_ENABLED ??= "false";
process.env.WEATHER_FILE_ENABLED ??= "false";

const port = process.env.PORT;
const forwardedUrl = codespacesUrl(port);

console.log("Building dashboard for single-port Codespaces service...");
await runBlocking("vite build", "pnpm", ["exec", "vite", "build"], {
  VITE_VESSEL_DATA_URL: process.env.VITE_VESSEL_DATA_URL,
  VITE_CHMARL_EXPERIMENT_URL: process.env.VITE_CHMARL_EXPERIMENT_URL,
  VITE_PORT_EVENTS_URL: process.env.VITE_PORT_EVENTS_URL,
  VITE_PORT_EVENTS_DEMO_ENABLED: process.env.VITE_PORT_EVENTS_DEMO_ENABLED,
  VITE_WEATHER_URL: process.env.VITE_WEATHER_URL,
  VITE_ALLOW_SAMPLE_DATA: process.env.VITE_ALLOW_SAMPLE_DATA,
  VITE_ALLOW_SAMPLE_CHMARL: process.env.VITE_ALLOW_SAMPLE_CHMARL,
});

console.log(`Starting single-port CH-MARL portal on port ${port}`);
console.log(process.env.AISSTREAM_API_KEY ? "AISStream API key loaded from environment." : "AISStream API key is missing; vessel feed will wait until configured.");
console.log(`AISStream bounding boxes: ${process.env.AISSTREAM_BBOX?.split("|").length ?? 0}`);
console.log(`AISStream Saudi boxes appended: ${process.env.AISSTREAM_APPEND_SAUDI_PORT_BBOXES !== "false" ? "yes" : "no"}`);
console.log(`AISStream filters: ${process.env.AISSTREAM_FILTER_TYPES || "none"}`);
console.log(`Port event demo: ${process.env.VITE_PORT_EVENTS_DEMO_ENABLED}`);
if (forwardedUrl) console.log(`Single-port portal URL: ${forwardedUrl}/`);
console.log(`Open forwarded port ${port} for the full portal and APIs.`);
console.log("The portal process now runs in the foreground; this terminal should not return to a shell prompt until you stop it with Ctrl+C.");

setTimeout(() => {
  void probe("Single-port portal", `http://127.0.0.1:${port}/`);
  void probe("Backend health", `http://127.0.0.1:${port}/health`);
}, 2500).unref?.();

await import("../server/vessel-feed-proxy/index.mjs");
