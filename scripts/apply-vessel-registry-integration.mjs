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

function patchRegistryModule() {
  const path = "server/vessel-feed-proxy/vessel-registry.mjs";
  let content = read(path);

  content = replaceOnce(
    content,
    `    closeOtherMmsi: database.prepare(\`
      UPDATE vessel_identifiers SET active = 0, valid_to = ?
      WHERE vessel_uuid = ? AND identifier_type = 'mmsi' AND active = 1 AND identifier_value <> ?
    \`),`,
    `    activeMmsiForVessel: database.prepare(\`
      SELECT identifier_value FROM vessel_identifiers
      WHERE vessel_uuid = ? AND identifier_type = 'mmsi' AND active = 1 AND identifier_value <> ?
    \`),
    closeOtherMmsi: database.prepare(\`
      UPDATE vessel_identifiers SET active = 0, valid_to = ?
      WHERE vessel_uuid = ? AND identifier_type = 'mmsi' AND active = 1 AND identifier_value <> ?
    \`),`,
    "active MMSI cache cleanup statement",
  );

  content = replaceOnce(
    content,
    `    if (type === "mmsi" && identity.imo) statements.closeOtherMmsi.run(identity.observedAt, uuid, value);`,
    `    if (type === "mmsi" && identity.imo) {
      const formerMmsi = statements.activeMmsiForVessel.all(uuid, value);
      statements.closeOtherMmsi.run(identity.observedAt, uuid, value);
      for (const row of formerMmsi) identifierCache.delete(\`mmsi:\${row.identifier_value}\`);
    }`,
    "MMSI cache cleanup",
  );

  content = replaceOnce(content, `  function updateIdentity(uuid, identity) {`, `  function updateIdentity(uuid, identity, recordInitial = false) {`, "initial identity observation flag");
  content = replaceOnce(content, `    if (changes.length > 0 || !existing) {`, `    if (changes.length > 0 || recordInitial) {`, "initial identity provider observation");
  content = replaceOnce(
    content,
    `          ensureVessel(uuid, observation.identity, observation.observedAt);
          updateIdentity(uuid, observation.identity);`,
    `          const wasKnown = vesselCache.has(uuid);
          ensureVessel(uuid, observation.identity, observation.observedAt);
          updateIdentity(uuid, observation.identity, !wasKnown);`,
    "initial identity observation call",
  );
  content = replaceOnce(content, `        operational = MAX(vessel_latest_positions.operational, excluded.operational)`, `        operational = excluded.operational`, "latest operational position state");
  content = replaceOnce(content, `      const pattern = \`%\${normalizedQuery.replace(/[%_]/g, "")} %\`.replace(" %", "%");`, `      const pattern = \`%\${normalizedQuery.replace(/[%_]/g, "")}%\`;`, "registry search pattern");
  write(path, content);
}

