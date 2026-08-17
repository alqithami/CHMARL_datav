from pathlib import Path
import json


def read(path: str) -> str:
    return Path(path).read_text()


def write(path: str, content: str) -> None:
    Path(path).write_text(content if content.endswith("\n") else content + "\n")
    print(f"updated {path}")


def replace_once(content: str, before: str, after: str, label: str) -> str:
    count = content.count(before)
    if count != 1:
        raise RuntimeError(f"Expected one {label}, found {count}")
    return content.replace(before, after, 1)


def update_runtime() -> None:
    path = "server/vessel-feed-proxy/runtime-v3.mjs"
    content = read(path)

    content = replace_once(
        content,
        'const AISSTREAM_SILENCE_TIMEOUT_MS = Math.max(15_000, Number(process.env.AISSTREAM_SILENCE_TIMEOUT_MS ?? 90_000));\nconst DATALASTIC_AIS_ENABLED',
        'const AISSTREAM_SILENCE_TIMEOUT_MS = Math.max(15_000, Number(process.env.AISSTREAM_SILENCE_TIMEOUT_MS ?? 90_000));\n'
        'const AISSTREAM_RATE_LIMIT_BACKOFF_MS = Math.max(60_000, Number(process.env.AISSTREAM_RATE_LIMIT_BACKOFF_MS ?? 30 * 60_000));\n'
        'const AISSTREAM_PROFILE_CYCLE_BACKOFF_MS = Math.max(30_000, Number(process.env.AISSTREAM_PROFILE_CYCLE_BACKOFF_MS ?? 10 * 60_000));\n'
        'const DATALASTIC_AIS_ENABLED',
        "AISStream backoff constants",
    )

    content = replace_once(
        content,
        'const POCKETWORLD_TIMEOUT_MS = Math.max(1_000, Number(process.env.POCKETWORLD_TIMEOUT_MS ?? 30_000));\n'
        'const POCKETWORLD_MAX_AGE_MS = Math.max(60_000, Number(process.env.POCKETWORLD_MAX_AGE_MS ?? 30 * 60_000));\n'
        'const POCKETWORLD_MAX_VESSELS = Math.max(1, Number(process.env.POCKETWORLD_MAX_VESSELS ?? 2500));\n'
        'const MAX_INGEST_BODY_BYTES',
        'const POCKETWORLD_TIMEOUT_MS = Math.max(1_000, Number(process.env.POCKETWORLD_TIMEOUT_MS ?? 30_000));\n'
        'const POCKETWORLD_DISPLAY_MAX_AGE_MS = Math.max(60_000, Number(process.env.POCKETWORLD_DISPLAY_MAX_AGE_MS ?? process.env.POCKETWORLD_MAX_AGE_MS ?? 6 * 60 * 60_000));\n'
        'const POCKETWORLD_FRESH_AGE_MS = Math.min(POCKETWORLD_DISPLAY_MAX_AGE_MS, Math.max(60_000, Number(process.env.POCKETWORLD_FRESH_AGE_MS ?? 30 * 60_000)));\n'
        'const POCKETWORLD_MAX_VESSELS = Math.max(1, Number(process.env.POCKETWORLD_MAX_VESSELS ?? 5000));\n'
        'const POCKETWORLD_CACHE_FLUSH_MS = Math.max(5_000, Number(process.env.POCKETWORLD_CACHE_FLUSH_MS ?? 60_000));\n'
        'const MAX_INGEST_BODY_BYTES',
        "PocketWorld continuity constants",
    )

    content = replace_once(
        content,
        'const ECOFAIR_OPERATIONAL_RADIUS_NM = Math.max(1, Number(process.env.ECOFAIR_OPERATIONAL_RADIUS_NM ?? 120));\n'
        'const ECOFAIR_TICK_MS',
        'const ECOFAIR_OPERATIONAL_RADIUS_NM = Math.max(1, Number(process.env.ECOFAIR_OPERATIONAL_RADIUS_NM ?? 120));\n'
        'const ECOFAIR_MAX_VESSEL_AGE_MS = Math.max(60_000, Number(process.env.ECOFAIR_MAX_VESSEL_AGE_MS ?? 30 * 60_000));\n'
        'const ECOFAIR_TICK_MS',
        "EcoFair freshness limit",
    )

    content = replace_once(
        content,
        'const OPERATIONAL_AIS_CACHE_FILE = runtimePath("AISSTREAM_OPERATIONAL_CACHE_FILE", "ais-operational-cache.json");\n'
        'const ECOFAIR_STATE_FILE',
        'const OPERATIONAL_AIS_CACHE_FILE = runtimePath("AISSTREAM_OPERATIONAL_CACHE_FILE", "ais-operational-cache.json");\n'
        'const POCKETWORLD_CACHE_FILE = runtimePath("POCKETWORLD_CACHE_FILE", "pocketworld-ais-cache.json");\n'
        'const ECOFAIR_STATE_FILE',
        "PocketWorld cache path",
    )

    content = replace_once(
        content,
        '    lastError: null,\n    reconnectAttempt: 0,\n    status:',
        '    lastError: null,\n    lastHttpStatus: null,\n    reconnectAttempt: 0,\n    rateLimitedUntil: null,\n    cycleBackoffUntil: null,\n    status:',
        "AIS state backoff fields",
    )

    content = replace_once(
        content,
        '  timeoutMs: POCKETWORLD_TIMEOUT_MS,\n  maxAgeMs: POCKETWORLD_MAX_AGE_MS,\n  maxVessels: POCKETWORLD_MAX_VESSELS,\n});',
        '  timeoutMs: POCKETWORLD_TIMEOUT_MS,\n'
        '  maxAgeMs: POCKETWORLD_DISPLAY_MAX_AGE_MS,\n'
        '  freshAgeMs: POCKETWORLD_FRESH_AGE_MS,\n'
        '  maxVessels: POCKETWORLD_MAX_VESSELS,\n'
        '  cacheFile: POCKETWORLD_CACHE_FILE,\n'
        '  cacheFlushMs: POCKETWORLD_CACHE_FLUSH_MS,\n'
        '});',
        "PocketWorld provider wiring",
    )

    content = replace_once(
        content,
        '  trackingRows: 0,\n  primaryOperationalRows: 0,',
        '  trackingRows: 0,\n  freshTrackingRows: 0,\n  lastKnownTrackingRows: 0,\n  primaryOperationalRows: 0,',
        "tracking freshness counters",
    )

    content = replace_once(
        content,
        'function vesselsNearPorts(vessels, ports) {\n  return vessels.filter((vessel) => {\n    if (!validCoordinates(vessel?.latitude, vessel?.longitude)) return false;\n    return ports.some((port) => haversineNm(vessel, port) <= ECOFAIR_OPERATIONAL_RADIUS_NM);\n  });\n}',
        'function vesselObservationAgeMs(vessel) {\n'
        '  const observedAt = timestampMs(vessel?.timestamp);\n'
        '  return observedAt > 0 ? Math.max(0, Date.now() - observedAt) : Number.POSITIVE_INFINITY;\n'
        '}\n\n'
        'function isOperationallyFresh(vessel) {\n'
        '  return vesselObservationAgeMs(vessel) <= ECOFAIR_MAX_VESSEL_AGE_MS;\n'
        '}\n\n'
        'function vesselsNearPorts(vessels, ports) {\n'
        '  return vessels.filter((vessel) => {\n'
        '    if (!validCoordinates(vessel?.latitude, vessel?.longitude) || !isOperationallyFresh(vessel)) return false;\n'
        '    return ports.some((port) => haversineNm(vessel, port) <= ECOFAIR_OPERATIONAL_RADIUS_NM);\n'
        '  });\n'
        '}',
        "fresh operational geofence",
    )

    content = replace_once(
        content,
        '    const tracking = [...merged.values()].filter((row) => validCoordinates(row.latitude, row.longitude));\n'
        '    const operational = operationalVessels(tracking);',
        '    const tracking = [...merged.values()].filter((row) => validCoordinates(row.latitude, row.longitude));\n'
        '    const freshTracking = tracking.filter(isOperationallyFresh);\n'
        '    const operational = operationalVessels(tracking);',
        "fresh tracking cohort",
    )

    content = replace_once(
        content,
        '      trackingRows: tracking.length,\n      primaryOperationalRows:',
        '      trackingRows: tracking.length,\n'
        '      freshTrackingRows: freshTracking.length,\n'
        '      lastKnownTrackingRows: Math.max(0, tracking.length - freshTracking.length),\n'
        '      primaryOperationalRows:',
        "tracking freshness assignment",
    )

    old_source = '''function sourceForTracking() {
  const activeProviders = [
    ...(Number(vesselInputState.aisstreamRows ?? 0) > 0 ? ["aisstream"] : []),
    ...(Number(vesselInputState.datalasticRows ?? 0) > 0 ? ["datalastic"] : []),
    ...(Number(vesselInputState.pocketworldRows ?? 0) > 0 ? ["pocketworld"] : []),
  ];
  if (activeProviders.length > 1) return "ais-multi-provider";
  if (activeProviders.length === 1) return activeProviders[0];
  return AISSTREAM_API_KEY || DATALASTIC_API_KEY || POCKETWORLD_AIS_ENABLED ? "aisstream-waiting" : "none";
}'''
    new_source = '''function sourceForTracking() {
  const activeProviders = [
    ...(Number(vesselInputState.aisstreamRows ?? 0) > 0 ? ["aisstream"] : []),
    ...(Number(vesselInputState.datalasticRows ?? 0) > 0 ? ["datalastic"] : []),
    ...(Number(vesselInputState.pocketworldRows ?? 0) > 0 ? ["pocketworld"] : []),
  ];
  if (activeProviders.length > 1) return "ais-multi-provider";
  if (activeProviders.length === 1 && activeProviders[0] === "pocketworld") {
    return pocketWorldProvider.publicState().freshVessels > 0 ? "pocketworld" : "pocketworld-last-known";
  }
  if (activeProviders.length === 1) return activeProviders[0];
  return AISSTREAM_API_KEY || DATALASTIC_API_KEY || POCKETWORLD_AIS_ENABLED ? "aisstream-waiting" : "none";
}'''
    content = replace_once(content, old_source, new_source, "source selection")

    content = replace_once(
        content,
        '  if (state.profileIndex <= previousIndex) state.profileCycles += 1;\n  state.profileSwitches += 1;',
        '  if (state.profileIndex <= previousIndex) {\n'
        '    state.profileCycles += 1;\n'
        '    state.cycleBackoffUntil = new Date(Date.now() + AISSTREAM_PROFILE_CYCLE_BACKOFF_MS).toISOString();\n'
        '  }\n'
        '  state.profileSwitches += 1;',
        "AIS profile-cycle backoff",
    )

    old_schedule = '''function scheduleAisReconnect(options) {
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
}'''
    new_schedule = '''function retryAfterDelayMs(response) {
  const value = response?.headers?.["retry-after"];
  if (value === undefined) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(String(value));
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

function reconnectBackoff(state) {
  const now = Date.now();
  const rateLimitedUntil = timestampMs(state.rateLimitedUntil);
  const cycleBackoffUntil = timestampMs(state.cycleBackoffUntil);
  if (rateLimitedUntil > now) return { delay: rateLimitedUntil - now, status: "rate-limited" };
  if (cycleBackoffUntil > now) return { delay: cycleBackoffUntil - now, status: "profile-backoff" };
  if (rateLimitedUntil > 0) state.rateLimitedUntil = null;
  if (cycleBackoffUntil > 0) state.cycleBackoffUntil = null;
  return { delay: 0, status: "reconnecting" };
}

function scheduleAisReconnect(options) {
  const { state } = options;
  if (stopping || !AISSTREAM_API_KEY || state.reconnectTimer) return;
  const backoff = reconnectBackoff(state);
  const exponentialDelay = Math.min(5 * 60_000, 2_000 * 2 ** Math.min(state.reconnectAttempt, 8));
  const delay = Math.max(backoff.delay, exponentialDelay);
  state.reconnectAttempt += 1;
  state.status = backoff.status;
  state.reconnectTimer = setTimeout(() => {
    state.reconnectTimer = null;
    startAisStream(options);
  }, delay);
  state.reconnectTimer.unref?.();
}'''
    content = replace_once(content, old_schedule, new_schedule, "AIS reconnect scheduler")

    content = replace_once(
        content,
        '  if (state.reconnectTimer) {\n    clearTimeout(state.reconnectTimer);\n    state.reconnectTimer = null;\n  }\n  const profile = activeAisProfile(state);',
        '  if (state.reconnectTimer) {\n'
        '    clearTimeout(state.reconnectTimer);\n'
        '    state.reconnectTimer = null;\n'
        '  }\n'
        '  const backoff = reconnectBackoff(state);\n'
        '  if (backoff.delay > 0) {\n'
        '    scheduleAisReconnect(options);\n'
        '    return;\n'
        '  }\n'
        '  state.connectionMessageCount = 0;\n'
        '  state.profileAdvancedForCurrentSocket = false;\n'
        '  const profile = activeAisProfile(state);',
        "AIS start backoff gate",
    )

    content = replace_once(
        content,
        '    state.connected = true;\n    state.reconnectAttempt = 0;\n    state.lastError = null;',
        '    state.connected = true;\n'
        '    state.lastError = null;\n'
        '    state.lastHttpStatus = null;\n'
        '    state.rateLimitedUntil = null;\n'
        '    state.cycleBackoffUntil = null;',
        "AIS open state",
    )

    content = replace_once(
        content,
        '      state.lastSuccessfulAt = receivedAt;\n      state.lastRecoveryReason = null;\n      state.status = "live";',
        '      state.lastSuccessfulAt = receivedAt;\n'
        '      state.lastRecoveryReason = null;\n'
        '      state.reconnectAttempt = 0;\n'
        '      state.lastHttpStatus = null;\n'
        '      state.rateLimitedUntil = null;\n'
        '      state.cycleBackoffUntil = null;\n'
        '      state.status = "live";',
        "AIS success reset",
    )

    old_unexpected = '''  socket.on("unexpected-response", (_request, response) => {
    state.lastError = "AIS websocket rejected the subscription with HTTP " + (response.statusCode ?? "unknown");
    state.status = "provider-error";
  });'''
    new_unexpected = '''  socket.on("unexpected-response", (_request, response) => {
    const statusCode = Number(response.statusCode ?? 0) || null;
    state.connected = false;
    state.socket = null;
    state.firstFrameDeadlineAt = null;
    state.lastHttpStatus = statusCode;
    state.lastError = "AIS websocket rejected the subscription with HTTP " + (statusCode ?? "unknown");
    state.profileAdvancedForCurrentSocket = true;
    if (statusCode === 429) {
      const delay = Math.max(AISSTREAM_RATE_LIMIT_BACKOFF_MS, retryAfterDelayMs(response) ?? 0);
      state.rateLimitedUntil = new Date(Date.now() + delay).toISOString();
      state.status = "rate-limited";
    } else {
      state.status = "provider-error";
    }
    response.resume?.();
    try { socket.terminate(); } catch {}
    if (state.reconnectTimer) {
      clearTimeout(state.reconnectTimer);
      state.reconnectTimer = null;
    }
    scheduleAisReconnect(options);
  });'''
    content = replace_once(content, old_unexpected, new_unexpected, "AIS rejected-handshake handling")

    content = replace_once(
        content,
        '  if (vesselInputState.trackingRows > 0) return sourceForTracking() === "ais-multi-provider" ? "live-multi-provider" : "live";',
        '  if (vesselInputState.trackingRows > 0) {\n'
        '    if (sourceForTracking() === "pocketworld-last-known") return "degraded-last-known";\n'
        '    return sourceForTracking() === "ais-multi-provider" ? "live-multi-provider" : "live";\n'
        '  }',
        "provider state for last-known rows",
    )

    content = replace_once(
        content,
        '      mode: sourceForTracking() === "datalastic" ? "monitored-port-failover" : sourceForTracking() === "pocketworld" ? "regional-public-fallback" : (GLOBAL_TRACKING_ENABLED ? "global" : "regional"),',
        '      mode: sourceForTracking() === "datalastic"\n'
        '        ? "monitored-port-failover"\n'
        '        : ["pocketworld", "pocketworld-last-known"].includes(sourceForTracking())\n'
        '          ? "regional-public-fallback"\n'
        '          : (GLOBAL_TRACKING_ENABLED ? "global" : "regional"),',
        "tracking-scope mode",
    )

    content = replace_once(
        content,
        '      rows: vesselInputState.operationalRows,\n      portfolioRows:',
        '      rows: vesselInputState.operationalRows,\n'
        '      maxVesselAgeMs: ECOFAIR_MAX_VESSEL_AGE_MS,\n'
        '      portfolioRows:',
        "operational freshness health",
    )

    content = replace_once(
        content,
        '    persistence: { dataDir: RUNTIME_DATA_DIR, trackingCacheFile: TRACKING_AIS_CACHE_FILE, operationalCacheFile: OPERATIONAL_AIS_CACHE_FILE, ecofairStateFile: ECOFAIR_STATE_FILE },',
        '    persistence: {\n'
        '      dataDir: RUNTIME_DATA_DIR,\n'
        '      trackingCacheFile: TRACKING_AIS_CACHE_FILE,\n'
        '      operationalCacheFile: OPERATIONAL_AIS_CACHE_FILE,\n'
        '      pocketWorldCacheFile: POCKETWORLD_CACHE_FILE,\n'
        '      ecofairStateFile: ECOFAIR_STATE_FILE,\n'
        '    },',
        "PocketWorld persistence health",
    )

    content = replace_once(
        content,
        '        tracking: tracking.length,\n        operational: operational.length,',
        '        tracking: tracking.length,\n'
        '        freshTracking: vesselInputState.freshTrackingRows,\n'
        '        lastKnownTracking: vesselInputState.lastKnownTrackingRows,\n'
        '        operational: operational.length,',
        "API freshness counts",
    )

    content = replace_once(
        content,
        '  console.log(`PocketWorld public AIS fallback: ${POCKETWORLD_AIS_ENABLED ? "enabled" : "disabled"}; max rows: ${POCKETWORLD_MAX_VESSELS}.`);',
        '  console.log(`PocketWorld public AIS fallback: ${POCKETWORLD_AIS_ENABLED ? "enabled" : "disabled"}; max rows: ${POCKETWORLD_MAX_VESSELS}; fresh age: ${Math.round(POCKETWORLD_FRESH_AGE_MS / 60_000)} min; display age: ${Math.round(POCKETWORLD_DISPLAY_MAX_AGE_MS / 3_600_000)} h.`);',
        "PocketWorld startup logging",
    )

    write(path, content)


