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

function replaceRange(content, startMarker, endMarker, replacement, label) {
  const start = content.indexOf(startMarker);
  if (start === -1) throw new Error(`Could not find start of ${label}`);
  const endStart = content.indexOf(endMarker, start);
  if (endStart === -1) throw new Error(`Could not find end of ${label}`);
  const end = endStart + endMarker.length;
  return content.slice(0, start) + replacement + content.slice(end);
}

function updateRuntime() {
  const path = "server/vessel-feed-proxy/runtime-v3.mjs";
  let content = read(path);

  content = replaceRange(
    content,
    "const AISSTREAM_URL = process.env.AISSTREAM_URL",
    "const AISSTREAM_OPERATIONAL_MAX_VESSELS = optionalCountLimit(process.env.AISSTREAM_OPERATIONAL_MAX_VESSELS ?? 0);",
    `const AISSTREAM_URL = process.env.AISSTREAM_URL ?? "wss://stream.aisstream.io/v0/stream";
const AISSTREAM_POSITION_FILTER_TYPES = [
  "PositionReport",
  "StandardClassBPositionReport",
  "ExtendedClassBPositionReport",
  "LongRangeAisBroadcastMessage",
];
// The portal needs current positions, not the full worldwide static/binary
// message firehose. The worldwide box is retained while provider load is kept
// within the documented whole-world processing envelope.
const AISSTREAM_FILTER_TYPES = AISSTREAM_POSITION_FILTER_TYPES;
const AISSTREAM_OPERATIONAL_FILTER_TYPES = AISSTREAM_POSITION_FILTER_TYPES;
const AISSTREAM_RECOVERY_ENABLED = process.env.AISSTREAM_RECOVERY_ENABLED !== "false";
const AISSTREAM_RECOVERY_PROFILES = [
  { id: "world-position-only", description: "worldwide, position-bearing messages", boxes: TRACKING_BOXES, filters: AISSTREAM_POSITION_FILTER_TYPES },
];
const AISSTREAM_MAX_VESSELS = optionalCountLimit(process.env.AISSTREAM_MAX_VESSELS ?? 0);
const AISSTREAM_OPERATIONAL_MAX_VESSELS = optionalCountLimit(process.env.AISSTREAM_OPERATIONAL_MAX_VESSELS ?? 0);`,
    "AISStream worldwide position profile",
  );

  content = replaceOnce(
    content,
    `const AISSTREAM_MAX_AGE_MS = Math.max(60_000, Number(process.env.AISSTREAM_MAX_AGE_MS ?? 6 * 60 * 60 * 1000));`,
    `const AISSTREAM_MAX_AGE_MS = Math.max(60_000, Number(process.env.AISSTREAM_MAX_AGE_MS ?? 24 * 60 * 60 * 1000));`,
    "24-hour AIS continuity retention",
  );

  content = replaceOnce(
    content,
    `const AISSTREAM_FIRST_FRAME_TIMEOUT_MS = Math.max(1_000, Number(process.env.AISSTREAM_FIRST_FRAME_TIMEOUT_MS ?? 30_000));
const AISSTREAM_SILENCE_TIMEOUT_MS = Math.max(15_000, Number(process.env.AISSTREAM_SILENCE_TIMEOUT_MS ?? 90_000));`,
    `const AISSTREAM_FIRST_FRAME_TIMEOUT_MS = Math.max(1_000, Number(process.env.AISSTREAM_FIRST_FRAME_TIMEOUT_MS ?? 30_000));
const AISSTREAM_SILENCE_TIMEOUT_MS = Math.max(15_000, Number(process.env.AISSTREAM_SILENCE_TIMEOUT_MS ?? 90_000));
const AISSTREAM_SILENT_RESUBSCRIBE_MS = Math.max(30_000, Number(process.env.AISSTREAM_SILENT_RESUBSCRIBE_MS ?? 2 * 60_000));
const AISSTREAM_HARD_RECONNECT_MS = Math.max(AISSTREAM_SILENT_RESUBSCRIBE_MS + 60_000, Number(process.env.AISSTREAM_HARD_RECONNECT_MS ?? 30 * 60_000));`,
    "AIS silent continuity intervals",
  );

  content = replaceOnce(
    content,
    `const POCKETWORLD_DISPLAY_MAX_AGE_MS = Math.max(60_000, Number(process.env.POCKETWORLD_DISPLAY_MAX_AGE_MS ?? process.env.POCKETWORLD_MAX_AGE_MS ?? 6 * 60 * 60_000));`,
    `const POCKETWORLD_DISPLAY_MAX_AGE_MS = Math.max(60_000, Number(process.env.POCKETWORLD_DISPLAY_MAX_AGE_MS ?? process.env.POCKETWORLD_MAX_AGE_MS ?? 24 * 60 * 60_000));`,
    "24-hour PocketWorld continuity retention",
  );

  content = replaceOnce(
    content,
    `    watchdogRestarts: 0,
    profileIndex: 0,`,
    `    watchdogRestarts: 0,
    subscriptionRefreshes: 0,
    lastSubscriptionRefreshAt: null,
    nextSubscriptionRefreshAt: null,
    silentSinceAt: null,
    hardReconnects: 0,
    lastHardReconnectAt: null,
    profileIndex: 0,`,
    "AIS continuity state fields",
  );

  content = replaceOnce(
    content,
    `function startAisStream({ state, cache, deriveOperational = false }) {`,
    `function sendAisSubscription(state, socket, profile, reason = "initial") {
  if (!socket || socket.readyState !== WebSocket.OPEN) return false;
  const subscription = { APIKey: AISSTREAM_API_KEY, BoundingBoxes: profile.boxes };
  if (profile.filters.length > 0) subscription.FilterMessageTypes = profile.filters;
  const sentAt = new Date().toISOString();
  socket.send(JSON.stringify(subscription));
  state.subscriptionSentAt = sentAt;
  state.subscription = {
    profile: profile.id,
    description: profile.description,
    boundingBoxes: profile.boxes,
    filterMessageTypes: profile.filters,
  };
  state.firstFrameDeadlineAt = new Date(Date.now() + AISSTREAM_FIRST_FRAME_TIMEOUT_MS).toISOString();
  if (reason !== "initial") {
    state.subscriptionRefreshes += 1;
    state.lastSubscriptionRefreshAt = sentAt;
    state.nextSubscriptionRefreshAt = new Date(Date.now() + AISSTREAM_SILENT_RESUBSCRIBE_MS).toISOString();
    state.lastRecoveryReason = reason;
    state.profileHistory = [...state.profileHistory, {
      at: sentAt,
      event: "subscription-refresh",
      profile: profile.id,
      reason,
    }].slice(-12);
  }
  return true;
}

function startAisStream({ state, cache, deriveOperational = false }) {`,
    "in-place AIS subscription helper",
  );

  content = replaceOnce(
    content,
    `    state.firstFrameDeadlineAt = new Date(Date.now() + AISSTREAM_FIRST_FRAME_TIMEOUT_MS).toISOString();
    state.profileHistory = [...state.profileHistory, {
      at: openedAt,
      event: "subscription",
      profile: profile.id,
      reason: state.lastRecoveryReason,
    }].slice(-12);`,
    `    state.firstFrameDeadlineAt = new Date(Date.now() + AISSTREAM_FIRST_FRAME_TIMEOUT_MS).toISOString();
    state.silentSinceAt = openedAt;
    state.nextSubscriptionRefreshAt = new Date(Date.now() + AISSTREAM_SILENT_RESUBSCRIBE_MS).toISOString();
    state.profileHistory = [...state.profileHistory, {
      at: openedAt,
      event: "subscription",
      profile: profile.id,
      reason: state.lastRecoveryReason,
    }].slice(-12);`,
    "AIS open continuity state",
  );

  content = replaceRange(
    content,
    "    const subscription = { APIKey: AISSTREAM_API_KEY, BoundingBoxes: profile.boxes };",
    "    socket.send(JSON.stringify(subscription));",
    `    sendAisSubscription(state, socket, profile, "initial");`,
    "initial AIS subscription send",
  );

  content = replaceOnce(
    content,
    `      state.lastFrameAt = new Date().toISOString();
      state.firstFrameDeadlineAt = null;`,
    `      state.lastFrameAt = new Date().toISOString();
      state.firstFrameDeadlineAt = null;
      state.silentSinceAt = null;
      state.nextSubscriptionRefreshAt = null;`,
    "AIS frame continuity reset",
  );

  content = replaceOnce(
    content,
    `    if (!stopping && closedBeforeFirstFrame && !state.profileAdvancedForCurrentSocket) {
      advanceAisProfile(state, "socket closed before the first AIS frame (code " + code + ")");
    }`,
    `    if (!stopping && closedBeforeFirstFrame) {
      state.lastRecoveryReason = "socket closed before the first AIS frame (code " + code + ")";
    }
    state.silentSinceAt = null;
    state.nextSubscriptionRefreshAt = null;`,
    "AIS close continuity handling",
  );

  content = replaceRange(
    content,
    "const aisWatchdogInterval = setInterval(() => {",
    "aisWatchdogInterval.unref?.();",
    `const aisWatchdogInterval = setInterval(() => {
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

  const now = Date.now();
  const openedAt = timestampMs(state.openedAt);
  const lastFrameAt = timestampMs(state.lastFrameAt);
  const lastPongAt = timestampMs(state.lastPongAt);
  const lastActivityAt = lastFrameAt > 0 ? lastFrameAt : openedAt;
  const silentForMs = lastActivityAt > 0 ? now - lastActivityAt : 0;
  const silenceThresholdMs = state.connectionMessageCount === 0
    ? AISSTREAM_FIRST_FRAME_TIMEOUT_MS
    : AISSTREAM_SILENCE_TIMEOUT_MS;
  const heartbeatLost = lastPongAt > 0 && now - lastPongAt > AISSTREAM_HEARTBEAT_MS * 3;
  const hardReconnectDue = silentForMs >= AISSTREAM_HARD_RECONNECT_MS;

  if (heartbeatLost || hardReconnectDue) {
    state.watchdogRestarts += 1;
    state.hardReconnects += 1;
    state.lastHardReconnectAt = new Date().toISOString();
    state.lastError = heartbeatLost
      ? "AIS websocket heartbeat timed out"
      : "AIS provider produced no frames for " + Math.round(silentForMs / 1000) + " seconds; performing a controlled hard reconnect";
    state.status = heartbeatLost ? "heartbeat-reconnect" : "hard-reconnect";
    state.firstFrameDeadlineAt = null;
    state.silentSinceAt = state.silentSinceAt ?? new Date(lastActivityAt || now).toISOString();
    try { socket.terminate(); } catch {}
    return;
  }

  if (silentForMs < silenceThresholdMs) return;
  state.silentSinceAt = state.silentSinceAt ?? new Date(lastActivityAt || now).toISOString();
  const lastSubscriptionAt = Math.max(
    timestampMs(state.subscriptionSentAt),
    timestampMs(state.lastSubscriptionRefreshAt),
  );
  const refreshDue = now - lastSubscriptionAt >= AISSTREAM_SILENT_RESUBSCRIBE_MS;
  if (!refreshDue || !AISSTREAM_RECOVERY_ENABLED) {
    state.status = "connected-silent";
    state.nextSubscriptionRefreshAt = new Date(lastSubscriptionAt + AISSTREAM_SILENT_RESUBSCRIBE_MS).toISOString();
    return;
  }

  const profile = activeAisProfile(state);
  if (sendAisSubscription(state, socket, profile, "open socket produced no AIS position frames")) {
    state.status = "connected-silent-resubscribed";
    state.lastError = "AIS socket is open but silent; the worldwide position subscription was refreshed in place";
  }
}, AISSTREAM_HEARTBEAT_MS);
aisWatchdogInterval.unref?.();`,
    "AIS continuity watchdog",
  );

  content = replaceRange(
    content,
    "function providerState() {",
    "}\n\nfunction readinessPayload() {",
    `function providerState() {
  if (!vesselProviderConfigured()) return "unconfigured";
  const source = sourceForTracking();
  const pocketWorldState = pocketWorldProvider.publicState();
  if (vesselInputState.trackingRows > 0) {
    if (
      Number(vesselInputState.aisstreamRows ?? 0) === 0
      && Number(vesselInputState.pocketworldRows ?? 0) > 0
      && pocketWorldState.coverage?.worldwide_ready === false
    ) return "degraded-regional-only";
    if (source === "pocketworld-last-known") return "degraded-last-known";
    return source === "ais-multi-provider" ? "live-multi-provider" : "live";
  }
  const datalasticState = datalasticProvider.publicState();
  if (["unauthorized", "credits-exhausted", "rate-limited", "provider-error", "request-error", "timeout"].includes(datalasticState.status)) {
    if (!POCKETWORLD_AIS_ENABLED) return "datalastic-" + datalasticState.status;
  }
  if (["rate-limited", "provider-error", "request-error", "timeout"].includes(pocketWorldState.status)) {
    return "pocketworld-" + pocketWorldState.status;
  }
  if (trackingAisState.connected) return "aisstream-silent-public-fallback-waiting";
  if (AISSTREAM_API_KEY || DATALASTIC_API_KEY || POCKETWORLD_AIS_ENABLED) return "reconnecting";
  return "unavailable";
}

function readinessPayload() {`,
    "truthful regional-only provider state",
  );

  content = replaceOnce(
    content,
    `      retentionMs: AISSTREAM_MAX_AGE_MS,
    },`,
    `      retentionMs: AISSTREAM_MAX_AGE_MS,
      worldwideReady: Number(vesselInputState.aisstreamRows ?? 0) > 0
        || pocketWorldProvider.publicState().coverage?.worldwide_ready === true,
      silentResubscribeMs: AISSTREAM_SILENT_RESUBSCRIBE_MS,
      hardReconnectMs: AISSTREAM_HARD_RECONNECT_MS,
    },`,
    "tracking continuity diagnostics",
  );

  write(path, content);
}