function patchRuntime() {
  const path = "server/vessel-feed-proxy/runtime-v3.mjs";
  let content = read(path);

  content = replaceOnce(
    content,
    `import { createPocketWorldLiveAisProvider } from "./pocketworld-live-ais.mjs";`,
    `import { createPocketWorldLiveAisProvider } from "./pocketworld-live-ais.mjs";\nimport { createVesselRegistry } from "./vessel-registry.mjs";`,
    "vessel registry import",
  );

  content = replaceOnce(
    content,
    `const WEATHER_FILE = runtimePath("WEATHER_FILE", "weather.json");`,
    `const WEATHER_FILE = runtimePath("WEATHER_FILE", "weather.json");
const VESSEL_REGISTRY_DB_FILE = runtimePath("VESSEL_REGISTRY_DB_FILE", "vessel-registry.sqlite");
const VESSEL_REGISTRY_ENABLED = process.env.VESSEL_REGISTRY_ENABLED !== "false";
const VESSEL_REGISTRY_LIVE_AGE_MS = Math.max(60_000, Number(process.env.VESSEL_REGISTRY_LIVE_AGE_MS ?? 10 * 60_000));
const VESSEL_REGISTRY_DELAYED_AGE_MS = Math.max(VESSEL_REGISTRY_LIVE_AGE_MS, Number(process.env.VESSEL_REGISTRY_DELAYED_AGE_MS ?? 30 * 60_000));
const VESSEL_REGISTRY_LAST_KNOWN_AGE_MS = Math.max(VESSEL_REGISTRY_DELAYED_AGE_MS, Number(process.env.VESSEL_REGISTRY_LAST_KNOWN_AGE_MS ?? 24 * 60 * 60_000));
const VESSEL_REGISTRY_GLOBAL_TRACK_BUCKET_MS = Math.max(60_000, Number(process.env.VESSEL_REGISTRY_GLOBAL_TRACK_BUCKET_MS ?? 6 * 60 * 60_000));
const VESSEL_REGISTRY_OPERATIONAL_TRACK_BUCKET_MS = Math.max(60_000, Number(process.env.VESSEL_REGISTRY_OPERATIONAL_TRACK_BUCKET_MS ?? 5 * 60_000));
const VESSEL_REGISTRY_FINE_TRACK_DAYS = Math.max(1, Number(process.env.VESSEL_REGISTRY_FINE_TRACK_DAYS ?? 7));
const VESSEL_REGISTRY_GLOBAL_TRACK_RETENTION_DAYS = Math.max(7, Number(process.env.VESSEL_REGISTRY_GLOBAL_TRACK_RETENTION_DAYS ?? 90));
const VESSEL_REGISTRY_OPERATIONAL_TRACK_RETENTION_DAYS = Math.max(30, Number(process.env.VESSEL_REGISTRY_OPERATIONAL_TRACK_RETENTION_DAYS ?? 365));
const VESSEL_REGISTRY_MAINTENANCE_MS = Math.max(60_000, Number(process.env.VESSEL_REGISTRY_MAINTENANCE_MS ?? 60 * 60_000));`,
    "vessel registry configuration",
  );

  content = replaceOnce(
    content,
    `const pocketWorldProvider = createPocketWorldLiveAisProvider({
  enabled: POCKETWORLD_AIS_ENABLED,
  url: POCKETWORLD_API_URL,
  pollIntervalMs: POCKETWORLD_POLL_INTERVAL_MS,
  timeoutMs: POCKETWORLD_TIMEOUT_MS,
  maxAgeMs: POCKETWORLD_DISPLAY_MAX_AGE_MS,
  freshAgeMs: POCKETWORLD_FRESH_AGE_MS,
  maxVessels: POCKETWORLD_MAX_VESSELS,
  maxPages: POCKETWORLD_MAX_PAGES,
  cacheFile: POCKETWORLD_CACHE_FILE,
  cacheFlushMs: POCKETWORLD_CACHE_FLUSH_MS,
});`,
    `const pocketWorldProvider = createPocketWorldLiveAisProvider({
  enabled: POCKETWORLD_AIS_ENABLED,
  url: POCKETWORLD_API_URL,
  pollIntervalMs: POCKETWORLD_POLL_INTERVAL_MS,
  timeoutMs: POCKETWORLD_TIMEOUT_MS,
  maxAgeMs: POCKETWORLD_DISPLAY_MAX_AGE_MS,
  freshAgeMs: POCKETWORLD_FRESH_AGE_MS,
  maxVessels: POCKETWORLD_MAX_VESSELS,
  maxPages: POCKETWORLD_MAX_PAGES,
  cacheFile: POCKETWORLD_CACHE_FILE,
  cacheFlushMs: POCKETWORLD_CACHE_FLUSH_MS,
});
const vesselRegistry = createVesselRegistry({
  enabled: VESSEL_REGISTRY_ENABLED,
  databaseFile: VESSEL_REGISTRY_DB_FILE,
  liveAgeMs: VESSEL_REGISTRY_LIVE_AGE_MS,
  delayedAgeMs: VESSEL_REGISTRY_DELAYED_AGE_MS,
  lastKnownAgeMs: VESSEL_REGISTRY_LAST_KNOWN_AGE_MS,
  globalTrackBucketMs: VESSEL_REGISTRY_GLOBAL_TRACK_BUCKET_MS,
  operationalTrackBucketMs: VESSEL_REGISTRY_OPERATIONAL_TRACK_BUCKET_MS,
  fineTrackDays: VESSEL_REGISTRY_FINE_TRACK_DAYS,
  globalTrackRetentionDays: VESSEL_REGISTRY_GLOBAL_TRACK_RETENTION_DAYS,
  operationalTrackRetentionDays: VESSEL_REGISTRY_OPERATIONAL_TRACK_RETENTION_DAYS,
});`,
    "vessel registry initialization",
  );

  content = replaceOnce(
    content,
    `  return {
    id: String(id),
    mmsi: row.mmsi === undefined ? undefined : String(row.mmsi),
    name: String(name),`,
    `  return {
    id: String(id),
    mmsi: row.mmsi === undefined ? undefined : String(row.mmsi),
    imo: row.imo === undefined || row.imo === null ? undefined : String(row.imo),
    callSign: row.callSign ?? row.callsign ?? row.call_sign,
    flag: row.flag ?? row.countryCode ?? row.country_code ?? row.country,
    shipType: row.shipType ?? row.vesselType ?? row.typeName ?? row.type_name ?? row.cargo,
    lengthM: numberValue(row.lengthM ?? row.length_m ?? row.length),
    beamM: numberValue(row.beamM ?? row.beam_m ?? row.beam ?? row.width),
    draughtM: numberValue(row.draughtM ?? row.draught_m ?? row.draught ?? row.draft),
    navigationStatus: row.navigationStatus ?? row.navStatus ?? row.nav_status,
    destination,
    name: String(name),`,
    "runtime vessel identity fields",
  );

  content = replaceOnce(
    content,
    `    mmsi,
    name: String(name).trim() || \`MMSI \${mmsi}\`,`,
    `    mmsi,
    imo: metadata.IMO ?? metadata.ImoNumber ?? body.ImoNumber,
    callSign: metadata.CallSign ?? metadata.Callsign ?? body.CallSign,
    flag: metadata.Flag ?? metadata.Country,
    shipType: metadata.ShipType ?? body.ShipType,
    lengthM: numberValue(metadata.Length ?? body.Length),
    beamM: numberValue(metadata.Beam ?? body.Beam),
    draughtM: numberValue(metadata.Draught ?? body.Draught),
    navigationStatus: body.NavigationalStatus ?? body.NavStatus,
    destination: metadata.Destination ?? body.Destination,
    name: String(name).trim() || \`MMSI \${mmsi}\`,`,
    "AIS message identity fields",
  );

  content = replaceOnce(
    content,
    `    const tracking = [...merged.values()].filter((row) => validCoordinates(row.latitude, row.longitude));
    const freshTracking = tracking.filter(isOperationallyFresh);
    const operational = operationalVessels(tracking);
    const primaryOperational = primaryOperationalVessels(tracking);`,
    `    const tracking = [...merged.values()].filter((row) => validCoordinates(row.latitude, row.longitude));
    const freshTracking = tracking.filter(isOperationallyFresh);
    const operational = operationalVessels(tracking);
    const primaryOperational = primaryOperationalVessels(tracking);
    const operationalIds = new Set(operational.map((row) => row.id));
    const registeredTracking = vesselRegistry.observeBatch(tracking, { operationalIds });
    const registeredById = new Map(registeredTracking.map((row) => [row.id, row]));
    const registeredOperational = operational.map((row) => registeredById.get(row.id) ?? row);
    const registeredPrimaryOperational = primaryOperational.map((row) => registeredById.get(row.id) ?? row);`,
    "registry observation batch",
  );

  content = replaceOnce(
    content,
    `      trackingRows: tracking.length,
      freshTrackingRows: freshTracking.length,
      lastKnownTrackingRows: Math.max(0, tracking.length - freshTracking.length),
      primaryOperationalRows: primaryOperational.length,
      portfolioOperationalRows: operational.length,
      operationalRows: operational.length,`,
    `      trackingRows: registeredTracking.length,
      freshTrackingRows: freshTracking.length,
      lastKnownTrackingRows: Math.max(0, registeredTracking.length - freshTracking.length),
      primaryOperationalRows: registeredPrimaryOperational.length,
      portfolioOperationalRows: registeredOperational.length,
      operationalRows: registeredOperational.length,`,
    "registered vessel input counts",
  );

  content = replaceOnce(
    content,
    `    lastCombinedVessels = tracking;
    lastOperationalVessels = operational;
    lastPrimaryOperationalVessels = primaryOperational;
    return { tracking, operational, primaryOperational };`,
    `    lastCombinedVessels = registeredTracking;
    lastOperationalVessels = registeredOperational;
    lastPrimaryOperationalVessels = registeredPrimaryOperational;
    return { tracking: registeredTracking, operational: registeredOperational, primaryOperational: registeredPrimaryOperational };`,
    "registered vessel return values",
  );

  content = replaceOnce(
    content,
    `    pocketworld: pocketWorldProvider.publicState(),
    chmarl: { ...chmarlState, active: chmarlState.steps > 0 },`,
    `    pocketworld: pocketWorldProvider.publicState(),
    registry: vesselRegistry.publicState(),
    chmarl: { ...chmarlState, active: chmarlState.steps > 0 },`,
    "registry health state",
  );

  content = replaceOnce(
    content,
    `      pocketWorldCacheFile: POCKETWORLD_CACHE_FILE,
      ecofairStateFile: ECOFAIR_STATE_FILE,`,
    `      pocketWorldCacheFile: POCKETWORLD_CACHE_FILE,
      vesselRegistryDbFile: VESSEL_REGISTRY_DB_FILE,
      ecofairStateFile: ECOFAIR_STATE_FILE,`,
    "registry persistence path",
  );

  content = replaceOnce(
    content,
    `  datalasticProvider.shutdown();
  pocketWorldProvider.shutdown();`,
    `  datalasticProvider.shutdown();
  pocketWorldProvider.shutdown();
  vesselRegistry.close();`,
    "registry shutdown",
  );

  content = replaceOnce(
    content,
    `const ecofairInterval = setInterval(() => void runBackgroundTick(), ECOFAIR_TICK_MS);
ecofairInterval.unref?.();`,
    `const ecofairInterval = setInterval(() => void runBackgroundTick(), ECOFAIR_TICK_MS);
ecofairInterval.unref?.();
const registryMaintenanceInterval = setInterval(() => vesselRegistry.maintenance(), VESSEL_REGISTRY_MAINTENANCE_MS);
registryMaintenanceInterval.unref?.();`,
    "registry maintenance interval",
  );

  content = replaceOnce(
    content,
    `      providers: {
        aisstream: publicAisState(trackingAisState),
        datalastic: datalasticProvider.publicState(),
        pocketworld: pocketWorldProvider.publicState(),
      },`,
    `      providers: {
        aisstream: publicAisState(trackingAisState),
        datalastic: datalasticProvider.publicState(),
        pocketworld: pocketWorldProvider.publicState(),
      },
      registry: vesselRegistry.publicState(),`,
    "registry vessel API summary",
  );

  content = replaceOnce(
    content,
    `  if ((path === "/api/chmarl/episode" || path === "/api/chmarl/ingest") && request.method === "POST") {`,
    `  if (path === "/api/registry/stats") {
    await loadCombinedVessels();
    return sendJson(response, 200, vesselRegistry.stats());
  }

  if (path === "/api/registry/vessels") {
    await loadCombinedVessels();
    return sendJson(response, 200, vesselRegistry.listVessels({
      query: url.searchParams.get("q") ?? "",
      status: url.searchParams.get("status") ?? "",
      limit: url.searchParams.get("limit") ?? 100,
      offset: url.searchParams.get("offset") ?? 0,
    }));
  }

  const registryRoute = path.match(/^\\/api\\/registry\\/vessels\\/([^/]+)(?:\\/(identity-history|track|observations))?$/);
  if (registryRoute) {
    const vesselUuid = decodeURIComponent(registryRoute[1]);
    const resource = registryRoute[2];
    if (resource === "identity-history") return sendJson(response, 200, vesselRegistry.identityHistory(vesselUuid, { limit: url.searchParams.get("limit") ?? 200 }));
    if (resource === "track") return sendJson(response, 200, vesselRegistry.track(vesselUuid, { from: url.searchParams.get("from"), to: url.searchParams.get("to"), limit: url.searchParams.get("limit") ?? 2000 }));
    if (resource === "observations") return sendJson(response, 200, vesselRegistry.observations(vesselUuid, { limit: url.searchParams.get("limit") ?? 100 }));
    const vessel = vesselRegistry.getVessel(vesselUuid);
    return vessel ? sendJson(response, 200, vessel) : sendJson(response, 404, { error: "Vessel registry record not found" });
  }

  if ((path === "/api/chmarl/episode" || path === "/api/chmarl/ingest") && request.method === "POST") {`,
    "registry API routes",
  );

  content = replaceOnce(
    content,
    `  return sendJson(response, 404, { error: "Not found", availableEndpoints: ["/health", "/health/live", "/health/ready", "/version", "/api/vessels", "/api/vessels/operations", "/api/vessels?scope=operational", "/api/vessels?scope=primary", "/api/chmarl/episode", "/api/chmarl/ingest", "/api/port-events", "/api/weather", "/api/report"] });`,
    `  return sendJson(response, 404, { error: "Not found", availableEndpoints: ["/health", "/health/live", "/health/ready", "/version", "/api/vessels", "/api/vessels/operations", "/api/vessels?scope=operational", "/api/vessels?scope=primary", "/api/registry/stats", "/api/registry/vessels", "/api/registry/vessels/:vessel_uuid", "/api/registry/vessels/:vessel_uuid/identity-history", "/api/registry/vessels/:vessel_uuid/track", "/api/chmarl/episode", "/api/chmarl/ingest", "/api/port-events", "/api/weather", "/api/report"] });`,
    "registry endpoint discovery",
  );

  content = replaceOnce(
    content,
    `  console.log(\`Runtime data directory: \${RUNTIME_DATA_DIR}\`);`,
    `  console.log(\`Runtime data directory: \${RUNTIME_DATA_DIR}\`);
  console.log(\`Persistent vessel registry: \${VESSEL_REGISTRY_ENABLED ? VESSEL_REGISTRY_DB_FILE : "disabled"}\`);`,
    "registry startup log",
  );

  write(path, content);
}

