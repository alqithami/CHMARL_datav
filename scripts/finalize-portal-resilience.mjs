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
    'const AISSTREAM_SILENCE_TIMEOUT_MS = Math.max(60_000, Number(process.env.AISSTREAM_SILENCE_TIMEOUT_MS ?? 5 * 60_000));\n',
    'const AISSTREAM_SILENCE_TIMEOUT_MS = Math.max(60_000, Number(process.env.AISSTREAM_SILENCE_TIMEOUT_MS ?? 5 * 60_000));\nconst MAX_INGEST_BODY_BYTES = Math.max(1_024, Number(process.env.MAX_INGEST_BODY_BYTES ?? 5 * 1024 * 1024));\n',
    "ingest body limit insertion point",
  );

  const oldProviders = `async function loadFixedVessels() {\n  const rows = [];\n  if (FIXED_VESSEL_DATA_URL) rows.push(...rowsFrom(await fetchProviderJson(FIXED_VESSEL_DATA_URL, FIXED_VESSEL_DATA_TOKEN), ["vessels", "data", "items"]));\n  if (FIXED_VESSEL_DATA_FILE_ENABLED && existsSync(FIXED_VESSEL_DATA_FILE)) rows.push(...rowsFrom(JSON.parse(readFileSync(FIXED_VESSEL_DATA_FILE, "utf8")), ["vessels", "data", "items"]));\n  return rows.map((row) => normalizeVessel({ ...row, inputSource: row.inputSource ?? "fixed" })).filter(Boolean);\n}\n\nasync function loadUpstreamVessels() {\n  if (!UPSTREAM_URL) return [];\n  const payload = await fetchProviderJson(UPSTREAM_URL, UPSTREAM_TOKEN);\n  return rowsFrom(payload, ["vessels", "data", "items"]).map((row) => normalizeVessel({ ...row, inputSource: row.inputSource ?? "upstream" })).filter(Boolean);\n}\n`;
  const newProviders = `async function loadFixedVessels() {\n  const rows = [];\n  const errors = [];\n  if (FIXED_VESSEL_DATA_URL) {\n    try { rows.push(...rowsFrom(await fetchProviderJson(FIXED_VESSEL_DATA_URL, FIXED_VESSEL_DATA_TOKEN), ["vessels", "data", "items"])); }\n    catch (error) { errors.push(\`fixed URL: \${error instanceof Error ? error.message : String(error)}\`); }\n  }\n  if (FIXED_VESSEL_DATA_FILE_ENABLED && existsSync(FIXED_VESSEL_DATA_FILE)) {\n    try { rows.push(...rowsFrom(JSON.parse(readFileSync(FIXED_VESSEL_DATA_FILE, "utf8")), ["vessels", "data", "items"])); }\n    catch (error) { errors.push(\`fixed file: \${error instanceof Error ? error.message : String(error)}\`); }\n  }\n  return {\n    rows: rows.map((row) => normalizeVessel({ ...row, inputSource: row.inputSource ?? "fixed" })).filter(Boolean),\n    errors,\n  };\n}\n\nasync function loadUpstreamVessels() {\n  if (!UPSTREAM_URL) return { rows: [], errors: [] };\n  try {\n    const payload = await fetchProviderJson(UPSTREAM_URL, UPSTREAM_TOKEN);\n    return {\n      rows: rowsFrom(payload, ["vessels", "data", "items"]).map((row) => normalizeVessel({ ...row, inputSource: row.inputSource ?? "upstream" })).filter(Boolean),\n      errors: [],\n    };\n  } catch (error) {\n    return { rows: [], errors: [\`upstream URL: \${error instanceof Error ? error.message : String(error)}\`] };\n  }\n}\n`;
  content = replaceOnce(content, oldProviders, newProviders, "provider loading functions");

  const oldCombined = `async function loadCombinedVessels() {\n  try {\n    const [fixed, upstream] = await Promise.all([loadFixedVessels(), loadUpstreamVessels()]);\n    const trackingAis = cacheRows(trackingAisCache, trackingAisState);\n    const priorityAis = cacheRows(operationalAisCache, operationalAisState);\n    const merged = new Map();\n    for (const row of fixed) merged.set(row.id, row);\n    for (const row of upstream) merged.set(row.id, row);\n    for (const row of trackingAis) merged.set(row.id, row);\n    for (const row of priorityAis) merged.set(row.id, row);\n    const tracking = [...merged.values()].filter((row) => validCoordinates(row.latitude, row.longitude));\n    const operational = operationalVessels(tracking);\n    Object.assign(vesselInputState, {\n      aisRows: trackingAis.length,\n      priorityAisRows: priorityAis.length,\n      upstreamRows: upstream.length,\n      fixedRows: fixed.length,\n      trackingRows: tracking.length,\n      operationalRows: operational.length,\n      lastLoadedAt: new Date().toISOString(),\n      lastError: null,\n    });\n    lastCombinedVessels = tracking;\n    lastOperationalVessels = operational;\n    return { tracking, operational };\n  } catch (error) {\n    vesselInputState.lastLoadedAt = new Date().toISOString();\n    vesselInputState.lastError = error instanceof Error ? error.message : String(error);\n    return { tracking: lastCombinedVessels, operational: lastOperationalVessels };\n  }\n}\n`;
  const newCombined = `async function loadCombinedVessels() {\n  try {\n    const [fixedInput, upstreamInput] = await Promise.all([loadFixedVessels(), loadUpstreamVessels()]);\n    const fixed = fixedInput.rows;\n    const upstream = upstreamInput.rows;\n    const providerErrors = [...fixedInput.errors, ...upstreamInput.errors];\n    const trackingAis = cacheRows(trackingAisCache, trackingAisState);\n    const priorityAis = OPERATIONAL_PRIORITY_ENABLED ? cacheRows(operationalAisCache, operationalAisState) : [];\n    const merged = new Map();\n    for (const row of fixed) merged.set(row.id, row);\n    for (const row of upstream) merged.set(row.id, row);\n    for (const row of priorityAis) merged.set(row.id, row);\n    for (const row of trackingAis) merged.set(row.id, row);\n    const tracking = [...merged.values()].filter((row) => validCoordinates(row.latitude, row.longitude));\n    const operational = operationalVessels(tracking);\n    Object.assign(vesselInputState, {\n      aisRows: trackingAis.length,\n      priorityAisRows: priorityAis.length,\n      upstreamRows: upstream.length,\n      fixedRows: fixed.length,\n      trackingRows: tracking.length,\n      operationalRows: operational.length,\n      lastLoadedAt: new Date().toISOString(),\n      lastError: providerErrors.length > 0 ? providerErrors.join("; ") : null,\n    });\n    lastCombinedVessels = tracking;\n    lastOperationalVessels = operational;\n    return { tracking, operational };\n  } catch (error) {\n    vesselInputState.lastLoadedAt = new Date().toISOString();\n    vesselInputState.lastError = error instanceof Error ? error.message : String(error);\n    return { tracking: lastCombinedVessels, operational: lastOperationalVessels };\n  }\n}\n`;
  content = replaceOnce(content, oldCombined, newCombined, "combined vessel loading function");

  content = replaceOnce(
    content,
    `function authorized(request, token) {\n  return !token || request.headers.authorization === \`Bearer \${token}\`;\n}\n\nasync function readJsonBody(request) {\n  const chunks = [];\n  for await (const chunk of request) chunks.push(chunk);\n  const text = Buffer.concat(chunks).toString("utf8");\n  return text ? JSON.parse(text) : {};\n}\n`,
    `function authorized(request, token) {\n  return Boolean(token) && request.headers.authorization === \`Bearer \${token}\`;\n}\n\nasync function readJsonBody(request) {\n  const chunks = [];\n  let receivedBytes = 0;\n  for await (const chunk of request) {\n    receivedBytes += Buffer.byteLength(chunk);\n    if (receivedBytes > MAX_INGEST_BODY_BYTES) throw new Error(\`Request body exceeds \${MAX_INGEST_BODY_BYTES} bytes\`);\n    chunks.push(chunk);\n  }\n  const text = Buffer.concat(chunks).toString("utf8");\n  return text ? JSON.parse(text) : {};\n}\n`,
    "ingest authorization and body reader",
  );

  content = replaceOnce(
    content,
    `        if (nearest && nearest.distanceNm <= ECOFAIR_OPERATIONAL_RADIUS_NM) {\n          operationalAisState.messageCount += 1;\n          operationalAisState.usablePositionMessages += 1;\n          operationalAisState.lastMessageAt = receivedAt;\n          operationalAisState.status = "derived-live";\n          mergeAisVessel(operationalAisCache, operationalAisState, vessel);\n        }\n`,
    `        if (nearest && nearest.distanceNm <= ECOFAIR_OPERATIONAL_RADIUS_NM) {\n          operationalAisState.messageCount += 1;\n          operationalAisState.usablePositionMessages += 1;\n          operationalAisState.lastMessageAt = receivedAt;\n          operationalAisState.status = "derived-live";\n          mergeAisVessel(operationalAisCache, operationalAisState, vessel);\n        } else {\n          operationalAisCache.delete(vessel.id);\n          operationalAisState.cachedVessels = operationalAisCache.size;\n        }\n`,
    "operational cache derivation block",
  );

  content = replaceOnce(
    content,
    '  const lastSignal = timestampMs(state.lastMessageAt) || timestampMs(state.openedAt);\n',
    '  const lastSignal = Math.max(timestampMs(state.lastMessageAt), timestampMs(state.openedAt));\n',
    "watchdog signal timestamp",
  );

  content = replaceOnce(
    content,
    'operationalAisState.status = OPERATIONAL_PRIORITY_ENABLED ? "derived-waiting" : "disabled";\n',
    'operationalAisState.status = OPERATIONAL_PRIORITY_ENABLED && AISSTREAM_API_KEY ? "derived-waiting" : "disabled";\n',
    "operational state bootstrap status",
  );

  content = replaceOnce(
    content,
    `function providerState() {\n  if (!AISSTREAM_API_KEY && !UPSTREAM_URL && !FIXED_VESSEL_DATA_URL && !FIXED_VESSEL_DATA_FILE_ENABLED) return "unconfigured";\n  if (vesselInputState.trackingRows > 0) return trackingAisState.connected ? "live" : "degraded-cache";\n  if (trackingAisState.connected) return "connected-waiting";\n  if (AISSTREAM_API_KEY) return "reconnecting";\n  return "unavailable";\n}\n\nfunction readinessPayload() {\n  const staticDashboard = existsSync(STATIC_INDEX);\n  const dataReady = vesselInputState.trackingRows > 0;\n  const providerConfigured = Boolean(AISSTREAM_API_KEY || UPSTREAM_URL || FIXED_VESSEL_DATA_URL || FIXED_VESSEL_DATA_FILE_ENABLED);\n`,
    `function vesselProviderConfigured() {\n  return Boolean(\n    AISSTREAM_API_KEY\n    || UPSTREAM_URL\n    || FIXED_VESSEL_DATA_URL\n    || (FIXED_VESSEL_DATA_FILE_ENABLED && existsSync(FIXED_VESSEL_DATA_FILE))\n  );\n}\n\nfunction providerState() {\n  if (!vesselProviderConfigured()) return "unconfigured";\n  if (vesselInputState.trackingRows > 0) return trackingAisState.connected ? "live" : "degraded-cache";\n  if (trackingAisState.connected) return "connected-waiting";\n  if (AISSTREAM_API_KEY) return "reconnecting";\n  return "unavailable";\n}\n\nfunction readinessPayload() {\n  const staticDashboard = existsSync(STATIC_INDEX);\n  const dataReady = vesselInputState.trackingRows > 0;\n  const providerConfigured = vesselProviderConfigured();\n`,
    "provider configuration and readiness block",
  );

  content = replaceOnce(
    content,
    `  if (path === "/health/live") {\n    return sendJson(response, 200, { ok: true, service: { version: SERVICE_VERSION, startedAt: SERVICE_STARTED_AT, uptimeSeconds: Math.round(process.uptime()) } });\n  }\n`,
    `  if (path === "/health/live") {\n    const staticDashboard = existsSync(STATIC_INDEX);\n    return sendJson(response, staticDashboard ? 200 : 503, {\n      ok: staticDashboard,\n      staticDashboard,\n      service: { version: SERVICE_VERSION, startedAt: SERVICE_STARTED_AT, uptimeSeconds: Math.round(process.uptime()) },\n    });\n  }\n`,
    "liveness route",
  );

  content = replaceOnce(
    content,
    `  if (path === "/api/vessels/ingest" && request.method === "POST") {\n    if (!authorized(request, FIXED_VESSEL_INGEST_TOKEN)) return sendJson(response, 401, { error: "Unauthorized vessel ingest" });\n`,
    `  if (path === "/api/vessels/ingest" && request.method === "POST") {\n    if (!FIXED_VESSEL_INGEST_TOKEN) return sendJson(response, 503, { error: "Vessel ingest is disabled; configure FIXED_VESSEL_INGEST_TOKEN" });\n    if (!authorized(request, FIXED_VESSEL_INGEST_TOKEN)) return sendJson(response, 401, { error: "Unauthorized vessel ingest" });\n`,
    "vessel ingest route authorization",
  );

  content = replaceOnce(
    content,
    `  if ((path === "/api/chmarl/episode" || path === "/api/chmarl/ingest") && request.method === "POST") {\n    if (!authorized(request, CHMARL_INGEST_TOKEN)) return sendJson(response, 401, { error: "Unauthorized CH-MARL ingest" });\n`,
    `  if ((path === "/api/chmarl/episode" || path === "/api/chmarl/ingest") && request.method === "POST") {\n    if (!CHMARL_INGEST_TOKEN) return sendJson(response, 503, { error: "CH-MARL ingest is disabled; configure CHMARL_INGEST_TOKEN" });\n    if (!authorized(request, CHMARL_INGEST_TOKEN)) return sendJson(response, 401, { error: "Unauthorized CH-MARL ingest" });\n`,
    "CH-MARL ingest route authorization",
  );

  write(path, content);
}