def update_start_prod() -> None:
    path = "scripts/start-prod.mjs"
    content = read(path)
    content = replace_once(
        content,
        'process.env.AISSTREAM_SILENCE_TIMEOUT_MS = runningOnRender ? "90000" : (process.env.AISSTREAM_SILENCE_TIMEOUT_MS || "90000");\n'
        'process.env.AISSTREAM_MAX_VESSELS',
        'process.env.AISSTREAM_SILENCE_TIMEOUT_MS = runningOnRender ? "90000" : (process.env.AISSTREAM_SILENCE_TIMEOUT_MS || "90000");\n'
        'process.env.AISSTREAM_RATE_LIMIT_BACKOFF_MS ??= "1800000";\n'
        'process.env.AISSTREAM_PROFILE_CYCLE_BACKOFF_MS ??= "600000";\n'
        'process.env.AISSTREAM_MAX_VESSELS',
        "production AIS backoff",
    )
    content = replace_once(
        content,
        'process.env.POCKETWORLD_ACTIVATION_DELAY_MS ??= "45000";\n'
        'process.env.POCKETWORLD_POLL_INTERVAL_MS ??= "300000";\n'
        'process.env.POCKETWORLD_TIMEOUT_MS ??= "30000";\n'
        'process.env.POCKETWORLD_MAX_AGE_MS ??= "1800000";\n'
        'process.env.POCKETWORLD_MAX_VESSELS ??= "2500";',
        'process.env.POCKETWORLD_ACTIVATION_DELAY_MS ??= "5000";\n'
        'process.env.POCKETWORLD_POLL_INTERVAL_MS ??= "300000";\n'
        'process.env.POCKETWORLD_TIMEOUT_MS ??= "30000";\n'
        'process.env.POCKETWORLD_DISPLAY_MAX_AGE_MS ??= "21600000";\n'
        'process.env.POCKETWORLD_FRESH_AGE_MS ??= "1800000";\n'
        'process.env.POCKETWORLD_MAX_AGE_MS ??= process.env.POCKETWORLD_DISPLAY_MAX_AGE_MS;\n'
        'process.env.POCKETWORLD_MAX_VESSELS ??= "5000";\n'
        'process.env.POCKETWORLD_CACHE_FLUSH_MS ??= "60000";',
        "production PocketWorld continuity",
    )
    content = replace_once(
        content,
        'process.env.AISSTREAM_OPERATIONAL_CACHE_FILE = join(process.env.RUNTIME_DATA_DIR, "ais-operational-cache.json");\n'
        'process.env.ECOFAIR_STATE_FILE',
        'process.env.AISSTREAM_OPERATIONAL_CACHE_FILE = join(process.env.RUNTIME_DATA_DIR, "ais-operational-cache.json");\n'
        'process.env.POCKETWORLD_CACHE_FILE = join(process.env.RUNTIME_DATA_DIR, "pocketworld-ais-cache.json");\n'
        'process.env.ECOFAIR_STATE_FILE',
        "production PocketWorld cache file",
    )
    content = replace_once(
        content,
        'process.env.ECOFAIR_OPERATIONAL_RADIUS_NM ??= "120";\n'
        'process.env.ECOFAIR_EMISSION_BUDGET_TONNES_PER_DAY',
        'process.env.ECOFAIR_OPERATIONAL_RADIUS_NM ??= "120";\n'
        'process.env.ECOFAIR_MAX_VESSEL_AGE_MS ??= "1800000";\n'
        'process.env.ECOFAIR_EMISSION_BUDGET_TONNES_PER_DAY',
        "production EcoFair freshness",
    )
    content = replace_once(
        content,
        'console.log(`PocketWorld public AIS fallback: ${process.env.POCKETWORLD_AIS_ENABLED}.`);',
        'console.log(`PocketWorld public AIS fallback: ${process.env.POCKETWORLD_AIS_ENABLED}; display retention ${process.env.POCKETWORLD_DISPLAY_MAX_AGE_MS} ms; fresh threshold ${process.env.POCKETWORLD_FRESH_AGE_MS} ms.`);',
        "production continuity log",
    )
    write(path, content)