function updateStartProd() {
  const path = "scripts/start-prod.mjs";
  let content = read(path);
  content = replaceOnce(content, 'process.env.AISSTREAM_FILTER_TYPES = "";', 'process.env.AISSTREAM_FILTER_TYPES = "PositionReport,StandardClassBPositionReport,ExtendedClassBPositionReport,LongRangeAisBroadcastMessage";', "production AIS message filter");
  content = replaceOnce(
    content,
    `process.env.AISSTREAM_FIRST_FRAME_TIMEOUT_MS = runningOnRender ? "30000" : (process.env.AISSTREAM_FIRST_FRAME_TIMEOUT_MS || "30000");
process.env.AISSTREAM_SILENCE_TIMEOUT_MS = runningOnRender ? "90000" : (process.env.AISSTREAM_SILENCE_TIMEOUT_MS || "90000");`,
    `process.env.AISSTREAM_FIRST_FRAME_TIMEOUT_MS = runningOnRender ? "30000" : (process.env.AISSTREAM_FIRST_FRAME_TIMEOUT_MS || "30000");
process.env.AISSTREAM_SILENCE_TIMEOUT_MS = runningOnRender ? "90000" : (process.env.AISSTREAM_SILENCE_TIMEOUT_MS || "90000");
process.env.AISSTREAM_SILENT_RESUBSCRIBE_MS = runningOnRender ? "120000" : (process.env.AISSTREAM_SILENT_RESUBSCRIBE_MS || "120000");
process.env.AISSTREAM_HARD_RECONNECT_MS = runningOnRender ? "1800000" : (process.env.AISSTREAM_HARD_RECONNECT_MS || "1800000");`,
    "production AIS continuity intervals",
  );
  content = replaceOnce(content, `process.env.AISSTREAM_MAX_AGE_MS ??= String(6 * 60 * 60 * 1000);`, `process.env.AISSTREAM_MAX_AGE_MS ??= String(24 * 60 * 60 * 1000);`, "production AIS retention");
  content = replaceOnce(content, `process.env.POCKETWORLD_DISPLAY_MAX_AGE_MS ??= "21600000";`, `process.env.POCKETWORLD_DISPLAY_MAX_AGE_MS ??= "86400000";`, "production PocketWorld retention");
  content = replaceOnce(content, `console.log("AIS recovery remains worldwide and changes message filters only; it never narrows the tracking bounding box to a region.");`, `console.log("AISStream uses one worldwide position-only subscription. Silent healthy sockets are resubscribed in place before any controlled hard reconnect.");`, "production recovery log");
  write(path, content);
}