function patchProviderNormalizers() {
  const datalasticPath = "server/vessel-feed-proxy/datalastic-live-ais.mjs";
  let datalastic = read(datalasticPath);
  datalastic = replaceOnce(
    datalastic,
    `    imo: imoValue === undefined || imoValue === null ? undefined : String(imoValue),
    name: name || id,`,
    `    imo: imoValue === undefined || imoValue === null ? undefined : String(imoValue),
    callSign: row.callsign ?? row.call_sign ?? row.callSign,
    flag: row.flag ?? row.country_iso ?? row.country_code ?? row.country,
    shipType: row.type_specific ?? row.type ?? row.vessel_type ?? row.ship_type,
    lengthM: numeric(row.length ?? row.length_m),
    beamM: numeric(row.width ?? row.beam ?? row.beam_m),
    draughtM: numeric(row.draught ?? row.draft ?? row.draught_m),
    navigationStatus,
    destination,
    name: name || id,`,
    "Datalastic vessel specifications",
  );
  write(datalasticPath, datalastic);

  const pocketPath = "server/vessel-feed-proxy/pocketworld-live-ais.mjs";
  let pocket = read(pocketPath);
  pocket = replaceOnce(
    pocket,
    `    id: \`MMSI-\${mmsi}\`,
    mmsi,
    name: name || \`MMSI \${mmsi}\`,`,
    `    id: \`MMSI-\${mmsi}\`,
    mmsi,
    imo: row.imo ?? row.IMO,
    callSign: row.callsign ?? row.call_sign ?? row.callSign,
    flag: row.flag ?? row.countryCode ?? row.country_code ?? row.country,
    shipType: row.type_name ?? row.vessel_type ?? row.ship_type ?? row.type,
    lengthM: numeric(row.length ?? row.length_m),
    beamM: numeric(row.beam ?? row.beam_m ?? row.width),
    draughtM: numeric(row.draught ?? row.draft ?? row.draught_m),
    navigationStatus: row.nav_status ?? row.navigation_status,
    destination: row.destination ?? row.dest,
    name: name || \`MMSI \${mmsi}\`,`,
    "PocketWorld vessel specifications",
  );
  write(pocketPath, pocket);
}

