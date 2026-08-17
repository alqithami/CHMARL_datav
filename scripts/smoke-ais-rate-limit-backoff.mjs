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

const runtimeDir = mkdtempSync(join(tmpdir(), "chmarl-ais-rate-limit-"));
const weatherFile = join(runtimeDir, "weather.json");
writeFileSync(weatherFile, JSON.stringify({ points: [] }));
const backendPort = await availablePort();
const providerPort = await availablePort();
const output = [];
let upgradeRequests = 0;

const providerServer = createHttpServer((_request, response) => {
  response.writeHead(426, { "content-type": "text/plain" });
  response.end("Upgrade required");
});
providerServer.on("upgrade", (_request, socket) => {
  upgradeRequests += 1;
  socket.write([
    "HTTP/1.1 429 Too Many Requests",
    "Retry-After: 120",
    "Connection: close",
    "Content-Length: 0",
    "",
    "",
  ].join("\r\n"));
  socket.destroy();
});
await new Promise((resolve) => providerServer.listen(providerPort, "127.0.0.1", resolve));

const env = {
  ...process.env,
  NODE_ENV: "test",
  PORT: String(backendPort),
  STATIC_DIR: "dist",
  RUNTIME_DATA_DIR: runtimeDir,
  AISSTREAM_API_KEY: "test-rate-limit-key",
  AISSTREAM_URL: `ws://127.0.0.1:${providerPort}/stream`,
  AISSTREAM_RECOVERY_ENABLED: "true",
  AISSTREAM_HEARTBEAT_MS: "500",
  AISSTREAM_FIRST_FRAME_TIMEOUT_MS: "1000",
  AISSTREAM_SILENCE_TIMEOUT_MS: "5000",
  AISSTREAM_RATE_LIMIT_BACKOFF_MS: "60000",
  AISSTREAM_PROFILE_CYCLE_BACKOFF_MS: "10000",
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
  const { json: health } = await fetchJsonUntil(`${baseUrl}/health`, (_response, json) => (
    json?.aisstream?.status === "rate-limited"
    && json?.aisstream?.lastHttpStatus === 429
    && Boolean(json?.aisstream?.rateLimitedUntil)
  ));

  const until = Date.parse(health.aisstream.rateLimitedUntil);
  assert(Number.isFinite(until), "Rate-limit deadline is invalid");
  assert(until - Date.now() > 60_000, "Retry-After header was not honored");
  assert(upgradeRequests === 1, `Expected one rejected handshake, received ${upgradeRequests}`);

  await new Promise((resolve) => setTimeout(resolve, 2000));
  const later = await fetch(`${baseUrl}/health`).then((response) => response.json());
  assert(later.aisstream.status === "rate-limited", "Rate-limited state was cleared prematurely");
  assert(upgradeRequests === 1, `AIS reconnect storm continued during backoff: ${upgradeRequests} handshakes`);
  assert(later.aisstream.reconnectAttempt <= 2, `Reconnect counter advanced unexpectedly: ${later.aisstream.reconnectAttempt}`);

  console.log("AISStream rate-limit backoff smoke test passed.");
} catch (error) {
  throw new Error(`${error instanceof Error ? error.message : String(error)}\n\nRuntime output:\n${output.join("").slice(-16000)}`);
} finally {
  child.kill("SIGTERM");
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 2500);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
  await new Promise((resolve) => providerServer.close(resolve));
  rmSync(runtimeDir, { recursive: true, force: true });
}