function updateRender() {
  const path = "render.yaml";
  let content = read(path);
  content = replaceOnce(
    content,
    `      - key: VITE_VESSEL_FETCH_INTERVAL_MS
        value: 15000`,
    `      - key: VITE_VESSEL_FETCH_INTERVAL_MS
        value: 15000
      - key: VITE_VESSEL_DISPLAY_RETENTION_MS
        value: 86400000`,
    "Render frontend retention",
  );
  content = replaceOnce(
    content,
    `      - key: AISSTREAM_FILTER_TYPES
        value: ""`,
    `      - key: AISSTREAM_FILTER_TYPES
        value: PositionReport,StandardClassBPositionReport,ExtendedClassBPositionReport,LongRangeAisBroadcastMessage`,
    "Render AIS position filter",
  );
  content = replaceOnce(content, `      - key: AISSTREAM_MAX_AGE_MS
        value: 21600000`, `      - key: AISSTREAM_MAX_AGE_MS
        value: 86400000`, "Render AIS retention");
  content = replaceOnce(
    content,
    `      - key: AISSTREAM_FIRST_FRAME_TIMEOUT_MS
        value: 30000
      - key: AISSTREAM_SILENCE_TIMEOUT_MS
        value: 90000`,
    `      - key: AISSTREAM_FIRST_FRAME_TIMEOUT_MS
        value: 30000
      - key: AISSTREAM_SILENCE_TIMEOUT_MS
        value: 90000
      - key: AISSTREAM_SILENT_RESUBSCRIBE_MS
        value: 120000
      - key: AISSTREAM_HARD_RECONNECT_MS
        value: 1800000`,
    "Render AIS continuity intervals",
  );
  content = replaceOnce(content, `      - key: POCKETWORLD_DISPLAY_MAX_AGE_MS
        value: 21600000`, `      - key: POCKETWORLD_DISPLAY_MAX_AGE_MS
        value: 86400000`, "Render PocketWorld retention");
  content = replaceOnce(content, `      - key: POCKETWORLD_MAX_AGE_MS
        value: 21600000`, `      - key: POCKETWORLD_MAX_AGE_MS
        value: 86400000`, "Render PocketWorld max age");
  write(path, content);
}

