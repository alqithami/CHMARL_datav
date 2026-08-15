import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";

function read(path) {
  return readFileSync(path, "utf8");
}

function write(path, content) {
  writeFileSync(path, content.endsWith("\n") ? content : `${content}\n`);
  console.log(`updated ${path}`);
}

function replaceOnce(content, before, after, label) {
  const index = content.indexOf(before);
  if (index === -1) throw new Error(`Could not find ${label}`);
  if (content.indexOf(before, index + before.length) !== -1) throw new Error(`Found ${label} more than once`);
  return content.slice(0, index) + after + content.slice(index + before.length);
}

function updateRuntime() {
  const path = "server/vessel-feed-proxy/runtime-v3.mjs";
  let content = read(path);

  content = replaceOnce(
    content,
    'import { createEcoFairRuntime } from "./ecofair.mjs";\n',
    'import { createEcoFairRuntime } from "./ecofair.mjs";\nimport { createDatalasticLiveAisProvider } from "./datalastic-live-ais.mjs";\n',
    "Datalastic provider import",
  );

  content = replaceOnce(
    content,
    'const AISSTREAM_SILENCE_TIMEOUT_MS = Math.max(15_000, Number(process.env.AISSTREAM_SILENCE_TIMEOUT_MS ?? 90_000));\nconst MAX_INGEST_BODY_BYTES',
    `const AISSTREAM_SILENCE_TIMEOUT_MS = Math.max(15_000, Number(process.env.AISSTREAM_SILENCE_TIMEOUT_MS ?? 90_000));
const DATALASTIC_AIS_ENABLED = process.env.DATALASTIC_AIS_ENABLED !== "false";
const DATALASTIC_API_KEY = String(process.env.DATALASTIC_API_KEY ?? "").trim();
const DATALASTIC_API_BASE_URL = process.env.DATALASTIC_API_BASE_URL ?? "https://api.datalastic.com/api/v0";
const DATALASTIC_ACTIVATION_DELAY_MS = Math.max(250, Number(process.env.DATALASTIC_ACTIVATION_DELAY_MS ?? 45_000));
const DATALASTIC_SCAN_INTERVAL_MS = Math.max(1_000, Number(process.env.DATALASTIC_SCAN_INTERVAL_MS ?? 15 * 60_000));
const DATALASTIC_TIMEOUT_MS = Math.max(1_000, Number(process.env.DATALASTIC_TIMEOUT_MS ?? 15_000));
const DATALASTIC_SCAN_RADIUS_NM = Math.min(50, Math.max(1, Number(process.env.DATALASTIC_SCAN_RADIUS_NM ?? 50)));
const DATALASTIC_MAX_AGE_MS = Math.max(60_000, Number(process.env.DATALASTIC_MAX_AGE_MS ?? 45 * 60_000));
const DATALASTIC_MAX_VESSELS = Math.max(1, Number(process.env.DATALASTIC_MAX_VESSELS ?? 5000));
const DATALASTIC_SCAN_POINT_SELECTION = String(process.env.DATALASTIC_SCAN_POINT_IDS ?? "Jeddah,King Abdullah Port")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);
const DATALASTIC_SCAN_POINTS = DATALASTIC_SCAN_POINT_SELECTION.some((item) => item.toLowerCase() === "all")
  ? PORT_REFERENCE_POINTS
  : PORT_REFERENCE_POINTS.filter((port) => DATALASTIC_SCAN_POINT_SELECTION.includes(port.id));
const MAX_INGEST_BODY_BYTES`,
    "Datalastic runtime configuration",
  );

  content = replaceOnce(
    content,
    'const operationalAisState = createAisState("operational-priority", OPERATIONAL_BOXES, AISSTREAM_OPERATIONAL_FILTER_TYPES, OPERATIONAL_AIS_CACHE_FILE, AISSTREAM_OPERATIONAL_MAX_VESSELS);\n\nconst vesselInputState = {\n  aisRows: 0,',
    `const operationalAisState = createAisState("operational-priority", OPERATIONAL_BOXES, AISSTREAM_OPERATIONAL_FILTER_TYPES, OPERATIONAL_AIS_CACHE_FILE, AISSTREAM_OPERATIONAL_MAX_VESSELS);
const datalasticProvider = createDatalasticLiveAisProvider({
  apiKey: DATALASTIC_AIS_ENABLED ? DATALASTIC_API_KEY : "",
  baseUrl: DATALASTIC_API_BASE_URL,
  scanPoints: DATALASTIC_SCAN_POINTS,
  radiusNm: DATALASTIC_SCAN_RADIUS_NM,
  scanIntervalMs: DATALASTIC_SCAN_INTERVAL_MS,
  timeoutMs: DATALASTIC_TIMEOUT_MS,
  maxAgeMs: DATALASTIC_MAX_AGE_MS,
  maxVessels: DATALASTIC_MAX_VESSELS,
});

const vesselInputState = {
  aisRows: 0,
  aisstreamRows: 0,
  datalasticRows: 0,
  activeProviders: [],`,
    "Datalastic provider initialization",
  );

  const oldCombined = `async function loadCombinedVessels() {
  try {
    const trackingAis = cacheRows(trackingAisCache, trackingAisState);
    const priorityAis = OPERATIONAL_PRIORITY_ENABLED ? cacheRows(operationalAisCache, operationalAisState) : [];
    const tracking = trackingAis.filter((row) => validCoordinates(row.latitude, row.longitude));
    const operational = operationalVessels(tracking);
    Object.assign(vesselInputState, {
      aisRows: trackingAis.length,
      priorityAisRows: priorityAis.length,
      trackingRows: tracking.length,
      operationalRows: operational.length,
      lastLoadedAt: new Date().toISOString(),
      lastError: null,
    });
    lastCombinedVessels = tracking;
    lastOperationalVessels = operational;
    return { tracking, operational };
  } catch (error) {
    vesselInputState.lastLoadedAt = new Date().toISOString();
    vesselInputState.lastError = error instanceof Error ? error.message : String(error);
    return { tracking: lastCombinedVessels, operational: lastOperationalVessels };
  }
}

function sourceForTracking() {
  if (vesselInputState.aisRows > 0) return "aisstream";
  return AISSTREAM_API_KEY ? "aisstream-waiting" : "none";
}
`;

  const newCombined = `function datalasticFailoverDue() {
  if (!DATALASTIC_AIS_ENABLED || !DATALASTIC_API_KEY || DATALASTIC_SCAN_POINTS.length === 0) return false;
  const lastPrimaryFrame = timestampMs(trackingAisState.lastFrameAt);
  if (lastPrimaryFrame > 0 && Date.now() - lastPrimaryFrame < AISSTREAM_SILENCE_TIMEOUT_MS) return false;
  const serviceStartedAt = timestampMs(SERVICE_STARTED_AT);
  return serviceStartedAt === 0 || Date.now() - serviceStartedAt >= DATALASTIC_ACTIVATION_DELAY_MS;
}

async function loadCombinedVessels() {
  try {
    if (datalasticFailoverDue()) await datalasticProvider.refresh();
    const trackingAis = cacheRows(trackingAisCache, trackingAisState);
    const datalasticAis = datalasticProvider.rows().map((row) => normalizeVessel(row)).filter(Boolean);
    const priorityAis = OPERATIONAL_PRIORITY_ENABLED ? cacheRows(operationalAisCache, operationalAisState) : [];
    const merged = new Map();
    for (const row of datalasticAis) merged.set(row.id, row);
    for (const row of trackingAis) merged.set(row.id, row);
    const tracking = [...merged.values()].filter((row) => validCoordinates(row.latitude, row.longitude));
    const operational = operationalVessels(tracking);
    const activeProviders = [
      ...(trackingAis.length > 0 ? ["aisstream"] : []),
      ...(datalasticAis.length > 0 ? ["datalastic"] : []),
    ];
    Object.assign(vesselInputState, {
      aisRows: tracking.length,
      aisstreamRows: trackingAis.length,
      datalasticRows: datalasticAis.length,
      activeProviders,
      priorityAisRows: priorityAis.length,
      trackingRows: tracking.length,
      operationalRows: operational.length,
      lastLoadedAt: new Date().toISOString(),
      lastError: null,
    });
    lastCombinedVessels = tracking;
    lastOperationalVessels = operational;
    return { tracking, operational };
  } catch (error) {
    vesselInputState.lastLoadedAt = new Date().toISOString();
    vesselInputState.lastError = error instanceof Error ? error.message : String(error);
    return { tracking: lastCombinedVessels, operational: lastOperationalVessels };
  }
}

function sourceForTracking() {
  const aisstreamRows = Number(vesselInputState.aisstreamRows ?? 0);
  const datalasticRows = Number(vesselInputState.datalasticRows ?? 0);
  if (aisstreamRows > 0 && datalasticRows > 0) return "ais-multi-provider";
  if (aisstreamRows > 0) return "aisstream";
  if (datalasticRows > 0) return "datalastic";
  return AISSTREAM_API_KEY || DATALASTIC_API_KEY ? "aisstream-waiting" : "none";
}
`;
  content = replaceOnce(content, oldCombined, newCombined, "combined AIS loading and source selection");

  content = replaceOnce(
    content,
    `function vesselProviderConfigured() {
  return Boolean(AISSTREAM_API_KEY);
}

function providerState() {
  if (!vesselProviderConfigured()) return "unconfigured";
  if (vesselInputState.trackingRows > 0) return trackingAisState.connected ? "live" : "degraded-cache";
  if (trackingAisState.connected) return "connected-waiting";
  if (AISSTREAM_API_KEY) return "reconnecting";
  return "unavailable";
}
`,
    `function vesselProviderConfigured() {
  return Boolean(AISSTREAM_API_KEY || DATALASTIC_API_KEY);
}

function providerState() {
  if (!vesselProviderConfigured()) return "unconfigured";
  if (vesselInputState.trackingRows > 0) return sourceForTracking() === "ais-multi-provider" ? "live-multi-provider" : "live";
  const datalasticState = datalasticProvider.publicState();
  if (["unauthorized", "credits-exhausted", "rate-limited", "provider-error", "request-error", "timeout"].includes(datalasticState.status)) {
    return `datalastic-${datalasticState.status}`;
  }
  if (trackingAisState.connected) return DATALASTIC_API_KEY ? "aisstream-silent-failover-waiting" : "connected-waiting";
  if (AISSTREAM_API_KEY || DATALASTIC_API_KEY) return "reconnecting";
  return "unavailable";
}
`,
    "aggregate provider state",
  );

  content = replaceOnce(
    content,
    `    trackingScope: {
      mode: GLOBAL_TRACKING_ENABLED ? "global" : "regional",
      bbox: TRACKING_BBOX_TEXT,`,
    `    trackingScope: {
      mode: sourceForTracking() === "datalastic" ? "monitored-port-failover" : (GLOBAL_TRACKING_ENABLED ? "global" : "regional"),
      source: sourceForTracking(),
      bbox: TRACKING_BBOX_TEXT,`,
    "tracking scope provider source",
  );

  content = replaceOnce(
    content,
    `    aisstream: publicAisState(trackingAisState),
    operationalAisstream: publicAisState(operationalAisState),`,
    `    aisstream: publicAisState(trackingAisState),
    operationalAisstream: publicAisState(operationalAisState),
    datalastic: datalasticProvider.publicState(),`,
    "Datalastic health state",
  );

  content = replaceOnce(
    content,
    `function shutdown() {
  stopping = true;`,
    `function shutdown() {
  stopping = true;
  datalasticProvider.shutdown();`,
    "Datalastic shutdown",
  );

  content = replaceOnce(
    content,
    `      health: publicAisState(trackingAisState),
      operationalHealth: publicAisState(operationalAisState),`,
    `      health: publicAisState(trackingAisState),
      operationalHealth: publicAisState(operationalAisState),
      providers: {
        aisstream: publicAisState(trackingAisState),
        datalastic: datalasticProvider.publicState(),
      },`,
    "vessel API provider diagnostics",
  );

  content = replaceOnce(
    content,
    '"- Vessel tracking: one self-healing AISStream connection starts with worldwide coverage and rotates among genuine live-AIS subscription profiles when a connected socket produces no frames; it populates both the display cache and the monitored-port operational cache; operational calculations remain restricted to port geofences."',
    '"- Vessel tracking: AISStream remains the primary worldwide live AIS source. When it produces no frames, the runtime can activate a separately authenticated Datalastic live AIS scan around monitored ports. Both sources contain genuine AIS observations; no manual or synthetic vessel rows are accepted."',
    "report provider-chain wording",
  );

  content = replaceOnce(
    content,
    `  if (AISSTREAM_API_KEY) console.log("AISStream live mode enabled.");
});`,
    `  if (AISSTREAM_API_KEY) console.log("AISStream live mode enabled.");
  if (DATALASTIC_API_KEY) console.log(\`Datalastic live AIS failover enabled for \${DATALASTIC_SCAN_POINTS.map((point) => point.id).join(", ") || "no scan points"}.\`);
  else console.log("Datalastic live AIS failover is not configured.");
});`,
    "startup failover logging",
  );

  write(path, content);
}