def update_render() -> None:
    path = "render.yaml"
    content = read(path)
    content = replace_once(
        content,
        '      - key: AISSTREAM_SILENCE_TIMEOUT_MS\n        value: 90000\n      - key: MAX_INGEST_BODY_BYTES',
        '      - key: AISSTREAM_SILENCE_TIMEOUT_MS\n        value: 90000\n'
        '      - key: AISSTREAM_RATE_LIMIT_BACKOFF_MS\n        value: 1800000\n'
        '      - key: AISSTREAM_PROFILE_CYCLE_BACKOFF_MS\n        value: 600000\n'
        '      - key: MAX_INGEST_BODY_BYTES',
        "Render AIS backoff",
    )
    content = replace_once(
        content,
        '      - key: POCKETWORLD_ACTIVATION_DELAY_MS\n        value: 45000\n'
        '      - key: POCKETWORLD_POLL_INTERVAL_MS\n        value: 300000\n'
        '      - key: POCKETWORLD_TIMEOUT_MS\n        value: 30000\n'
        '      - key: POCKETWORLD_MAX_AGE_MS\n        value: 1800000\n'
        '      - key: POCKETWORLD_MAX_VESSELS\n        value: 2500',
        '      - key: POCKETWORLD_ACTIVATION_DELAY_MS\n        value: 5000\n'
        '      - key: POCKETWORLD_POLL_INTERVAL_MS\n        value: 300000\n'
        '      - key: POCKETWORLD_TIMEOUT_MS\n        value: 30000\n'
        '      - key: POCKETWORLD_DISPLAY_MAX_AGE_MS\n        value: 21600000\n'
        '      - key: POCKETWORLD_FRESH_AGE_MS\n        value: 1800000\n'
        '      - key: POCKETWORLD_MAX_AGE_MS\n        value: 21600000\n'
        '      - key: POCKETWORLD_MAX_VESSELS\n        value: 5000\n'
        '      - key: POCKETWORLD_CACHE_FILE\n        value: /var/data/pocketworld-ais-cache.json\n'
        '      - key: POCKETWORLD_CACHE_FLUSH_MS\n        value: 60000',
        "Render PocketWorld continuity",
    )
    content = replace_once(
        content,
        '      - key: ECOFAIR_OPERATIONAL_RADIUS_NM\n        value: 120\n'
        '      - key: ECOFAIR_EMISSION_BUDGET_TONNES_PER_DAY',
        '      - key: ECOFAIR_OPERATIONAL_RADIUS_NM\n        value: 120\n'
        '      - key: ECOFAIR_MAX_VESSEL_AGE_MS\n        value: 1800000\n'
        '      - key: ECOFAIR_EMISSION_BUDGET_TONNES_PER_DAY',
        "Render EcoFair freshness",
    )
    write(path, content)


