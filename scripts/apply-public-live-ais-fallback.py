from pathlib import Path
import json


def read(path: str) -> str:
    return Path(path).read_text(encoding="utf-8")


def write(path: str, content: str) -> None:
    Path(path).write_text(content if content.endswith("\n") else content + "\n", encoding="utf-8")
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
        'import { createDatalasticLiveAisProvider } from "./datalastic-live-ais.mjs";\n',
        'import { createDatalasticLiveAisProvider } from "./datalastic-live-ais.mjs";\nimport { createPocketWorldLiveAisProvider } from "./pocketworld-live-ais.mjs";\n',
        "PocketWorld provider import",
    )

    content = replace_once(
        content,
        '''const DATALASTIC_SCAN_POINTS = DATALASTIC_SCAN_POINT_SELECTION.some((item) => item.toLowerCase() === "all")
  ? PORT_REFERENCE_POINTS
  : PORT_REFERENCE_POINTS.filter((port) => DATALASTIC_SCAN_POINT_SELECTION.includes(port.id));
const MAX_INGEST_BODY_BYTES''',
        '''const DATALASTIC_SCAN_POINTS = DATALASTIC_SCAN_POINT_SELECTION.some((item) => item.toLowerCase() === "all")
  ? PORT_REFERENCE_POINTS
  : PORT_REFERENCE_POINTS.filter((port) => DATALASTIC_SCAN_POINT_SELECTION.includes(port.id));
const POCKETWORLD_AIS_ENABLED = process.env.POCKETWORLD_AIS_ENABLED !== "false";
const POCKETWORLD_API_URL = process.env.POCKETWORLD_API_URL ?? "https://pocketworld.org/api/ships";
const POCKETWORLD_ACTIVATION_DELAY_MS = Math.max(250, Number(process.env.POCKETWORLD_ACTIVATION_DELAY_MS ?? 45_000));
const POCKETWORLD_POLL_INTERVAL_MS = Math.max(5_000, Number(process.env.POCKETWORLD_POLL_INTERVAL_MS ?? 5 * 60_000));
const POCKETWORLD_TIMEOUT_MS = Math.max(1_000, Number(process.env.POCKETWORLD_TIMEOUT_MS ?? 30_000));
const POCKETWORLD_MAX_AGE_MS = Math.max(60_000, Number(process.env.POCKETWORLD_MAX_AGE_MS ?? 30 * 60_000));
const POCKETWORLD_MAX_VESSELS = Math.max(1, Number(process.env.POCKETWORLD_MAX_VESSELS ?? 2500));
const MAX_INGEST_BODY_BYTES''',
        "PocketWorld runtime constants",
    )

    content = replace_once(
        content,
        '''const datalasticProvider = createDatalasticLiveAisProvider({
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
  activeProviders: [],''',
        '''const datalasticProvider = createDatalasticLiveAisProvider({
  apiKey: DATALASTIC_AIS_ENABLED ? DATALASTIC_API_KEY : "",
  baseUrl: DATALASTIC_API_BASE_URL,
  scanPoints: DATALASTIC_SCAN_POINTS,
  radiusNm: DATALASTIC_SCAN_RADIUS_NM,
  scanIntervalMs: DATALASTIC_SCAN_INTERVAL_MS,
  timeoutMs: DATALASTIC_TIMEOUT_MS,
  maxAgeMs: DATALASTIC_MAX_AGE_MS,
  maxVessels: DATALASTIC_MAX_VESSELS,
});
const pocketWorldProvider = createPocketWorldLiveAisProvider({
  enabled: POCKETWORLD_AIS_ENABLED,
  url: POCKETWORLD_API_URL,
  pollIntervalMs: POCKETWORLD_POLL_INTERVAL_MS,
  timeoutMs: POCKETWORLD_TIMEOUT_MS,
  maxAgeMs: POCKETWORLD_MAX_AGE_MS,
  maxVessels: POCKETWORLD_MAX_VESSELS,
});

const vesselInputState = {
  aisRows: 0,
  aisstreamRows: 0,
  datalasticRows: 0,
  pocketworldRows: 0,
  activeProviders: [],''',
        "PocketWorld provider initialization",
    )

    old_combined = '''function datalasticFailoverDue() {
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
'''

    new_combined = '''function datalasticFailoverDue() {
  if (!DATALASTIC_AIS_ENABLED || !DATALASTIC_API_KEY || DATALASTIC_SCAN_POINTS.length === 0) return false;
  const lastPrimaryFrame = timestampMs(trackingAisState.lastFrameAt);
  if (lastPrimaryFrame > 0 && Date.now() - lastPrimaryFrame < AISSTREAM_SILENCE_TIMEOUT_MS) return false;
  const serviceStartedAt = timestampMs(SERVICE_STARTED_AT);
  return serviceStartedAt === 0 || Date.now() - serviceStartedAt >= DATALASTIC_ACTIVATION_DELAY_MS;
}

function pocketWorldFailoverDue(datalasticRows) {
  if (!POCKETWORLD_AIS_ENABLED || datalasticRows > 0) return false;
  const lastPrimaryFrame = timestampMs(trackingAisState.lastFrameAt);
  if (lastPrimaryFrame > 0 && Date.now() - lastPrimaryFrame < AISSTREAM_SILENCE_TIMEOUT_MS) return false;
  const serviceStartedAt = timestampMs(SERVICE_STARTED_AT);
  return serviceStartedAt === 0 || Date.now() - serviceStartedAt >= POCKETWORLD_ACTIVATION_DELAY_MS;
}

async function loadCombinedVessels() {
  try {
    if (datalasticFailoverDue()) await datalasticProvider.refresh();
    const trackingAis = cacheRows(trackingAisCache, trackingAisState);
    const datalasticAis = datalasticProvider.rows().map((row) => normalizeVessel(row)).filter(Boolean);
    if (pocketWorldFailoverDue(datalasticAis.length)) await pocketWorldProvider.refresh();
    const pocketWorldAis = pocketWorldProvider.rows().map((row) => normalizeVessel(row)).filter(Boolean);
    const priorityAis = OPERATIONAL_PRIORITY_ENABLED ? cacheRows(operationalAisCache, operationalAisState) : [];
    const merged = new Map();
    for (const row of pocketWorldAis) merged.set(row.id, row);
    for (const row of datalasticAis) merged.set(row.id, row);
    for (const row of trackingAis) merged.set(row.id, row);
    const tracking = [...merged.values()].filter((row) => validCoordinates(row.latitude, row.longitude));
    const operational = operationalVessels(tracking);
    const activeProviders = [
      ...(trackingAis.length > 0 ? ["aisstream"] : []),
      ...(datalasticAis.length > 0 ? ["datalastic"] : []),
      ...(pocketWorldAis.length > 0 ? ["pocketworld"] : []),
    ];
    Object.assign(vesselInputState, {
      aisRows: tracking.length,
      aisstreamRows: trackingAis.length,
      datalasticRows: datalasticAis.length,
      pocketworldRows: pocketWorldAis.length,
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
  const activeProviders = [
    ...(Number(vesselInputState.aisstreamRows ?? 0) > 0 ? ["aisstream"] : []),
    ...(Number(vesselInputState.datalasticRows ?? 0) > 0 ? ["datalastic"] : []),
    ...(Number(vesselInputState.pocketworldRows ?? 0) > 0 ? ["pocketworld"] : []),
  ];
  if (activeProviders.length > 1) return "ais-multi-provider";
  if (activeProviders.length === 1) return activeProviders[0];
  return AISSTREAM_API_KEY || DATALASTIC_API_KEY || POCKETWORLD_AIS_ENABLED ? "aisstream-waiting" : "none";
}
'''
    content = replace_once(content, old_combined, new_combined, "combined live AIS provider chain")

    content = replace_once(
        content,
        '''function vesselProviderConfigured() {
  return Boolean(AISSTREAM_API_KEY || DATALASTIC_API_KEY);
}

function providerState() {
  if (!vesselProviderConfigured()) return "unconfigured";
  if (vesselInputState.trackingRows > 0) return sourceForTracking() === "ais-multi-provider" ? "live-multi-provider" : "live";
  const datalasticState = datalasticProvider.publicState();
  if (["unauthorized", "credits-exhausted", "rate-limited", "provider-error", "request-error", "timeout"].includes(datalasticState.status)) {
    return "datalastic-" + datalasticState.status;
  }
  if (trackingAisState.connected) return DATALASTIC_API_KEY ? "aisstream-silent-failover-waiting" : "connected-waiting";
  if (AISSTREAM_API_KEY || DATALASTIC_API_KEY) return "reconnecting";
  return "unavailable";
}
''',
        '''function vesselProviderConfigured() {
  return Boolean(AISSTREAM_API_KEY || DATALASTIC_API_KEY || POCKETWORLD_AIS_ENABLED);
}

function providerState() {
  if (!vesselProviderConfigured()) return "unconfigured";
  if (vesselInputState.trackingRows > 0) return sourceForTracking() === "ais-multi-provider" ? "live-multi-provider" : "live";
  const datalasticState = datalasticProvider.publicState();
  const pocketWorldState = pocketWorldProvider.publicState();
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
''',
        "aggregate provider state",
    )

    content = replace_once(
        content,
        'mode: sourceForTracking() === "datalastic" ? "monitored-port-failover" : (GLOBAL_TRACKING_ENABLED ? "global" : "regional"),',
        'mode: sourceForTracking() === "datalastic" ? "monitored-port-failover" : sourceForTracking() === "pocketworld" ? "regional-public-fallback" : (GLOBAL_TRACKING_ENABLED ? "global" : "regional"),',
        "tracking scope mode",
    )

    content = replace_once(
        content,
        '''    datalastic: datalasticProvider.publicState(),
    chmarl:''',
        '''    datalastic: datalasticProvider.publicState(),
    pocketworld: pocketWorldProvider.publicState(),
    chmarl:''',
        "PocketWorld health state",
    )

    content = replace_once(
        content,
        '''function shutdown() {
  stopping = true;
  datalasticProvider.shutdown();''',
        '''function shutdown() {
  stopping = true;
  datalasticProvider.shutdown();
  pocketWorldProvider.shutdown();''',
        "PocketWorld shutdown",
    )

    content = replace_once(
        content,
        '''        aisstream: publicAisState(trackingAisState),
        datalastic: datalasticProvider.publicState(),
      },''',
        '''        aisstream: publicAisState(trackingAisState),
        datalastic: datalasticProvider.publicState(),
        pocketworld: pocketWorldProvider.publicState(),
      },''',
        "PocketWorld vessel API diagnostics",
    )

    content = replace_once(
        content,
        '"- Vessel tracking: AISStream remains the primary worldwide live AIS source. When it produces no frames, the runtime can activate a separately authenticated Datalastic live AIS scan around monitored ports. Both sources contain genuine AIS observations; no manual or synthetic vessel rows are accepted."',
        '"- Vessel tracking: AISStream remains the primary worldwide source. When it produces no frames, the runtime first uses a configured Datalastic port scan and then a public PocketWorld mirror of current BarentsWatch, Fintraffic, and Singapore MPA AIS observations. Every row retains its source timestamp and provenance; no manual or synthetic vessel rows are accepted."',
        "report live AIS provider chain",
    )

    content = replace_once(
        content,
        '''  if (DATALASTIC_API_KEY) console.log(`Datalastic live AIS failover enabled for ${DATALASTIC_SCAN_POINTS.map((point) => point.id).join(", ") || "no scan points"}.`);
  else console.log("Datalastic live AIS failover is not configured.");
});''',
        '''  if (DATALASTIC_API_KEY) console.log(`Datalastic live AIS failover enabled for ${DATALASTIC_SCAN_POINTS.map((point) => point.id).join(", ") || "no scan points"}.`);
  else console.log("Datalastic live AIS failover is not configured.");
  console.log(`PocketWorld public AIS fallback: ${POCKETWORLD_AIS_ENABLED ? "enabled" : "disabled"}; max rows: ${POCKETWORLD_MAX_VESSELS}.`);
});''',
        "PocketWorld startup logging",
    )

    write(path, content)