function patchFrontendTypesAndProvider() {
  const vesselPath = "src/data/chmarlData.ts";
  let vessel = read(vesselPath);
  vessel = replaceOnce(
    vessel,
    `  inputSource?: string;
  trail?: VesselTrailPoint[];`,
    `  inputSource?: string;
  vesselUuid?: string;
  imo?: string;
  mmsi?: string;
  callSign?: string;
  flag?: string;
  shipType?: string;
  lengthM?: number;
  beamM?: number;
  draughtM?: number;
  navigationStatus?: string;
  destination?: string;
  registryStatus?: "live" | "delayed" | "last-known" | "archived" | "identity-only";
  identityConfidence?: number;
  verifiedStatus?: string;
  trail?: VesselTrailPoint[];`,
    "frontend vessel registry fields",
  );
  write(vesselPath, vessel);

  const loaderPath = "src/data/loadSampleDashboardData.ts";
  let loader = read(loaderPath);
  loader = replaceOnce(
    loader,
    `export type VesselScopeSummary = {
  trackingRows: number;
  reportedRows: number;
  freshRows: number;
  heldRows: number;
  cachedRows: number;
  operationalRows: number;
  operationalRadiusNm: number;
};`,
    `export type VesselScopeSummary = {
  trackingRows: number;
  reportedRows: number;
  freshRows: number;
  heldRows: number;
  cachedRows: number;
  operationalRows: number;
  operationalRadiusNm: number;
};

export type VesselRegistrySummary = {
  enabled: boolean;
  status: string;
  knownVessels: number;
  withPosition: number;
  live: number;
  delayed: number;
  lastKnown: number;
  archived: number;
  identityOnly: number;
  imoAnchored: number;
  mmsiAnchored: number;
  openIdentityConflicts: number;
  trackPoints: number;
  identityChanges: number;
  lastIngestAt?: string | null;
};`,
    "dashboard registry summary type",
  );
  loader = replaceOnce(loader, `  vesselScope?: VesselScopeSummary;`, `  vesselScope?: VesselScopeSummary;\n  registry?: VesselRegistrySummary;`, "dashboard registry field");
  loader = replaceOnce(loader, `    vesselScope,\n    chmarlExperimentId:`, `    vesselScope,\n    registry: remoteVessels?.registry,\n    chmarlExperimentId:`, "dashboard registry assignment");
  write(loaderPath, loader);

  const providerPath = "src/providers/dashboardDataProvider.ts";
  let provider = read(providerPath);
  provider = replaceOnce(provider, `import type { DashboardDataSource } from "@/data/loadSampleDashboardData";`, `import type { DashboardDataSource, VesselRegistrySummary } from "@/data/loadSampleDashboardData";`, "registry provider type import");
  provider = replaceOnce(
    provider,
    `  imo?: string | number;
  vesselName?: string;`,
    `  imo?: string | number;
  vesselUuid?: string;
  callSign?: string;
  callsign?: string;
  call_sign?: string;
  flag?: string;
  countryCode?: string;
  country_code?: string;
  lengthM?: string | number;
  length_m?: string | number;
  beamM?: string | number;
  beam_m?: string | number;
  draughtM?: string | number;
  draught_m?: string | number;
  navigationStatus?: string;
  registryStatus?: Vessel["registryStatus"];
  identityConfidence?: number;
  verifiedStatus?: string;
  vesselName?: string;`,
    "remote registry vessel fields",
  );
  provider = replaceOnce(provider, `  items?: RemoteVesselRow[];`, `  items?: RemoteVesselRow[];\n  registry?: VesselRegistrySummary;`, "remote registry payload");
  provider = replaceOnce(provider, `  operationalRadiusNm?: number;\n};`, `  operationalRadiusNm?: number;\n  registry?: VesselRegistrySummary;\n};`, "dashboard registry feed");
  provider = replaceOnce(
    provider,
    `    id: String(id),
    name: String(name),`,
    `    id: String(id),
    vesselUuid: row.vesselUuid,
    imo: row.imo === undefined ? undefined : String(row.imo),
    mmsi: row.mmsi === undefined ? undefined : String(row.mmsi),
    callSign: row.callSign ?? row.callsign ?? row.call_sign,
    flag: row.flag ?? row.countryCode ?? row.country_code,
    shipType: row.shipType ?? row.vesselType,
    lengthM: toNumber(row.lengthM ?? row.length_m),
    beamM: toNumber(row.beamM ?? row.beam_m),
    draughtM: toNumber(row.draughtM ?? row.draught_m),
    navigationStatus: row.navigationStatus ?? row.navStatus,
    registryStatus: row.registryStatus,
    identityConfidence: row.identityConfidence,
    verifiedStatus: row.verifiedStatus,
    name: String(name),`,
    "dashboard vessel registry normalization",
  );
  provider = replaceOnce(provider, `    operationalRadiusNm: payload.inputs?.operationalRadiusNm,\n  };`, `    operationalRadiusNm: payload.inputs?.operationalRadiusNm,\n    registry: payload.registry,\n  };`, "registry payload return");
  write(providerPath, provider);

  const panelPath = "src/components/VesselRegistryPanel.tsx";
  let panel = read(panelPath);
  panel = replaceOnce(panel, `import { fetchFirstJson } from "@/providers/backendUrl";`, `import { fetchFirstJson } from "@/providers/backendUrl";\nimport type { VesselRegistrySummary } from "@/data/loadSampleDashboardData";`, "registry panel summary import");
  panel = replaceRange(panel, `export type VesselRegistrySummary = {`, `};\n\ntype RegistryRow = {`, `type RegistryRow = {`, "duplicate registry summary type");
  write(panelPath, panel);
}

