import { existsSync, readFileSync } from "node:fs";

function read(path) {
  if (!existsSync(path)) throw new Error(`Required file is missing: ${path}`);
  return readFileSync(path, "utf8");
}

function assertIncludes(content, text, label) {
  if (!content.includes(text)) throw new Error(`Runtime contract failed: ${label}`);
}

function assertNotIncludes(content, text, label) {
  if (content.includes(text)) throw new Error(`Runtime contract failed: ${label}`);
}

const runtime = read("server/vessel-feed-proxy/runtime-v3.mjs");
const render = read("render.yaml");
const dockerfile = read("Dockerfile");

assertIncludes(runtime, 'path === "/health/live"', "liveness endpoint is absent");
assertIncludes(runtime, 'path === "/health/ready"', "readiness endpoint is absent");
assertIncludes(runtime, 'path === "/version"', "version endpoint is absent");
assertIncludes(runtime, "AISSTREAM_SILENCE_TIMEOUT_MS", "AIS silence watchdog is absent");
assertIncludes(runtime, "socket.ping()", "websocket heartbeat is absent");
assertIncludes(runtime, "deriveOperational: OPERATIONAL_PRIORITY_ENABLED", "single-stream operational derivation is absent");
assertNotIncludes(runtime, "alsoTracking: true", "legacy second AIS subscription is still enabled");
assertIncludes(render, "healthCheckPath: /health/live", "Render still uses the dependency-heavy health endpoint");
assertIncludes(render, "renderSubdomainPolicy: enabled", "Render subdomain policy is not explicit");
assertIncludes(dockerfile, "COPY package.json pnpm-lock.yaml ./", "Docker build does not copy the lockfile");
assertIncludes(dockerfile, "pnpm install --frozen-lockfile", "Docker build is not locked");
if (!existsSync("pnpm-lock.yaml")) throw new Error("Runtime contract failed: pnpm-lock.yaml is missing");

console.log("Portal runtime contract verified.");