def update_start_prod() -> None:
    path = "scripts/start-prod.mjs"
    content = read(path)
    content = replace_once(
        content,
        '''process.env.DATALASTIC_SCAN_POINT_IDS ??= "Jeddah,King Abdullah Port";
process.env.AISSTREAM_CACHE_FILE''',
        '''process.env.DATALASTIC_SCAN_POINT_IDS ??= "Jeddah,King Abdullah Port";
process.env.POCKETWORLD_AIS_ENABLED = runningOnRender ? "true" : (process.env.POCKETWORLD_AIS_ENABLED || "true");
process.env.POCKETWORLD_API_URL ??= "https://pocketworld.org/api/ships";
process.env.POCKETWORLD_ACTIVATION_DELAY_MS ??= "45000";
process.env.POCKETWORLD_POLL_INTERVAL_MS ??= "300000";
process.env.POCKETWORLD_TIMEOUT_MS ??= "30000";
process.env.POCKETWORLD_MAX_AGE_MS ??= "1800000";
process.env.POCKETWORLD_MAX_VESSELS ??= "2500";
process.env.AISSTREAM_CACHE_FILE''',
        "production PocketWorld defaults",
    )
    content = replace_once(
        content,
        'console.log("Vessel input policy: genuine live AIS only; AISStream is primary and Datalastic is optional failover. Manual, fixed, sample, and synthetic vessel rows are disabled.");',
        'console.log("Vessel input policy: genuine live AIS only; AISStream is primary, Datalastic is optional port failover, and PocketWorld supplies a public regional AIS fallback. Manual, fixed, sample, and synthetic vessel rows are disabled.");',
        "production provider policy",
    )
    content = replace_once(
        content,
        'else console.log("Datalastic live AIS failover key is not configured.");\nconsole.log(`Global AIS tracking: true`);',
        'else console.log("Datalastic live AIS failover key is not configured.");\nconsole.log(`PocketWorld public AIS fallback: ${process.env.POCKETWORLD_AIS_ENABLED}.`);\nconsole.log(`Global AIS tracking: true`);',
        "production PocketWorld logging",
    )
    write(path, content)