function updateRenderBlueprint() {
  const path = "render.yaml";
  let content = read(path);
  content = replaceOnce(
    content,
    "      - key: AISSTREAM_SILENCE_TIMEOUT_MS\n        value: 300000\n",
    "      - key: AISSTREAM_SILENCE_TIMEOUT_MS\n        value: 300000\n      - key: MAX_INGEST_BODY_BYTES\n        value: 5242880\n",
    "Render ingest body limit",
  );
  write(path, content);
}

function updatePackageJson() {
  const path = "package.json";
  const json = JSON.parse(read(path));
  json.scripts["verify:runtime"] = "node --check server/vessel-feed-proxy/runtime-v3.mjs && node scripts/check-runtime-contract.mjs && node scripts/smoke-runtime.mjs";
  write(path, `${JSON.stringify(json, null, 2)}\n`);
}

function updateContractCheck() {
  const path = "scripts/check-runtime-contract.mjs";
  write(path, `import { existsSync, readFileSync } from "node:fs";\n\nfunction read(path) {\n  if (!existsSync(path)) throw new Error(\`Required file is missing: \${path}\`);\n  return readFileSync(path, "utf8");\n}\n\nfunction assertIncludes(content, text, label) {\n  if (!content.includes(text)) throw new Error(\`Runtime contract failed: \${label}\`);\n}\n\nfunction assertNotIncludes(content, text, label) {\n  if (content.includes(text)) throw new Error(\`Runtime contract failed: \${label}\`);\n}\n\nconst runtime = read("server/vessel-feed-proxy/runtime-v3.mjs");\nconst render = read("render.yaml");\nconst dockerfile = read("Dockerfile");\nconst packageJson = read("package.json");\n\nassertIncludes(runtime, 'path === "/health/live"', "liveness endpoint is absent");\nassertIncludes(runtime, 'path === "/health/ready"', "readiness endpoint is absent");\nassertIncludes(runtime, 'path === "/version"', "version endpoint is absent");\nassertIncludes(runtime, "staticDashboard ? 200 : 503", "liveness does not verify the dashboard bundle");\nassertIncludes(runtime, "AISSTREAM_SILENCE_TIMEOUT_MS", "AIS silence watchdog is absent");\nassertIncludes(runtime, "socket.ping()", "websocket heartbeat is absent");\nassertIncludes(runtime, "Math.max(timestampMs(state.lastMessageAt), timestampMs(state.openedAt))", "watchdog reconnect grace is absent");\nassertIncludes(runtime, "deriveOperational: OPERATIONAL_PRIORITY_ENABLED", "single-stream operational derivation is absent");\nassertIncludes(runtime, "operationalAisCache.delete(vessel.id)", "out-of-scope vessels are not removed from the operational cache");\nassertIncludes(runtime, "const [fixedInput, upstreamInput]", "optional provider failures are not isolated");\nassertIncludes(runtime, "return Boolean(token)", "ingest endpoints allow missing tokens");\nassertIncludes(runtime, "MAX_INGEST_BODY_BYTES", "ingest body size is unbounded");\nassertIncludes(runtime, "function vesselProviderConfigured()", "provider readiness does not inspect active sources");\nassertNotIncludes(runtime, "alsoTracking: true", "legacy second AIS subscription is still enabled");\nassertIncludes(render, "healthCheckPath: /health/live", "Render still uses the dependency-heavy health endpoint");\nassertIncludes(render, "renderSubdomainPolicy: enabled", "Render subdomain policy is not explicit");\nassertIncludes(render, "MAX_INGEST_BODY_BYTES", "Render ingest size limit is not explicit");\nassertIncludes(dockerfile, "COPY package.json pnpm-lock.yaml ./", "Docker build does not copy the lockfile");\nassertIncludes(dockerfile, "pnpm install --frozen-lockfile", "Docker build is not locked");\nassertIncludes(packageJson, "scripts/smoke-runtime.mjs", "runtime smoke test is not part of verification");\nif (!existsSync("pnpm-lock.yaml")) throw new Error("Runtime contract failed: pnpm-lock.yaml is missing");\nif (!existsSync("scripts/smoke-runtime.mjs")) throw new Error("Runtime contract failed: smoke test is missing");\n\nconsole.log("Portal runtime contract verified.");\n`);
}

updateRuntime();
updateRenderBlueprint();
updatePackageJson();
updateContractCheck();
