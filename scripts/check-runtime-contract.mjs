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
const startProd = read("scripts/start-prod.mjs");
const render = read("render.yaml");
const dockerfile = read("Dockerfile");
const packageJson = read("package.json");
const envExample = read(".env.example");

assertIncludes(runtime, 'path === "/health/live"', "liveness endpoint is absent");
assertIncludes(runtime, 'path === "/health/ready"', "readiness endpoint is absent");
assertIncludes(runtime, 'path === "/version"', "version endpoint is absent");
assertIncludes(runtime, "const TRACKING_BBOX_TEXT = WORLD_AIS_BBOX", "global AIS subscription is not enforced");
assertIncludes(runtime, "const AISSTREAM_FILTER_TYPES = []", "AIS provider frames remain filtered");
assertIncludes(runtime, 'String(process.env.AISSTREAM_API_KEY ?? "").trim()', "AIS API key is not normalized");
assertIncludes(runtime, "state.lastFrameAt", "raw AIS frame diagnostics are absent");
assertIncludes(runtime, "AISSTREAM_RECOVERY_PROFILES", "adaptive AIS subscription profiles are absent");
assertIncludes(runtime, "AISSTREAM_FIRST_FRAME_TIMEOUT_MS", "AIS first-frame timeout is absent");
assertIncludes(runtime, "connectionMessageCount", "per-connection AIS frame accounting is absent");
assertIncludes(runtime, "advanceAisProfile", "silent AIS sockets do not rotate profiles");
assertIncludes(runtime, "perMessageDeflate: false", "AIS websocket compression is not explicitly disabled");
assertIncludes(runtime, "deriveOperational: OPERATIONAL_PRIORITY_ENABLED", "single-stream operational derivation is absent");
assertIncludes(runtime, "operationalAisCache.delete(vessel.id)", "out-of-scope vessels are not removed from the operational cache");
assertNotIncludes(runtime, "FIXED_VESSEL", "manual/fixed vessel support remains in production runtime");
assertNotIncludes(runtime, "UPSTREAM_VESSEL", "non-AIS vessel provider remains in production runtime");
assertNotIncludes(runtime, "/api/vessels/ingest", "manual vessel ingest endpoint remains enabled");
assertIncludes(runtime, 'path.startsWith("/api/")', "unknown API routes do not return 404");
assertNotIncludes(startProd, "manual_vessels", "production startup still seeds manual vessels");
assertNotIncludes(startProd, "FIXED_VESSEL", "production startup still configures fixed vessels");
assertIncludes(startProd, 'process.env.AISSTREAM_GLOBAL_TRACKING_ENABLED = "true"', "production startup does not force global AIS");
assertIncludes(startProd, "process.env.AISSTREAM_TRACKING_BBOX = WORLD_AIS_BBOX", "production startup does not force the world box");
assertIncludes(startProd, 'process.env.AISSTREAM_RECOVERY_ENABLED = "true"', "production startup does not enable silent-session recovery");
assertIncludes(startProd, 'process.env.AISSTREAM_FIRST_FRAME_TIMEOUT_MS', "production startup does not configure first-frame recovery");
assertIncludes(startProd, 'process.env.RUNTIME_DATA_DIR = runningOnRender ? "/var/data"', "Render persistence is not enforced");
assertIncludes(render, "healthCheckPath: /health/live", "Render liveness endpoint is incorrect");
assertIncludes(render, "value: -90,-180;90,180", "Render does not use the global AIS box");
assertIncludes(render, "AISSTREAM_MAX_VESSELS\n        value: 20000", "Render AIS capacity was reduced");
assertIncludes(render, "AISSTREAM_RECOVERY_ENABLED\n        value: true", "Render does not enable AIS silent-session recovery");
assertIncludes(render, "AISSTREAM_FIRST_FRAME_TIMEOUT_MS\n        value: 30000", "Render first-frame timeout is not configured");
assertIncludes(render, "AISSTREAM_SILENCE_TIMEOUT_MS\n        value: 90000", "Render silence timeout is too slow");
assertNotIncludes(render, "FIXED_VESSEL", "Render still configures manual/fixed vessels");
assertNotIncludes(render, "UPSTREAM_VESSEL", "Render still configures a non-AIS vessel provider");
assertNotIncludes(envExample, "FIXED_VESSEL", "environment template still advertises manual vessels");
assertNotIncludes(envExample, "UPSTREAM_VESSEL", "environment template still advertises non-AIS vessels");
assertIncludes(dockerfile, "COPY package.json pnpm-lock.yaml ./", "Docker build does not copy the lockfile");
assertIncludes(dockerfile, "pnpm install --frozen-lockfile", "Docker build is not locked");
assertIncludes(packageJson, "scripts/smoke-ais-live.mjs", "live AIS integration smoke test is not part of verification");
assertNotIncludes(packageJson, "ingest:fixed-vessels", "manual vessel command remains available");

for (const path of [
  "public/data/fixed_vessels.sample.json",
  "public/data/manual_vessels.sample.json",
  "public/data/vessels.sample.json",
  "public/data/vessels.sample.csv",
  "scripts/ingest-fixed-vessels.mjs",
]) {
  if (existsSync(path)) throw new Error(`Runtime contract failed: non-AIS vessel artifact remains: ${path}`);
}

console.log("AIS-only portal runtime contract verified.");