def update_env_and_render() -> None:
    env_path = ".env.example"
    env = read(env_path)
    env = replace_once(
        env,
        '''DATALASTIC_SCAN_POINT_IDS=Jeddah,King Abdullah Port

# EcoFair-CH-MARL operational scope.''',
        '''DATALASTIC_SCAN_POINT_IDS=Jeddah,King Abdullah Port

# Public no-key regional AIS fallback. Rows retain original source and timestamps.
POCKETWORLD_AIS_ENABLED=true
POCKETWORLD_API_URL=https://pocketworld.org/api/ships
POCKETWORLD_ACTIVATION_DELAY_MS=45000
POCKETWORLD_POLL_INTERVAL_MS=300000
POCKETWORLD_TIMEOUT_MS=30000
POCKETWORLD_MAX_AGE_MS=1800000
POCKETWORLD_MAX_VESSELS=2500

# EcoFair-CH-MARL operational scope.''',
        "environment PocketWorld block",
    )
    write(env_path, env)

    render_path = "render.yaml"
    render = read(render_path)
    render = replace_once(
        render,
        '''      - key: DATALASTIC_SCAN_POINT_IDS
        value: "Jeddah,King Abdullah Port"
      - key: CHMARL_RUNTIME_ENABLED''',
        '''      - key: DATALASTIC_SCAN_POINT_IDS
        value: "Jeddah,King Abdullah Port"
      - key: POCKETWORLD_AIS_ENABLED
        value: true
      - key: POCKETWORLD_API_URL
        value: https://pocketworld.org/api/ships
      - key: POCKETWORLD_ACTIVATION_DELAY_MS
        value: 45000
      - key: POCKETWORLD_POLL_INTERVAL_MS
        value: 300000
      - key: POCKETWORLD_TIMEOUT_MS
        value: 30000
      - key: POCKETWORLD_MAX_AGE_MS
        value: 1800000
      - key: POCKETWORLD_MAX_VESSELS
        value: 2500
      - key: CHMARL_RUNTIME_ENABLED''',
        "Render PocketWorld block",
    )
    write(render_path, render)


