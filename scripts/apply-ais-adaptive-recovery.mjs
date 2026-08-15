import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

function read(path) {
  return readFileSync(path, "utf8");
}

function write(path, content) {
  writeFileSync(path, content.endsWith("\n") ? content : content + "\n");
  console.log("updated " + path);
}

function replaceOnce(content, before, after, label) {
  const index = content.indexOf(before);
  if (index === -1) throw new Error("Could not find " + label);
  if (content.indexOf(before, index + before.length) !== -1) throw new Error("Found " + label + " more than once");
  return content.slice(0, index) + after + content.slice(index + before.length);
}

function replacePattern(content, pattern, replacement, label) {
  const match = content.match(pattern);
  if (!match) throw new Error("Could not find " + label);
  return content.replace(pattern, () => replacement);
}

function updateRuntime() {
  const path = "server/vessel-feed-proxy/runtime-v3.mjs";
  let content = read(path);

  const constants = `const GLOBAL_TRACKING_ENABLED = true;
const TRACKING_BBOX_TEXT = WORLD_AIS_BBOX;
const OPERATIONAL_PRIORITY_ENABLED = process.env.AISSTREAM_OPERATIONAL_PRIORITY_ENABLED !== "false";
const OPERATIONAL_BBOX_TEXT = process.env.AISSTREAM_OPERATIONAL_BBOX ?? mergeBboxes(REGIONAL_AIS_BBOX, SAUDI_PORT_BBOX);
const TRACKING_BOXES = parseBoundingBoxes(TRACKING_BBOX_TEXT);
const OPERATIONAL_BOXES = parseBoundingBoxes(OPERATIONAL_BBOX_TEXT);
const AISSTREAM_API_KEY = String(process.env.AISSTREAM_API_KEY ?? "").trim();
const AISSTREAM_URL = process.env.AISSTREAM_URL ?? "wss://stream.aisstream.io/v0/stream";
const AISSTREAM_FILTER_TYPES = [];
const AISSTREAM_OPERATIONAL_FILTER_TYPES = [];
const AISSTREAM_POSITION_FILTER_TYPES = [
  "PositionReport",
  "StandardClassBPositionReport",
  "ExtendedClassBPositionReport",
  "LongRangeAisBroadcastMessage",
];
const AISSTREAM_RECOVERY_ENABLED = process.env.AISSTREAM_RECOVERY_ENABLED !== "false";
const AISSTREAM_RECOVERY_PROFILES = [
  { id: "world-unfiltered", description: "worldwide, all AIS message types", boxes: TRACKING_BOXES, filters: AISSTREAM_FILTER_TYPES },
  { id: "world-position-only", description: "worldwide, position-bearing messages", boxes: TRACKING_BOXES, filters: AISSTREAM_POSITION_FILTER_TYPES },
  { id: "red-sea-gulf-position-only", description: "Red Sea and Gulf, position-bearing messages", boxes: parseBoundingBoxes(REGIONAL_AIS_BBOX), filters: AISSTREAM_POSITION_FILTER_TYPES },
  { id: "port-approaches-position-only", description: "monitored port approaches, position-bearing messages", boxes: OPERATIONAL_BOXES, filters: AISSTREAM_POSITION_FILTER_TYPES },
];
const AISSTREAM_MAX_VESSELS = Math.max(100, Number(process.env.AISSTREAM_MAX_VESSELS ?? 8000));
const AISSTREAM_OPERATIONAL_MAX_VESSELS = Math.max(100, Number(process.env.AISSTREAM_OPERATIONAL_MAX_VESSELS ?? 2500));
const AISSTREAM_TRAIL_POINTS = Math.max(2, Number(process.env.AISSTREAM_TRAIL_POINTS ?? 12));
const AISSTREAM_MAX_AGE_MS = Math.max(60_000, Number(process.env.AISSTREAM_MAX_AGE_MS ?? 6 * 60 * 60 * 1000));
const AISSTREAM_CACHE_ENABLED = process.env.AISSTREAM_CACHE_ENABLED !== "false";
const AISSTREAM_CACHE_FLUSH_MS = Math.max(5_000, Number(process.env.AISSTREAM_CACHE_FLUSH_MS ?? 30_000));
const AISSTREAM_MAX_IMPLIED_SPEED_KN = Math.max(50, Number(process.env.AISSTREAM_MAX_IMPLIED_SPEED_KN ?? 120));
const AISSTREAM_HEARTBEAT_MS = Math.max(1_000, Number(process.env.AISSTREAM_HEARTBEAT_MS ?? 10_000));
const AISSTREAM_FIRST_FRAME_TIMEOUT_MS = Math.max(1_000, Number(process.env.AISSTREAM_FIRST_FRAME_TIMEOUT_MS ?? 30_000));
const AISSTREAM_SILENCE_TIMEOUT_MS = Math.max(15_000, Number(process.env.AISSTREAM_SILENCE_TIMEOUT_MS ?? 90_000));
`;

  content = replacePattern(
    content,
    /const GLOBAL_TRACKING_ENABLED = true;[\s\S]*?const AISSTREAM_SILENCE_TIMEOUT_MS = .*?;\n/,
    constants,
    "AIS configuration block",
  );

  content = replaceOnce(
    content,
    `    watchdogRestarts: 0,
    messageCount: 0,`,
    `    watchdogRestarts: 0,
    profileIndex: 0,
    activeProfile: AISSTREAM_RECOVERY_PROFILES[0].id,
    activeProfileDescription: AISSTREAM_RECOVERY_PROFILES[0].description,
    profileSwitches: 0,
    profileCycles: 0,
    lastProfileSwitchAt: null,
    lastRecoveryReason: null,
    lastSuccessfulProfile: null,
    lastSuccessfulAt: null,
    profileAdvancedForCurrentSocket: false,
    connectionMessageCount: 0,
    firstFrameDeadlineAt: null,
    profileHistory: [],
    messageCount: 0,`,
    "AIS state counters",
  );

  const streamFunctions = `function activeAisProfile(state) {
  return AISSTREAM_RECOVERY_PROFILES[state.profileIndex % AISSTREAM_RECOVERY_PROFILES.length];
}

function setAisProfileState(state, profile) {
  state.activeProfile = profile.id;
  state.activeProfileDescription = profile.description;
  state.boundingBoxes = profile.boxes;
  state.filterTypes = profile.filters;
}

function advanceAisProfile(state, reason) {
  state.lastRecoveryReason = reason;
  if (!AISSTREAM_RECOVERY_ENABLED || AISSTREAM_RECOVERY_PROFILES.length < 2) return;
  const previousIndex = state.profileIndex;
  state.profileIndex = (state.profileIndex + 1) % AISSTREAM_RECOVERY_PROFILES.length;
  if (state.profileIndex <= previousIndex) state.profileCycles += 1;
  state.profileSwitches += 1;
  state.lastProfileSwitchAt = new Date().toISOString();
  state.profileAdvancedForCurrentSocket = true;
  const profile = activeAisProfile(state);
  setAisProfileState(state, profile);
  state.profileHistory = [...state.profileHistory, {
    at: state.lastProfileSwitchAt,
    event: "recovery",
    profile: profile.id,
    reason,
  }].slice(-12);
}

function scheduleAisReconnect(options) {
  const { state } = options;
  if (stopping || !AISSTREAM_API_KEY || state.reconnectTimer) return;
  const delay = Math.min(30_000, 2_000 * 2 ** state.reconnectAttempt);
  state.reconnectAttempt += 1;
  state.status = "reconnecting";
  state.reconnectTimer = setTimeout(() => {
    state.reconnectTimer = null;
    startAisStream(options);
  }, delay);
  state.reconnectTimer.unref?.();
}

function startAisStream({ state, cache, deriveOperational = false }) {
  const options = { state, cache, deriveOperational };
  if (!AISSTREAM_API_KEY || stopping) {
    state.status = AISSTREAM_API_KEY ? "stopped" : "disabled";
    return;
  }
  if (state.reconnectTimer) {
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = null;
  }
  const profile = activeAisProfile(state);
  setAisProfileState(state, profile);
  const socket = new WebSocket(AISSTREAM_URL, {
    perMessageDeflate: false,
    handshakeTimeout: 15_000,
  });
  state.socket = socket;
  state.status = "connecting";
  socket.on("open", () => {
    const openedAt = new Date().toISOString();
    state.connected = true;
    state.reconnectAttempt = 0;
    state.lastError = null;
    state.openedAt = openedAt;
    state.lastPongAt = openedAt;
    state.status = "connected-waiting";
    state.connectionMessageCount = 0;
    state.profileAdvancedForCurrentSocket = false;
    state.firstFrameDeadlineAt = new Date(Date.now() + AISSTREAM_FIRST_FRAME_TIMEOUT_MS).toISOString();
    state.profileHistory = [...state.profileHistory, {
      at: openedAt,
      event: "subscription",
      profile: profile.id,
      reason: state.lastRecoveryReason,
    }].slice(-12);
    if (deriveOperational) {
      operationalAisState.enabled = true;
      operationalAisState.connected = true;
      operationalAisState.openedAt = openedAt;
      operationalAisState.status = "derived-waiting";
      operationalAisState.lastError = null;
    }
    const subscription = { APIKey: AISSTREAM_API_KEY, BoundingBoxes: profile.boxes };
    if (profile.filters.length > 0) subscription.FilterMessageTypes = profile.filters;
    state.subscriptionSentAt = new Date().toISOString();
    state.subscription = {
      profile: profile.id,
      description: profile.description,
      boundingBoxes: profile.boxes,
      filterMessageTypes: profile.filters,
    };
    socket.send(JSON.stringify(subscription));
  });
  socket.on("pong", () => {
    state.lastPongAt = new Date().toISOString();
  });
  socket.on("message", (data) => {
    try {
      state.messageCount += 1;
      state.connectionMessageCount += 1;
      state.lastFrameAt = new Date().toISOString();
      state.firstFrameDeadlineAt = null;
      const raw = JSON.parse(data.toString());
      if (raw.error) {
        state.lastError = String(raw.error);
        state.status = "provider-error";
        return;
      }
      const vessel = normalizeAisMessage(raw, state.label);
      if (!vessel) return;
      const receivedAt = new Date().toISOString();
      state.usablePositionMessages += 1;
      state.lastMessageAt = receivedAt;
      state.lastSuccessfulProfile = state.activeProfile;
      state.lastSuccessfulAt = receivedAt;
      state.lastRecoveryReason = null;
      state.status = "live";
      mergeAisVessel(cache, state, vessel);
      if (deriveOperational) {
        const nearest = nearestOperationalPort(vessel);
        if (nearest && nearest.distanceNm <= ECOFAIR_OPERATIONAL_RADIUS_NM) {
          operationalAisState.messageCount += 1;
          operationalAisState.usablePositionMessages += 1;
          operationalAisState.lastMessageAt = receivedAt;
          operationalAisState.status = "derived-live";
          mergeAisVessel(operationalAisCache, operationalAisState, vessel);
        } else {
          operationalAisCache.delete(vessel.id);
          operationalAisState.cachedVessels = operationalAisCache.size;
        }
      }
    } catch (error) {
      state.lastError = error instanceof Error ? error.message : String(error);
      state.status = "message-error";
    }
  });
  socket.on("close", (code, reason) => {
    const closedAt = new Date().toISOString();
    const closedBeforeFirstFrame = state.connectionMessageCount === 0;
    state.connected = false;
    state.lastCloseAt = closedAt;
    state.firstFrameDeadlineAt = null;
    state.socket = null;
    if (reason?.length) state.lastError = "AIS websocket closed (" + code + "): " + reason.toString();
    if (!stopping && closedBeforeFirstFrame && !state.profileAdvancedForCurrentSocket) {
      advanceAisProfile(state, "socket closed before the first AIS frame (code " + code + ")");
    }
    if (deriveOperational) {
      operationalAisState.connected = false;
      operationalAisState.lastCloseAt = closedAt;
      operationalAisState.status = stopping ? "stopped" : "derived-reconnecting";
    }
    if (!stopping) scheduleAisReconnect(options);
  });
  socket.on("error", (error) => {
    state.connected = false;
    state.lastError = error.message;
    state.status = "socket-error";
  });
  socket.on("unexpected-response", (_request, response) => {
    state.lastError = "AIS websocket rejected the subscription with HTTP " + (response.statusCode ?? "unknown");
    state.status = "provider-error";
  });
}

function scopedReport() {`;

  content = replacePattern(
    content,
    /function scheduleAisReconnect\(options\) \{[\s\S]*?\n\}\n\nfunction scopedReport\(\) \{/,
    streamFunctions,
    "AIS connection functions",
  );

  content = content.replace(
    "derived from the single global subscription.",
    "derived from the active live AIS subscription.",
  );
  content = content.replace(
    "one resilient global AIS subscription populates both the display cache and the monitored-port operational cache",
    "one self-healing AISStream connection starts with worldwide coverage and rotates among genuine live-AIS subscription profiles when a connected socket produces no frames; it populates both the display cache and the monitored-port operational cache",
  );

  content = replaceOnce(
    content,
    `startAisStream({
  state: trackingAisState,
  cache: trackingAisCache,
  boxes: TRACKING_BOXES,
  filters: AISSTREAM_FILTER_TYPES,
  deriveOperational: OPERATIONAL_PRIORITY_ENABLED,
});`,
    `startAisStream({
  state: trackingAisState,
  cache: trackingAisCache,
  deriveOperational: OPERATIONAL_PRIORITY_ENABLED,
});`,
    "initial AIS connection",
  );

  const watchdog = `const aisWatchdogInterval = setInterval(() => {
  if (stopping || !AISSTREAM_API_KEY) return;
  const state = trackingAisState;
  const socket = state.socket;
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    scheduleAisReconnect({
      state,
      cache: trackingAisCache,
      deriveOperational: OPERATIONAL_PRIORITY_ENABLED,
    });
    return;
  }
  try { socket.ping(); }
  catch (error) { state.lastError = error instanceof Error ? error.message : String(error); }
  const openedAt = timestampMs(state.openedAt);
  const lastFrameAt = timestampMs(state.lastFrameAt);
  const lastPongAt = timestampMs(state.lastPongAt);
  const now = Date.now();
  const firstFrameTimedOut = state.connectionMessageCount === 0
    && openedAt > 0
    && now - openedAt > AISSTREAM_FIRST_FRAME_TIMEOUT_MS;
  const streamBecameSilent = state.connectionMessageCount > 0
    && lastFrameAt > 0
    && now - lastFrameAt > AISSTREAM_SILENCE_TIMEOUT_MS;
  const heartbeatLost = lastPongAt > 0 && now - lastPongAt > AISSTREAM_HEARTBEAT_MS * 3;
  if (firstFrameTimedOut || streamBecameSilent || heartbeatLost) {
    state.watchdogRestarts += 1;
    const reason = firstFrameTimedOut
      ? "connected AIS socket produced no first frame within " + Math.round(AISSTREAM_FIRST_FRAME_TIMEOUT_MS / 1000) + " seconds"
      : streamBecameSilent
        ? "AIS provider produced no frames for " + Math.round((now - lastFrameAt) / 1000) + " seconds"
        : "AIS websocket heartbeat timed out";
    state.lastError = reason;
    advanceAisProfile(state, reason);
    state.status = "profile-recovery";
    try { socket.terminate(); } catch {}
  }
}, AISSTREAM_HEARTBEAT_MS);`;

  content = replacePattern(
    content,
    /const aisWatchdogInterval = setInterval\(\(\) => \{[\s\S]*?\}, AISSTREAM_HEARTBEAT_MS\);/,
    watchdog,
    "AIS watchdog",
  );

  content = replaceOnce(
    content,
    `    trackingScope: { mode: GLOBAL_TRACKING_ENABLED ? "global" : "regional", bbox: TRACKING_BBOX_TEXT, rows: vesselInputState.trackingRows, maxRows: AISSTREAM_MAX_VESSELS },`,
    `    trackingScope: {
      mode: GLOBAL_TRACKING_ENABLED ? "global" : "regional",
      bbox: TRACKING_BBOX_TEXT,
      activeProfile: trackingAisState.activeProfile,
      activeProfileDescription: trackingAisState.activeProfileDescription,
      activeBoundingBoxes: trackingAisState.boundingBoxes,
      profileSwitches: trackingAisState.profileSwitches,
      profileCycles: trackingAisState.profileCycles,
      rows: vesselInputState.trackingRows,
      maxRows: AISSTREAM_MAX_VESSELS,
    },`,
    "tracking health scope",
  );

  write(path, content);
}

function updateStartProd() {
  const path = "scripts/start-prod.mjs";
  let content = read(path);
  content = replaceOnce(
    content,
    `process.env.AISSTREAM_OPERATIONAL_FILTER_TYPES = "";
process.env.AISSTREAM_MAX_VESSELS = runningOnRender ? "20000" : (process.env.AISSTREAM_MAX_VESSELS || "20000");`,
    `process.env.AISSTREAM_OPERATIONAL_FILTER_TYPES = "";
process.env.AISSTREAM_RECOVERY_ENABLED = "true";
process.env.AISSTREAM_HEARTBEAT_MS = runningOnRender ? "10000" : (process.env.AISSTREAM_HEARTBEAT_MS || "10000");
process.env.AISSTREAM_FIRST_FRAME_TIMEOUT_MS = runningOnRender ? "30000" : (process.env.AISSTREAM_FIRST_FRAME_TIMEOUT_MS || "30000");
process.env.AISSTREAM_SILENCE_TIMEOUT_MS = runningOnRender ? "90000" : (process.env.AISSTREAM_SILENCE_TIMEOUT_MS || "90000");
process.env.AISSTREAM_MAX_VESSELS = runningOnRender ? "20000" : (process.env.AISSTREAM_MAX_VESSELS || "20000");`,
    "production AIS recovery environment",
  );
  content = replaceOnce(
    content,
    `console.log("AIS message filter: none (all provider frames accepted; position-bearing frames are normalized).");
console.log(\`Operational AIS derivation: \${process.env.AISSTREAM_OPERATIONAL_PRIORITY_ENABLED}\`);`,
    `console.log("AIS message filter: none on the primary world profile; recovery profiles reduce scope only after a silent socket.");
console.log("AIS silent-session recovery: enabled; first-frame timeout " + process.env.AISSTREAM_FIRST_FRAME_TIMEOUT_MS + " ms; silence timeout " + process.env.AISSTREAM_SILENCE_TIMEOUT_MS + " ms.");
console.log(\`Operational AIS derivation: \${process.env.AISSTREAM_OPERATIONAL_PRIORITY_ENABLED}\`);`,
    "production AIS recovery logging",
  );
  write(path, content);
}

function updateEnvironmentFiles() {
  const envPath = ".env.example";
  let env = read(envPath);
  env = replaceOnce(
    env,
    `AISSTREAM_HEARTBEAT_MS=30000
AISSTREAM_SILENCE_TIMEOUT_MS=300000`,
    `AISSTREAM_RECOVERY_ENABLED=true
AISSTREAM_HEARTBEAT_MS=10000
AISSTREAM_FIRST_FRAME_TIMEOUT_MS=30000
AISSTREAM_SILENCE_TIMEOUT_MS=90000`,
    "environment AIS timeouts",
  );
  write(envPath, env);

  const renderPath = "render.yaml";
  let render = read(renderPath);
  render = replaceOnce(
    render,
    `      - key: AISSTREAM_HEARTBEAT_MS
        value: 30000
      - key: AISSTREAM_SILENCE_TIMEOUT_MS
        value: 300000`,
    `      - key: AISSTREAM_RECOVERY_ENABLED
        value: true
      - key: AISSTREAM_HEARTBEAT_MS
        value: 10000
      - key: AISSTREAM_FIRST_FRAME_TIMEOUT_MS
        value: 30000
      - key: AISSTREAM_SILENCE_TIMEOUT_MS
        value: 90000`,
    "Render AIS timeouts",
  );
  write(renderPath, render);
}

function updateRuntimeContract() {
  const path = "scripts/check-runtime-contract.mjs";
  let content = read(path);
  content = replaceOnce(
    content,
    `assertIncludes(runtime, "state.lastFrameAt", "raw AIS frame diagnostics are absent");`,
    `assertIncludes(runtime, "state.lastFrameAt", "raw AIS frame diagnostics are absent");
assertIncludes(runtime, "AISSTREAM_RECOVERY_PROFILES", "adaptive AIS subscription profiles are absent");
assertIncludes(runtime, "AISSTREAM_FIRST_FRAME_TIMEOUT_MS", "AIS first-frame timeout is absent");
assertIncludes(runtime, "connectionMessageCount", "per-connection AIS frame accounting is absent");
assertIncludes(runtime, "advanceAisProfile", "silent AIS sockets do not rotate profiles");
assertIncludes(runtime, "perMessageDeflate: false", "AIS websocket compression is not explicitly disabled");`,
    "runtime recovery assertions",
  );
  content = replaceOnce(
    content,
    `assertIncludes(startProd, "process.env.AISSTREAM_TRACKING_BBOX = WORLD_AIS_BBOX", "production startup does not force the world box");`,
    `assertIncludes(startProd, "process.env.AISSTREAM_TRACKING_BBOX = WORLD_AIS_BBOX", "production startup does not force the world box");
assertIncludes(startProd, 'process.env.AISSTREAM_RECOVERY_ENABLED = "true"', "production startup does not enable silent-session recovery");
assertIncludes(startProd, 'process.env.AISSTREAM_FIRST_FRAME_TIMEOUT_MS', "production startup does not configure first-frame recovery");`,
    "startup recovery assertions",
  );
  content = replaceOnce(
    content,
    `assertIncludes(render, "AISSTREAM_MAX_VESSELS\\n        value: 20000", "Render AIS capacity was reduced");`,
    `assertIncludes(render, "AISSTREAM_MAX_VESSELS\\n        value: 20000", "Render AIS capacity was reduced");
assertIncludes(render, "AISSTREAM_RECOVERY_ENABLED\\n        value: true", "Render does not enable AIS silent-session recovery");
assertIncludes(render, "AISSTREAM_FIRST_FRAME_TIMEOUT_MS\\n        value: 30000", "Render first-frame timeout is not configured");
assertIncludes(render, "AISSTREAM_SILENCE_TIMEOUT_MS\\n        value: 90000", "Render silence timeout is too slow");`,
    "Render recovery assertions",
  );
  write(path, content);
}

function updateSmokeTest() {
  const path = "scripts/smoke-ais-live.mjs";
  const content = `import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
      if (!address || typeof address === "string") return reject(new Error("Could not allocate a port"));
      const port = address.port;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function fetchJsonWithRetry(url, predicate) {
  let last;
  for (let attempt = 0; attempt < 200; attempt += 1) {
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
  throw new Error("Timed out waiting for " + url + ": " + (last instanceof Error ? last.message : JSON.stringify(last?.json)));
}

const runtimeDir = mkdtempSync(join(tmpdir(), "chmarl-ais-recovery-"));
const weatherFile = join(runtimeDir, "weather.json");
writeFileSync(weatherFile, JSON.stringify({ points: [] }));
const backendPort = await availablePort();
const websocketPort = await availablePort();
const websocketServer = new WebSocketServer({ host: "127.0.0.1", port: websocketPort });
const output = [];
const subscriptions = [];
let connectionCount = 0;

websocketServer.on("connection", (socket) => {
  connectionCount += 1;
  const connectionNumber = connectionCount;
  socket.on("message", (data) => {
    const subscription = JSON.parse(data.toString());
    subscriptions.push({ connectionNumber, subscription });
    if (connectionNumber === 1) return;
    socket.send(JSON.stringify({
      MessageType: "PositionReport",
      MetaData: {
        MMSI: 123456789,
        ShipName: "AIS RECOVERY TEST",
        latitude: 21.4858,
        longitude: 39.1925,
        time_utc: new Date().toISOString(),
      },
      Message: {
        PositionReport: {
          UserID: 123456789,
          Latitude: 21.4858,
          Longitude: 39.1925,
          Sog: 12.3,
          Cog: 180,
          TrueHeading: 181,
        },
      },
    }));
  });
});

const env = {
  ...process.env,
  NODE_ENV: "production",
  PORT: String(backendPort),
  STATIC_DIR: "dist",
  RUNTIME_DATA_DIR: runtimeDir,
  AISSTREAM_API_KEY: "  test-key  ",
  AISSTREAM_URL: "ws://127.0.0.1:" + websocketPort,
  AISSTREAM_GLOBAL_TRACKING_ENABLED: "false",
  AISSTREAM_TRACKING_BBOX: "11,32;31,56",
  AISSTREAM_FILTER_TYPES: "UnknownMessage",
  AISSTREAM_OPERATIONAL_PRIORITY_ENABLED: "true",
  AISSTREAM_RECOVERY_ENABLED: "true",
  AISSTREAM_HEARTBEAT_MS: "1000",
  AISSTREAM_FIRST_FRAME_TIMEOUT_MS: "1200",
  AISSTREAM_SILENCE_TIMEOUT_MS: "60000",
  AISSTREAM_CACHE_ENABLED: "false",
  CHMARL_RUNTIME_ENABLED: "false",
  WEATHER_FILE_ENABLED: "true",
  WEATHER_FILE: weatherFile,
  FIXED_VESSEL_DATA_FILE_ENABLED: "true",
  FIXED_VESSEL_DATA_URL: "https://example.invalid/manual.json",
  UPSTREAM_VESSEL_DATA_URL: "https://example.invalid/upstream.json",
};

const child = spawn(process.execPath, ["server/vessel-feed-proxy/index.mjs"], { env, stdio: ["ignore", "pipe", "pipe"] });
child.stdout.on("data", (chunk) => output.push(chunk.toString()));
child.stderr.on("data", (chunk) => output.push(chunk.toString()));

try {
  const baseUrl = "http://127.0.0.1:" + backendPort;
  const result = await fetchJsonWithRetry(baseUrl + "/api/vessels", (_response, json) => json?.vessels?.some((row) => row.id === "MMSI-123456789"));
  const vessels = result.json;
  const first = subscriptions[0]?.subscription;
  const recovered = subscriptions.find((entry) => entry.connectionNumber > 1)?.subscription;

  assert(connectionCount >= 2, "Silent first AIS socket did not reconnect");
  assert(first?.APIKey === "test-key", "AIS API key was not trimmed before subscription");
  assert(JSON.stringify(first?.BoundingBoxes) === JSON.stringify([[[-90, -180], [90, 180]]]), "Primary AIS subscription was not global");
  assert(!("FilterMessageTypes" in first), "Primary AIS subscription unexpectedly filtered provider frames");
  assert(JSON.stringify(recovered?.BoundingBoxes) === JSON.stringify([[[-90, -180], [90, 180]]]), "Recovery profile unexpectedly blocked global coverage");
  assert(Array.isArray(recovered?.FilterMessageTypes) && recovered.FilterMessageTypes.includes("PositionReport"), "Recovery profile did not reduce the stream to position messages");
  assert(vessels.source === "aisstream", "Expected aisstream source, received " + vessels.source);
  assert(vessels.counts?.tracking === 1, "Expected one live AIS row, received " + vessels.counts?.tracking);
  assert(vessels.counts?.operational === 1, "Recovered AIS row was not derived into monitored-port scope");
  assert(vessels.vessels[0].inputSource === "global-tracking", "Vessel did not preserve its AIS source");
  assert(vessels.inputs?.fixedRows === undefined && vessels.inputs?.upstreamRows === undefined, "Non-AIS input counters remain in the API contract");
  assert(vessels.health?.messageCount >= 1 && vessels.health?.usablePositionMessages >= 1, "AIS frame counters were not updated");
  assert(vessels.health?.profileSwitches >= 1, "Silent socket did not record a profile switch");
  assert(vessels.health?.activeProfile === "world-position-only", "Unexpected recovery profile: " + vessels.health?.activeProfile);
  assert(vessels.health?.lastSuccessfulProfile === "world-position-only", "Successful recovery profile was not recorded");
  assert(vessels.health?.lastFrameAt && vessels.health?.lastMessageAt, "AIS frame timestamps were not recorded");

  const readiness = await fetch(baseUrl + "/health/ready");
  assert(readiness.status === 200, "AIS-backed readiness returned " + readiness.status);

  const ingest = await fetch(baseUrl + "/api/vessels/ingest", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ vessels: [] }) });
  assert(ingest.status === 404, "Manual vessel ingest endpoint still exists: " + ingest.status);

  console.log("Adaptive live AIS recovery integration smoke test passed.");
} catch (error) {
  throw new Error((error instanceof Error ? error.message : String(error)) + "\\n\\nRuntime output:\\n" + output.join("").slice(-10000));
} finally {
  child.kill("SIGTERM");
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 2000);
    child.once("exit", () => { clearTimeout(timer); resolve(); });
  });
  await new Promise((resolve) => websocketServer.close(resolve));
  rmSync(runtimeDir, { recursive: true, force: true });
}`;
  write(path, content);
}

function updateDocs() {
  write("docs/AIS_TRACKING_CONTINUITY.md", `# AIS tracking continuity

All vessel positions in the production portal originate from a genuine live AIS connection. The runtime does not load manual vessels, fixed vessel files, sample vessel files, or synthetic continuity rows.

## Primary tracking and automatic recovery

- The primary subscription is worldwide using the bounding box \`-90,-180;90,180\` with no message-type filter.
- A connected socket that produces no first frame within 30 seconds is treated as failed, not healthy.
- The runtime reconnects and rotates through live AISStream profiles: worldwide unfiltered, worldwide position-only, Red Sea/Gulf position-only, and monitored-port position-only.
- The first profile that delivers real AIS frames remains active. Every profile, switch, timeout, and successful profile is exposed through \`/health\` and \`/api/vessels\`.
- Monitored-port operational rows are always derived from the same genuine AIS observations used by the map.
- Recent real AIS positions may remain in the persistent AIS cache during a short interruption, retaining their MMSI and original timestamps.

## Provider outage boundary

Automatic profile rotation repairs silent connections, overloaded worldwide subscriptions, and subscription-specific delivery failures. It cannot manufacture frames during a service-wide AISStream upstream outage. During such an outage the portal reports zero current vessels rather than inserting placeholders. Continuous production availability therefore requires a second genuine live AIS provider; manual or fabricated vessel rows remain prohibited.
`);
}

function restoreBuildWorkflowAndRemoveInstaller() {
  const originalBuild = execFileSync("git", ["show", "HEAD^:.github/workflows/build.yml"], { encoding: "utf8" });
  write(".github/workflows/build.yml", originalBuild);
  rmSync("scripts/apply-ais-adaptive-recovery.mjs", { force: true });
  console.log("removed one-time AIS recovery installer");
}

updateRuntime();
updateStartProd();
updateEnvironmentFiles();
updateRuntimeContract();
updateSmokeTest();
updateDocs();
restoreBuildWorkflowAndRemoveInstaller();
console.log("Adaptive AIS recovery patch applied.");
