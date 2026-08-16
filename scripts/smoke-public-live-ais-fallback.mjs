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
  for (let attempt = 0; attempt < 180; attempt += 1) {
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

const runtimeDir = mkdtempSync(join(tmpdir(), "chmarl-public-live-ais-"));
const weatherFile = join(runtimeDir, "weather.json");
writeFileSync(weatherFile, JSON.stringify({ points: [] }));

const backendPort = await availablePort();
const websocketPort = await availablePort();
const pocketWorldPort = await availablePort();
const output = [];
let websocketSubscriptions = 0;
let pocketWorldRequests = 0;

const websocketServer = new WebSocketServer({ host: "127.0.0.1", port: websocketPort });
websocketServer.on("connection", (socket) => {
  socket.on("message", () => {
    websocketSubscriptions += 1;
    // The primary AISStream-shaped connection deliberately remains silent.
  });
});

const pocketWorldServer = createHttpServer((request, response) => {
  if (request.url !== "/api/ships") {
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "not found" }));
    return;
  }
  pocketWorldRequests += 1;
  const observedAt = new Date().toISOString();
  response.writeHead(200, {
    "content-type": "application/json",
    "x-pocketworld-stale": "1",
  });
  response.end(JSON.stringify({
    count: 2,
    total_tracked: 2,
    connected: true,
    sources: ["barentswatch", "fintraffic"],
    working_sources: ["barentswatch", "fintraffic"],
    source_health: {
      barentswatch: { status: "working", count: 1 },
      fintraffic: { status: "working", count: 1 },
      aisstream: { status: "degraded", count: 0 },
    },
    coverage: {
      scope: "regional",
      worldwide_ready: false,
      regions: ["Norwegian coastal coverage", "Finland and nearby Baltic waters"],
    },
    total_available: 2,
    truncated: false,
    ships: [
      {
        mmsi: 123456789,
        name: "PUBLIC AIS JEDDAH TEST",
        lat: 21.4858,
        lng: 39.1925,
        sog: 9.7,
        cog: 181,
        heading: 180,
        nav_status: 0,
        type_name: "Cargo",
        source: "barentswatch",
        source_url: "https://example.test/barentswatch",
        observed_at: observedAt,
      },
      {
        mmsi: 987654321,
        name: "PUBLIC AIS BALTIC TEST",
        lat: 60.1,
        lng: 24.9,
        sog: 6.2,
        cog: 220,
        heading: 219,
        nav_status: 1,
        type_name: "Tug",
        source: "fintraffic",
        source_url: "https://example.test/fintraffic",
        observed_at: observedAt,
      },
    ],
  }));
});
await new Promise((resolve) => pocketWorldServer.listen(pocketWorldPort, "127.0.0.1", resolve));

const env = {
  ...process.env,
  NODE_ENV: "test",
  PORT: String(backendPort),
  STATIC_DIR: "dist",
  RUNTIME_DATA_DIR: runtimeDir,
  AISSTREAM_API_KEY: "test-aisstream-key",
  AISSTREAM_URL: `ws://127.0.0.1:${websocketPort}`,
  AISSTREAM_RECOVERY_ENABLED: "true",
  AISSTREAM_HEARTBEAT_MS: "500",
  AISSTREAM_FIRST_FRAME_TIMEOUT_MS: "700",
  AISSTREAM_SILENCE_TIMEOUT_MS: "5000",
  AISSTREAM_CACHE_ENABLED: "false",
  DATALASTIC_AIS_ENABLED: "false",
  POCKETWORLD_AIS_ENABLED: "true",
  POCKETWORLD_API_URL: `http://127.0.0.1:${pocketWorldPort}/api/ships`,
  POCKETWORLD_ACTIVATION_DELAY_MS: "500",
  POCKETWORLD_POLL_INTERVAL_MS: "5000",
  POCKETWORLD_TIMEOUT_MS: "1000",
  POCKETWORLD_MAX_AGE_MS: "3600000",
  POCKETWORLD_MAX_VESSELS: "100",
  CHMARL_RUNTIME_ENABLED: "false",
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
  const { json: vessels } = await fetchJsonUntil(`${baseUrl}/api/vessels`, (_response, json) => (
    json?.source === "pocketworld"
    && json?.counts?.tracking === 2
    && json?.vessels?.some((row) => row.id === "MMSI-123456789")
  ));

  assert(websocketSubscriptions >= 1, "Primary AISStream subscription was not attempted");
  assert(pocketWorldRequests >= 1, "Public live AIS fallback was not queried");
  assert(vessels.counts.operational === 1, "Public live AIS row near Jeddah did not enter monitored-port scope");
  assert(vessels.inputs.aisstreamRows === 0, "Silent AISStream unexpectedly produced rows");
  assert(vessels.inputs.pocketworldRows === 2, "Public live AIS row count was not exposed");
  assert(vessels.providers?.pocketworld?.status === "live-regional-stale-global", "Public AIS provider state did not preserve truthful regional/global health");
  assert(vessels.providers?.pocketworld?.cachedVessels === 2, "Public AIS cache did not retain the genuine observations");
  assert(vessels.providers?.pocketworld?.observedSources?.includes("barentswatch"), "Upstream AIS provenance was not exposed");
  assert(vessels.providers?.aisstream?.messageCount === 0, "Silent AISStream unexpectedly received frames");
  assert(vessels.vessels.every((row) => row.inputSource?.startsWith("pocketworld-")), "Public AIS provenance was not preserved on vessel rows");

  const readiness = await fetch(`${baseUrl}/health/ready`);
  assert(readiness.status === 200, `Public live AIS readiness returned ${readiness.status}`);

  const ingest = await fetch(`${baseUrl}/api/vessels/ingest`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ vessels: [] }),
  });
  assert(ingest.status === 404, `Manual vessel ingest endpoint exists: ${ingest.status}`);

  console.log("Public live AIS fallback smoke test passed.");
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
  await new Promise((resolve) => pocketWorldServer.close(resolve));
  rmSync(runtimeDir, { recursive: true, force: true });
}