function patchFrontendViews() {
  const readinessPath = "src/components/ReadinessStrip.tsx";
  let readiness = read(readinessPath);
  readiness = replaceOnce(
    readiness,
    `  const tracking = data.vesselScope?.trackingRows ?? data.vessels.length;
  const reported = data.vesselScope?.reportedRows ?? tracking;`,
    `  const tracking = data.vesselScope?.trackingRows ?? data.vessels.length;
  const knownVessels = data.registry?.knownVessels ?? tracking;
  const reported = data.vesselScope?.reportedRows ?? tracking;`,
    "readiness registry count",
  );
  readiness = replaceOnce(
    readiness,
    `      value: tracking > 0 ? \`\${tracking.toLocaleString()} vessel rows\` : "No current vessel rows",
      detail: \`\${providerLabel} · \${fresh.toLocaleString()} fresh · \${positionedPct}% positioned · refreshed \${updatedAt}\`,`,
    `      value: knownVessels > 0 ? \`\${knownVessels.toLocaleString()} known · \${tracking.toLocaleString()} current\` : "No vessel records",
      detail: \`Permanent registry · \${data.registry?.lastKnown?.toLocaleString() ?? 0} last known · \${data.registry?.archived?.toLocaleString() ?? 0} archived · refreshed \${updatedAt}\`,`,
    "readiness persistent registry display",
  );
  write(readinessPath, readiness);

  const commandPath = "src/components/CommandWorkspace.tsx";
  let command = read(commandPath);
  command = replaceOnce(command, `export type CommandWorkspaceFocus = "fleet" | "port-coverage" | "vessels" | "port-events" | "weather";`, `export type CommandWorkspaceFocus = "registry" | "fleet" | "port-coverage" | "vessels" | "port-events" | "weather";`, "registry command focus");
  command = replaceOnce(command, `  const tracking = data.vesselScope?.trackingRows ?? data.vessels.length;`, `  const tracking = data.vesselScope?.trackingRows ?? data.vessels.length;\n  const knownVessels = data.registry?.knownVessels ?? tracking;`, "known vessel command metric");
  command = replaceOnce(
    command,
    `    { label: "Global vessels", value: integer.format(tracking), detail: "Tracked", tone: tracking > 0 ? "good" : "missing", focus: "fleet" },`,
    `    { label: "Known vessels", value: integer.format(knownVessels), detail: \`\${integer.format(tracking)} currently tracked\`, tone: knownVessels > 0 ? "good" : "missing", focus: "registry" },`,
    "registry command metric",
  );
  write(commandPath, command);

  const shellPath = "src/components/ProfessionalDashboardShell.tsx";
  let shell = read(shellPath);
  shell = replaceOnce(shell, `import VesselTable from "./VesselTable";`, `import VesselTable from "./VesselTable";\nimport VesselRegistryPanel from "./VesselRegistryPanel";`, "registry focus panel import");
  shell = replaceOnce(shell, `  | "vessels"\n  | "chmarl-components"`, `  | "vessels"\n  | "registry"\n  | "chmarl-components"`, "registry focus type");
  shell = replaceOnce(
    shell,
    `    if (focusPanel === "vessels") return { panel: focusPanel, title: "Vessel State Table", description: "Searchable and sortable vessel state with provenance, position, speed, route, and freshness context.", content: <VesselTable vessels={data.vessels} /> };`,
    `    if (focusPanel === "vessels") return { panel: focusPanel, title: "Vessel State Table", description: "Searchable and sortable current vessel state with provenance, position, speed, route, and freshness context.", content: <VesselTable vessels={data.vessels} /> };
    if (focusPanel === "registry") return { panel: focusPanel, title: "Persistent Vessel Registry", description: "Permanent physical-vessel identity, mutable identifier history, latest genuine position, and archived state.", content: <VesselRegistryPanel /> };`,
    "registry focus content",
  );
  write(shellPath, shell);

  const mainPath = "src/main.tsx";
  let main = read(mainPath);
  main = replaceOnce(main, `import "./portalVision.css";`, `import "./portalVision.css";\nimport "./vesselRegistry.css";`, "registry stylesheet import");
  write(mainPath, main);
}

