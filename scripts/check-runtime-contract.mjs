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
const datalasticProvider = read("server/vessel-feed-proxy/datalastic-live-ais.mjs");
const pocketWorldProvider = read("server/vessel-feed-proxy/pocketworld-live-ais.mjs");
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
assertIncludes(runtime, "createDatalasticLiveAisProvider", "secondary genuine live AIS provider is not integrated");
assertIncludes(runtime, "datalasticFailoverDue", "silent AISStream sessions do not activate live AIS failover");
assertIncludes(runtime, '...(Number(vesselInputState.datalasticRows ?? 0) > 0 ? ["datalastic"] : [])', "Datalastic live AIS source is not represented in provider selection");
assertIncludes(runtime, 'return "ais-multi-provider"', "multi-provider AIS source is not exposed");
assertIncludes(datalasticProvider, '"x-api-key": key', "Datalastic key is not sent securely in a request header");
assertIncludes(datalasticProvider, 'inputSource: "datalastic-live-ais"', "Datalastic vessel provenance is absent");
assertNotIncludes(datalasticProvider, "manual", "Datalastic provider contains manual vessel logic");
assertIncludes(runtime, "createPocketWorldLiveAisProvider", "public live AIS fallback is not integrated");
assertIncludes(runtime, "pocketWorldFailoverDue", "silent primary AIS does not activate the public fallback");
assertIncludes(runtime, '...(Number(vesselInputState.pocketworldRows ?? 0) > 0 ? ["pocketworld"] : [])', "public AIS source is not represented in provider selection");
assertIncludes(pocketWorldProvider, 'row.inputSource ?? `pocketworld-${source}`', "public AIS provenance is absent");
assertIncludes(pocketWorldProvider, 'payload?.coverage', "public AIS coverage metadata is not preserved");
assertIncludes(pocketWorldProvider, "loadCache();", "public AIS continuity cache is not restored at startup");
assertIncludes(pocketWorldProvider, "last-known-regional", "public AIS last-known state is absent");
assertIncludes(pocketWorldProvider, "freshVessels", "public AIS freshness diagnostics are absent");
assertIncludes(pocketWorldProvider, "snapshot_id", "PocketWorld snapshot pagination is absent");
assertIncludes(pocketWorldProvider, "next_cursor", "PocketWorld cursor traversal is absent");
assertIncludes(pocketWorldProvider, "firstRequestLimit", "PocketWorld first request does not advertise its full page capacity");
assertIncludes(pocketWorldProvider, "providerOmittedCursor", "PocketWorld cannot detect a provider-side truncated response without a cursor");
assertIncludes(pocketWorldProvider, "pagesFetched", "PocketWorld pagination diagnostics are absent");
assertIncludes(pocketWorldProvider, "fetchComplete", "PocketWorld complete-snapshot state is absent");
assertIncludes(pocketWorldProvider, "DEFAULT_PAGE_SIZE = 10_000", "PocketWorld page size is not bounded");
assertIncludes(pocketWorldProvider, "maxVessels = 50_000", "PocketWorld provider capacity remains below the API maximum");
assertNotIncludes(pocketWorldProvider, "placeholder", "public AIS provider contains placeholder rows");
assertIncludes(runtime, "deriveOperational: OPERATIONAL_PRIORITY_ENABLED", "single-stream operational derivation is absent");
assertIncludes(runtime, 'id: "Jubail Commercial Port"', "Jubail is missing from the eight-port portfolio");
assertIncludes(runtime, "PRIMARY_PORT_REFERENCE_POINTS", "Jeddah and King Abdullah focus is absent");
assertIncludes(runtime, 'id: "primary-ports-position-only"', "AIS recovery does not prioritize the primary ports");
assertIncludes(runtime, "primaryOperationalVessels", "primary operational scope is absent");
assertIncludes(runtime, "ECOFAIR_MAX_VESSEL_AGE_MS", "last-known rows are not excluded from EcoFair");
assertIncludes(runtime, '"pocketworld-last-known"', "last-known public AIS source is not exposed");
assertIncludes(runtime, "AISSTREAM_RATE_LIMIT_BACKOFF_MS", "AIS 429 backoff is absent");
assertIncludes(runtime, "rateLimitedUntil", "AIS rate-limit deadline is not exposed");
assertIncludes(runtime, "retryAfterDelayMs", "AIS Retry-After handling is absent");
assertIncludes(runtime, 'requestedScope === "primary"', "primary vessel API scope is absent");
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
assertIncludes(startProd, 'process.env.POCKETWORLD_MAX_VESSELS ??= "50000"', "production startup still limits PocketWorld to 5000 rows");
assertIncludes(startProd, 'process.env.RUNTIME_DATA_DIR = runningOnRender ? "/var/data"', "Render persistence is not enforced");
assertIncludes(render, "healthCheckPath: /health/live", "Render liveness endpoint is incorrect");
assertIncludes(render, "value: -90,-180;90,180", "Render does not use the global AIS box");
assertIncludes(render, "AISSTREAM_MAX_VESSELS\n        value: 20000", "Render AIS capacity was reduced");
assertIncludes(render, "AISSTREAM_RECOVERY_ENABLED\n        value: true", "Render does not enable AIS silent-session recovery");
assertIncludes(render, "AISSTREAM_FIRST_FRAME_TIMEOUT_MS\n        value: 30000", "Render first-frame timeout is not configured");
assertIncludes(render, "AISSTREAM_SILENCE_TIMEOUT_MS\n        value: 90000", "Render silence timeout is too slow");
assertIncludes(render, "DATALASTIC_API_KEY\n        sync: false", "Render does not declare the secondary live AIS secret");
assertIncludes(render, "DATALASTIC_SCAN_POINT_IDS", "Render does not configure live AIS fallback coverage");
assertIncludes(render, "POCKETWORLD_AIS_ENABLED\n        value: true", "Render does not enable public live AIS fallback");
assertIncludes(render, "POCKETWORLD_API_URL", "Render does not configure the public AIS endpoint");
assertIncludes(render, "POCKETWORLD_MAX_VESSELS\n        value: 50000", "Render public AIS capacity remains fixed at 5000");
assertIncludes(render, "POCKETWORLD_DISPLAY_MAX_AGE_MS\n        value: 21600000", "Render last-known AIS retention is absent");
assertIncludes(render, "POCKETWORLD_CACHE_FILE\n        value: /var/data/pocketworld-ais-cache.json", "Render public AIS persistence is absent");
assertIncludes(render, "ECOFAIR_MAX_VESSEL_AGE_MS\n        value: 1800000", "Render EcoFair freshness guard is absent");
assertIncludes(render, "AISSTREAM_RATE_LIMIT_BACKOFF_MS\n        value: 1800000", "Render AIS rate-limit backoff is absent");
assertNotIncludes(render, "FIXED_VESSEL", "Render still configures manual/fixed vessels");
assertNotIncludes(render, "UPSTREAM_VESSEL", "Render still configures a non-AIS vessel provider");
assertNotIncludes(envExample, "FIXED_VESSEL", "environment template still advertises manual vessels");
assertNotIncludes(envExample, "UPSTREAM_VESSEL", "environment template still advertises non-AIS vessels");
assertIncludes(envExample, "POCKETWORLD_MAX_VESSELS=50000", "environment template still caps PocketWorld at 5000");
assertIncludes(dockerfile, "COPY package.json pnpm-lock.yaml ./", "Docker build does not copy the lockfile");
assertIncludes(dockerfile, "pnpm install --frozen-lockfile", "Docker build is not locked");
assertIncludes(packageJson, "scripts/smoke-ais-live.mjs", "live AIS integration smoke test is not part of verification");
assertIncludes(packageJson, "scripts/smoke-live-ais-failover.mjs", "live AIS failover smoke test is not part of verification");
assertIncludes(packageJson, "scripts/smoke-public-live-ais-fallback.mjs", "public live AIS fallback smoke test is not part of verification");
assertIncludes(packageJson, "scripts/smoke-eight-port-ecofair-focus.mjs", "eight-port EcoFair smoke test is not part of verification");
assertIncludes(packageJson, "scripts/smoke-public-live-ais-continuity.mjs", "public AIS continuity smoke test is not part of verification");
assertIncludes(packageJson, "scripts/smoke-ais-rate-limit-backoff.mjs", "AIS rate-limit smoke test is not part of verification");
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