def update_frontend() -> None:
    provider_path = "src/providers/dashboardDataProvider.ts"
    provider = read(provider_path)
    provider = replace_once(
        provider,
        '''  if (value === "datalastic") return "datalastic";
  if (value === "ais-multi-provider") return "ais-multi-provider";''',
        '''  if (value === "datalastic") return "datalastic";
  if (value === "pocketworld") return "pocketworld";
  if (value === "ais-multi-provider") return "ais-multi-provider";''',
        "frontend PocketWorld source normalization",
    )
    write(provider_path, provider)

    data_path = "src/data/loadSampleDashboardData.ts"
    data = read(data_path)
    data = replace_once(
        data,
        'export type DashboardDataSource = "aisstream" | "datalastic" | "ais-multi-provider" | "aisstream-waiting" | "upstream" | "remote" | "local-json" | "fallback" | "none";',
        'export type DashboardDataSource = "aisstream" | "datalastic" | "pocketworld" | "ais-multi-provider" | "aisstream-waiting" | "upstream" | "remote" | "local-json" | "fallback" | "none";',
        "dashboard PocketWorld source type",
    )
    data = replace_once(
        data,
        '''  return source === "aisstream"
    || source === "datalastic"
    || source === "ais-multi-provider"''',
        '''  return source === "aisstream"
    || source === "datalastic"
    || source === "pocketworld"
    || source === "ais-multi-provider"''',
        "PocketWorld external-source classification",
    )
    data = replace_once(
        data,
        '''  const providerLabel = source === "datalastic"
    ? "Datalastic live AIS failover"
    : source === "ais-multi-provider"
      ? "AISStream + Datalastic live AIS"
      : "AISStream live AIS";''',
        '''  const providerLabel = source === "datalastic"
    ? "Datalastic live AIS failover"
    : source === "pocketworld"
      ? "PocketWorld public regional live AIS"
      : source === "ais-multi-provider"
        ? "multi-provider live AIS"
        : "AISStream live AIS";''',
        "timeline PocketWorld provider label",
    )
    write(data_path, data)

    quality_path = "src/components/DataQualityPanel.tsx"
    quality = read(quality_path)
    quality = replace_once(
        quality,
        '''  if (data.source === "ais-multi-provider") {
    return {
      label: "Vessel tracking",
      value: `${trackingRows} multi-provider AIS rows`,
      detail: `AISStream and Datalastic genuine AIS observations are merged by MMSI · ${operationalRows} within ${radius} nm port scope · ${coverage}% positioned · ${stale} stale`,''',
        '''  if (data.source === "pocketworld") {
    return {
      label: "Vessel tracking",
      value: `${trackingRows} public live AIS rows`,
      detail: `PocketWorld public AIS mirror is active with regional BarentsWatch, Fintraffic, and Singapore MPA coverage · ${operationalRows} within ${radius} nm port scope · ${coverage}% positioned · ${stale} stale`,
      tone: trackingRows > 0 && stale < trackingRows ? "good" : "warn",
    };
  }
  if (data.source === "ais-multi-provider") {
    return {
      label: "Vessel tracking",
      value: `${trackingRows} multi-provider AIS rows`,
      detail: `Multiple genuine AIS providers are merged by MMSI · ${operationalRows} within ${radius} nm port scope · ${coverage}% positioned · ${stale} stale`,''',
        "PocketWorld data-quality state",
    )
    quality = replace_once(
        quality,
        '        : "AISStream is connected but delivering no frames. The portal will use Datalastic genuine live AIS automatically when DATALASTIC_API_KEY is configured in Render.",',
        '        : "AISStream is connected but delivering no frames, and neither the configured port failover nor the public regional AIS fallback has produced a usable row yet.",',
        "waiting-state detail",
    )
    quality = replace_once(
        quality,
        '''  if (data.source === "datalastic") return `Datalastic live AIS failover · ${tracking} vessels · ${operational} port calculations`;
  if (data.source === "ais-multi-provider")''',
        '''  if (data.source === "datalastic") return `Datalastic live AIS failover · ${tracking} vessels · ${operational} port calculations`;
  if (data.source === "pocketworld") return `Public regional live AIS · ${tracking} vessels · ${operational} port calculations`;
  if (data.source === "ais-multi-provider")''',
        "PocketWorld readiness headline",
    )
    write(quality_path, quality)


