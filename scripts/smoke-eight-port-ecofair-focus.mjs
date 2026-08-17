import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { WebSocketServer } from "ws";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function availablePort() {
  return new Promise((resolve, reject) => {
    const server = createNetServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("Could not allocate a test port"));
      const port = address.port;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function fetchJsonUntil(url, predicate) {
  let last;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      const response = await fetch(url);
      const json = await response.json();
      last = { response, json };
      if (predicate(response, json)) return last;
    } catch (error) {
      last = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${url}: ${last instanceof Error ? last.message : JSON.stringify(last?.json)}`);
}

const runtimeDir = mkdtempSync(join(tmpdir(), "chmarl-eight-port-focus-"));
const weatherFile = join(runtimeDir, "weather.json");
writeFileSync(weatherFile, JSON.stringify({ points: [] }));
const backendPort = await availablePort();
const websocketPort = await availablePort();
const publicAisPort = await availablePort();
const output = [];

const websocketServer = new WebSocketServer({ host: "127.0.0.1", port: websocketPort });
websocketServer.on("connection", (socket) => socket.on("message", () => {}));

const publicAisServer = createHttpServer((request, response) => {
  const requestUrl = new URL(request.url ?? "/", `http://127.0.0.1:${publicAisPort}`);
  if (requestUrl.pathname !== "/api/ships") {
    response.writeHead(404).end();
    return;
  }
  const observedAt = new Date().toISOString();
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify({
    connected: true,
    sources: ["test-live-ais"],
    working_sources: ["test-live-ais"],
    coverage: { scope: "test-multi-region", worldwide_ready: false },
    ships: [
      { mmsi: 111111111, name: "JEDDAH LIVE TEST", lat: 21.49, lng: 39.19, sog: 0.2, nav_status: 5, source: "test-live-ais", observed_at: observedAt },
      { mmsi: 222222222, name: "KAP LIVE TEST", lat: 22.39, lng: 39.10, sog: 8.0, nav_status: 0, source: "test-live-ais", observed_at: observedAt },
      { mmsi: 333333333, name: "GLOBAL LIVE TEST", lat: 60.10, lng: 24.90, sog: 6.0, nav_status: 0, source: "test-live-ais", observed_at: observedAt },
    ],
  }));
});
await new Promise((resolve) => publicAisServer.listen(publicAisPort, "127.0.0.1", resolve));

const env = {
  ...process.env,
  NODE_ENV: "test",
  PORT: String(backendPort),
  STATIC_DIR: "dist",
  RUNTIME_DATA_DIR: runtimeDir,
  AISSTREAM_API_KEY: "test-key",
  AISSTREAM_URL: `ws://127.0.0.1:${websocketPort}`,
  AISSTREAM_HEARTBEAT_MS: "500",
  AISSTREAM_FIRST_FRAME_TIMEOUT_MS: "700",
  AISSTREAM_SILENCE_TIMEOUT_MS: "5000",
  AISSTREAM_CACHE_ENABLED: "false",
  DATALASTIC_AIS_ENABLED: "false",
  POCKETWORLD_AIS_ENABLED: "true",
  POCKETWORLD_API_URL: `http://127.0.0.1:${publicAisPort}/api/ships`,
  POCKETWORLD_ACTIVATION_DELAY_MS: "250",
  POCKETWORLD_POLL_INTERVAL_MS: "5000",
  POCKETWORLD_TIMEOUT_MS: "1000",
  POCKETWORLD_MAX_AGE_MS: "3600000",
  CHMARL_RUNTIME_ENABLED: "true",
  ECOFAIR_TICK_MS: "1000",
  CHMARL_HISTORY_MIN_INTERVAL_MS: "1000",
  WEATHER_FILE_ENABLED: "true",
  WEATHER_FILE: weatherFile,
};

const child = spawn(process.execPath, ["server/vessel-feed-proxy/index.mjs"], {
  env,
  stdio: ["ignore", "pipe", "pipe"],
});
child.stdout.on("data", (chunk) => output.push(chunk.toString()));
child.stderr.on("data", (chunk) => output.push(chunk.toString()));

try {
  const baseUrl = `http://127.0.0.1:${backendPort}`;
  const { json: tracking } = await fetchJsonUntil(`${baseUrl}/api/vessels`, (_response, json) => json?.counts?.tracking === 3);
  assert(tracking.vessels.length === 3, "Global tracking cohort was reduced");
  assert(tracking.counts.operational === 2, "Eight-port operational scope should contain the two primary-port rows");
  assert(tracking.counts.primaryOperational === 2, "Primary-port count should contain Jeddah and KAP rows");
  assert(tracking.inputs.portfolioOperationalRows === 2, "Portfolio scope counter was not exposed");

  const primary = await fetch(`${baseUrl}/api/vessels?scope=primary`).then((response) => response.json());
  assert(primary.scope === "primary", "Primary scope label is missing");
  assert(primary.vessels.length === 2, "Primary scope did not isolate Jeddah and KAP rows");

  const health = await fetch(`${baseUrl}/health`).then((response) => response.json());
  assert(health.operationalScope.ports.length === 8, "The operational portfolio does not contain eight ports");
  assert(health.operationalScope.ports.includes("Jubail Commercial Port"), "Jubail is missing from the eight-port portfolio");
  assert(health.operationalScope.primaryRows === 2, "Health did not expose primary-port rows");

  const { json: episode } = await fetchJsonUntil(`${baseUrl}/api/chmarl/episode`, (response, json) => response.status === 200 && json?.steps?.length > 0);
  const latest = episode.steps.at(-1);
  assert(latest.state.trackingVessels === 3, "CH-MARL step did not retain the full tracking count");
  assert(latest.state.portfolioOperationalVessels === 2, "CH-MARL step did not use the eight-port operational fleet");
  assert(latest.state.primaryOperationalVessels === 2, "CH-MARL step did not expose the Jeddah/KAP focus");

  console.log("Eight-port EcoFair focus smoke test passed.");
} catch (error) {
  throw new Error(`${error instanceof Error ? error.message : String(error)}\n\nRuntime output:\n${output.join("").slice(-12000)}`);
} finally {
  child.kill("SIGTERM");
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 2000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
  await new Promise((resolve) => websocketServer.close(resolve));
  await new Promise((resolve) => publicAisServer.close(resolve));
  rmSync(runtimeDir, { recursive: true, force: true });
}