def update_env_example() -> None:
    path = ".env.example"
    content = read(path)
    content = replace_once(
        content,
        'AISSTREAM_SILENCE_TIMEOUT_MS=90000\nAISSTREAM_CACHE_ENABLED=true',
        'AISSTREAM_SILENCE_TIMEOUT_MS=90000\n'
        'AISSTREAM_RATE_LIMIT_BACKOFF_MS=1800000\n'
        'AISSTREAM_PROFILE_CYCLE_BACKOFF_MS=600000\n'
        'AISSTREAM_CACHE_ENABLED=true',
        "environment AIS backoff",
    )
    content = replace_once(
        content,
        'POCKETWORLD_ACTIVATION_DELAY_MS=45000\n'
        'POCKETWORLD_POLL_INTERVAL_MS=300000\n'
        'POCKETWORLD_TIMEOUT_MS=30000\n'
        'POCKETWORLD_MAX_AGE_MS=1800000\n'
        'POCKETWORLD_MAX_VESSELS=2500',
        'POCKETWORLD_ACTIVATION_DELAY_MS=5000\n'
        'POCKETWORLD_POLL_INTERVAL_MS=300000\n'
        'POCKETWORLD_TIMEOUT_MS=30000\n'
        '# Rows newer than 30 minutes are fresh; genuine observations remain visible\n'
        '# for up to six hours as explicitly labeled last-known positions.\n'
        'POCKETWORLD_DISPLAY_MAX_AGE_MS=21600000\n'
        'POCKETWORLD_FRESH_AGE_MS=1800000\n'
        'POCKETWORLD_MAX_AGE_MS=21600000\n'
        'POCKETWORLD_MAX_VESSELS=5000\n'
        'POCKETWORLD_CACHE_FILE=\n'
        'POCKETWORLD_CACHE_FLUSH_MS=60000',
        "environment PocketWorld continuity",
    )
    content = replace_once(
        content,
        'ECOFAIR_OPERATIONAL_RADIUS_NM=120\nECOFAIR_EMISSION_BUDGET_TONNES_PER_DAY=0',
        'ECOFAIR_OPERATIONAL_RADIUS_NM=120\n'
        '# Last-known map rows never enter EcoFair calculations.\n'
        'ECOFAIR_MAX_VESSEL_AGE_MS=1800000\n'
        'ECOFAIR_EMISSION_BUDGET_TONNES_PER_DAY=0',
        "environment EcoFair freshness",
    )
    write(path, content)