function updateStartProd() {
  const path = "scripts/start-prod.mjs";
  let content = read(path);
  content = replaceOnce(
    content,
    `process.env.AISSTREAM_CACHE_FLUSH_MS ??= "15000";
process.env.AISSTREAM_CACHE_FILE`,
    `process.env.AISSTREAM_CACHE_FLUSH_MS ??= "15000";
process.env.DATALASTIC_AIS_ENABLED ??= "true";
process.env.DATALASTIC_API_BASE_URL ??= "https://api.datalastic.com/api/v0";
process.env.DATALASTIC_ACTIVATION_DELAY_MS ??= "45000";
process.env.DATALASTIC_SCAN_INTERVAL_MS ??= "900000";
process.env.DATALASTIC_TIMEOUT_MS ??= "15000";
process.env.DATALASTIC_SCAN_RADIUS_NM ??= "50";
process.env.DATALASTIC_MAX_AGE_MS ??= "2700000";
process.env.DATALASTIC_MAX_VESSELS ??= "5000";
process.env.DATALASTIC_SCAN_POINT_IDS ??= "Jeddah,King Abdullah Port";
process.env.AISSTREAM_CACHE_FILE`,
    "production Datalastic defaults",
  );
  content = replaceOnce(
    content,
    'console.log("Vessel input policy: live AIS only; manual, fixed, sample, and upstream vessel rows are disabled.");\nif (process.env.AISSTREAM_API_KEY?.trim()) console.log("AISStream API key loaded from environment.");',
    'console.log("Vessel input policy: genuine live AIS only; AISStream is primary and Datalastic is optional failover. Manual, fixed, sample, and synthetic vessel rows are disabled.");\nif (process.env.AISSTREAM_API_KEY?.trim()) console.log("AISStream API key loaded from environment.");\nif (process.env.DATALASTIC_API_KEY?.trim()) console.log("Datalastic live AIS failover key loaded from environment.");\nelse console.log("Datalastic live AIS failover key is not configured.");',
    "production provider policy logging",
  );
  write(path, content);
}

