import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

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

async function fetchJsonUntil(url, predicate, attempts = 160) {
  let last;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
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

async function stopChild(child) {
  child.kill("SIGTERM");
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 2500);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

const runtimeDir = mkdtempSync(join(tmpdir(), "chmarl-public-ais-continuity-"));
const weatherFile = join(runtimeDir, "weather.json");
const cacheFile = join(runtimeDir, "pocketworld-ais-cache.json");
writeFileSync(weatherFile, JSON.stringify({ points: [] }));

const mirrorPort = await availablePort();
let mirrorAvailable = true;
let mirrorRequests = 0;
const observedAt = new Date(Date.now() - 90 * 60_000).toISOString();
const mirrorServer = createHttpServer((request, response) => {
  if (request.url !== "/api/ships") {
    response.writeHead(404).end();
    return;
  }
  mirrorRequests += 1;
  if (!mirrorAvailable) {
    response.writeHead(503, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "temporary mirror outage" }));
    return;
  }
  response.writeHead(200, {
    "content-type": "application/json",
    "x-pocketworld-stale": "1",
  });
  response.end(JSON.stringify({
    connected: true,
    sources: ["barentswatch"],
    working_sources: ["barentswatch"],
    total_available: 2,
    ships: [
      {
        mmsi: 111111111,
        name: "LAST KNOWN JEDDAH TEST",
        lat: 21.49,
        lng: 39.19,
        sog: 0.2,
        nav_status: 5,
        source: "barentswatch",
        observed_at: observedAt,
      },
      {
        mmsi: 222222222,
        name: "LAST KNOWN WORLD TEST",
        lat: 60.1,
        lng: 24.9,
        sog: 7.5,
        nav_status: 0,
        source: "barentswatch",
        observed_at: observedAt,
      },
    ],
  }));
});
await new Promise((resolve) => mirrorServer.listen(mirrorPort, "127.0.0.1", resolve));

function runtimeEnv(port) {
  return {
    ...process.env,
    NODE_ENV: "test",
    PORT: String(port),
    STATIC_DIR: "dist",
    RUNTIME_DATA_DIR: runtimeDir,
    AISSTREAM_API_KEY: "",
    AISSTREAM_CACHE_ENABLED: "false",
    DATALASTIC_AIS_ENABLED: "false",
    POCKETWORLD_AIS_ENABLED: "true",
    POCKETWORLD_API_URL: `http://127.0.0.1:${mirrorPort}/api/ships`,
    POCKETWORLD_ACTIVATION_DELAY_MS: "250",
    POCKETWORLD_POLL_INTERVAL_MS: "1000",
    POCKETWORLD_TIMEOUT_MS: "1000",
    POCKETWORLD_DISPLAY_MAX_AGE_MS: String(6 * 60 * 60_000),
    POCKETWORLD_FRESH_AGE_MS: String(30 * 60_000),
    POCKETWORLD_MAX_VESSELS: "100",
    POCKETWORLD_CACHE_FILE: cacheFile,
    POCKETWORLD_CACHE_FLUSH_MS: "1000",
    ECOFAIR_MAX_VESSEL_AGE_MS: String(30 * 60_000),
    CHMARL_RUNTIME_ENABLED: "true",
    ECOFAIR_TICK_MS: "1000",
    WEATHER_FILE_ENABLED: "true",
    WEATHER_FILE: weatherFile,
  };
}

function startBackend(port, output) {
  const child = spawn(process.execPath, ["server/vessel-feed-proxy/index.mjs"], {
    env: runtimeEnv(port),
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => output.push(chunk.toString()));
  child.stderr.on("data", (chunk) => output.push(chunk.toString()));
  return child;
}

const output = [];
let firstChild;
let secondChild;
try {
  const firstPort = await availablePort();
  firstChild = startBackend(firstPort, output);
  const firstBase = `http://127.0.0.1:${firstPort}`;
  const { json: first } = await fetchJsonUntil(`${firstBase}/api/vessels`, (_response, json) => json?.counts?.tracking === 2);

  assert(first.source === "pocketworld-last-known", `Expected last-known source, received ${first.source}`);
  assert(first.vessels.length === 2, "The regional AIS rows were not retained for tracking");
  assert(first.counts.freshTracking === 0, "Old regional observations were incorrectly marked fresh");
  assert(first.counts.lastKnownTracking === 2, "Last-known row count was not exposed");
  assert(first.counts.operational === 0, "Last-known Jeddah row incorrectly entered EcoFair scope");
  assert(first.counts.primaryOperational === 0, "Last-known Jeddah row incorrectly entered the primary scope");
  assert(first.providers?.pocketworld?.status === "last-known-regional", "Provider did not expose the last-known state");
  assert(first.providers?.pocketworld?.freshVessels === 0, "Provider freshness count is incorrect");
  assert(first.providers?.pocketworld?.lastKnownVessels === 2, "Provider last-known count is incorrect");

  await stopChild(firstChild);
  firstChild = null;
  mirrorAvailable = false;

  const secondPort = await availablePort();
  secondChild = startBackend(secondPort, output);
  const secondBase = `http://127.0.0.1:${secondPort}`;
  const { json: restored } = await fetchJsonUntil(`${secondBase}/api/vessels`, (_response, json) => json?.counts?.tracking === 2);

  assert(restored.source === "pocketworld-last-known", "Persistent regional AIS cache lost its source state");
  assert(restored.vessels.length === 2, "Persistent genuine AIS rows disappeared during the mirror outage");
  assert(restored.providers?.pocketworld?.restoredVessels === 2, "Persistent AIS rows were not restored after restart");
  assert(restored.counts.operational === 0, "Restored last-known rows incorrectly activated EcoFair");

  const { json: outageHealth } = await fetchJsonUntil(`${secondBase}/health`, (_response, json) => (
    mirrorRequests >= 2
    && json?.pocketworld?.status === "provider-error"
    && json?.vesselInputs?.trackingRows === 2
  ));
  assert(mirrorRequests >= 2, "The mirror outage path was not exercised");
  assert(outageHealth.pocketworld.cachedVessels === 2, "Mirror failure removed the persistent genuine AIS rows");
  assert(outageHealth.vesselInputs.operationalRows === 0, "Mirror outage caused last-known rows to activate EcoFair");

  console.log("Public live AIS continuity smoke test passed.");
} catch (error) {
  throw new Error(`${error instanceof Error ? error.message : String(error)}\n\nRuntime output:\n${output.join("").slice(-16000)}`);
} finally {
  if (firstChild) await stopChild(firstChild);
  if (secondChild) await stopChild(secondChild);
  await new Promise((resolve) => mirrorServer.close(resolve));
  rmSync(runtimeDir, { recursive: true, force: true });
}