def update_dashboard_provider() -> None:
    path = "src/providers/dashboardDataProvider.ts"
    content = read(path)
    content = replace_once(
        content,
        '    tracking?: number;\n    operational?: number;',
        '    tracking?: number;\n    freshTracking?: number;\n    lastKnownTracking?: number;\n    operational?: number;',
        "remote freshness counts",
    )
    content = replace_once(
        content,
        '  if (value === "pocketworld") return "pocketworld";\n  if (value === "ais-multi-provider")',
        '  if (value === "pocketworld") return "pocketworld";\n'
        '  if (value === "pocketworld-last-known") return "pocketworld-last-known";\n'
        '  if (value === "ais-multi-provider")',
        "last-known source normalization",
    )
    write(path, content)


def update_dashboard_shell() -> None:
    path = "src/components/DashboardShell.tsx"
    content = read(path)
    content = replace_once(
        content,
        '    || source === "pocketworld"\n    || source === "ais-multi-provider"',
        '    || source === "pocketworld"\n    || source === "pocketworld-last-known"\n    || source === "ais-multi-provider"',
        "last-known external source",
    )
    content = replace_once(
        content,
        '  if (source === "pocketworld") return "Public regional live AIS";\n  if (source === "ais-multi-provider")',
        '  if (source === "pocketworld") return "Public regional live AIS";\n'
        '  if (source === "pocketworld-last-known") return "Public regional AIS · last known";\n'
        '  if (source === "ais-multi-provider")',
        "last-known source label",
    )
    content = replace_once(
        content,
        '    || source === "pocketworld"\n    || source === "ais-multi-provider"\n    || source === "aisstream-waiting") return 5_000;',
        '    || source === "pocketworld"\n'
        '    || source === "pocketworld-last-known"\n'
        '    || source === "ais-multi-provider"\n'
        '    || source === "aisstream-waiting") return 5_000;',
        "last-known refresh interval",
    )
    write(path, content)


