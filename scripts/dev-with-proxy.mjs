import { createServer } from "node:http";
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

function codespacesUrl(port) {
  const name = process.env.CODESPACE_NAME;
  const domain = process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN ?? "app.github.dev";
  return name ? `https://${name}-${port}.${domain}` : undefined;
}

async function probe(name, url) {
  try {
    const response = await fetch(url, { headers: { Accept: "application/json,text/html" } });
    console.log(`${name} probe: ${response.status} ${response.statusText} · ${url}`);
  } catch (error) {
    console.log(`${name} probe failed: ${error instanceof Error ? error.message : String(error)} · ${url}`);
  }
}

async function readRequestBody(request) {
  if (request.method === "GET" || request.method === "HEAD") return undefined;
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return chunks.length > 0 ? Buffer.concat(chunks) : undefined;
}

function filteredHeaders(headers) {
  const next = {};
  for (const [key, value] of headers.entries()) {
    const lower = key.toLowerCase();
    if (["connection", "content-encoding", "content-length", "transfer-encoding"].includes(lower)) continue;
    next[key] = value;
  }
  return next;
}

loadEnvFile(".env");
loadEnvFile(".env.local");

process.env.PORT ??= "8787";
process.env.VITE_PORT ??= "5173";
process.env.VITE_MIRROR_PORT ??= "3000";
process.env.VITE_PROXY_TARGET ??= `http://localhost:${process.env.PORT}`;
process.env.VITE_VESSEL_DATA_URL ??= "/api/vessels";
process.env.VITE_CHMARL_EXPERIMENT_URL ??= "/api/chmarl/episode";
process.env.VITE_PORT_EVENTS_URL ??= "/api/port-events";
process.env.VITE_WEATHER_URL ??= "/api/weather";
process.env.VITE_ALLOW_SAMPLE_DATA ??= "false";
process.env.VITE_ALLOW_SAMPLE_CHMARL ??= "false";
process.env.VITE_PORT_EVENTS_DEMO_ENABLED ??= "false";
process.env.VITE_REQUIRE_OPERATIONAL_REGION ??= "false";
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
process.env.PORT_EVENTS_FILE_ENABLED ??= "false";
process.env.WEATHER_FILE_ENABLED ??= "false";

const proxyPort = process.env.PORT;
const dashboardPort = process.env.VITE_PORT;
const viteProxyTarget = process.env.VITE_PROXY_TARGET;
const dashboardForwardUrl = codespacesUrl(dashboardPort);
const backendForwardUrl = codespacesUrl(proxyPort);
const processes = [];

function run(name, command, args, env = {}) {
  const child = spawn(command, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...process.env, ...env },
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

function startDashboardMirror() {
  const mirrorPort = Number(process.env.VITE_MIRROR_PORT ?? 3000);
  if (!mirrorPort || String(mirrorPort) === String(dashboardPort)) return;
  const server = createServer(async (request, response) => {
    const target = `http://127.0.0.1:${dashboardPort}${request.url ?? "/"}`;
    try {
      const body = await readRequestBody(request);
      const upstream = await fetch(target, { method: request.method, headers: request.headers, body, redirect: "manual" });
      const payload = Buffer.from(await upstream.arrayBuffer());
      response.writeHead(upstream.status, filteredHeaders(upstream.headers));
      response.end(payload);
    } catch (error) {
      response.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
      response.end(`Dashboard mirror could not reach Vite on ${dashboardPort}: ${error instanceof Error ? error.message : String(error)}\n`);
    }
  });
  server.listen(mirrorPort, "0.0.0.0", () => {
    const mirrorForwardUrl = codespacesUrl(mirrorPort);
    console.log(`Dashboard mirror listening on port ${mirrorPort}`);
    if (mirrorForwardUrl) console.log(`Dashboard mirror forwarded URL: ${mirrorForwardUrl}/`);
  });
  processes.push({ killed: false, kill: () => server.close() });
}

function shutdown(code = 0) {
  for (const proc of processes) {
    try { proc.kill?.(); } catch { /* already closed */ }
  }
  process.exit(code);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

console.log(`Starting CH-MARL backend on port ${proxyPort}`);
if (process.env.AISSTREAM_API_KEY) console.log("AISStream API key loaded from environment.");
console.log(`AIS tracking mode: ${process.env.AISSTREAM_GLOBAL_TRACKING_ENABLED === "false" ? "regional" : "global"}`);
console.log(`AIS tracking BBOX: ${process.env.AISSTREAM_TRACKING_BBOX}`);
console.log(`AIS cache capacity: ${process.env.AISSTREAM_MAX_VESSELS}`);
console.log(`Runtime data directory: ${process.env.RUNTIME_DATA_DIR}`);
console.log(`EcoFair operational radius: ${process.env.ECOFAIR_OPERATIONAL_RADIUS_NM} nm`);
if (backendForwardUrl) console.log(`Backend forwarded URL: ${backendForwardUrl}/health`);
run("backend", "node", ["server/vessel-feed-proxy/index.mjs"]);

console.log(`Starting dashboard on port ${dashboardPort}`);
console.log(`Using frontend vessel feed path: ${process.env.VITE_VESSEL_DATA_URL}`);
console.log(`Proxying Vite API calls to: ${viteProxyTarget}`);
if (dashboardForwardUrl) console.log(`Dashboard forwarded URL: ${dashboardForwardUrl}/`);
console.log(`Open the forwarded Codespaces port ${dashboardPort} for the dashboard UI.`);
run("vite", "pnpm", ["exec", "vite", "--host", "0.0.0.0", "--port", String(dashboardPort), "--strictPort"]);
startDashboardMirror();

setTimeout(() => {
  void probe("Backend", `http://127.0.0.1:${proxyPort}/health`);
  void probe("Dashboard", `http://127.0.0.1:${dashboardPort}/`);
  if (process.env.VITE_MIRROR_PORT !== "false") void probe("Dashboard mirror", `http://127.0.0.1:${process.env.VITE_MIRROR_PORT ?? 3000}/`);
}, 2500).unref?.();
