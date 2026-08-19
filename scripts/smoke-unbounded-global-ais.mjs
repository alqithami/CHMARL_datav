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
      if (!address || typeof address === "string") return reject(new Error("Could not allocate a test port"));
      const port = address.port;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function fetchJsonUntil(url, predicate) {
  let last;
  for (let attempt = 0; attempt < 250; attempt += 1) {
    try {
      const response = await fetch(url);
      const json = await response.json();
      last = { response, json };
      if (predicate(response, json)) return last;
    } catch (error) {
      last = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  throw new Error(`Timed out waiting for ${url}: ${last instanceof Error ? last.message : JSON.stringify(last?.json)}`);
}

const runtimeDir = mkdtempSync(join(tmpdir(), "chmarl-unbounded-global-ais-"));
const weatherFile = join(runtimeDir, "weather.json");
writeFileSync(weatherFile, JSON.stringify({ points: [] }));
const backendPort = await availablePort();
const websocketPort = await availablePort();
const websocketServer = new WebSocketServer({ host: "127.0.0.1", port: websocketPort });
const output = [];
const subscriptions = [];

const positions = [
  { latitude: 89, longitude: 0 },
  { latitude: -89, longitude: 10 },
  { latitude: 21.4858, longitude: 39.1925 },
];
for (let index = 0; index < 320; index += 1) {
  positions.push({
    latitude: -80 + ((index * 17) % 160),
    longitude: -179 + ((index * 43) % 358),
  });
}

websocketServer.on("connection", (socket) => {
  socket.on("message", (data) => {
    const subscription = JSON.parse(data.toString());
    subscriptions.push(subscription);
    const observedAt = new Date().toISOString();
    positions.forEach((position, index) => {
      const mmsi = 300000000 + index;
      socket.send(JSON.stringify({
        MessageType: "PositionReport",
        MetaData: {
          MMSI: mmsi,
          ShipName: `GLOBAL AIS ${index}`,
          latitude: position.latitude,
          longitude: position.longitude,
          time_utc: observedAt,
        },
        Message: {
          PositionReport: {
            UserID: mmsi,
            Latitude: position.latitude,
            Longitude: position.longitude,
            Sog: 6 + (index % 12),
            Cog: (index * 19) % 360,
            TrueHeading: (index * 19) % 360,
          },
        },
      }));
    });
  });
});

const env = {
  ...process.env,
  NODE_ENV: "test",
  PORT: String(backendPort),
  STATIC_DIR: "dist",
  RUNTIME_DATA_DIR: runtimeDir,
  AISSTREAM_API_KEY: "test-key",
  AISSTREAM_URL: `ws://127.0.0.1:${websocketPort}`,
  AISSTREAM_MAX_VESSELS: "0",
  AISSTREAM_OPERATIONAL_MAX_VESSELS: "0",
  AISSTREAM_MAX_AGE_MS: "3600000",
  AISSTREAM_TRAIL_POINTS: "2",
  AISSTREAM_RECOVERY_ENABLED: "true",
  AISSTREAM_HEARTBEAT_MS: "1000",
  AISSTREAM_FIRST_FRAME_TIMEOUT_MS: "5000",
  AISSTREAM_SILENCE_TIMEOUT_MS: "60000",
  AISSTREAM_CACHE_ENABLED: "false",
  DATALASTIC_AIS_ENABLED: "false",
  POCKETWORLD_AIS_ENABLED: "false",
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
  const expectedRows = positions.length;
  const { json: tracking } = await fetchJsonUntil(`${baseUrl}/api/vessels`, (_response, json) => json?.counts?.tracking === expectedRows);

  assert(subscriptions.length >= 1, "The global AIS subscription was not sent");
  assert(JSON.stringify(subscriptions[0].BoundingBoxes) === JSON.stringify([[[-90, -180], [90, 180]]]), "Tracking subscription was not worldwide");
  assert(tracking.vessels.length === expectedRows, `Expected ${expectedRows} global rows, received ${tracking.vessels.length}`);
  assert(tracking.vessels.some((row) => row.latitude === 89), "Northern polar row was discarded by latitude");
  assert(tracking.vessels.some((row) => row.latitude === -89), "Southern polar row was discarded by latitude");
  assert(tracking.inputs.countLimited === false, "Runtime still reports a vessel-count limit");
  assert(tracking.inputs.locationFilter === "none", "Runtime still reports a geographic tracking filter");
  assert(tracking.inputs.discardedByLocation === 0, "Runtime reports location-based discards");
  assert(tracking.health.countLimited === false && tracking.health.cacheLimit === null, "AISStream cache is not unbounded by count");
  assert(tracking.health.locationFilter === "none", "AISStream state does not expose the global no-filter policy");

  const health = await fetch(`${baseUrl}/health`).then((response) => response.json());
  assert(health.trackingScope.maxRows === null, "Health still exposes a finite global vessel cap");
  assert(health.trackingScope.countLimited === false, "Health does not expose unbounded count policy");
  assert(health.trackingScope.locationFilter === "none", "Health does not expose location-filter-free tracking");
  assert(health.trackingScope.rows === expectedRows, "Health tracking count does not include every reported vessel");
  assert(health.operationalScope.rows === 1, "Jeddah row was not independently derived into operational scope");

  console.log(`Unbounded global AIS smoke test passed with ${expectedRows} rows across the full latitude/longitude range.`);
} catch (error) {
  throw new Error(`${error instanceof Error ? error.message : String(error)}\n\nRuntime output:\n${output.join("").slice(-16000)}`);
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
  rmSync(runtimeDir, { recursive: true, force: true });
}