function updateEnvironmentFiles() {
  const envPath = ".env.example";
  let env = read(envPath);
  env = replaceOnce(
    env,
    `AISSTREAM_CACHE_FLUSH_MS=30000

# EcoFair-CH-MARL operational scope.`,
    `AISSTREAM_CACHE_FLUSH_MS=30000

# Optional second genuine live-AIS provider. It is activated only when AISStream
# has delivered no frames. No placeholder or manually positioned vessels are used.
DATALASTIC_AIS_ENABLED=true
DATALASTIC_API_KEY=
DATALASTIC_API_BASE_URL=https://api.datalastic.com/api/v0
DATALASTIC_ACTIVATION_DELAY_MS=45000
DATALASTIC_SCAN_INTERVAL_MS=900000
DATALASTIC_TIMEOUT_MS=15000
DATALASTIC_SCAN_RADIUS_NM=50
DATALASTIC_MAX_AGE_MS=2700000
DATALASTIC_MAX_VESSELS=5000
DATALASTIC_SCAN_POINT_IDS=Jeddah,King Abdullah Port

# EcoFair-CH-MARL operational scope.`,
    "environment Datalastic block",
  );
  write(envPath, env);

  const renderPath = "render.yaml";
  let render = read(renderPath);
  render = replaceOnce(
    render,
    `      - key: AISSTREAM_CACHE_FLUSH_MS
        value: 30000
      - key: CHMARL_RUNTIME_ENABLED`,
    `      - key: AISSTREAM_CACHE_FLUSH_MS
        value: 30000
      - key: DATALASTIC_AIS_ENABLED
        value: true
      - key: DATALASTIC_API_KEY
        sync: false
      - key: DATALASTIC_API_BASE_URL
        value: https://api.datalastic.com/api/v0
      - key: DATALASTIC_ACTIVATION_DELAY_MS
        value: 45000
      - key: DATALASTIC_SCAN_INTERVAL_MS
        value: 900000
      - key: DATALASTIC_TIMEOUT_MS
        value: 15000
      - key: DATALASTIC_SCAN_RADIUS_NM
        value: 50
      - key: DATALASTIC_MAX_AGE_MS
        value: 2700000
      - key: DATALASTIC_MAX_VESSELS
        value: 5000
      - key: DATALASTIC_SCAN_POINT_IDS
        value: "Jeddah,King Abdullah Port"
      - key: CHMARL_RUNTIME_ENABLED`,
    "Render Datalastic block",
  );
  write(renderPath, render);
}

