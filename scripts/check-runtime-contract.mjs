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
const vesselRegistry = read("server/vessel-feed-proxy/vessel-registry.mjs");
const startProd = read("scripts/start-prod.mjs");
const render = read("render.yaml");
const dockerfile = read("Dockerfile");
const packageJson = read("package.json");
const envExample = read(".env.example");

assertIncludes(runtime, 'path === "/health/live"', "liveness endpoint is absent");
assertIncludes(runtime, 'path === "/health/ready"', "readiness endpoint is absent");
assertIncludes(runtime, 'path === "/version"', "version endpoint is absent");
assertIncludes(runtime, "const TRACKING_BBOX_TEXT = WORLD_AIS_BBOX", "global AIS subscription is not enforced");
assertIncludes(runtime, "const AISSTREAM_FILTER_TYPES = AISSTREAM_POSITION_FILTER_TYPES", "worldwide AIS is not constrained to position-bearing messages");
assertIncludes(runtime, 'String(process.env.AISSTREAM_API_KEY ?? "").trim()', "AIS API key is not normalized");
assertIncludes(runtime, "state.lastFrameAt", "raw AIS frame diagnostics are absent");
assertIncludes(runtime, "AISSTREAM_RECOVERY_PROFILES", "adaptive AIS subscription profiles are absent");
assertIncludes(runtime, "AISSTREAM_FIRST_FRAME_TIMEOUT_MS", "AIS first-frame timeout is absent");
assertIncludes(runtime, "connectionMessageCount", "per-connection AIS frame accounting is absent");
assertIncludes(runtime, "sendAisSubscription", "silent AIS sockets cannot refresh a subscription in place");
assertIncludes(runtime, "subscriptionRefreshes", "AIS subscription-refresh diagnostics are absent");
assertIncludes(runtime, "hardReconnects", "AIS controlled hard-reconnect diagnostics are absent");
assertIncludes(runtime, "perMessageDeflate: false", "AIS websocket compression is not explicitly disabled");
assertIncludes(runtime, "createDatalasticLiveAisProvider", "secondary genuine live AIS provider is not integrated");
assertIncludes(runtime, "datalasticFailoverDue", "silent AISStream sessions do not activate live AIS failover");
assertIncludes(runtime, '...(Number(vesselInputState.datalasticRows ?? 0) > 0 ? ["datalastic"] : [])', "Datalastic live AIS source is not represented in provider selection");
assertIncludes(runtime, 'return "ais-multi-provider"', "multi-provider AIS source is not exposed");
assertIncludes(datalasticProvider, '"x-api-key": key', "Datalastic key is not sent securely in a request header");
assertIncludes(datalasticProvider, 'inputSource: "datalastic-live-ais"', "Datalastic vessel provenance is absent");
assertNotIncludes(datalasticProvider, "manual", "Datalastic provider contains manual vessel logic");
assertIncludes(runtime, "createPocketWorldLiveAisProvider", "public live AIS fallback is not integrated");
assertIncludes(runtime, "createVesselRegistry", "persistent vessel registry is not integrated");
assertIncludes(runtime, 'path === "/api/registry/stats"', "registry statistics endpoint is absent");
assertIncludes(runtime, 'path === "/api/registry/vessels"', "registry list endpoint is absent");
assertIncludes(runtime, 'path === "/api/registry/conflicts"', "registry conflict queue endpoint is absent");
assertIncludes(runtime, 'url.searchParams.get("sort")', "registry sorting is not exposed by the API");
assertIncludes(runtime, "vesselRegistry.observeBatch", "current AIS rows are not persisted into the registry");
assertIncludes(vesselRegistry, "DatabaseSync", "the registry is not backed by SQLite");
assertIncludes(vesselRegistry, "vessel_identity_history", "identity changes are not versioned");
assertIncludes(vesselRegistry, "vessel_latest_positions", "latest movement state is not separated from identity");
assertIncludes(vesselRegistry, "vessel_track_points", "bounded track history is absent");
assertIncludes(vesselRegistry, "vessel_identity_conflicts", "identity conflicts cannot be quarantined");
assertIncludes(vesselRegistry, "function listConflicts", "identity conflicts cannot be listed for operator review");
assertIncludes(vesselRegistry, "sortColumns", "registry records cannot be sorted safely");
assertIncludes(vesselRegistry, "databaseBytes", "registry storage usage is not exposed");
assertIncludes(vesselRegistry, 'database.exec("PRAGMA optimize")', "registry maintenance does not optimize SQLite indexes");
assertIncludes(vesselRegistry, 'return "archived"', "archived vessel state is absent");
assertIncludes(runtime, "pocketWorldRefreshDue", "PocketWorld is not continuously merged with other AIS providers");
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
assertIncludes(pocketWorldProvider, "DEFAULT_PAGE_SIZE = 5_000", "PocketWorld page size does not match the provider contract");
assertIncludes(pocketWorldProvider, "PROVIDER_MAX_PAGE_SIZE = 5_000", "PocketWorld requests can exceed the provider page limit");
assertIncludes(pocketWorldProvider, "optionalCountLimit", "PocketWorld does not support an unlimited aggregate count policy");
assertIncludes(pocketWorldProvider, "countLimited: vesselLimit !== null", "PocketWorld count policy is not exposed");
assertNotIncludes(pocketWorldProvider, "PROVIDER_MAX_VESSELS", "PocketWorld still contains a hard aggregate vessel ceiling");
assertIncludes(pocketWorldProvider, "cursorForNextPage", "PocketWorld does not infer an offset cursor when a truncated snapshot omits next_cursor");
assertIncludes(pocketWorldProvider, "metadata.totalAvailable > accumulatedRows", "PocketWorld inferred pagination does not check remaining rows");
assertIncludes(pocketWorldProvider, "maxVessels = 0", "PocketWorld does not default to unlimited aggregate retention");
assertNotIncludes(pocketWorldProvider, "placeholder", "public AIS provider contains placeholder rows");
assertIncludes(runtime, "deriveOperational: OPERATIONAL_PRIORITY_ENABLED", "single-stream operational derivation is absent");
assertIncludes(runtime, 'id: "Jubail Commercial Port"', "Jubail is missing from the eight-port portfolio");
assertIncludes(runtime, "PRIMARY_PORT_REFERENCE_POINTS", "Jeddah and King Abdullah focus is absent");
assertIncludes(runtime, 'id: "world-position-only"', "AIS recovery does not preserve worldwide position coverage");
assertNotIncludes(runtime, 'id: "world-unfiltered"', "the high-volume unfiltered worldwide profile is still active");
assertNotIncludes(runtime, 'id: "primary-ports-position-only"', "tracking recovery can still narrow the subscription by location");
assertNotIncludes(runtime, 'id: "red-sea-gulf-position-only"', "tracking recovery can still narrow to a regional subscription");
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
assertIncludes(startProd, 'process.env.AISSTREAM_SILENT_RESUBSCRIBE_MS', "production startup does not configure in-place silent resubscription");
assertIncludes(startProd, 'process.env.AISSTREAM_HARD_RECONNECT_MS', "production startup does not configure controlled hard reconnects");
assertIncludes(startProd, 'process.env.AISSTREAM_MAX_VESSELS = "0"', "production startup does not remove the AISStream count ceiling");
assertIncludes(startProd, 'process.env.AISSTREAM_OPERATIONAL_MAX_VESSELS = "0"', "production startup does not remove the operational cache count ceiling");
assertIncludes(startProd, 'process.env.DATALASTIC_MAX_VESSELS = "0"', "production startup does not remove the Datalastic cache ceiling");
assertIncludes(startProd, 'process.env.POCKETWORLD_MAX_VESSELS = "0"', "production startup does not remove the PocketWorld aggregate ceiling");
assertIncludes(startProd, 'process.env.RUNTIME_DATA_DIR = runningOnRender ? "/var/data"', "Render persistence is not enforced");
assertIncludes(startProd, 'process.env.VESSEL_REGISTRY_ENABLED = "true"', "production startup does not enable the permanent registry");
assertIncludes(startProd, 'vessel-registry.sqlite', "production startup does not place the registry on persistent storage");
assertIncludes(render, "healthCheckPath: /health/live", "Render liveness endpoint is incorrect");
assertIncludes(render, "VESSEL_REGISTRY_DB_FILE\n        value: /var/data/vessel-registry.sqlite", "Render registry database is not persistent");
assertIncludes(render, "VESSEL_REGISTRY_LAST_KNOWN_AGE_MS\n        value: 86400000", "Render registry last-known policy is not configured");
assertIncludes(render, "value: -90,-180;90,180", "Render does not use the global AIS box");
assertIncludes(render, "AISSTREAM_MAX_VESSELS\n        value: 0", "Render still applies an AISStream vessel-count ceiling");
assertIncludes(render, "AISSTREAM_OPERATIONAL_MAX_VESSELS\n        value: 0", "Render still caps the operational AIS cache");
assertIncludes(render, "AISSTREAM_MAX_AGE_MS\n        value: 86400000", "Render AIS continuity retention is below 24 hours");
assertIncludes(render, "AISSTREAM_RECOVERY_ENABLED\n        value: true", "Render does not enable AIS silent-session recovery");
assertIncludes(render, "AISSTREAM_FIRST_FRAME_TIMEOUT_MS\n        value: 30000", "Render first-frame timeout is not configured");
assertIncludes(render, "AISSTREAM_SILENCE_TIMEOUT_MS\n        value: 90000", "Render silence timeout is too slow");
assertIncludes(render, "AISSTREAM_SILENT_RESUBSCRIBE_MS\n        value: 120000", "Render does not refresh silent subscriptions in place");
assertIncludes(render, "AISSTREAM_HARD_RECONNECT_MS\n        value: 1800000", "Render hard-reconnect interval is too aggressive or absent");
assertIncludes(render, "DATALASTIC_API_KEY\n        sync: false", "Render does not declare the secondary live AIS secret");
assertIncludes(render, "DATALASTIC_SCAN_POINT_IDS", "Render does not configure live AIS fallback coverage");
assertIncludes(render, "POCKETWORLD_AIS_ENABLED\n        value: true", "Render does not enable public live AIS fallback");
assertIncludes(render, "POCKETWORLD_API_URL", "Render does not configure the public AIS endpoint");
assertIncludes(render, "POCKETWORLD_MAX_VESSELS\n        value: 0", "Render still applies a PocketWorld aggregate vessel ceiling");
assertIncludes(render, "POCKETWORLD_MAX_PAGES\n        value: 1000", "Render does not allow complete provider pagination");
assertIncludes(render, "DATALASTIC_MAX_VESSELS\n        value: 0", "Render still caps Datalastic rows");
assertIncludes(render, "POCKETWORLD_DISPLAY_MAX_AGE_MS\n        value: 86400000", "Render regional continuity retention is below 24 hours");
assertIncludes(render, "POCKETWORLD_CACHE_FILE\n        value: /var/data/pocketworld-ais-cache.json", "Render public AIS persistence is absent");
assertIncludes(render, "ECOFAIR_MAX_VESSEL_AGE_MS\n        value: 1800000", "Render EcoFair freshness guard is absent");
assertIncludes(render, "AISSTREAM_RATE_LIMIT_BACKOFF_MS\n        value: 1800000", "Render AIS rate-limit backoff is absent");
assertNotIncludes(render, "FIXED_VESSEL", "Render still configures manual/fixed vessels");
assertNotIncludes(render, "UPSTREAM_VESSEL", "Render still configures a non-AIS vessel provider");
assertNotIncludes(envExample, "FIXED_VESSEL", "environment template still advertises manual vessels");
assertNotIncludes(envExample, "UPSTREAM_VESSEL", "environment template still advertises non-AIS vessels");
assertIncludes(envExample, "AISSTREAM_MAX_VESSELS=0", "environment template does not document unlimited AISStream retention");
assertIncludes(envExample, "VITE_VESSEL_DISPLAY_RETENTION_MS=86400000", "environment template does not document 24-hour browser continuity");
assertIncludes(envExample, "AISSTREAM_SILENT_RESUBSCRIBE_MS=120000", "environment template does not document silent resubscription");
assertIncludes(envExample, "POCKETWORLD_MAX_VESSELS=0", "environment template does not document unlimited PocketWorld retention");
assertIncludes(envExample, "DATALASTIC_MAX_VESSELS=0", "environment template does not document unlimited Datalastic retention");
assertIncludes(dockerfile, "COPY package.json pnpm-lock.yaml ./", "Docker build does not copy the lockfile");
assertIncludes(dockerfile, "pnpm install --frozen-lockfile", "Docker build is not locked");
assertIncludes(packageJson, "scripts/smoke-ais-live.mjs", "live AIS integration smoke test is not part of verification");
assertIncludes(packageJson, "scripts/smoke-live-ais-failover.mjs", "live AIS failover smoke test is not part of verification");
assertIncludes(packageJson, "scripts/smoke-public-live-ais-fallback.mjs", "public live AIS fallback smoke test is not part of verification");
assertIncludes(packageJson, "scripts/smoke-eight-port-ecofair-focus.mjs", "eight-port EcoFair smoke test is not part of verification");
assertIncludes(packageJson, "scripts/smoke-public-live-ais-continuity.mjs", "public AIS continuity smoke test is not part of verification");
assertIncludes(packageJson, "scripts/smoke-ais-rate-limit-backoff.mjs", "AIS rate-limit smoke test is not part of verification");
assertIncludes(packageJson, "scripts/smoke-unbounded-global-ais.mjs", "unbounded global AIS smoke test is not part of verification");
assertIncludes(packageJson, "scripts/smoke-vessel-registry.mjs", "persistent vessel registry smoke test is not part of verification");
assertIncludes(runtime, "optionalCountLimit", "runtime does not support unlimited count policy");
assertIncludes(runtime, 'locationFilter: "none"', "runtime does not expose location-filter-free tracking");
assertIncludes(runtime, "validLatitudeRange: [-90, 90]", "runtime does not expose the full geographic latitude range");
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