function updateEnvExample() {
  const path = ".env.example";
  let content = read(path);
  content = replaceOnce(content, `VITE_PROXY_TARGET=http://localhost:8787`, `VITE_PROXY_TARGET=http://localhost:8787\nVITE_VESSEL_DISPLAY_RETENTION_MS=86400000`, "example frontend retention");
  content = replaceOnce(content, `AISSTREAM_FILTER_TYPES=`, `AISSTREAM_FILTER_TYPES=PositionReport,StandardClassBPositionReport,ExtendedClassBPositionReport,LongRangeAisBroadcastMessage`, "example AIS filter");
  content = replaceOnce(content, `AISSTREAM_MAX_AGE_MS=21600000`, `AISSTREAM_MAX_AGE_MS=86400000`, "example AIS retention");
  content = replaceOnce(
    content,
    `AISSTREAM_FIRST_FRAME_TIMEOUT_MS=30000
AISSTREAM_SILENCE_TIMEOUT_MS=90000`,
    `AISSTREAM_FIRST_FRAME_TIMEOUT_MS=30000
AISSTREAM_SILENCE_TIMEOUT_MS=90000
AISSTREAM_SILENT_RESUBSCRIBE_MS=120000
AISSTREAM_HARD_RECONNECT_MS=1800000`,
    "example AIS continuity intervals",
  );
  content = replaceOnce(content, `POCKETWORLD_DISPLAY_MAX_AGE_MS=21600000`, `POCKETWORLD_DISPLAY_MAX_AGE_MS=86400000`, "example PocketWorld retention");
  content = replaceOnce(content, `POCKETWORLD_MAX_AGE_MS=21600000`, `POCKETWORLD_MAX_AGE_MS=86400000`, "example PocketWorld max age");
  write(path, content);
}