function updateFrontend() {
  const vesselPath = "src/data/chmarlData.ts";
  let vessels = read(vesselPath);
  vessels = replaceOnce(
    vessels,
    `  timestamp?: string;
  trail?: VesselTrailPoint[];`,
    `  timestamp?: string;
  inputSource?: string;
  trail?: VesselTrailPoint[];`,
    "vessel input provenance type",
  );
  write(vesselPath, vessels);

  const providerPath = "src/providers/dashboardDataProvider.ts";
  let provider = read(providerPath);
  provider = replaceOnce(
    provider,
    `function normalizeSource(value: unknown): DashboardDataSource {
  if (value === "aisstream") return "aisstream";
  if (value === "aisstream-waiting") return "aisstream-waiting";
  return "none";
}`,
    `function normalizeSource(value: unknown): DashboardDataSource {
  if (value === "aisstream") return "aisstream";
  if (value === "datalastic") return "datalastic";
  if (value === "ais-multi-provider") return "ais-multi-provider";
  if (value === "aisstream-waiting") return "aisstream-waiting";
  return "none";
}`,
    "frontend AIS source normalization",
  );
  provider = replaceOnce(
    provider,
    `    timestamp: row.timestamp,
    trail: normalizeTrail(row.trail ?? row.history ?? row.track),`,
    `    timestamp: row.timestamp,
    inputSource: row.inputSource,
    trail: normalizeTrail(row.trail ?? row.history ?? row.track),`,
    "frontend vessel provenance mapping",
  );
  write(providerPath, provider);

  const dataPath = "src/data/loadSampleDashboardData.ts";
  let data = read(dataPath);
  data = replaceOnce(
    data,
    'export type DashboardDataSource = "aisstream" | "aisstream-waiting" | "upstream" | "remote" | "local-json" | "fallback" | "none";',
    'export type DashboardDataSource = "aisstream" | "datalastic" | "ais-multi-provider" | "aisstream-waiting" | "upstream" | "remote" | "local-json" | "fallback" | "none";',
    "dashboard source type",
  );
  data = replaceOnce(
    data,
    `function isExternalSource(source: DashboardDataSource) {
  return source === "aisstream" || source === "aisstream-waiting";
}`,
    `function isExternalSource(source: DashboardDataSource) {
  return source === "aisstream"
    || source === "datalastic"
    || source === "ais-multi-provider"
    || source === "aisstream-waiting";
}`,
    "external live AIS source classification",
  );
  data = replaceOnce(
    data,
    `  if (!isExternalSource(source)) return [];
  const continuity = vesselScope.heldRows > 0`,
    `  if (!isExternalSource(source)) return [];
  const providerLabel = source === "datalastic"
    ? "Datalastic live AIS failover"
    : source === "ais-multi-provider"
      ? "AISStream + Datalastic live AIS"
      : "AISStream live AIS";
  const continuity = vesselScope.heldRows > 0`,
    "timeline provider label",
  );
  data = replaceOnce(
    data,
    `    title: chmarlSource !== "none" ? "Stable global tracking + port-scoped inference active" : "Live AIS tracking feed active",
    body: \`${'${vesselScope.trackingRows}'} vessels are retained for map tracking from ${'${vesselScope.reportedRows}'} live AIS API rows; ${'${vesselScope.operationalRows}'} vessels within ${'${vesselScope.operationalRadiusNm}'} nm of monitored ports are used by EcoFair-CH-MARL. ${'${continuity}'} Port source: ${'${portOpsSource}'}.\`,`,
    `    title: chmarlSource !== "none" ? "Live AIS tracking + port-scoped inference active" : \`${'${providerLabel}'} active\`,
    body: \`${'${vesselScope.trackingRows}'} vessels are retained for map tracking from ${'${vesselScope.reportedRows}'} genuine live AIS rows supplied by ${'${providerLabel}'}; ${'${vesselScope.operationalRows}'} vessels within ${'${vesselScope.operationalRadiusNm}'} nm of monitored ports are used by EcoFair-CH-MARL. ${'${continuity}'} Port source: ${'${portOpsSource}'}.\`,`,
    "timeline live AIS wording",
  );
  write(dataPath, data);

  const qualityPath = "src/components/DataQualityPanel.tsx";
  let quality = read(qualityPath);
  quality = replaceOnce(
    quality,
    `  if (data.source === "aisstream-waiting") {
    return {`,
    `  if (data.source === "datalastic") {
    return {
      label: "Vessel tracking",
      value: \`${'${trackingRows}'} live AIS rows\`,
      detail: \`Datalastic genuine AIS failover is active because AISStream is not delivering frames · ${'${operationalRows}'} within ${'${radius}'} nm port scope · ${'${coverage}'}% positioned · ${'${stale}'} stale\`,
      tone: trackingRows > 0 && stale < trackingRows ? "good" : "warn",
    };
  }
  if (data.source === "ais-multi-provider") {
    return {
      label: "Vessel tracking",
      value: \`${'${trackingRows}'} multi-provider AIS rows\`,
      detail: \`AISStream and Datalastic genuine AIS observations are merged by MMSI · ${'${operationalRows}'} within ${'${radius}'} nm port scope · ${'${coverage}'}% positioned · ${'${stale}'} stale\`,
      tone: trackingRows > 0 && stale < trackingRows ? "good" : "warn",
    };
  }
  if (data.source === "aisstream-waiting") {
    return {`,
    "Datalastic quality states",
  );
  quality = replaceOnce(
    quality,
    '        : "The backend websocket is open, but the provider has not delivered any usable live AIS position messages yet.",',
    '        : "AISStream is connected but delivering no frames. The portal will use Datalastic genuine live AIS automatically when DATALASTIC_API_KEY is configured in Render.",',
    "actionable silent-provider detail",
  );
  quality = replaceOnce(
    quality,
    `  if (data.source === "aisstream-waiting") return tracking > 0 ? \`${'${tracking}'} recent vessels retained while AIS is silent\` : "AIS connected but silent · no usable positions";
  if (data.source === "aisstream" && operational > 0)`,
    `  if (data.source === "aisstream-waiting") return tracking > 0 ? \`${'${tracking}'} recent vessels retained while AIS is silent\` : "AISStream silent · secondary live AIS not active";
  if (data.source === "datalastic") return \`Datalastic live AIS failover · ${'${tracking}'} vessels · ${'${operational}'} port calculations\`;
  if (data.source === "ais-multi-provider") return \`Multi-provider live AIS · ${'${tracking}'} vessels · ${'${operational}'} port calculations\`;
  if (data.source === "aisstream" && operational > 0)`,
    "readiness provider headlines",
  );
  write(qualityPath, quality);
}