def update_monitoring() -> None:
    path = "scripts/check-deployed-service.mjs"
    content = read(path)
    content = replace_once(
        content,
        '''  const health = source === "datalastic"
    ? (providers.datalastic ?? primaryHealth)
    : primaryHealth;''',
        '''  const health = source === "datalastic"
    ? (providers.datalastic ?? primaryHealth)
    : source === "pocketworld"
      ? (providers.pocketworld ?? primaryHealth)
      : primaryHealth;''',
        "deployment monitor PocketWorld selection",
    )
    content = replace_once(
        content,
        '''    activeProvider: source === "datalastic" ? "datalastic" : source === "ais-multi-provider" ? "multi-provider" : "aisstream",
    datalasticStatus: providers.datalastic?.status ?? null,
    datalasticRows: numeric(vessels?.inputs?.datalasticRows),''',
        '''    activeProvider: source === "datalastic" ? "datalastic" : source === "pocketworld" ? "pocketworld" : source === "ais-multi-provider" ? "multi-provider" : "aisstream",
    datalasticStatus: providers.datalastic?.status ?? null,
    datalasticRows: numeric(vessels?.inputs?.datalasticRows),
    pocketworldStatus: providers.pocketworld?.status ?? null,
    pocketworldRows: numeric(vessels?.inputs?.pocketworldRows),''',
        "deployment monitor PocketWorld fields",
    )
    write(path, content)