function updateRuntimeContract() {
  const path = "scripts/check-runtime-contract.mjs";
  let content = read(path);
  content = replaceOnce(content, `assertIncludes(runtime, "const AISSTREAM_FILTER_TYPES = []", "AIS provider frames remain filtered");`, `assertIncludes(runtime, "const AISSTREAM_FILTER_TYPES = AISSTREAM_POSITION_FILTER_TYPES", "worldwide AIS is not constrained to position-bearing messages");`, "runtime AIS filter contract");
  content = replaceOnce(content, `assertIncludes(runtime, "advanceAisProfile", "silent AIS sockets do not rotate profiles");`, `assertIncludes(runtime, "sendAisSubscription", "silent AIS sockets cannot refresh a subscription in place");\nassertIncludes(runtime, "subscriptionRefreshes", "AIS subscription-refresh diagnostics are absent");\nassertIncludes(runtime, "hardReconnects", "AIS controlled hard-reconnect diagnostics are absent");`, "runtime continuity contract");
  content = replaceOnce(content, `assertIncludes(runtime, 'id: "world-position-only"', "AIS recovery does not preserve worldwide position coverage");`, `assertIncludes(runtime, 'id: "world-position-only"', "AIS recovery does not preserve worldwide position coverage");\nassertNotIncludes(runtime, 'id: "world-unfiltered"', "the high-volume unfiltered worldwide profile is still active");`, "position-only profile contract");
  content = replaceOnce(content, `assertIncludes(startProd, 'process.env.AISSTREAM_FIRST_FRAME_TIMEOUT_MS', "production startup does not configure first-frame recovery");`, `assertIncludes(startProd, 'process.env.AISSTREAM_FIRST_FRAME_TIMEOUT_MS', "production startup does not configure first-frame recovery");\nassertIncludes(startProd, 'process.env.AISSTREAM_SILENT_RESUBSCRIBE_MS', "production startup does not configure in-place silent resubscription");\nassertIncludes(startProd, 'process.env.AISSTREAM_HARD_RECONNECT_MS', "production startup does not configure controlled hard reconnects");`, "production continuity contract");
  content = replaceOnce(content, `assertIncludes(render, "AISSTREAM_MAX_AGE_MS\\n        value: 21600000", "Render AIS continuity retention is absent");`, `assertIncludes(render, "AISSTREAM_MAX_AGE_MS\\n        value: 86400000", "Render AIS continuity retention is below 24 hours");`, "Render AIS retention contract");
  content = replaceOnce(content, `assertIncludes(render, "AISSTREAM_SILENCE_TIMEOUT_MS\\n        value: 90000", "Render silence timeout is too slow");`, `assertIncludes(render, "AISSTREAM_SILENCE_TIMEOUT_MS\\n        value: 90000", "Render silence timeout is too slow");\nassertIncludes(render, "AISSTREAM_SILENT_RESUBSCRIBE_MS\\n        value: 120000", "Render does not refresh silent subscriptions in place");\nassertIncludes(render, "AISSTREAM_HARD_RECONNECT_MS\\n        value: 1800000", "Render hard-reconnect interval is too aggressive or absent");`, "Render continuity intervals contract");
  content = replaceOnce(content, `assertIncludes(render, "POCKETWORLD_DISPLAY_MAX_AGE_MS\\n        value: 21600000", "Render last-known AIS retention is absent");`, `assertIncludes(render, "POCKETWORLD_DISPLAY_MAX_AGE_MS\\n        value: 86400000", "Render regional continuity retention is below 24 hours");`, "Render PocketWorld retention contract");
  content = replaceOnce(content, `assertIncludes(envExample, "AISSTREAM_MAX_VESSELS=0", "environment template does not document unlimited AISStream retention");`, `assertIncludes(envExample, "AISSTREAM_MAX_VESSELS=0", "environment template does not document unlimited AISStream retention");\nassertIncludes(envExample, "VITE_VESSEL_DISPLAY_RETENTION_MS=86400000", "environment template does not document 24-hour browser continuity");\nassertIncludes(envExample, "AISSTREAM_SILENT_RESUBSCRIBE_MS=120000", "environment template does not document silent resubscription");`, "environment continuity contract");
  write(path, content);
}