function updateMonitoring() {
  const path = "scripts/check-deployed-service.mjs";
  let content = read(path);
  content = replaceOnce(
    content,
    `function providerSnapshot(vessels) {
  const health = vessels?.health ?? {};
  return {
    source: vessels?.source ?? null,`,
    `function providerSnapshot(vessels) {
  const source = vessels?.source ?? null;
  const providers = vessels?.providers ?? {};
  const primaryHealth = vessels?.health ?? providers.aisstream ?? {};
  const health = source === "datalastic"
    ? (providers.datalastic ?? primaryHealth)
    : primaryHealth;
  return {
    source,`,
    "deployment monitor provider selection",
  );
  content = replaceOnce(
    content,
    `    watchdogRestarts: numeric(health?.watchdogRestarts),
  };`,
    `    watchdogRestarts: numeric(primaryHealth?.watchdogRestarts),
    activeProvider: source === "datalastic" ? "datalastic" : source === "ais-multi-provider" ? "multi-provider" : "aisstream",
    datalasticStatus: providers.datalastic?.status ?? null,
    datalasticRows: numeric(vessels?.inputs?.datalasticRows),
  };`,
    "deployment monitor Datalastic fields",
  );
  write(path, content);
}

function updateValidation() {
  const packagePath = "package.json";
  const packageJson = JSON.parse(read(packagePath));
  packageJson.scripts["verify:runtime"] = "node --check server/vessel-feed-proxy/runtime-v3.mjs && node --check server/vessel-feed-proxy/datalastic-live-ais.mjs && node scripts/check-runtime-contract.mjs && node scripts/smoke-runtime.mjs && node scripts/smoke-ais-live.mjs && node scripts/smoke-live-ais-failover.mjs";
  write(packagePath, JSON.stringify(packageJson, null, 2));

  const contractPath = "scripts/check-runtime-contract.mjs";
  let contract = read(contractPath);
  contract = replaceOnce(
    contract,
    'const runtime = read("server/vessel-feed-proxy/runtime-v3.mjs");\n',
    'const runtime = read("server/vessel-feed-proxy/runtime-v3.mjs");\nconst datalasticProvider = read("server/vessel-feed-proxy/datalastic-live-ais.mjs");\n',
    "Datalastic contract module read",
  );
  contract = replaceOnce(
    contract,
    `assertIncludes(runtime, "perMessageDeflate: false", "AIS websocket compression is not explicitly disabled");`,
    `assertIncludes(runtime, "perMessageDeflate: false", "AIS websocket compression is not explicitly disabled");
assertIncludes(runtime, "createDatalasticLiveAisProvider", "secondary genuine live AIS provider is not integrated");
assertIncludes(runtime, "datalasticFailoverDue", "silent AISStream sessions do not activate live AIS failover");
assertIncludes(runtime, 'return "datalastic"', "Datalastic live AIS source is not exposed");
assertIncludes(runtime, 'return "ais-multi-provider"', "multi-provider AIS source is not exposed");
assertIncludes(datalasticProvider, '"x-api-key": key', "Datalastic key is not sent securely in a request header");
assertIncludes(datalasticProvider, 'inputSource: "datalastic-live-ais"', "Datalastic vessel provenance is absent");
assertNotIncludes(datalasticProvider, "manual", "Datalastic provider contains manual vessel logic");`,
    "Datalastic runtime contract assertions",
  );
  contract = replaceOnce(
    contract,
    `assertIncludes(render, "AISSTREAM_SILENCE_TIMEOUT_MS\\n        value: 90000", "Render silence timeout is too slow");`,
    `assertIncludes(render, "AISSTREAM_SILENCE_TIMEOUT_MS\\n        value: 90000", "Render silence timeout is too slow");
assertIncludes(render, "DATALASTIC_API_KEY\\n        sync: false", "Render does not declare the secondary live AIS secret");
assertIncludes(render, "DATALASTIC_SCAN_POINT_IDS", "Render does not configure live AIS fallback coverage");`,
    "Render Datalastic contract assertions",
  );
  contract = replaceOnce(
    contract,
    `assertIncludes(packageJson, "scripts/smoke-ais-live.mjs", "live AIS integration smoke test is not part of verification");`,
    `assertIncludes(packageJson, "scripts/smoke-ais-live.mjs", "live AIS integration smoke test is not part of verification");
assertIncludes(packageJson, "scripts/smoke-live-ais-failover.mjs", "live AIS failover smoke test is not part of verification");`,
    "failover smoke contract assertion",
  );
  write(contractPath, contract);
}