def update_tests_and_validation() -> None:
    for path, marker in [
        ("scripts/smoke-runtime.mjs", '  RUNTIME_DATA_DIR: runtimeDir,\n'),
        ("scripts/smoke-ais-live.mjs", '  AISSTREAM_CACHE_ENABLED: "false",\n'),
        ("scripts/smoke-live-ais-failover.mjs", '  DATALASTIC_AIS_ENABLED: "true",\n'),
    ]:
        content = read(path)
        content = replace_once(
            content,
            marker,
            marker + '  POCKETWORLD_AIS_ENABLED: "false",\n',
            f"PocketWorld isolation in {path}",
        )
        write(path, content)

    package_path = "package.json"
    package_json = json.loads(read(package_path))
    package_json["scripts"]["verify:runtime"] = (
        "node --check server/vessel-feed-proxy/runtime-v3.mjs "
        "&& node --check server/vessel-feed-proxy/datalastic-live-ais.mjs "
        "&& node --check server/vessel-feed-proxy/pocketworld-live-ais.mjs "
        "&& node scripts/check-runtime-contract.mjs "
        "&& node scripts/smoke-runtime.mjs "
        "&& node scripts/smoke-ais-live.mjs "
        "&& node scripts/smoke-live-ais-failover.mjs "
        "&& node scripts/smoke-public-live-ais-fallback.mjs"
    )
    write(package_path, json.dumps(package_json, indent=2))

    contract_path = "scripts/check-runtime-contract.mjs"
    contract = read(contract_path)
    contract = replace_once(
        contract,
        'const datalasticProvider = read("server/vessel-feed-proxy/datalastic-live-ais.mjs");\n',
        'const datalasticProvider = read("server/vessel-feed-proxy/datalastic-live-ais.mjs");\nconst pocketWorldProvider = read("server/vessel-feed-proxy/pocketworld-live-ais.mjs");\n',
        "PocketWorld contract module read",
    )
    contract = replace_once(
        contract,
        '''assertNotIncludes(datalasticProvider, "manual", "Datalastic provider contains manual vessel logic");''',
        '''assertNotIncludes(datalasticProvider, "manual", "Datalastic provider contains manual vessel logic");
assertIncludes(runtime, "createPocketWorldLiveAisProvider", "public live AIS fallback is not integrated");
assertIncludes(runtime, "pocketWorldFailoverDue", "silent primary AIS does not activate the public fallback");
assertIncludes(runtime, 'return "pocketworld"', "public AIS source is not exposed");
assertIncludes(pocketWorldProvider, 'inputSource: `pocketworld-${source}`', "public AIS provenance is absent");
assertIncludes(pocketWorldProvider, 'payload?.coverage', "public AIS coverage metadata is not preserved");
assertNotIncludes(pocketWorldProvider, "placeholder", "public AIS provider contains placeholder rows");''',
        "PocketWorld runtime contract assertions",
    )
    contract = replace_once(
        contract,
        '''assertIncludes(render, "DATALASTIC_SCAN_POINT_IDS", "Render does not configure live AIS fallback coverage");''',
        '''assertIncludes(render, "DATALASTIC_SCAN_POINT_IDS", "Render does not configure live AIS fallback coverage");
assertIncludes(render, "POCKETWORLD_AIS_ENABLED\\n        value: true", "Render does not enable public live AIS fallback");
assertIncludes(render, "POCKETWORLD_API_URL", "Render does not configure the public AIS endpoint");
assertIncludes(render, "POCKETWORLD_MAX_VESSELS\\n        value: 2500", "Render public AIS row bound is missing");''',
        "Render PocketWorld contract assertions",
    )
    contract = replace_once(
        contract,
        '''assertIncludes(packageJson, "scripts/smoke-live-ais-failover.mjs", "live AIS failover smoke test is not part of verification");''',
        '''assertIncludes(packageJson, "scripts/smoke-live-ais-failover.mjs", "live AIS failover smoke test is not part of verification");
assertIncludes(packageJson, "scripts/smoke-public-live-ais-fallback.mjs", "public live AIS fallback smoke test is not part of verification");''',
        "PocketWorld smoke contract assertion",
    )
    write(contract_path, contract)