function writeDocumentation() {
  write("docs/AISSTREAM_GLOBAL_CONTINUITY.md", `# AISStream global continuity policy

The portal retains a worldwide AIS tracking subscription and does not narrow vessel reporting to selected regions. The current production fallback may nevertheless appear regional when AISStream itself supplies no position frames.

## Observed provider state

A live diagnostic on 19 August 2026 found that AISStream was configured with the full-world bounding box but had delivered zero frames. The visible cohort therefore came entirely from PocketWorld sources covering Norway, Finland/Baltic waters, and Singapore. This is an upstream-source state, not a Leaflet or application geography filter.

## Connection strategy

- The active AISStream subscription uses the worldwide bounding box and position-bearing message types only.
- A healthy WebSocket that produces no AIS positions is kept open.
- The same worldwide subscription is refreshed in place after the silent interval.
- A hard reconnect is delayed until the configured long silence interval or heartbeat loss.
- Rate-limit backoff remains authoritative.
- Diagnostics expose subscription refreshes, silent start time, and controlled hard reconnects.

AISStream documents that an active subscription can be replaced by sending a new subscription message on the same WebSocket. The position-only profile also reduces processing load compared with the full worldwide message firehose.

## Continuity retention

Global AIS and PocketWorld observations remain available for up to 24 hours by default. Browser display retention is aligned to the same interval. This helps preserve genuine worldwide context through short provider interruptions and deployments.

Retention is not operational freshness. EcoFair-CH-MARL continues to use only observations within the configured port radius and the separate 30-minute operational freshness gate.

## Provider boundary

The application cannot recreate AIS observations that an upstream provider did not deliver. During a service-side AISStream outage, the portal reports the remaining PocketWorld cohort as \`degraded-regional-only\` rather than calling it worldwide live coverage. No manual or synthetic rows are introduced.
`);
}

function removeBootstrapFiles() {
  for (const path of [
    "scripts/apply-aisstream-global-continuity.mjs",
    ".github/workflows/apply-aisstream-global-continuity.yml",
  ]) {
    if (existsSync(path)) rmSync(path);
  }
}

updateRuntime();
updateStartProd();
updateRender();
updateEnvExample();
updateRuntimeContract();
writeDocumentation();
removeBootstrapFiles();
console.log("AISStream global continuity patch applied.");
