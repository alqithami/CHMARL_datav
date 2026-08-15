import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";

function read(path) {
  return readFileSync(path, "utf8");
}

function write(path, content) {
  writeFileSync(path, content.endsWith("\n") ? content : `${content}\n`);
  console.log(`updated ${path}`);
}

function replaceOnce(content, before, after, label) {
  const first = content.indexOf(before);
  if (first === -1) throw new Error(`Could not find ${label}`);
  if (content.indexOf(before, first + before.length) !== -1) throw new Error(`Found ${label} more than once`);
  return content.slice(0, first) + after + content.slice(first + before.length);
}

function replacePattern(content, pattern, replacement, label) {
  if (!pattern.test(content)) throw new Error(`Could not find ${label}`);
  pattern.lastIndex = 0;
  const next = content.replace(pattern, replacement);
  pattern.lastIndex = 0;
  if (pattern.test(next)) throw new Error(`Replacement left ${label} behind`);
  return next;
}

function updateRuntime() {
  const path = "server/vessel-feed-proxy/runtime-v3.mjs";
  let content = read(path);

  content = replacePattern(
    content,
    /const GLOBAL_TRACKING_ENABLED = process\.env\.AISSTREAM_GLOBAL_TRACKING_ENABLED !== "false";[\s\S]*?const AISSTREAM_OPERATIONAL_FILTER_TYPES = .*?;\n/,
    `const GLOBAL_TRACKING_ENABLED = true;\nconst TRACKING_BBOX_TEXT = WORLD_AIS_BBOX;\nconst OPERATIONAL_PRIORITY_ENABLED = process.env.AISSTREAM_OPERATIONAL_PRIORITY_ENABLED !== "false";\nconst OPERATIONAL_BBOX_TEXT = process.env.AISSTREAM_OPERATIONAL_BBOX ?? mergeBboxes(REGIONAL_AIS_BBOX, SAUDI_PORT_BBOX);\nconst TRACKING_BOXES = parseBoundingBoxes(TRACKING_BBOX_TEXT);\nconst OPERATIONAL_BOXES = parseBoundingBoxes(OPERATIONAL_BBOX_TEXT);\nconst AISSTREAM_API_KEY = String(process.env.AISSTREAM_API_KEY ?? "").trim();\nconst AISSTREAM_URL = process.env.AISSTREAM_URL ?? "wss://stream.aisstream.io/v0/stream";\nconst AISSTREAM_FILTER_TYPES = [];\nconst AISSTREAM_OPERATIONAL_FILTER_TYPES = [];\n`,
    "AIS subscription configuration block",
  );

  content = replaceOnce(
    content,
    'const FIXED_VESSEL_DATA_FILE = runtimePath("FIXED_VESSEL_DATA_FILE", "manual-vessels.json");\n',
    "",
    "fixed vessel runtime path",
  );

  content = replacePattern(
    content,
    /const UPSTREAM_URL = process\.env\.UPSTREAM_VESSEL_DATA_URL;[\s\S]*?const FIXED_VESSEL_INGEST_TOKEN = process\.env\.FIXED_VESSEL_INGEST_TOKEN;\n/,
    "",
    "non-AIS vessel provider constants",
  );

  content = replacePattern(
    content,
    /const vesselInputState = \{[\s\S]*?\n\};\n\nconst chmarlState/,
    `const vesselInputState = {\n  aisRows: 0,\n  priorityAisRows: 0,\n  trackingRows: 0,\n  operationalRows: 0,\n  operationalRadiusNm: ECOFAIR_OPERATIONAL_RADIUS_NM,\n  lastLoadedAt: null,\n  lastError: null,\n};\n\nconst chmarlState`,
    "vessel input state",
  );

  content = replaceOnce(
    content,
    "    lastMessageAt: null,\n    lastError: null,\n",
    "    lastMessageAt: null,\n    lastFrameAt: null,\n    subscriptionSentAt: null,\n    subscription: null,\n    lastError: null,\n",
    "AIS state frame metadata",
  );

  content = replacePattern(
    content,
    /async function loadFixedVessels\(\) \{[\s\S]*?\n\}\n\nasync function loadUpstreamVessels\(\) \{[\s\S]*?\n\}\n\nfunction operationalVessels/,
    "function operationalVessels",
    "fixed and upstream vessel loaders",
  );

  content = replacePattern(
    content,
    /async function loadCombinedVessels\(\) \{[\s\S]*?\n\}\n\nfunction sourceForTracking\(\) \{[\s\S]*?\n\}\n/,
    `async function loadCombinedVessels() {\n  try {\n    const trackingAis = cacheRows(trackingAisCache, trackingAisState);\n    const priorityAis = OPERATIONAL_PRIORITY_ENABLED ? cacheRows(operationalAisCache, operationalAisState) : [];\n    const tracking = trackingAis.filter((row) => validCoordinates(row.latitude, row.longitude));\n    const operational = operationalVessels(tracking);\n    Object.assign(vesselInputState, {\n      aisRows: trackingAis.length,\n      priorityAisRows: priorityAis.length,\n      trackingRows: tracking.length,\n      operationalRows: operational.length,\n      lastLoadedAt: new Date().toISOString(),\n      lastError: null,\n    });\n    lastCombinedVessels = tracking;\n    lastOperationalVessels = operational;\n    return { tracking, operational };\n  } catch (error) {\n    vesselInputState.lastLoadedAt = new Date().toISOString();\n    vesselInputState.lastError = error instanceof Error ? error.message : String(error);\n    return { tracking: lastCombinedVessels, operational: lastOperationalVessels };\n  }\n}\n\nfunction sourceForTracking() {\n  if (vesselInputState.aisRows > 0) return "aisstream";\n  return AISSTREAM_API_KEY ? "aisstream-waiting" : "none";\n}\n`,
    "AIS-only combined vessel loader",
  );

  content = replacePattern(
    content,
    /function writeFixedVessels\(payload\) \{[\s\S]*?\n\}\n\nfunction updateChmarlState/,
    "function updateChmarlState",
    "fixed vessel writer",
  );

  content = replaceOnce(
    content,
    "    socket.send(JSON.stringify({ APIKey: AISSTREAM_API_KEY, BoundingBoxes: boxes, ...(filters.length > 0 ? { FilterMessageTypes: filters } : {}) }));\n",
    `    const subscription = { APIKey: AISSTREAM_API_KEY, BoundingBoxes: boxes };\n    state.subscriptionSentAt = new Date().toISOString();\n    state.subscription = { boundingBoxes: boxes, filterMessageTypes: [] };\n    socket.send(JSON.stringify(subscription));\n`,
    "AIS subscription send",
  );

  content = replaceOnce(
    content,
    "      state.messageCount += 1;\n      const raw = JSON.parse(data.toString());\n",
    "      state.messageCount += 1;\n      state.lastFrameAt = new Date().toISOString();\n      const raw = JSON.parse(data.toString());\n",
    "AIS frame timestamp",
  );

  content = replaceOnce(
    content,
    "  const lastSignal = Math.max(timestampMs(state.lastMessageAt), timestampMs(state.openedAt));\n",
    "  const lastSignal = Math.max(timestampMs(state.lastFrameAt), timestampMs(state.openedAt));\n",
    "AIS watchdog signal",
  );
  content = replaceOnce(
    content,
    "      ? `AIS provider produced no usable positions for ${Math.round((now - lastSignal) / 1000)} seconds`\n",
    "      ? `AIS provider produced no frames for ${Math.round((now - lastSignal) / 1000)} seconds`\n",
    "AIS watchdog message",
  );

  content = replacePattern(
    content,
    /function vesselProviderConfigured\(\) \{[\s\S]*?\n\}\n\nfunction providerState/,
    `function vesselProviderConfigured() {\n  return Boolean(AISSTREAM_API_KEY);\n}\n\nfunction providerState`,
    "vessel provider configuration",
  );

  content = replaceOnce(
    content,
    "    persistence: { dataDir: RUNTIME_DATA_DIR, trackingCacheFile: TRACKING_AIS_CACHE_FILE, operationalCacheFile: OPERATIONAL_AIS_CACHE_FILE, ecofairStateFile: ECOFAIR_STATE_FILE, fixedVesselFile: FIXED_VESSEL_DATA_FILE },\n",
    "    persistence: { dataDir: RUNTIME_DATA_DIR, trackingCacheFile: TRACKING_AIS_CACHE_FILE, operationalCacheFile: OPERATIONAL_AIS_CACHE_FILE, ecofairStateFile: ECOFAIR_STATE_FILE },\n",
    "health persistence payload",
  );

  content = replacePattern(
    content,
    /\n  if \(path === "\/api\/vessels\/ingest" && request\.method === "POST"\) \{[\s\S]*?\n  \}\n\n  if \(\(path === "\/api\/chmarl\/episode"/,
    '\n  if ((path === "/api/chmarl/episode"',
    "fixed vessel ingest route",
  );

  content = replaceOnce(
    content,
    '"/api/vessels?scope=operational", "/api/vessels/ingest", "/api/chmarl/episode"',
    '"/api/vessels?scope=operational", "/api/chmarl/episode"',
    "available vessel endpoints",
  );

  const forbidden = [
    "FIXED_VESSEL",
    "UPSTREAM_VESSEL",
    "loadFixedVessels",
    "loadUpstreamVessels",
    "writeFixedVessels",
    "/api/vessels/ingest",
    "manual-fixed-vessels",
  ];
  for (const text of forbidden) {
    if (content.includes(text)) throw new Error(`AIS-only runtime still contains ${text}`);
  }
  if (!content.includes("const TRACKING_BBOX_TEXT = WORLD_AIS_BBOX;")) throw new Error("Global AIS bounding box is not enforced");
  if (!content.includes("const AISSTREAM_FILTER_TYPES = [];")) throw new Error("Unfiltered AIS subscription is not enforced");
  write(path, content);
}

function updateStartProd() {
  const path = "scripts/start-prod.mjs";
  const content = `import { existsSync, readFileSync } from "node:fs";\nimport { spawn } from "node:child_process";\nimport { join, resolve } from "node:path";\n\nconst WORLD_AIS_BBOX = "-90,-180;90,180";\nconst REGIONAL_AIS_BBOX = "11,32;31,56";\nconst SAUDI_PORT_AIS_BBOXES = [\n  "20.70,38.35;22.95,39.85",\n  "23.25,37.15;24.90,38.90",\n  "16.15,41.75;17.55,43.35",\n  "25.70,49.25;27.25,50.90",\n  "24.35,54.35;25.65,55.75",\n  "29.20,32.00;30.55,33.25",\n].join("|");\n\nfunction mergeBboxText(...values) {\n  return [...new Set(values.flatMap((value) => String(value ?? "").split("|").map((box) => box.trim()).filter(Boolean)))].join("|");\n}\n\nfunction loadEnvFile(fileName) {\n  const filePath = resolve(process.cwd(), fileName);\n  if (!existsSync(filePath)) return;\n  const source = readFileSync(filePath, "utf8");\n  for (const line of source.split(/\\r?\\n/)) {\n    const trimmed = line.trim();\n    if (!trimmed || trimmed.startsWith("#")) continue;\n    const separatorIndex = trimmed.indexOf("=");\n    if (separatorIndex === -1) continue;\n    const key = trimmed.slice(0, separatorIndex).trim();\n    let value = trimmed.slice(separatorIndex + 1).trim();\n    if (!key || process.env[key] !== undefined) continue;\n    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);\n    process.env[key] = value;\n  }\n}\n\nloadEnvFile(".env");\nloadEnvFile(".env.local");\n\nconst runningOnRender = Boolean(process.env.RENDER || process.env.RENDER_SERVICE_ID || process.env.RENDER_GIT_COMMIT);\nprocess.env.STATIC_DIR ??= "dist";\nprocess.env.PORT ??= "8787";\nprocess.env.RUNTIME_DATA_DIR = runningOnRender ? "/var/data" : (process.env.RUNTIME_DATA_DIR || ".runtime");\nprocess.env.AISSTREAM_URL = runningOnRender\n  ? "wss://stream.aisstream.io/v0/stream"\n  : (process.env.AISSTREAM_URL?.trim() || "wss://stream.aisstream.io/v0/stream");\nprocess.env.AISSTREAM_GLOBAL_TRACKING_ENABLED = "true";\nprocess.env.AISSTREAM_TRACKING_BBOX = WORLD_AIS_BBOX;\nprocess.env.AISSTREAM_FILTER_TYPES = "";\nprocess.env.AISSTREAM_OPERATIONAL_PRIORITY_ENABLED = "true";\nprocess.env.AISSTREAM_OPERATIONAL_BBOX ??= mergeBboxText(REGIONAL_AIS_BBOX, SAUDI_PORT_AIS_BBOXES);\nprocess.env.AISSTREAM_OPERATIONAL_FILTER_TYPES = "";\nprocess.env.AISSTREAM_MAX_VESSELS = runningOnRender ? "20000" : (process.env.AISSTREAM_MAX_VESSELS || "20000");\nprocess.env.AISSTREAM_OPERATIONAL_MAX_VESSELS ??= "3000";\nprocess.env.AISSTREAM_MAX_AGE_MS ??= String(6 * 60 * 60 * 1000);\nprocess.env.AISSTREAM_TRAIL_POINTS = runningOnRender ? "4" : (process.env.AISSTREAM_TRAIL_POINTS || "4");\nprocess.env.AISSTREAM_CACHE_ENABLED ??= "true";\nprocess.env.AISSTREAM_CACHE_FLUSH_MS ??= "15000";\nprocess.env.AISSTREAM_CACHE_FILE = join(process.env.RUNTIME_DATA_DIR, "ais-tracking-cache.json");\nprocess.env.AISSTREAM_OPERATIONAL_CACHE_FILE = join(process.env.RUNTIME_DATA_DIR, "ais-operational-cache.json");\nprocess.env.ECOFAIR_STATE_FILE = join(process.env.RUNTIME_DATA_DIR, "ecofair-state.json");\nprocess.env.CHMARL_EXPERIMENT_FILE ??= join(process.env.RUNTIME_DATA_DIR, "chmarl-episode.json");\nprocess.env.PORT_EVENTS_FILE ??= join(process.env.RUNTIME_DATA_DIR, "port-events.json");\nprocess.env.WEATHER_FILE ??= join(process.env.RUNTIME_DATA_DIR, "weather.json");\nprocess.env.CHMARL_RUNTIME_ENABLED ??= "true";\nprocess.env.ECOFAIR_OPERATIONAL_RADIUS_NM ??= "120";\nprocess.env.ECOFAIR_EMISSION_BUDGET_TONNES_PER_DAY ??= "0";\nprocess.env.ECOFAIR_BUDGET_TONNES_PER_VESSEL_PER_DAY ??= "60";\n\nconsole.log(\`Starting production CH-MARL service on port \${process.env.PORT}\`);\nconsole.log("Vessel input policy: live AIS only; manual, fixed, sample, and upstream vessel rows are disabled.");\nif (process.env.AISSTREAM_API_KEY?.trim()) console.log("AISStream API key loaded from environment.");\nconsole.log(\`Global AIS tracking: true\`);\nconsole.log(\`Global AIS BBOX: \${WORLD_AIS_BBOX}\`);\nconsole.log("AIS message filter: none (all provider frames accepted; position-bearing frames are normalized).");\nconsole.log(\`Operational AIS derivation: \${process.env.AISSTREAM_OPERATIONAL_PRIORITY_ENABLED}\`);\nconsole.log(\`Runtime data directory: \${process.env.RUNTIME_DATA_DIR}\`);\nconsole.log(\`EcoFair operational radius: \${process.env.ECOFAIR_OPERATIONAL_RADIUS_NM} nm\`);\n\nconst child = spawn("node", ["server/vessel-feed-proxy/index.mjs"], {\n  stdio: "inherit",\n  env: process.env,\n});\n\nchild.on("exit", (code, signal) => {\n  if (signal) process.exit(0);\n  process.exit(code ?? 0);\n});\n`;
  write(path, content);
}

function updateRender() {
  const path = "render.yaml";
  let content = read(path);
  content = replacePattern(
    content,
    /      - key: UPSTREAM_VESSEL_DATA_URL[\s\S]*?      - key: FIXED_VESSEL_INGEST_TOKEN\n        sync: false\n/,
    "",
    "Render non-AIS vessel variables",
  );
  content = replaceOnce(content, "      - key: AISSTREAM_GLOBAL_TRACKING_ENABLED\n        value: false\n", "      - key: AISSTREAM_GLOBAL_TRACKING_ENABLED\n        value: true\n", "Render global AIS flag");
  content = replaceOnce(content, "      - key: AISSTREAM_TRACKING_BBOX\n        value: 11,32;31,56\n", "      - key: AISSTREAM_TRACKING_BBOX\n        value: -90,-180;90,180\n", "Render world AIS box");
  content = replacePattern(
    content,
    /      - key: AISSTREAM_BBOX\n        value: 11,32;31,56\n      - key: AISSTREAM_APPEND_SAUDI_PORT_BBOXES\n        value: true\n/,
    "",
    "legacy regional AIS variables",
  );
  content = replaceOnce(content, "      - key: AISSTREAM_MAX_VESSELS\n        value: 5000\n", "      - key: AISSTREAM_MAX_VESSELS\n        value: 20000\n", "Render AIS capacity");
  content = replaceOnce(content, "      - key: AISSTREAM_TRAIL_POINTS\n        value: 12\n", "      - key: AISSTREAM_TRAIL_POINTS\n        value: 4\n", "Render trail depth");
  if (/FIXED_VESSEL|UPSTREAM_VESSEL/.test(content)) throw new Error("Render still configures non-AIS vessel inputs");
  write(path, content);
}

function updateEnvExample() {
  const path = ".env.example";
  let content = read(path);
  content = replacePattern(
    content,
    /# Optional upstream vessel API merged with AIS and fixed\/manual rows\.[\s\S]*?# AISStream tracking\.[\s\S]*?AISSTREAM_FILTER_TYPES=\n/,
    `# AISStream is the only vessel-position source. The runtime always subscribes\n# globally and derives the monitored-port operational scope from those live rows.\nAISSTREAM_API_KEY=\nAISSTREAM_URL=wss://stream.aisstream.io/v0/stream\nAISSTREAM_GLOBAL_TRACKING_ENABLED=true\nAISSTREAM_TRACKING_BBOX=-90,-180;90,180\nAISSTREAM_FILTER_TYPES=\n`,
    "environment vessel source section",
  );
  content = content.replace("AISSTREAM_MAX_VESSELS=5000", "AISSTREAM_MAX_VESSELS=20000");
  content = content.replace("AISSTREAM_TRAIL_POINTS=12", "AISSTREAM_TRAIL_POINTS=4");
  if (/FIXED_VESSEL|UPSTREAM_VESSEL|manual-vessels/.test(content)) throw new Error("Environment template still enables non-AIS vessels");
  write(path, content);
}

function updatePackageJson() {
  const path = "package.json";
  const json = JSON.parse(read(path));
  delete json.scripts["ingest:fixed-vessels"];
  json.scripts["verify:runtime"] = "node --check server/vessel-feed-proxy/runtime-v3.mjs && node scripts/check-runtime-contract.mjs && node scripts/smoke-runtime.mjs && node scripts/smoke-ais-live.mjs";
  write(path, JSON.stringify(json, null, 2));
}

function updateFrontend() {
  const providerPath = "src/providers/dashboardDataProvider.ts";
  let provider = read(providerPath);
  provider = replacePattern(
    provider,
    /function normalizeSource\(value: unknown\): DashboardDataSource \{[\s\S]*?\n\}/,
    `function normalizeSource(value: unknown): DashboardDataSource {\n  if (value === "aisstream") return "aisstream";\n  if (value === "aisstream-waiting") return "aisstream-waiting";\n  return "none";\n}`,
    "frontend vessel source normalization",
  );
  provider = replaceOnce(provider, '      source: "remote",\n', '      source: "aisstream",\n', "array vessel source");
  write(providerPath, provider);

  const dataPath = "src/data/loadSampleDashboardData.ts";
  let data = read(dataPath);
  data = replaceOnce(
    data,
    '  return source === "aisstream" || source === "aisstream-waiting" || source === "upstream" || source === "remote";\n',
    '  return source === "aisstream" || source === "aisstream-waiting";\n',
    "external source predicate",
  );
  data = data.replace("Stable external tracking feed active", "Live AIS tracking feed active");
  data = data.replace("vessels are retained for map tracking from ${vesselScope.reportedRows} current API rows", "vessels are retained for map tracking from ${vesselScope.reportedRows} live AIS API rows");
  write(dataPath, data);

  const qualityPath = "src/components/DataQualityPanel.tsx";
  let quality = read(qualityPath);
  quality = replaceOnce(
    quality,
    ': "The backend websocket is open, but the provider has not delivered any usable position messages. Verify the AIS key and regional subscription; configured fixed or upstream rows are used automatically.",\n',
    ': "The backend websocket is open, but the provider has not delivered any usable live AIS position messages yet.",\n',
    "AIS waiting explanation",
  );
  quality = replacePattern(
    quality,
    /  if \(data\.source === "upstream" \|\| data\.source === "remote"\) \{[\s\S]*?\n  \}\n/,
    "",
    "non-AIS quality branch",
  );
  quality = quality.replace('return { label: "Vessel tracking", value: "Missing", detail: "no AIS, upstream, or fixed vessel rows are available", tone: "missing" };', 'return { label: "Vessel tracking", value: "Missing", detail: "no live AIS vessel rows are available", tone: "missing" };');
  quality = quality.replace(/\n  if \(data\.source === "upstream"\)[^\n]*\n  if \(data\.source === "remote"\)[^\n]*\n/, "\n");
  write(qualityPath, quality);
}

function writeAisSmokeTest() {
  const path = "scripts/smoke-ais-live.mjs";
  const content = `import { mkdtempSync, rmSync, writeFileSync } from "node:fs";\nimport { createServer } from "node:net";\nimport { tmpdir } from "node:os";\nimport { join } from "node:path";\nimport { spawn } from "node:child_process";\nimport { WebSocketServer } from "ws";\n\nfunction assert(condition, message) {\n  if (!condition) throw new Error(message);\n}\n\nfunction availablePort() {\n  return new Promise((resolve, reject) => {\n    const server = createServer();\n    server.once("error", reject);\n    server.listen(0, "127.0.0.1", () => {\n      const address = server.address();\n      if (!address || typeof address === "string") return reject(new Error("Could not allocate a port"));\n      const port = address.port;\n      server.close((error) => error ? reject(error) : resolve(port));\n    });\n  });\n}\n\nasync function fetchJsonWithRetry(url, predicate) {\n  let last;\n  for (let attempt = 0; attempt < 60; attempt += 1) {\n    try {\n      const response = await fetch(url);\n      const json = await response.json();\n      last = { response, json };\n      if (predicate(response, json)) return last;\n    } catch (error) {\n      last = error;\n    }\n    await new Promise((resolve) => setTimeout(resolve, 100));\n  }\n  throw new Error(\`Timed out waiting for \${url}: \${last instanceof Error ? last.message : JSON.stringify(last?.json)}\`);\n}\n\nconst runtimeDir = mkdtempSync(join(tmpdir(), "chmarl-ais-only-"));\nconst weatherFile = join(runtimeDir, "weather.json");\nwriteFileSync(weatherFile, JSON.stringify({ points: [] }));\nconst backendPort = await availablePort();\nconst websocketPort = await availablePort();\nconst websocketServer = new WebSocketServer({ host: "127.0.0.1", port: websocketPort });\nconst output = [];\nlet subscription = null;\n\nwebsocketServer.on("connection", (socket) => {\n  socket.on("message", (data) => {\n    subscription = JSON.parse(data.toString());\n    socket.send(JSON.stringify({\n      MessageType: "PositionReport",\n      MetaData: {\n        MMSI: 123456789,\n        ShipName: "AIS INTEGRATION TEST",\n        latitude: 21.4858,\n        longitude: 39.1925,\n        time_utc: new Date().toISOString(),\n      },\n      Message: {\n        PositionReport: {\n          UserID: 123456789,\n          Latitude: 21.4858,\n          Longitude: 39.1925,\n          Sog: 12.3,\n          Cog: 180,\n          TrueHeading: 181,\n        },\n      },\n    }));\n  });\n});\n\nconst env = {\n  ...process.env,\n  NODE_ENV: "production",\n  PORT: String(backendPort),\n  STATIC_DIR: "dist",\n  RUNTIME_DATA_DIR: runtimeDir,\n  AISSTREAM_API_KEY: "  test-key  ",\n  AISSTREAM_URL: \`ws://127.0.0.1:\${websocketPort}\`,\n  AISSTREAM_GLOBAL_TRACKING_ENABLED: "false",\n  AISSTREAM_TRACKING_BBOX: "11,32;31,56",\n  AISSTREAM_FILTER_TYPES: "PositionReport",\n  AISSTREAM_OPERATIONAL_PRIORITY_ENABLED: "true",\n  AISSTREAM_CACHE_ENABLED: "false",\n  AISSTREAM_SILENCE_TIMEOUT_MS: "60000",\n  CHMARL_RUNTIME_ENABLED: "false",\n  WEATHER_FILE_ENABLED: "true",\n  WEATHER_FILE: weatherFile,\n  FIXED_VESSEL_DATA_FILE_ENABLED: "true",\n  FIXED_VESSEL_DATA_URL: "https://example.invalid/manual.json",\n  UPSTREAM_VESSEL_DATA_URL: "https://example.invalid/upstream.json",\n};\n\nconst child = spawn(process.execPath, ["server/vessel-feed-proxy/index.mjs"], { env, stdio: ["ignore", "pipe", "pipe"] });\nchild.stdout.on("data", (chunk) => output.push(chunk.toString()));\nchild.stderr.on("data", (chunk) => output.push(chunk.toString()));\n\ntry {\n  const baseUrl = \`http://127.0.0.1:\${backendPort}\`;\n  const { json: vessels } = await fetchJsonWithRetry(\`${baseUrl}/api/vessels\`, (_response, json) => json?.vessels?.some((row) => row.id === "MMSI-123456789"));\n\n  assert(subscription?.APIKey === "test-key", "AIS API key was not trimmed before subscription");\n  assert(JSON.stringify(subscription?.BoundingBoxes) === JSON.stringify([[[-90, -180], [90, 180]]]), "AIS subscription was not global");\n  assert(!("FilterMessageTypes" in subscription), "AIS subscription unexpectedly filtered provider frames");\n  assert(vessels.source === "aisstream", \`Expected aisstream source, received \${vessels.source}\`);\n  assert(vessels.counts?.tracking === 1, \`Expected one live AIS row, received \${vessels.counts?.tracking}\`);\n  assert(vessels.counts?.operational === 1, "Live AIS row was not derived into monitored-port scope");\n  assert(vessels.vessels[0].inputSource === "global-tracking", "Vessel did not preserve its AIS source");\n  assert(vessels.inputs?.fixedRows === undefined && vessels.inputs?.upstreamRows === undefined, "Non-AIS input counters remain in the API contract");\n  assert(vessels.health?.messageCount >= 1 && vessels.health?.usablePositionMessages >= 1, "AIS frame counters were not updated");\n  assert(vessels.health?.lastFrameAt && vessels.health?.lastMessageAt, "AIS frame timestamps were not recorded");\n\n  const readiness = await fetch(\`${baseUrl}/health/ready\`);\n  assert(readiness.status === 200, \`AIS-backed readiness returned \${readiness.status}\`);\n\n  const ingest = await fetch(\`${baseUrl}/api/vessels/ingest\`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ vessels: [] }) });\n  assert(ingest.status === 404, \`Manual vessel ingest endpoint still exists: \${ingest.status}\`);\n\n  console.log("Live AIS-only integration smoke test passed.");\n} catch (error) {\n  throw new Error(\`${error instanceof Error ? error.message : String(error)}\\n\\nRuntime output:\\n\${output.join("").slice(-10000)}\`);\n} finally {\n  child.kill("SIGTERM");\n  await new Promise((resolve) => {\n    const timer = setTimeout(resolve, 2000);\n    child.once("exit", () => { clearTimeout(timer); resolve(); });\n  });\n  await new Promise((resolve) => websocketServer.close(resolve));\n  rmSync(runtimeDir, { recursive: true, force: true });\n}\n`;
  write(path, content);
}

function updateRuntimeContract() {
  const path = "scripts/check-runtime-contract.mjs";
  const content = `import { existsSync, readFileSync } from "node:fs";\n\nfunction read(path) {\n  if (!existsSync(path)) throw new Error(\`Required file is missing: \${path}\`);\n  return readFileSync(path, "utf8");\n}\n\nfunction assertIncludes(content, text, label) {\n  if (!content.includes(text)) throw new Error(\`Runtime contract failed: \${label}\`);\n}\n\nfunction assertNotIncludes(content, text, label) {\n  if (content.includes(text)) throw new Error(\`Runtime contract failed: \${label}\`);\n}\n\nconst runtime = read("server/vessel-feed-proxy/runtime-v3.mjs");\nconst startProd = read("scripts/start-prod.mjs");\nconst render = read("render.yaml");\nconst dockerfile = read("Dockerfile");\nconst packageJson = read("package.json");\nconst envExample = read(".env.example");\n\nassertIncludes(runtime, 'path === "/health/live"', "liveness endpoint is absent");\nassertIncludes(runtime, 'path === "/health/ready"', "readiness endpoint is absent");\nassertIncludes(runtime, 'path === "/version"', "version endpoint is absent");\nassertIncludes(runtime, "const TRACKING_BBOX_TEXT = WORLD_AIS_BBOX", "global AIS subscription is not enforced");\nassertIncludes(runtime, "const AISSTREAM_FILTER_TYPES = []", "AIS provider frames remain filtered");\nassertIncludes(runtime, "String(process.env.AISSTREAM_API_KEY ?? \"\").trim()", "AIS API key is not normalized");\nassertIncludes(runtime, "state.lastFrameAt", "raw AIS frame diagnostics are absent");\nassertIncludes(runtime, "deriveOperational: OPERATIONAL_PRIORITY_ENABLED", "single-stream operational derivation is absent");\nassertIncludes(runtime, "operationalAisCache.delete(vessel.id)", "out-of-scope vessels are not removed from the operational cache");\nassertNotIncludes(runtime, "FIXED_VESSEL", "manual/fixed vessel support remains in production runtime");\nassertNotIncludes(runtime, "UPSTREAM_VESSEL", "non-AIS vessel provider remains in production runtime");\nassertNotIncludes(runtime, "/api/vessels/ingest", "manual vessel ingest endpoint remains enabled");\nassertNotIncludes(startProd, "manual_vessels", "production startup still seeds manual vessels");\nassertNotIncludes(startProd, "FIXED_VESSEL", "production startup still configures fixed vessels");\nassertIncludes(startProd, 'process.env.AISSTREAM_GLOBAL_TRACKING_ENABLED = "true"', "production startup does not force global AIS");\nassertIncludes(startProd, "process.env.AISSTREAM_TRACKING_BBOX = WORLD_AIS_BBOX", "production startup does not force the world box");\nassertIncludes(startProd, 'process.env.RUNTIME_DATA_DIR = runningOnRender ? "/var/data"', "Render persistence is not enforced");\nassertIncludes(render, "healthCheckPath: /health/live", "Render liveness endpoint is incorrect");\nassertIncludes(render, "value: -90,-180;90,180", "Render does not use the global AIS box");\nassertIncludes(render, "AISSTREAM_MAX_VESSELS\\n        value: 20000", "Render AIS capacity was reduced");\nassertNotIncludes(render, "FIXED_VESSEL", "Render still configures manual/fixed vessels");\nassertNotIncludes(render, "UPSTREAM_VESSEL", "Render still configures a non-AIS vessel provider");\nassertNotIncludes(envExample, "FIXED_VESSEL", "environment template still advertises manual vessels");\nassertNotIncludes(envExample, "UPSTREAM_VESSEL", "environment template still advertises non-AIS vessels");\nassertIncludes(dockerfile, "COPY package.json pnpm-lock.yaml ./", "Docker build does not copy the lockfile");\nassertIncludes(dockerfile, "pnpm install --frozen-lockfile", "Docker build is not locked");\nassertIncludes(packageJson, "scripts/smoke-ais-live.mjs", "live AIS integration smoke test is not part of verification");\nassertNotIncludes(packageJson, "ingest:fixed-vessels", "manual vessel command remains available");\n\nfor (const path of [\n  "public/data/fixed_vessels.sample.json",\n  "public/data/manual_vessels.sample.json",\n  "public/data/vessels.sample.json",\n  "public/data/vessels.sample.csv",\n  "scripts/ingest-fixed-vessels.mjs",\n]) {\n  if (existsSync(path)) throw new Error(\`Runtime contract failed: non-AIS vessel artifact remains: \${path}\`);\n}\n\nconsole.log("AIS-only portal runtime contract verified.");\n`;
  write(path, content);
}

function updateDiagnosticsAndDocs() {
  write("scripts/check-ais-subscription-config.mjs", `#!/usr/bin/env node\n\nimport { existsSync, readFileSync } from "node:fs";\nimport { resolve } from "node:path";\n\nfunction loadEnvFile(fileName) {\n  const path = resolve(fileName);\n  if (!existsSync(path)) return;\n  for (const line of readFileSync(path, "utf8").split(/\\r?\\n/)) {\n    const trimmed = line.trim();\n    if (!trimmed || trimmed.startsWith("#")) continue;\n    const equals = trimmed.indexOf("=");\n    if (equals === -1) continue;\n    const key = trimmed.slice(0, equals).trim();\n    let value = trimmed.slice(equals + 1).trim();\n    if (!key || process.env[key] !== undefined) continue;\n    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);\n    process.env[key] = value;\n  }\n}\n\nloadEnvFile(".env");\nloadEnvFile(".env.local");\n\nconsole.log("AIS-only subscription configuration");\nconsole.log("-".repeat(72));\nconsole.log(\`keyLoaded=\${Boolean(process.env.AISSTREAM_API_KEY?.trim())}\`);\nconsole.log("trackingMode=global");\nconsole.log("boundingBoxes=-90,-180;90,180");\nconsole.log("filters=none");\nconsole.log(\`maxVessels=\${process.env.AISSTREAM_MAX_VESSELS ?? "20000"}\`);\nconsole.log("vesselSources=aisstream-only");\n\nif (!process.env.AISSTREAM_API_KEY?.trim()) process.exit(1);\n`);

  write("docs/AIS_TRACKING_CONTINUITY.md", `# AIS tracking continuity\n\nAll vessel positions in the production portal originate from the live AISStream connection. The runtime does not load manual vessels, fixed vessel files, sample vessel files, or a secondary vessel API.\n\n## Global tracking\n\n- The backend sends one worldwide AIS subscription using the bounding box \`-90,-180;90,180\`.\n- No message-type filter is sent to the provider. Position-bearing messages are normalized into vessel rows.\n- Monitored-port operational rows are derived from the same live global stream; they are not fetched through a second connection.\n- Recent AIS positions may remain in the AIS cache during a short connection interruption, but they retain their original AIS identity and timestamp.\n\n## Truthful unavailable state\n\nWhen the provider has not delivered live AIS frames, the portal displays an AIS waiting/degraded state and zero current vessels. It does not insert continuity placeholders. EcoFair-CH-MARL calculations remain inactive until real AIS rows enter the monitored-port scope.\n`);

  const readmePath = "README.md";
  let readme = read(readmePath);
  readme = readme.replace("## One-Terminal Remote Feed Demo", "## One-Terminal Live AIS Development");
  readme = readme.replace("Data: remote", "Data: AIS live");
  readme = readme.replace("| Local JSON sample data layer | Implemented in `public/data/` |\n", "");
  readme = readme.replace("| Remote vessel feed | Implemented through `VITE_VESSEL_DATA_URL` |", "| Live vessel feed | AISStream-only through the backend proxy and `VITE_VESSEL_DATA_URL` |");
  readme = replacePattern(
    readme,
    /## Local Data Fixtures[\s\S]*?## Remote Vessel Feed\n/,
    `## Live AIS Vessel Feed\n\nProduction vessel rows come only from the backend AISStream connection. Bundled vessel files and manual ingest are not supported. When AIS is unavailable, the dashboard reports zero live vessels rather than inserting placeholders.\n\nThe frontend reads the same-origin AIS endpoint through:\n\n`,
    "README vessel fixture sections",
  );
  readme = readme.replace("See [`docs/REMOTE_VESSEL_FEED.md`](docs/REMOTE_VESSEL_FEED.md) and [`server/vessel-feed-proxy/README.md`](server/vessel-feed-proxy/README.md).", "See [`docs/REMOTE_VESSEL_FEED.md`](docs/REMOTE_VESSEL_FEED.md) and [`server/vessel-feed-proxy/README.md`](server/vessel-feed-proxy/README.md).");
  write(readmePath, readme);

  write("docs/REMOTE_VESSEL_FEED.md", `# Live AIS vessel feed\n\nThe production dashboard reads vessel rows only from the same-origin backend endpoint configured by \`VITE_VESSEL_DATA_URL\` (normally \`/api/vessels\`). The backend holds the AISStream credential and maintains one worldwide WebSocket subscription.\n\n## Production policy\n\n- Live AIS is the sole vessel-position source.\n- The subscription bounding box is worldwide: \`-90,-180;90,180\`.\n- The provider subscription is unfiltered; the runtime normalizes position-bearing messages.\n- Operational port scope is derived from the global AIS cache.\n- Manual vessel insertion, fixed vessel files, bundled vessel samples, and secondary vessel APIs are disabled.\n- If AIS provides no positions, the endpoint returns an empty vessel array with an explicit waiting/degraded state.\n\n## Frontend endpoint\n\n\`VITE_VESSEL_DATA_URL=/api/vessels\`\n\nProvider credentials must remain in the backend environment. Never place \`AISSTREAM_API_KEY\` in a Vite variable or browser-delivered file.\n`);
}

function removeNonAisArtifacts() {
  for (const path of [
    "public/data/fixed_vessels.sample.json",
    "public/data/manual_vessels.sample.json",
    "public/data/vessels.sample.json",
    "public/data/vessels.sample.csv",
    "scripts/ingest-fixed-vessels.mjs",
  ]) {
    if (existsSync(path)) {
      rmSync(path);
      console.log(`removed ${path}`);
    }
  }
}

updateRuntime();
updateStartProd();
updateRender();
updateEnvExample();
updatePackageJson();
updateFrontend();
writeAisSmokeTest();
updateRuntimeContract();
updateDiagnosticsAndDocs();
removeNonAisArtifacts();

rmSync("scripts/apply-ais-only-production.mjs", { force: true });
rmSync(".github/workflows/apply-ais-only-production.yml", { force: true });
console.log("AIS-only production patch applied.");
