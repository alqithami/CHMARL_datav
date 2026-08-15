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
  for (let attempt = 0; attempt < 160; attempt += 1) {
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

const runtimeDir = mkdtempSync(join(tmpdir(), "chmarl-live-ais-failover-"));
const weatherFile = join(runtimeDir, "weather.json");
writeFileSync(weatherFile, JSON.stringify({ points: [] }));

const backendPort = await availablePort();
const websocketPort = await availablePort();
const datalasticPort = await availablePort();
const output = [];
let websocketSubscriptions = 0;
let datalasticRequests = 0;

const websocketServer = new WebSocketServer({ host: "127.0.0.1", port: websocketPort });
websocketServer.on("connection", (socket) => {
  socket.on("message", () => {
    websocketSubscriptions += 1;
    // Intentionally remain silent: this simulates an accepted AISStream socket
    // whose upstream pipeline delivers no AIS frames.
  });
});

const datalasticServer = createHttpServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://127.0.0.1:${datalasticPort}`);
  if (url.pathname !== "/api/v0/vessel_inradius") {
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "not found" }));
    return;
  }
  datalasticRequests += 1;
  assert(request.headers["x-api-key"] === "test-datalastic-key", "Datalastic key was not sent in the header");
  assert(url.searchParams.get("radius") === "50", "Datalastic scan did not use the configured radius");
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify({
    data: {
      total: 1,
      vessels: [
        {
          uuid: "datalastic-test-vessel",
          name: "REAL AIS FAILOVER TEST",
          mmsi: "123456789",
          imo: "9876543",
          type: "Cargo",
          type_specific: "Container Ship",
          lat: 21.4858,
          lon: 39.1925,
          speed: 11.4,
          course: 182,
          heading: 181,
          nav_status: "Under way using engine",
          destination: "JEDDAH",
          eta_UTC: "2026-08-15T18:00:00Z",
          last_position_UTC: new Date().toISOString(),
        },
      ],
    },
    meta: { success: true },
  }));
});
await new Promise((resolve) => datalasticServer.listen(datalasticPort, "127.0.0.1", resolve));

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
  DATALASTIC_AIS_ENABLED: "true",
  DATALASTIC_API_KEY: "test-datalastic-key",
  DATALASTIC_API_BASE_URL: `http://127.0.0.1:${datalasticPort}/api/v0`,
  DATALASTIC_ACTIVATION_DELAY_MS: "500",
  DATALASTIC_SCAN_INTERVAL_MS: "1000",
  DATALASTIC_TIMEOUT_MS: "1000",
  DATALASTIC_SCAN_RADIUS_NM: "50",
  DATALASTIC_MAX_AGE_MS: "3600000",
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
    json?.source === "datalastic"
    && json?.counts?.tracking === 1
    && json?.vessels?.[0]?.id === "MMSI-123456789"
  ));

  assert(websocketSubscriptions >= 1, "Primary AISStream subscription was not attempted");
  assert(datalasticRequests >= 1, "Secondary live AIS provider was not queried");
  assert(vessels.counts.operational === 1, "Live fallback vessel was not admitted to monitored-port scope");
  assert(vessels.inputs.aisstreamRows === 0, "Silent AISStream unexpectedly produced rows");
  assert(vessels.inputs.datalasticRows === 1, "Datalastic row count was not exposed");
  assert(vessels.providers?.datalastic?.status === "live", "Datalastic provider was not marked live");
  assert(vessels.providers?.datalastic?.cachedVessels === 1, "Datalastic provider cache did not retain the real AIS row");
  assert(vessels.providers?.aisstream?.messageCount === 0, "Silent AISStream unexpectedly received frames");
  assert(vessels.vessels[0].inputSource === "datalastic-live-ais", "Fallback vessel provenance was not preserved");

  const readiness = await fetch(`${baseUrl}/health/ready`);
  assert(readiness.status === 200, `Live AIS fallback readiness returned ${readiness.status}`);

  const ingest = await fetch(`${baseUrl}/api/vessels/ingest`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ vessels: [] }),
  });
  assert(ingest.status === 404, `Manual vessel ingest endpoint exists: ${ingest.status}`);

  console.log("Live AIS provider failover smoke test passed.");
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
  await new Promise((resolve) => datalasticServer.close(resolve));
  rmSync(runtimeDir, { recursive: true, force: true });
}
