import { readFileSync, writeFileSync } from "node:fs";

function read(path) {
  return readFileSync(path, "utf8");
}

function write(path, content) {
  writeFileSync(path, content);
  console.log(`updated ${path}`);
}

function replaceOnce(content, before, after, label) {
  const first = content.indexOf(before);
  if (first === -1) throw new Error(`Could not find ${label}`);
  if (content.indexOf(before, first + before.length) !== -1) throw new Error(`Found ${label} more than once`);
  return content.slice(0, first) + after + content.slice(first + before.length);
}

function updateRuntime() {
  const path = "server/vessel-feed-proxy/runtime-v3.mjs";
  let content = read(path);

  content = replaceOnce(
    content,
    'const STATIC_INDEX = resolve(STATIC_DIR, "index.html");\n',
    'const STATIC_INDEX = resolve(STATIC_DIR, "index.html");\nconst SERVICE_VERSION = process.env.RENDER_GIT_COMMIT ?? process.env.GIT_COMMIT ?? "development";\nconst SERVICE_STARTED_AT = new Date().toISOString();\n',
    "runtime service metadata insertion point",
  );

  content = replaceOnce(
    content,
    'const AISSTREAM_MAX_IMPLIED_SPEED_KN = Math.max(50, Number(process.env.AISSTREAM_MAX_IMPLIED_SPEED_KN ?? 120));\n',
    'const AISSTREAM_MAX_IMPLIED_SPEED_KN = Math.max(50, Number(process.env.AISSTREAM_MAX_IMPLIED_SPEED_KN ?? 120));\nconst AISSTREAM_HEARTBEAT_MS = Math.max(15_000, Number(process.env.AISSTREAM_HEARTBEAT_MS ?? 30_000));\nconst AISSTREAM_SILENCE_TIMEOUT_MS = Math.max(60_000, Number(process.env.AISSTREAM_SILENCE_TIMEOUT_MS ?? 5 * 60_000));\n',
    "AIS watchdog constants insertion point",
  );

  content = replaceOnce(
    content,
    `    reconnectAttempt: 0,\n    messageCount: 0,\n`,
    `    reconnectAttempt: 0,\n    status: AISSTREAM_API_KEY ? "connecting" : "disabled",\n    openedAt: null,\n    lastPongAt: null,\n    lastCloseAt: null,\n    watchdogRestarts: 0,\n    messageCount: 0,\n`,
    "AIS state lifecycle fields",
  );

  const oldStartFunction = `function startAisStream({ state, cache, boxes, filters, alsoTracking = false }) {\n  if (!AISSTREAM_API_KEY || stopping) return;\n  const socket = new WebSocket(AISSTREAM_URL);\n  state.socket = socket;\n  socket.on("open", () => {\n    state.connected = true;\n    state.reconnectAttempt = 0;\n    state.lastError = null;\n    socket.send(JSON.stringify({ APIKey: AISSTREAM_API_KEY, BoundingBoxes: boxes, ...(filters.length > 0 ? { FilterMessageTypes: filters } : {}) }));\n  });\n  socket.on("message", (data) => {\n    try {\n      state.messageCount += 1;\n      const raw = JSON.parse(data.toString());\n      if (raw.error) {\n        state.lastError = String(raw.error);\n        return;\n      }\n      const vessel = normalizeAisMessage(raw, state.label);\n      if (!vessel) return;\n      state.usablePositionMessages += 1;\n      state.lastMessageAt = new Date().toISOString();\n      mergeAisVessel(cache, state, vessel);\n      if (alsoTracking) mergeAisVessel(trackingAisCache, trackingAisState, vessel);\n    } catch (error) {\n      state.lastError = error instanceof Error ? error.message : String(error);\n    }\n  });\n  socket.on("close", () => {\n    state.connected = false;\n    if (stopping) return;\n    const delay = Math.min(30_000, 2_000 * 2 ** state.reconnectAttempt);\n    state.reconnectAttempt += 1;\n    state.reconnectTimer = setTimeout(() => startAisStream({ state, cache, boxes, filters, alsoTracking }), delay);\n  });\n  socket.on("error", (error) => {\n    state.connected = false;\n    state.lastError = error.message;\n  });\n}\n`;

  const newStartFunction = `function scheduleAisReconnect(options) {\n  const { state } = options;\n  if (stopping || !AISSTREAM_API_KEY || state.reconnectTimer) return;\n  const delay = Math.min(30_000, 2_000 * 2 ** state.reconnectAttempt);\n  state.reconnectAttempt += 1;\n  state.status = "reconnecting";\n  state.reconnectTimer = setTimeout(() => {\n    state.reconnectTimer = null;\n    startAisStream(options);\n  }, delay);\n  state.reconnectTimer.unref?.();\n}\n\nfunction startAisStream({ state, cache, boxes, filters, deriveOperational = false }) {\n  const options = { state, cache, boxes, filters, deriveOperational };\n  if (!AISSTREAM_API_KEY || stopping) {\n    state.status = AISSTREAM_API_KEY ? "stopped" : "disabled";\n    return;\n  }\n  if (state.reconnectTimer) {\n    clearTimeout(state.reconnectTimer);\n    state.reconnectTimer = null;\n  }\n  const socket = new WebSocket(AISSTREAM_URL);\n  state.socket = socket;\n  state.status = "connecting";\n  socket.on("open", () => {\n    const openedAt = new Date().toISOString();\n    state.connected = true;\n    state.reconnectAttempt = 0;\n    state.lastError = null;\n    state.openedAt = openedAt;\n    state.lastPongAt = openedAt;\n    state.status = "connected-waiting";\n    if (deriveOperational) {\n      operationalAisState.enabled = true;\n      operationalAisState.connected = true;\n      operationalAisState.openedAt = openedAt;\n      operationalAisState.status = "derived-waiting";\n      operationalAisState.lastError = null;\n    }\n    socket.send(JSON.stringify({ APIKey: AISSTREAM_API_KEY, BoundingBoxes: boxes, ...(filters.length > 0 ? { FilterMessageTypes: filters } : {}) }));\n  });\n  socket.on("pong", () => {\n    state.lastPongAt = new Date().toISOString();\n  });\n  socket.on("message", (data) => {\n    try {\n      state.messageCount += 1;\n      const raw = JSON.parse(data.toString());\n      if (raw.error) {\n        state.lastError = String(raw.error);\n        state.status = "provider-error";\n        return;\n      }\n      const vessel = normalizeAisMessage(raw, state.label);\n      if (!vessel) return;\n      const receivedAt = new Date().toISOString();\n      state.usablePositionMessages += 1;\n      state.lastMessageAt = receivedAt;\n      state.status = "live";\n      mergeAisVessel(cache, state, vessel);\n      if (deriveOperational) {\n        const nearest = nearestOperationalPort(vessel);\n        if (nearest && nearest.distanceNm <= ECOFAIR_OPERATIONAL_RADIUS_NM) {\n          operationalAisState.messageCount += 1;\n          operationalAisState.usablePositionMessages += 1;\n          operationalAisState.lastMessageAt = receivedAt;\n          operationalAisState.status = "derived-live";\n          mergeAisVessel(operationalAisCache, operationalAisState, vessel);\n        }\n      }\n    } catch (error) {\n      state.lastError = error instanceof Error ? error.message : String(error);\n      state.status = "message-error";\n    }\n  });\n  socket.on("close", (code, reason) => {\n    const closedAt = new Date().toISOString();\n    state.connected = false;\n    state.lastCloseAt = closedAt;\n    state.socket = null;\n    if (reason?.length) state.lastError = \`AIS websocket closed (\${code}): \${reason.toString()}\`;\n    if (deriveOperational) {\n      operationalAisState.connected = false;\n      operationalAisState.lastCloseAt = closedAt;\n      operationalAisState.status = stopping ? "stopped" : "derived-reconnecting";\n    }\n    if (!stopping) scheduleAisReconnect(options);\n  });\n  socket.on("error", (error) => {\n    state.connected = false;\n    state.lastError = error.message;\n    state.status = "socket-error";\n  });\n  socket.on("unexpected-response", (_request, response) => {\n    state.lastError = \`AIS websocket rejected the subscription with HTTP \${response.statusCode ?? "unknown"}\`;\n    state.status = "provider-error";\n  });\n}\n`;

  content = replaceOnce(content, oldStartFunction, newStartFunction, "AIS stream implementation");

  content = replaceOnce(
    content,
    `startAisStream({ state: trackingAisState, cache: trackingAisCache, boxes: TRACKING_BOXES, filters: AISSTREAM_FILTER_TYPES });\nif (OPERATIONAL_PRIORITY_ENABLED) startAisStream({ state: operationalAisState, cache: operationalAisCache, boxes: OPERATIONAL_BOXES, filters: AISSTREAM_OPERATIONAL_FILTER_TYPES, alsoTracking: true });\n`,
    `startAisStream({\n  state: trackingAisState,\n  cache: trackingAisCache,\n  boxes: TRACKING_BOXES,\n  filters: AISSTREAM_FILTER_TYPES,\n  deriveOperational: OPERATIONAL_PRIORITY_ENABLED,\n});\noperationalAisState.enabled = Boolean(AISSTREAM_API_KEY && OPERATIONAL_PRIORITY_ENABLED);\noperationalAisState.status = OPERATIONAL_PRIORITY_ENABLED ? "derived-waiting" : "disabled";\n`,
    "AIS startup subscriptions",
  );

  content = replaceOnce(
    content,
    `const pruneInterval = setInterval(() => {\n  cacheRows(trackingAisCache, trackingAisState);\n  cacheRows(operationalAisCache, operationalAisState);\n}, 60_000);\npruneInterval.unref?.();\n`,
    `const pruneInterval = setInterval(() => {\n  cacheRows(trackingAisCache, trackingAisState);\n  cacheRows(operationalAisCache, operationalAisState);\n}, 60_000);\npruneInterval.unref?.();\nconst aisWatchdogInterval = setInterval(() => {\n  if (stopping || !AISSTREAM_API_KEY) return;\n  const state = trackingAisState;\n  const socket = state.socket;\n  if (!socket || socket.readyState !== WebSocket.OPEN) {\n    scheduleAisReconnect({\n      state,\n      cache: trackingAisCache,\n      boxes: TRACKING_BOXES,\n      filters: AISSTREAM_FILTER_TYPES,\n      deriveOperational: OPERATIONAL_PRIORITY_ENABLED,\n    });\n    return;\n  }\n  try { socket.ping(); }\n  catch (error) { state.lastError = error instanceof Error ? error.message : String(error); }\n  const lastSignal = timestampMs(state.lastMessageAt) || timestampMs(state.openedAt);\n  const lastPong = timestampMs(state.lastPongAt);\n  const now = Date.now();\n  const silent = lastSignal > 0 && now - lastSignal > AISSTREAM_SILENCE_TIMEOUT_MS;\n  const heartbeatLost = lastPong > 0 && now - lastPong > AISSTREAM_HEARTBEAT_MS * 3;\n  if (silent || heartbeatLost) {\n    state.watchdogRestarts += 1;\n    state.lastError = silent\n      ? \`AIS provider produced no usable positions for \${Math.round((now - lastSignal) / 1000)} seconds\`\n      : "AIS websocket heartbeat timed out";\n    state.status = "watchdog-restart";\n    try { socket.terminate(); } catch {}\n  }\n}, AISSTREAM_HEARTBEAT_MS);\naisWatchdogInterval.unref?.();\n`,
    "AIS watchdog interval insertion point",
  );

  content = replaceOnce(
    content,
    `  return base.replace("## Fleet measures", \`${'${scopeSection}'}## Fleet measures\`).replace("- Vessel positions: aisstream.io live AIS (Red Sea / Gulf bounding boxes).", "- Vessel tracking: independent global and Red Sea/Gulf AIS subscriptions; operational calculations are restricted to monitored-port geofences.");\n`,
    `  return base.replace("## Fleet measures", \`${'${scopeSection}'}## Fleet measures\`).replace("- Vessel positions: aisstream.io live AIS (Red Sea / Gulf bounding boxes).", "- Vessel tracking: one resilient global AIS subscription populates both the display cache and the monitored-port operational cache; operational calculations remain restricted to port geofences.");\n`,
    "report AIS architecture wording",
  );

  content = replaceOnce(
    content,
    '    `- Priority regional AIS cache: ${vesselInputState.priorityAisRows} vessels retained independently of global traffic.`,\n',
    '    `- Monitored-port AIS cache: ${vesselInputState.priorityAisRows} vessels derived from the single global subscription.`,\n',
    "report operational cache wording",
  );

  content = replaceOnce(
    content,
    '  console.log(`Operational AIS priority: ${OPERATIONAL_PRIORITY_ENABLED ? "enabled" : "disabled"}; boxes: ${OPERATIONAL_BOXES.length}; cache limit: ${AISSTREAM_OPERATIONAL_MAX_VESSELS}`);\n',
    '  console.log(`Operational AIS derivation: ${OPERATIONAL_PRIORITY_ENABLED ? "enabled" : "disabled"}; monitored boxes: ${OPERATIONAL_BOXES.length}; cache limit: ${AISSTREAM_OPERATIONAL_MAX_VESSELS}`);\n',
    "startup operational AIS wording",
  );

  content = replaceOnce(
    content,
    `function healthPayload() {\n  return {\n    ok: true,\n`,
    `function providerState() {\n  if (!AISSTREAM_API_KEY && !UPSTREAM_URL && !FIXED_VESSEL_DATA_URL && !FIXED_VESSEL_DATA_FILE_ENABLED) return "unconfigured";\n  if (vesselInputState.trackingRows > 0) return trackingAisState.connected ? "live" : "degraded-cache";\n  if (trackingAisState.connected) return "connected-waiting";\n  if (AISSTREAM_API_KEY) return "reconnecting";\n  return "unavailable";\n}\n\nfunction readinessPayload() {\n  const staticDashboard = existsSync(STATIC_INDEX);\n  const dataReady = vesselInputState.trackingRows > 0;\n  const providerConfigured = Boolean(AISSTREAM_API_KEY || UPSTREAM_URL || FIXED_VESSEL_DATA_URL || FIXED_VESSEL_DATA_FILE_ENABLED);\n  return {\n    ok: staticDashboard && dataReady,\n    staticDashboard,\n    dataReady,\n    providerConfigured,\n    providerState: providerState(),\n    reason: !staticDashboard ? "production dashboard bundle is missing" : dataReady ? null : providerConfigured ? "provider is configured but no vessel rows are currently available" : "no vessel provider is configured",\n  };\n}\n\nfunction healthPayload() {\n  return {\n    ok: true,\n    service: { version: SERVICE_VERSION, startedAt: SERVICE_STARTED_AT, uptimeSeconds: Math.round(process.uptime()) },\n    providerState: providerState(),\n    readiness: readinessPayload(),\n`,
    "health payload extension",
  );

  content = replaceOnce(
    content,
    `  if (path === "/health") {\n    await loadCombinedVessels();\n    await currentPortOperations();\n    await currentWeather();\n    return sendJson(response, 200, healthPayload());\n  }\n`,
    `  if (path === "/health/live") {\n    return sendJson(response, 200, { ok: true, service: { version: SERVICE_VERSION, startedAt: SERVICE_STARTED_AT, uptimeSeconds: Math.round(process.uptime()) } });\n  }\n\n  if (path === "/health" || path === "/health/ready") {\n    await loadCombinedVessels();\n    if (path === "/health") {\n      await currentPortOperations();\n      await currentWeather();\n      return sendJson(response, 200, healthPayload());\n    }\n    const readiness = readinessPayload();\n    return sendJson(response, readiness.ok ? 200 : 503, readiness);\n  }\n\n  if (path === "/version") {\n    return sendJson(response, 200, { version: SERVICE_VERSION, startedAt: SERVICE_STARTED_AT });\n  }\n`,
    "health route block",
  );

  content = replaceOnce(
    content,
    `["/health", "/api/vessels", "/api/vessels/operations", "/api/vessels?scope=operational", "/api/vessels/ingest", "/api/chmarl/episode", "/api/chmarl/ingest", "/api/port-events", "/api/weather", "/api/report"]`,
    `["/health", "/health/live", "/health/ready", "/version", "/api/vessels", "/api/vessels/operations", "/api/vessels?scope=operational", "/api/vessels/ingest", "/api/chmarl/episode", "/api/chmarl/ingest", "/api/port-events", "/api/weather", "/api/report"]`,
    "available endpoint list",
  );

  write(path, content);
}