def update_data_quality() -> None:
    path = "src/components/DataQualityPanel.tsx"
    content = read(path)
    marker = '''  if (data.source === "ais-multi-provider") {
    return {
      label: "Vessel tracking",
      value: `${trackingRows} multi-provider AIS rows`,
      detail: `Multiple genuine AIS providers are merged by MMSI · ${operationalRows} within ${radius} nm port scope · ${coverage}% positioned · ${stale} stale`,
      tone: trackingRows > 0 && stale < trackingRows ? "good" : "warn",
    };
  }'''
    insertion = '''  if (data.source === "pocketworld-last-known") {
    return {
      label: "Vessel tracking",
      value: `${trackingRows} last-known AIS rows`,
      detail: `Regional providers still expose genuine AIS positions, but their timestamps exceed the ${Math.round(30)} minute operational freshness limit · rows remain visible with original timestamps · ${operationalRows} admitted to EcoFair · ${coverage}% positioned · ${stale} stale`,
      tone: "warn",
    };
  }
  if (data.source === "ais-multi-provider") {
    return {
      label: "Vessel tracking",
      value: `${trackingRows} multi-provider AIS rows`,
      detail: `Multiple genuine AIS providers are merged by MMSI · ${operationalRows} within ${radius} nm port scope · ${coverage}% positioned · ${stale} stale`,
      tone: trackingRows > 0 && stale < trackingRows ? "good" : "warn",
    };
  }'''
    content = replace_once(content, marker, insertion, "last-known quality state")
    content = replace_once(
        content,
        '  if (data.source === "pocketworld") return `Public regional live AIS · ${tracking} vessels · ${operational} port calculations`;\n'
        '  if (data.source === "ais-multi-provider")',
        '  if (data.source === "pocketworld") return `Public regional live AIS · ${tracking} vessels · ${operational} port calculations`;\n'
        '  if (data.source === "pocketworld-last-known") return `Public regional AIS · ${tracking} last-known vessels · excluded from EcoFair until fresh`;\n'
        '  if (data.source === "ais-multi-provider")',
        "last-known readiness headline",
    )
    write(path, content)