function patchConfiguration() {
  const packagePath = "package.json";
  let packageJson = read(packagePath);
  packageJson = replaceOnce(
    packageJson,
    `"verify:runtime": "node --check server/vessel-feed-proxy/runtime-v3.mjs && node --check server/vessel-feed-proxy/datalastic-live-ais.mjs && node --check server/vessel-feed-proxy/pocketworld-live-ais.mjs && node scripts/check-runtime-contract.mjs && node scripts/smoke-runtime.mjs`,
    `"verify:runtime": "node --check server/vessel-feed-proxy/runtime-v3.mjs && node --check server/vessel-feed-proxy/datalastic-live-ais.mjs && node --check server/vessel-feed-proxy/pocketworld-live-ais.mjs && node --check server/vessel-feed-proxy/vessel-registry.mjs && node scripts/check-runtime-contract.mjs && node scripts/smoke-vessel-registry.mjs && node scripts/smoke-runtime.mjs`,
    "registry runtime verification",
  );
  write(packagePath, packageJson);

  const startPath = "scripts/start-prod.mjs";
  let start = read(startPath);
  start = replaceOnce(
    start,
    `process.env.RUNTIME_DATA_DIR = runningOnRender ? "/var/data" : (process.env.RUNTIME_DATA_DIR || ".runtime");`,
    `process.env.RUNTIME_DATA_DIR = runningOnRender ? "/var/data" : (process.env.RUNTIME_DATA_DIR || ".runtime");
process.env.VESSEL_REGISTRY_ENABLED = "true";
process.env.VESSEL_REGISTRY_DB_FILE = join(process.env.RUNTIME_DATA_DIR, "vessel-registry.sqlite");
process.env.VESSEL_REGISTRY_LIVE_AGE_MS ??= "600000";
process.env.VESSEL_REGISTRY_DELAYED_AGE_MS ??= "1800000";
process.env.VESSEL_REGISTRY_LAST_KNOWN_AGE_MS ??= "86400000";
process.env.VESSEL_REGISTRY_GLOBAL_TRACK_BUCKET_MS ??= "21600000";
process.env.VESSEL_REGISTRY_OPERATIONAL_TRACK_BUCKET_MS ??= "300000";
process.env.VESSEL_REGISTRY_FINE_TRACK_DAYS ??= "7";
process.env.VESSEL_REGISTRY_GLOBAL_TRACK_RETENTION_DAYS ??= "90";
process.env.VESSEL_REGISTRY_OPERATIONAL_TRACK_RETENTION_DAYS ??= "365";
process.env.VESSEL_REGISTRY_MAINTENANCE_MS ??= "3600000";`,
    "production registry environment",
  );
  write(startPath, start);

  const renderPath = "render.yaml";
  let render = read(renderPath);
  render = replaceOnce(
    render,
    `      - key: VITE_VESSEL_DISPLAY_RETENTION_MS
        value: 86400000
      - key: VITE_VESSEL_DISPLAY_RETENTION_MS
        value: 21600000`,
    `      - key: VITE_VESSEL_DISPLAY_RETENTION_MS
        value: 86400000`,
    "duplicate frontend retention setting",
  );
  render = replaceOnce(
    render,
    `      - key: RUNTIME_DATA_DIR
        value: /var/data`,
    `      - key: RUNTIME_DATA_DIR
        value: /var/data
      - key: VESSEL_REGISTRY_ENABLED
        value: true
      - key: VESSEL_REGISTRY_DB_FILE
        value: /var/data/vessel-registry.sqlite
      - key: VESSEL_REGISTRY_LIVE_AGE_MS
        value: 600000
      - key: VESSEL_REGISTRY_DELAYED_AGE_MS
        value: 1800000
      - key: VESSEL_REGISTRY_LAST_KNOWN_AGE_MS
        value: 86400000
      - key: VESSEL_REGISTRY_GLOBAL_TRACK_BUCKET_MS
        value: 21600000
      - key: VESSEL_REGISTRY_OPERATIONAL_TRACK_BUCKET_MS
        value: 300000
      - key: VESSEL_REGISTRY_FINE_TRACK_DAYS
        value: 7
      - key: VESSEL_REGISTRY_GLOBAL_TRACK_RETENTION_DAYS
        value: 90
      - key: VESSEL_REGISTRY_OPERATIONAL_TRACK_RETENTION_DAYS
        value: 365
      - key: VESSEL_REGISTRY_MAINTENANCE_MS
        value: 3600000`,
    "Render registry environment",
  );
  write(renderPath, render);

  const envPath = ".env.example";
  let env = read(envPath);
  env = replaceOnce(
    env,
    `VITE_VESSEL_DISPLAY_RETENTION_MS=86400000
VITE_CHMARL_EXPERIMENT_URL`,
    `VITE_VESSEL_DISPLAY_RETENTION_MS=86400000
VITE_CHMARL_EXPERIMENT_URL`,
    "frontend retention anchor",
  );
  env = replaceOnce(
    env,
    `# Uniform display retention for every geography. No region receives a different
# retention window and no frontend vessel-count ceiling is applied.
VITE_VESSEL_DISPLAY_RETENTION_MS=21600000

`,
    `# Uniform 24-hour display retention for every geography. No region receives
# a different retention window and no frontend vessel-count ceiling is applied.

`,
    "duplicate environment retention",
  );
  env = replaceOnce(
    env,
    `RUNTIME_DATA_DIR=.runtime

# AISStream`,
    `RUNTIME_DATA_DIR=.runtime

# Persistent physical-vessel registry. Identity records are permanent, while
# movement history is bucketed and downsampled according to this policy.
VESSEL_REGISTRY_ENABLED=true
VESSEL_REGISTRY_DB_FILE=.runtime/vessel-registry.sqlite
VESSEL_REGISTRY_LIVE_AGE_MS=600000
VESSEL_REGISTRY_DELAYED_AGE_MS=1800000
VESSEL_REGISTRY_LAST_KNOWN_AGE_MS=86400000
VESSEL_REGISTRY_GLOBAL_TRACK_BUCKET_MS=21600000
VESSEL_REGISTRY_OPERATIONAL_TRACK_BUCKET_MS=300000
VESSEL_REGISTRY_FINE_TRACK_DAYS=7
VESSEL_REGISTRY_GLOBAL_TRACK_RETENTION_DAYS=90
VESSEL_REGISTRY_OPERATIONAL_TRACK_RETENTION_DAYS=365
VESSEL_REGISTRY_MAINTENANCE_MS=3600000

# AISStream`,
    "environment registry configuration",
  );
  write(envPath, env);
}