function updateDocumentation() {
  write("docs/LIVE_AIS_PROVIDER_FAILOVER.md", `# Live AIS provider failover

The production portal accepts only genuine AIS observations. It never inserts manually positioned, fixed, sample, or synthetic vessels.

## Provider order

1. AISStream WebSocket remains the primary worldwide source.
2. When AISStream has delivered no frame for the configured activation window, the runtime can scan monitored ports through Datalastic's live AIS Location Traffic endpoint.
3. When AISStream recovers, its worldwide observations take precedence for duplicate MMSIs. Datalastic observations remain visible only until their real timestamps exceed the configured age limit.

## Render secret required

Set this secret in the Render service environment:

\`DATALASTIC_API_KEY=<your Datalastic API key>\`

Do not place the key in GitHub, a Vite variable, or browser code. The backend sends it only in the \`x-api-key\` request header.

The repository Blueprint already defines the non-secret controls:

- \`DATALASTIC_AIS_ENABLED=true\`
- \`DATALASTIC_ACTIVATION_DELAY_MS=45000\`
- \`DATALASTIC_SCAN_INTERVAL_MS=900000\`
- \`DATALASTIC_SCAN_RADIUS_NM=50\`
- \`DATALASTIC_MAX_AGE_MS=2700000\`
- \`DATALASTIC_SCAN_POINT_IDS=Jeddah,King Abdullah Port\`

The default deliberately scans one port per interval to control API credits. Expand the comma-separated scan-point list or set it to \`all\` only after selecting a plan that supports the resulting traffic volume.

## Runtime evidence

\`/health\` exposes separate \`aisstream\` and \`datalastic\` states. \`/api/vessels\` exposes the active source as \`aisstream\`, \`datalastic\`, or \`ais-multi-provider\`, together with per-provider diagnostics. A Datalastic row retains \`inputSource=datalastic-live-ais\` and its provider timestamp.
`);
}

function removeBootstrapFiles() {
  for (const path of [
    "scripts/apply-live-ais-provider-failover.mjs",
    ".github/workflows/apply-live-ais-provider-failover.yml",
  ]) {
    if (existsSync(path)) {
      rmSync(path);
      console.log(`removed ${path}`);
    }
  }
}

updateRuntime();
updateStartProd();
updateEnvironmentFiles();
updateFrontend();
updateMonitoring();
updateValidation();
updateDocumentation();
removeBootstrapFiles();
console.log("Live AIS provider failover patch applied.");