def update_sample_data_loader() -> None:
    path = "src/data/loadSampleDashboardData.ts"
    content = read(path)
    content = replace_once(
        content,
        'export type DashboardDataSource = "aisstream" | "datalastic" | "pocketworld" | "ais-multi-provider"',
        'export type DashboardDataSource = "aisstream" | "datalastic" | "pocketworld" | "pocketworld-last-known" | "ais-multi-provider"',
        "dashboard source type",
    )
    content = replace_once(
        content,
        '    || source === "pocketworld"\n    || source === "ais-multi-provider"',
        '    || source === "pocketworld"\n    || source === "pocketworld-last-known"\n    || source === "ais-multi-provider"',
        "last-known dashboard source",
    )
    content = replace_once(
        content,
        '  { id: "Dammam", latitude: 26.4318, longitude: 50.1015 },\n  { id: "Jebel Ali",',
        '  { id: "Dammam", latitude: 26.4318, longitude: 50.1015 },\n'
        '  { id: "Jubail Commercial Port", latitude: 27.0333, longitude: 49.6667 },\n'
        '  { id: "Jebel Ali",',
        "Jubail frontend operational reference",
    )
    content = replace_once(
        content,
        '  return rows.filter((row) => {\n    const nearest = nearestPort(row);',
        '  return rows.filter((row) => {\n'
        '    if (stalePosition(row)) return false;\n'
        '    const nearest = nearestPort(row);',
        "frontend operational freshness",
    )
    content = replace_once(
        content,
        '    : source === "pocketworld"\n      ? "PocketWorld public regional live AIS"\n      : source === "ais-multi-provider"',
        '    : source === "pocketworld"\n'
        '      ? "PocketWorld public regional live AIS"\n'
        '      : source === "pocketworld-last-known"\n'
        '        ? "PocketWorld public regional AIS (last known)"\n'
        '        : source === "ais-multi-provider"',
        "last-known timeline label",
    )
    write(path, content)