function patchContracts() {
  const runtimeContractPath = "scripts/check-runtime-contract.mjs";
  let runtimeContract = read(runtimeContractPath);
  runtimeContract = replaceOnce(runtimeContract, `const pocketWorldProvider = read("server/vessel-feed-proxy/pocketworld-live-ais.mjs");`, `const pocketWorldProvider = read("server/vessel-feed-proxy/pocketworld-live-ais.mjs");\nconst vesselRegistry = read("server/vessel-feed-proxy/vessel-registry.mjs");`, "registry runtime contract source");
  runtimeContract = replaceOnce(
    runtimeContract,
    `assertIncludes(runtime, "createPocketWorldLiveAisProvider", "public live AIS fallback is not integrated");`,
    `assertIncludes(runtime, "createPocketWorldLiveAisProvider", "public live AIS fallback is not integrated");
assertIncludes(runtime, "createVesselRegistry", "persistent vessel registry is not integrated");
assertIncludes(runtime, 'path === "/api/registry/stats"', "registry statistics endpoint is absent");
assertIncludes(runtime, 'path === "/api/registry/vessels"', "registry list endpoint is absent");
assertIncludes(runtime, "vesselRegistry.observeBatch", "current AIS rows are not persisted into the registry");
assertIncludes(vesselRegistry, "DatabaseSync", "the registry is not backed by SQLite");
assertIncludes(vesselRegistry, "vessel_identity_history", "identity changes are not versioned");
assertIncludes(vesselRegistry, "vessel_latest_positions", "latest movement state is not separated from identity");
assertIncludes(vesselRegistry, "vessel_track_points", "bounded track history is absent");
assertIncludes(vesselRegistry, "vessel_identity_conflicts", "identity conflicts cannot be quarantined");
assertIncludes(vesselRegistry, 'return "archived"', "archived vessel state is absent");`,
    "registry runtime contracts",
  );
  runtimeContract = replaceOnce(
    runtimeContract,
    `assertIncludes(startProd, 'process.env.RUNTIME_DATA_DIR = runningOnRender ? "/var/data"', "Render persistence is not enforced");`,
    `assertIncludes(startProd, 'process.env.RUNTIME_DATA_DIR = runningOnRender ? "/var/data"', "Render persistence is not enforced");
assertIncludes(startProd, 'process.env.VESSEL_REGISTRY_ENABLED = "true"', "production startup does not enable the permanent registry");
assertIncludes(startProd, 'vessel-registry.sqlite', "production startup does not place the registry on persistent storage");`,
    "registry production contracts",
  );
  runtimeContract = replaceOnce(
    runtimeContract,
    `assertIncludes(render, "healthCheckPath: /health/live", "Render liveness endpoint is incorrect");`,
    `assertIncludes(render, "healthCheckPath: /health/live", "Render liveness endpoint is incorrect");
assertIncludes(render, "VESSEL_REGISTRY_DB_FILE\\n        value: /var/data/vessel-registry.sqlite", "Render registry database is not persistent");
assertIncludes(render, "VESSEL_REGISTRY_LAST_KNOWN_AGE_MS\\n        value: 86400000", "Render registry last-known policy is not configured");`,
    "Render registry contracts",
  );
  runtimeContract = replaceOnce(
    runtimeContract,
    `assertIncludes(packageJson, "scripts/smoke-unbounded-global-ais.mjs", "unbounded global AIS smoke test is not part of verification");`,
    `assertIncludes(packageJson, "scripts/smoke-unbounded-global-ais.mjs", "unbounded global AIS smoke test is not part of verification");
assertIncludes(packageJson, "scripts/smoke-vessel-registry.mjs", "persistent vessel registry smoke test is not part of verification");`,
    "registry smoke contract",
  );
  write(runtimeContractPath, runtimeContract);

  const uiContractPath = "scripts/check-live-ui-contract.mjs";
  let uiContract = read(uiContractPath);
  uiContract = replaceOnce(uiContract, `const commandWorkspace = read("src/components/CommandWorkspace.tsx");`, `const commandWorkspace = read("src/components/CommandWorkspace.tsx");\nconst vesselRegistryPanel = read("src/components/VesselRegistryPanel.tsx");\nconst vesselRegistryCss = read("src/vesselRegistry.css");`, "registry UI contract sources");
  uiContract = replaceOnce(
    uiContract,
    `assertIncludes(commandWorkspace, "Command summary", "the lower command summary is absent");`,
    `assertIncludes(commandWorkspace, "Command summary", "the lower command summary is absent");
assertIncludes(commandWorkspace, "Known vessels", "the permanent registry is absent from command metrics");
assertIncludes(vesselRegistryPanel, "Persistent identity and last-known state", "the operator registry workspace is absent");
assertIncludes(vesselRegistryPanel, "/api/registry/vessels", "the registry workspace does not query permanent records");
assertIncludes(vesselRegistryCss, ".vessel-registry-workspace", "the registry workspace layout is absent");`,
    "registry UI contracts",
  );
  uiContract = replaceOnce(uiContract, `assertIncludes(main, 'import "./portalVision.css"', "the professional portal vision is not loaded last");`, `assertIncludes(main, 'import "./portalVision.css"', "the professional portal vision is absent");\nassertIncludes(main, 'import "./vesselRegistry.css"', "the vessel registry styles are not loaded");`, "registry stylesheet contract");
  write(uiContractPath, uiContract);
}

function cleanup() {
  for (const path of [
    "scripts/apply-vessel-registry-integration.mjs",
    ".github/workflows/apply-vessel-registry-integration.yml",
  ]) {
    if (existsSync(path)) rmSync(path);
  }
}

patchRegistryModule();
patchRuntime();
patchProviderNormalizers();
patchFrontendTypesAndProvider();
patchFrontendViews();
patchConfiguration();
patchContracts();
cleanup();
console.log("Persistent vessel registry integration applied.");
