import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { WebSocketServer } from "ws";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function availablePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("Could not allocate a port"));
      const port = address.port;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function fetchJsonWithRetry(url, predicate) {
  let last;
  for (let attempt = 0; attempt < 60; attempt += 1) {
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

const runtimeDir = mkdtempSync(join(tmpdir(), "chmarl-ais-only-"));
const weatherFile = join(runtimeDir, "weather.json");
writeFileSync(weatherFile, JSON.stringify({ points: [] }));
const backendPort = await availablePort();
const websocketPort = await availablePort();
const websocketServer = new WebSocketServer({ host: "127.0.0.1", port: websocketPort });
const output = [];
let subscription = null;

websocketServer.on("connection", (socket) => {
  socket.on("message", (data) => {
    subscription = JSON.parse(data.toString());
    socket.send(JSON.stringify({
      MessageType: "PositionReport",
      MetaData: {
        MMSI: 123456789,
        ShipName: "AIS INTEGRATION TEST",
        latitude: 21.4858,
        longitude: 39.1925,
        time_utc: new Date().toISOString(),
      },
      Message: {
        PositionReport: {
          UserID: 123456789,
          Latitude: 21.4858,
          Longitude: 39.1925,
          Sog: 12.3,
          Cog: 180,
          TrueHeading: 181,
        },
      },
    }));
  });
});

const env = {
  ...process.env,
  NODE_ENV: "production",
  PORT: String(backendPort),
  STATIC_DIR: "dist",
  RUNTIME_DATA_DIR: runtimeDir,
  AISSTREAM_API_KEY: "  test-key  ",
  AISSTREAM_URL: `ws://127.0.0.1:${websocketPort}`,
  AISSTREAM_GLOBAL_TRACKING_ENABLED: "false",
  AISSTREAM_TRACKING_BBOX: "11,32;31,56",
  AISSTREAM_FILTER_TYPES: "PositionReport",
  AISSTREAM_OPERATIONAL_PRIORITY_ENABLED: "true",
  AISSTREAM_CACHE_ENABLED: "false",
  AISSTREAM_SILENCE_TIMEOUT_MS: "60000",
  CHMARL_RUNTIME_ENABLED: "false",
  WEATHER_FILE_ENABLED: "true",
  WEATHER_FILE: weatherFile,
  FIXED_VESSEL_DATA_FILE_ENABLED: "true",
  FIXED_VESSEL_DATA_URL: "https://example.invalid/manual.json",
  UPSTREAM_VESSEL_DATA_URL: "https://example.invalid/upstream.json",
};

const child = spawn(process.execPath, ["server/vessel-feed-proxy/index.mjs"], { env, stdio: ["ignore", "pipe", "pipe"] });
child.stdout.on("data", (chunk) => output.push(chunk.toString()));
child.stderr.on("data", (chunk) => output.push(chunk.toString()));

try {
  const baseUrl = `http://127.0.0.1:${backendPort}`;
  const { json: vessels } = await fetchJsonWithRetry(`${baseUrl}/api/vessels`, (_response, json) => json?.vessels?.some((row) => row.id === "MMSI-123456789"));

  assert(subscription?.APIKey === "test-key", "AIS API key was not trimmed before subscription");
  assert(JSON.stringify(subscription?.BoundingBoxes) === JSON.stringify([[[-90, -180], [90, 180]]]), "AIS subscription was not global");
  assert(!("FilterMessageTypes" in subscription), "AIS subscription unexpectedly filtered provider frames");
  assert(vessels.source === "aisstream", `Expected aisstream source, received ${vessels.source}`);
  assert(vessels.counts?.tracking === 1, `Expected one live AIS row, received ${vessels.counts?.tracking}`);
  assert(vessels.counts?.operational === 1, "Live AIS row was not derived into monitored-port scope");
  assert(vessels.vessels[0].inputSource === "global-tracking", "Vessel did not preserve its AIS source");
  assert(vessels.inputs?.fixedRows === undefined && vessels.inputs?.upstreamRows === undefined, "Non-AIS input counters remain in the API contract");
  assert(vessels.health?.messageCount >= 1 && vessels.health?.usablePositionMessages >= 1, "AIS frame counters were not updated");
  assert(vessels.health?.lastFrameAt && vessels.health?.lastMessageAt, "AIS frame timestamps were not recorded");

  const readiness = await fetch(`${baseUrl}/health/ready`);
  assert(readiness.status === 200, `AIS-backed readiness returned ${readiness.status}`);

  const ingest = await fetch(`${baseUrl}/api/vessels/ingest`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ vessels: [] }) });
  assert(ingest.status === 404, `Manual vessel ingest endpoint still exists: ${ingest.status}`);

  console.log("Live AIS-only integration smoke test passed.");
} catch (error) {
  throw new Error(`${error instanceof Error ? error.message : String(error)}\n\nRuntime output:\n${output.join("").slice(-10000)}`);
} finally {
  child.kill("SIGTERM");
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 2000);
    child.once("exit", () => { clearTimeout(timer); resolve(); });
  });
  await new Promise((resolve) => websocketServer.close(resolve));
  rmSync(runtimeDir, { recursive: true, force: true });
}
