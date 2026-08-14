import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

function availablePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not allocate a test port."));
        return;
      }
      const port = address.port;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function fetchWithRetry(url, options = {}) {
  let lastError;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      return await fetch(url, options);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 125));
    }
  }
  throw lastError ?? new Error(`Could not reach ${url}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const runtimeDir = mkdtempSync(join(tmpdir(), "chmarl-runtime-smoke-"));
const weatherFile = join(runtimeDir, "weather.json");
writeFileSync(weatherFile, JSON.stringify({ points: [] }));
const port = await availablePort();
const baseUrl = `http://127.0.0.1:${port}`;
const output = [];

const env = { ...process.env };
delete env.AISSTREAM_API_KEY;
Object.assign(env, {
  NODE_ENV: "production",
  PORT: String(port),
  STATIC_DIR: "dist",
  RUNTIME_DATA_DIR: runtimeDir,
  FIXED_VESSEL_DATA_FILE_ENABLED: "false",
  CHMARL_RUNTIME_ENABLED: "false",
  WEATHER_FILE_ENABLED: "true",
  WEATHER_FILE: weatherFile,
  WEATHER_URL: "",
  UPSTREAM_VESSEL_DATA_URL: "",
  FIXED_VESSEL_DATA_URL: "",
});

const child = spawn(process.execPath, ["server/vessel-feed-proxy/index.mjs"], {
  env,
  stdio: ["ignore", "pipe", "pipe"],
});
child.stdout.on("data", (chunk) => output.push(chunk.toString()));
child.stderr.on("data", (chunk) => output.push(chunk.toString()));

try {
  const liveStarted = Date.now();
  const liveResponse = await fetchWithRetry(`${baseUrl}/health/live`);
  const live = await liveResponse.json();
  assert(liveResponse.status === 200, `/health/live returned ${liveResponse.status}`);
  assert(live.ok === true, "/health/live did not report ok=true");
  assert(live.service?.startedAt, "/health/live omitted service metadata");
  assert(Date.now() - liveStarted < 5_000, "/health/live exceeded the deployment health-check budget");

  const versionResponse = await fetch(`${baseUrl}/version`);
  const version = await versionResponse.json();
  assert(versionResponse.status === 200, `/version returned ${versionResponse.status}`);
  assert(typeof version.version === "string", "/version omitted the deployed version");

  const readinessResponse = await fetch(`${baseUrl}/health/ready`);
  const readiness = await readinessResponse.json();
  assert(readinessResponse.status === 503, `/health/ready returned ${readinessResponse.status} without data`);
  assert(readiness.staticDashboard === true, "readiness did not detect the production dashboard bundle");
  assert(readiness.dataReady === false, "readiness incorrectly reported vessel data");
  assert(readiness.providerConfigured === false, "readiness incorrectly reported an unconfigured provider as configured");

  const vesselsResponse = await fetch(`${baseUrl}/api/vessels`);
  const vessels = await vesselsResponse.json();
  assert(vesselsResponse.status === 200, `/api/vessels returned ${vesselsResponse.status}`);
  assert(Array.isArray(vessels.vessels) && vessels.vessels.length === 0, "empty runtime returned unexpected vessel rows");

  const dashboardResponse = await fetch(`${baseUrl}/`);
  assert(dashboardResponse.status === 200, `/ returned ${dashboardResponse.status}`);
  assert((await dashboardResponse.text()).includes("<div id=\"root\"></div>"), "production dashboard HTML was not served");

  console.log("Portal runtime smoke test passed.");
} catch (error) {
  const logs = output.join("").slice(-8_000);
  throw new Error(`${error instanceof Error ? error.message : String(error)}\n\nRuntime output:\n${logs}`);
} finally {
  child.kill("SIGTERM");
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 2_000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
  rmSync(runtimeDir, { recursive: true, force: true });
}