def update_docs() -> None:
    write(
        "docs/PUBLIC_LIVE_AIS_FALLBACK.md",
        '''# Public live AIS fallback

The portal accepts only provider-issued AIS observations. It does not insert manually positioned, fixed, sample, synthetic, or placeholder vessels.

## Runtime provider order

1. AISStream remains the primary worldwide WebSocket source.
2. A configured Datalastic key supplies monitored-port live AIS when the primary stream is silent.
3. When neither source has produced rows, the backend polls PocketWorld's public `/api/ships` endpoint and accepts only fresh observations with MMSI, coordinates, original source, and observation timestamp.

PocketWorld currently aggregates working regional sources including BarentsWatch, Fintraffic, and Singapore MPA. Its payload explicitly reports whether worldwide coverage is ready. The portal preserves that coverage metadata and labels this source as regional rather than global.

## Production settings

- `POCKETWORLD_AIS_ENABLED=true`
- `POCKETWORLD_API_URL=https://pocketworld.org/api/ships`
- `POCKETWORLD_ACTIVATION_DELAY_MS=45000`
- `POCKETWORLD_POLL_INTERVAL_MS=300000`
- `POCKETWORLD_MAX_AGE_MS=1800000`
- `POCKETWORLD_MAX_VESSELS=2500`

No secret or account is required for this fallback. The backend polls no more than once every five minutes, rejects stale or invalid rows, caps retained rows, and exposes source health under `/health` and `/api/vessels`.

## Operational limitation

The current public sources provide regional coverage in Norway, Finland/Baltic waters, and Singapore. They restore genuine vessels to the global map, but they do not guarantee Saudi-port observations. EcoFair-CH-MARL remains inactive unless real AIS rows enter the monitored-port radius. Saudi operational continuity still requires AISStream recovery or a licensed provider with Red Sea/Gulf coverage.
''',
    )


def remove_bootstrap() -> None:
    for path in [
        "scripts/apply-public-live-ais-fallback.py",
        ".github/workflows/apply-public-live-ais-fallback.yml",
    ]:
        file = Path(path)
        if file.exists():
            file.unlink()
            print(f"removed {path}")


update_runtime()
update_start_prod()
update_env_and_render()
update_frontend()
update_monitoring()
update_tests_and_validation()
update_docs()
remove_bootstrap()
print("Public live AIS fallback patch applied.")