function updateRenderBlueprint() {
  const path = "render.yaml";
  let content = read(path);
  content = replaceOnce(content, "    healthCheckPath: /health\n", "    healthCheckPath: /health/live\n    renderSubdomainPolicy: enabled\n", "Render health check");
  content = replaceOnce(
    content,
    "      - key: AISSTREAM_MAX_IMPLIED_SPEED_KN\n        value: 120\n",
    "      - key: AISSTREAM_MAX_IMPLIED_SPEED_KN\n        value: 120\n      - key: AISSTREAM_HEARTBEAT_MS\n        value: 30000\n      - key: AISSTREAM_SILENCE_TIMEOUT_MS\n        value: 300000\n",
    "Render AIS watchdog settings",
  );
  write(path, content);
}

function updateDockerfile() {
  const path = "Dockerfile";
  let content = read(path);
  content = replaceOnce(content, "COPY package.json ./\nRUN pnpm install --no-frozen-lockfile\n", "COPY package.json pnpm-lock.yaml ./\nRUN pnpm install --frozen-lockfile\n", "Docker build dependency install");
  content = replaceOnce(content, "COPY package.json ./\nRUN pnpm install --prod --no-frozen-lockfile\n", "COPY package.json pnpm-lock.yaml ./\nRUN pnpm install --prod --frozen-lockfile\n", "Docker runtime dependency install");
  write(path, content);
}

function updatePackageJson() {
  const path = "package.json";
  const json = JSON.parse(read(path));
  json.scripts ??= {};
  json.scripts["verify:runtime"] = "node --check server/vessel-feed-proxy/runtime-v3.mjs && node scripts/check-runtime-contract.mjs";
  json.scripts.check = "pnpm lint && pnpm build && pnpm verify:runtime";
  write(path, `${JSON.stringify(json, null, 2)}\n`);
}

function updateWorkflows() {
  for (const path of [".github/workflows/build.yml", ".github/workflows/verify-build.yml", ".github/workflows/ci.yml"]) {
    let content = read(path);
    content = content.replaceAll("pnpm install --no-frozen-lockfile", "pnpm install --frozen-lockfile");
    if (!content.includes("pnpm verify:runtime")) {
      content = content.replace(/(\n\s+- name: (?:Type-check and build|Build production bundle|Build)\n\s+run: pnpm build\n)/, `$1\n      - name: Verify runtime contract\n        run: pnpm verify:runtime\n`);
    }
    write(path, content);
  }
}

updateRuntime();
updateRenderBlueprint();
updateDockerfile();
updatePackageJson();
updateWorkflows();
