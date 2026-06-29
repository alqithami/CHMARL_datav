import { existsSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

const SAUDI_PORT_AIS_BBOX = [
  "20.70,38.35;22.95,39.85", // Jeddah + King Abdullah Port
  "23.25,37.15;24.90,38.90", // Yanbu
  "16.15,41.75;17.55,43.35", // Jizan
  "25.70,49.25;27.25,50.90", // Dammam / Ras Tanura approaches
  "24.35,54.35;25.65,55.75", // Jebel Ali / UAE Gulf reference
  "29.20,32.00;30.55,33.25", // Suez reference
].join("|");

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

if (process.env.AISSTREAM_USE_SAUDI_PORT_BBOXES !== "false") {
  process.env.AISSTREAM_BBOX = SAUDI_PORT_AIS_BBOX;
}

const proxyPort = process.env.PORT ?? "8787";
const dashboardPort = process.env.VITE_PORT ?? "5173";
const vesselFeedUrl = process.env.VITE_VESSEL_DATA_URL ?? "/api/vessels";
const viteProxyTarget = process.env.VITE_PROXY_TARGET ?? `http://localhost:${proxyPort}`;

const processes = [];

function run(name, command, args, env = {}) {
  const child = spawn(command, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: {
      ...process.env,
      ...env,
    },
  });

  child.on("exit", (code, signal) => {
    if (signal) return;
    if (code && code !== 0) {
      console.error(`${name} exited with code ${code}`);
      shutdown(code);
    }
  });

  processes.push(child);
  return child;
}

function shutdown(code = 0) {
  for (const child of processes) {
    if (!child.killed) child.kill("SIGTERM");
  }
  process.exit(code);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
process.on("exit", () => {
  for (const child of processes) {
    if (!child.killed) child.kill("SIGTERM");
  }
});

console.log(`Starting vessel proxy on port ${proxyPort}`);
if (process.env.AISSTREAM_API_KEY) console.log("AISStream API key loaded from environment.");
console.log(`AISStream bounding boxes: ${process.env.AISSTREAM_BBOX?.split("|").length ?? 0}`);
run("vessel-feed-proxy", "node", ["server/vessel-feed-proxy/index.mjs"], {
  PORT: proxyPort,
});

console.log(`Starting dashboard on port ${dashboardPort}`);
console.log(`Using frontend vessel feed path: ${vesselFeedUrl}`);
console.log(`Proxying Vite API calls to: ${viteProxyTarget}`);
console.log(`Open the forwarded Codespaces port ${dashboardPort} for the dashboard UI.`);
run("vite", "pnpm", ["exec", "vite", "--host", "0.0.0.0", "--port", dashboardPort, "--strictPort"], {
  VITE_VESSEL_DATA_URL: vesselFeedUrl,
  VITE_PROXY_TARGET: viteProxyTarget,
});