def update_package_and_contracts() -> None:
    package_path = "package.json"
    package_data = json.loads(read(package_path))
    verify_runtime = package_data["scripts"]["verify:runtime"]
    for script in [
        "node scripts/smoke-public-live-ais-continuity.mjs",
        "node scripts/smoke-ais-rate-limit-backoff.mjs",
    ]:
        if script not in verify_runtime:
            verify_runtime += " && " + script
    package_data["scripts"]["verify:runtime"] = verify_runtime
    write(package_path, json.dumps(package_data, indent=2))

    contract_path = "scripts/check-runtime-contract.mjs"
    contract = read(contract_path)
    contract = replace_once(
        contract,
        'assertIncludes(pocketWorldProvider, \'payload?.coverage\', "public AIS coverage metadata is not preserved");',
        'assertIncludes(pocketWorldProvider, \'payload?.coverage\', "public AIS coverage metadata is not preserved");\n'
        'assertIncludes(pocketWorldProvider, "loadCache();", "public AIS continuity cache is not restored at startup");\n'
        'assertIncludes(pocketWorldProvider, "last-known-regional", "public AIS last-known state is absent");\n'
        'assertIncludes(pocketWorldProvider, "freshVessels", "public AIS freshness diagnostics are absent");',
        "PocketWorld continuity contract",
    )
    contract = replace_once(
        contract,
        'assertIncludes(runtime, "primaryOperationalVessels", "primary operational scope is absent");',
        'assertIncludes(runtime, "primaryOperationalVessels", "primary operational scope is absent");\n'
        'assertIncludes(runtime, "ECOFAIR_MAX_VESSEL_AGE_MS", "last-known rows are not excluded from EcoFair");\n'
        'assertIncludes(runtime, \'return "pocketworld-last-known"\', "last-known public AIS source is not exposed");\n'
        'assertIncludes(runtime, "AISSTREAM_RATE_LIMIT_BACKOFF_MS", "AIS 429 backoff is absent");\n'
        'assertIncludes(runtime, "rateLimitedUntil", "AIS rate-limit deadline is not exposed");\n'
        'assertIncludes(runtime, "retryAfterDelayMs", "AIS Retry-After handling is absent");',
        "runtime continuity contract",
    )
    contract = replace_once(
        contract,
        'assertIncludes(render, "POCKETWORLD_MAX_VESSELS\\n        value: 2500", "Render public AIS row bound is missing");',
        'assertIncludes(render, "POCKETWORLD_MAX_VESSELS\\n        value: 5000", "Render public AIS row bound is missing");\n'
        'assertIncludes(render, "POCKETWORLD_DISPLAY_MAX_AGE_MS\\n        value: 21600000", "Render last-known AIS retention is absent");\n'
        'assertIncludes(render, "POCKETWORLD_CACHE_FILE\\n        value: /var/data/pocketworld-ais-cache.json", "Render public AIS persistence is absent");\n'
        'assertIncludes(render, "ECOFAIR_MAX_VESSEL_AGE_MS\\n        value: 1800000", "Render EcoFair freshness guard is absent");\n'
        'assertIncludes(render, "AISSTREAM_RATE_LIMIT_BACKOFF_MS\\n        value: 1800000", "Render AIS rate-limit backoff is absent");',
        "Render continuity contract",
    )
    contract = replace_once(
        contract,
        'assertIncludes(packageJson, "scripts/smoke-eight-port-ecofair-focus.mjs", "eight-port EcoFair smoke test is not part of verification");',
        'assertIncludes(packageJson, "scripts/smoke-eight-port-ecofair-focus.mjs", "eight-port EcoFair smoke test is not part of verification");\n'
        'assertIncludes(packageJson, "scripts/smoke-public-live-ais-continuity.mjs", "public AIS continuity smoke test is not part of verification");\n'
        'assertIncludes(packageJson, "scripts/smoke-ais-rate-limit-backoff.mjs", "AIS rate-limit smoke test is not part of verification");',
        "continuity smoke contracts",
    )
    write(contract_path, contract)

    ui_path = "scripts/check-live-ui-contract.mjs"
    ui = read(ui_path)
    ui = replace_once(
        ui,
        'for (const source of ["datalastic", "pocketworld", "ais-multi-provider"]) {',
        'for (const source of ["datalastic", "pocketworld", "pocketworld-last-known", "ais-multi-provider"]) {',
        "last-known UI source contract",
    )
    ui = replace_once(
        ui,
        'assertIncludes(dashboard, \'if (source === "pocketworld") return "Public regional live AIS"\', "PocketWorld is mislabeled as unavailable");',
        'assertIncludes(dashboard, \'if (source === "pocketworld") return "Public regional live AIS"\', "PocketWorld is mislabeled as unavailable");\n'
        'assertIncludes(dashboard, \'if (source === "pocketworld-last-known") return "Public regional AIS · last known"\', "last-known AIS is mislabeled as unavailable");',
        "last-known UI label contract",
    )
    write(ui_path, ui)


def write_docs() -> None:
    write(
        "docs/WORLD_AIS_CONTINUITY.md",
        """# World AIS continuity and freshness\n\nThe portal distinguishes observation availability from operational freshness. Genuine regional AIS rows remain visible with their original MMSI, provider, coordinates, and timestamps for up to six hours. Rows older than 30 minutes are labeled as last known and are excluded from EcoFair-CH-MARL fuel, emissions, fairness, queue, reward, utilization, and constraint calculations.\n\nPocketWorld snapshots are persisted under the runtime data directory so a Render restart or short mirror outage does not erase genuine observations immediately. The persistence layer never creates or moves a vessel.\n\nAISStream HTTP 429 responses activate a provider backoff that honors Retry-After and prevents reconnect storms. Completing a full silent subscription-profile cycle also activates a cooldown before another cycle.\n\nProduction source states are:\n\n- `pocketworld`: at least one regional observation is operationally fresh.\n- `pocketworld-last-known`: genuine regional observations are visible, but all exceed the operational freshness threshold.\n- `aisstream-waiting`: no genuine vessel row is currently available.\n\nOnly fresh observations within the eight monitored port geofences can activate EcoFair-CH-MARL.\n""",
    )


update_runtime()
update_start_prod()
update_render()
update_env_example()
update_dashboard_provider()
update_dashboard_shell()
update_data_quality()
update_sample_data_loader()
update_package_and_contracts()
write_docs()
print("World AIS continuity fix applied.")
