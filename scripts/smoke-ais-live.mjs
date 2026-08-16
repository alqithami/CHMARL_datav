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
  throw new Error("Timed out waiting for " + url + ": " + (last instanceof Error ? last.message : JSON.stringify(last?.json)));
}

const runtimeDir = mkdtempSync(join(tmpdir(), "chmarl-ais-recovery-"));
const weatherFile = join(runtimeDir, "weather.json");
writeFileSync(weatherFile, JSON.stringify({ points: [] }));
const backendPort = await availablePort();
const websocketPort = await availablePort();
const websocketServer = new WebSocketServer({ host: "127.0.0.1", port: websocketPort });
const output = [];
const subscriptions = [];
let connectionCount = 0;

websocketServer.on("connection", (socket) => {
  connectionCount += 1;
  const connectionNumber = connectionCount;
  socket.on("message", (data) => {
    const subscription = JSON.parse(data.toString());
    subscriptions.push({ connectionNumber, subscription });
    if (connectionNumber === 1) return;
    socket.send(JSON.stringify({
      MessageType: "PositionReport",
      MetaData: {
        MMSI: 123456789,
        ShipName: "AIS RECOVERY TEST",
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
  AISSTREAM_URL: "ws://127.0.0.1:" + websocketPort,
  AISSTREAM_GLOBAL_TRACKING_ENABLED: "false",
  AISSTREAM_TRACKING_BBOX: "11,32;31,56",
  AISSTREAM_FILTER_TYPES: "UnknownMessage",
  AISSTREAM_OPERATIONAL_PRIORITY_ENABLED: "true",
  AISSTREAM_RECOVERY_ENABLED: "true",
  AISSTREAM_HEARTBEAT_MS: "1000",
  AISSTREAM_FIRST_FRAME_TIMEOUT_MS: "1200",
  AISSTREAM_SILENCE_TIMEOUT_MS: "60000",
  AISSTREAM_CACHE_ENABLED: "false",
  POCKETWORLD_AIS_ENABLED: "false",
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
  const baseUrl = "http://127.0.0.1:" + backendPort;
  const result = await fetchJsonWithRetry(baseUrl + "/api/vessels", (_response, json) => json?.vessels?.some((row) => row.id === "MMSI-123456789"));
  const vessels = result.json;
  const first = subscriptions[0]?.subscription;
  const recovered = subscriptions.find((entry) => entry.connectionNumber > 1)?.subscription;

  assert(connectionCount >= 2, "Silent first AIS socket did not reconnect");
  assert(first?.APIKey === "test-key", "AIS API key was not trimmed before subscription");
  assert(JSON.stringify(first?.BoundingBoxes) === JSON.stringify([[[-90, -180], [90, 180]]]), "Primary AIS subscription was not global");
  assert(!("FilterMessageTypes" in first), "Primary AIS subscription unexpectedly filtered provider frames");
  assert(JSON.stringify(recovered?.BoundingBoxes) === JSON.stringify([[[20.70, 38.35], [22.95, 39.85]]]), "First recovery profile did not prioritize Jeddah and King Abdullah Port");
  assert(Array.isArray(recovered?.FilterMessageTypes) && recovered.FilterMessageTypes.includes("PositionReport"), "Recovery profile did not reduce the stream to position messages");
  assert(vessels.source === "aisstream", "Expected aisstream source, received " + vessels.source);
  assert(vessels.counts?.tracking === 1, "Expected one live AIS row, received " + vessels.counts?.tracking);
  assert(vessels.counts?.operational === 1, "Recovered AIS row was not derived into monitored-port scope");
  assert(vessels.counts?.primaryOperational === 1, "Recovered AIS row was not counted in the primary-port scope");
  assert(vessels.vessels[0].inputSource === "global-tracking", "Vessel did not preserve its AIS source");
  assert(vessels.inputs?.fixedRows === undefined && vessels.inputs?.upstreamRows === undefined, "Non-AIS input counters remain in the API contract");
  assert(vessels.health?.messageCount >= 1 && vessels.health?.usablePositionMessages >= 1, "AIS frame counters were not updated");
  assert(vessels.health?.profileSwitches >= 1, "Silent socket did not record a profile switch");
  assert(vessels.health?.activeProfile === "primary-ports-position-only", "Unexpected recovery profile: " + vessels.health?.activeProfile);
  assert(vessels.health?.lastSuccessfulProfile === "primary-ports-position-only", "Successful primary-port recovery profile was not recorded");
  assert(vessels.health?.lastFrameAt && vessels.health?.lastMessageAt, "AIS frame timestamps were not recorded");

  const primaryScope = await fetch(baseUrl + "/api/vessels?scope=primary").then((response) => response.json());
  assert(primaryScope.scope === "primary" && primaryScope.vessels.length === 1, "Primary-port API scope did not return the recovered vessel");

  const readiness = await fetch(baseUrl + "/health/ready");
  assert(readiness.status === 200, "AIS-backed readiness returned " + readiness.status);

  const ingest = await fetch(baseUrl + "/api/vessels/ingest", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ vessels: [] }) });
  assert(ingest.status === 404, "Manual vessel ingest endpoint still exists: " + ingest.status);

  console.log("Adaptive live AIS recovery integration smoke test passed.");
} catch (error) {
  throw new Error((error instanceof Error ? error.message : String(error)) + "\n\nRuntime output:\n" + output.join("").slice(-10000));
} finally {
  child.kill("SIGTERM");
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 2000);
    child.once("exit", () => { clearTimeout(timer); resolve(); });
  });
  await new Promise((resolve) => websocketServer.close(resolve));
  rmSync(runtimeDir, { recursive: true, force: true });
}
