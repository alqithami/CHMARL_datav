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

function updateRuntime() {
  const path = "server/vessel-feed-proxy/runtime-v3.mjs";
  let content = read(path);

  content = replaceOnce(
    content,
    `function numberValue(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.trim().replace(/[^0-9.\\-]/g, ""));
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function timestampMs(value) {`,
    `function numberValue(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.trim().replace(/[^0-9.\\-]/g, ""));
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function optionalCountLimit(value) {
  const text = String(value ?? "").trim().toLowerCase();
  if (!text || ["0", "unlimited", "none", "infinity", "inf"].includes(text)) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
}

function timestampMs(value) {`,
    "optional AIS count-limit helper",
  );

  content = replaceOnce(
    content,
    `function validCoordinates(latitude, longitude) {
  return Number.isFinite(latitude)
    && Number.isFinite(longitude)
    && latitude >= -85.051129
    && latitude <= 85.051129
    && longitude >= -180
    && longitude <= 180;
}`,
    `function validCoordinates(latitude, longitude) {
  return Number.isFinite(latitude)
    && Number.isFinite(longitude)
    && latitude >= -90
    && latitude <= 90
    && longitude >= -180
    && longitude <= 180;
}`,
    "full geographic coordinate range",
  );

  content = replaceOnce(
    content,
    `const PRIMARY_PORT_REFERENCE_POINTS = PORT_REFERENCE_POINTS.filter((port) => PRIMARY_PORT_IDS.has(port.id));
const PRIMARY_PORT_BBOX = "20.70,38.35;22.95,39.85";`,
    `const PRIMARY_PORT_REFERENCE_POINTS = PORT_REFERENCE_POINTS.filter((port) => PRIMARY_PORT_IDS.has(port.id));`,
    "unused primary recovery bounding box",
  );

  content = replaceOnce(
    content,
    `const AISSTREAM_RECOVERY_PROFILES = [
  { id: "world-unfiltered", description: "worldwide, all AIS message types", boxes: TRACKING_BOXES, filters: AISSTREAM_FILTER_TYPES },
  { id: "primary-ports-position-only", description: "Jeddah Islamic Port and King Abdullah Port approaches", boxes: parseBoundingBoxes(PRIMARY_PORT_BBOX), filters: AISSTREAM_POSITION_FILTER_TYPES },
  { id: "portfolio-position-only", description: "eight monitored port approaches, position-bearing messages", boxes: OPERATIONAL_BOXES, filters: AISSTREAM_POSITION_FILTER_TYPES },
  { id: "red-sea-gulf-position-only", description: "Red Sea and Gulf, position-bearing messages", boxes: parseBoundingBoxes(REGIONAL_AIS_BBOX), filters: AISSTREAM_POSITION_FILTER_TYPES },
  { id: "world-position-only", description: "worldwide, position-bearing messages", boxes: TRACKING_BOXES, filters: AISSTREAM_POSITION_FILTER_TYPES },
];
const AISSTREAM_MAX_VESSELS = Math.max(100, Number(process.env.AISSTREAM_MAX_VESSELS ?? 8000));
const AISSTREAM_OPERATIONAL_MAX_VESSELS = Math.max(100, Number(process.env.AISSTREAM_OPERATIONAL_MAX_VESSELS ?? 2500));`,
    `const AISSTREAM_RECOVERY_PROFILES = [
  { id: "world-unfiltered", description: "worldwide, all AIS message types", boxes: TRACKING_BOXES, filters: AISSTREAM_FILTER_TYPES },
  { id: "world-position-only", description: "worldwide, position-bearing messages", boxes: TRACKING_BOXES, filters: AISSTREAM_POSITION_FILTER_TYPES },
];
const AISSTREAM_MAX_VESSELS = optionalCountLimit(process.env.AISSTREAM_MAX_VESSELS ?? 0);
const AISSTREAM_OPERATIONAL_MAX_VESSELS = optionalCountLimit(process.env.AISSTREAM_OPERATIONAL_MAX_VESSELS ?? 0);`,
    "worldwide-only AIS recovery and unbounded cache constants",
  );

  content = replaceOnce(
    content,
    `const DATALASTIC_MAX_VESSELS = Math.max(1, Number(process.env.DATALASTIC_MAX_VESSELS ?? 5000));`,
    `const DATALASTIC_MAX_VESSELS = optionalCountLimit(process.env.DATALASTIC_MAX_VESSELS ?? 0);`,
    "unbounded Datalastic count policy",
  );

  content = replaceOnce(
    content,
    `const POCKETWORLD_MAX_VESSELS = Math.max(1, Number(process.env.POCKETWORLD_MAX_VESSELS ?? 5000));
const POCKETWORLD_CACHE_FLUSH_MS = Math.max(5_000, Number(process.env.POCKETWORLD_CACHE_FLUSH_MS ?? 60_000));`,
    `const POCKETWORLD_MAX_VESSELS = optionalCountLimit(process.env.POCKETWORLD_MAX_VESSELS ?? 0);
const POCKETWORLD_MAX_PAGES = Math.min(10_000, Math.max(1, Number(process.env.POCKETWORLD_MAX_PAGES ?? 1_000)));
const POCKETWORLD_CACHE_FLUSH_MS = Math.max(5_000, Number(process.env.POCKETWORLD_CACHE_FLUSH_MS ?? 60_000));`,
    "unbounded PocketWorld aggregate policy",
  );

  content = replaceOnce(
    content,
    `    cachedVessels: 0,
    cacheLimit,
    cacheFile,`,
    `    cachedVessels: 0,
    cacheLimit,
    countLimited: cacheLimit !== null,
    locationFilter: "none",
    discardedByLocation: 0,
    cacheFile,`,
    "AIS state policy diagnostics",
  );

  content = replaceOnce(
    content,
    `  cache.set(update.id, merged);
  while (cache.size > state.cacheLimit) {
    const oldestKey = cache.keys().next().value;
    if (!oldestKey) break;
    cache.delete(oldestKey);
  }
  state.cachedVessels = cache.size;`,
    `  cache.set(update.id, merged);
  if (state.cacheLimit !== null) {
    while (cache.size > state.cacheLimit) {
      const oldestKey = cache.keys().next().value;
      if (!oldestKey) break;
      cache.delete(oldestKey);
    }
  }
  state.cachedVessels = cache.size;`,
    "conditional AIS cache cap",
  );

  content = replaceOnce(
    content,
    `    const payload = JSON.parse(readFileSync(state.cacheFile, "utf8"));
    for (const raw of rowsFrom(payload, ["vessels"]).slice(-state.cacheLimit)) {
      const vessel = normalizeVessel(raw);
      if (vessel && isFresh(vessel)) cache.set(vessel.id, vessel);
    }`,
    `    const payload = JSON.parse(readFileSync(state.cacheFile, "utf8"));
    const cachedRows = rowsFrom(payload, ["vessels"]);
    const rowsToRestore = state.cacheLimit === null ? cachedRows : cachedRows.slice(-state.cacheLimit);
    for (const raw of rowsToRestore) {
      const vessel = normalizeVessel(raw);
      if (vessel && isFresh(vessel)) cache.set(vessel.id, vessel);
    }`,
    "unbounded AIS cache restoration",
  );

  content = replaceOnce(
    content,
    `  maxVessels: POCKETWORLD_MAX_VESSELS,
  cacheFile: POCKETWORLD_CACHE_FILE,`,
    `  maxVessels: POCKETWORLD_MAX_VESSELS,
  maxPages: POCKETWORLD_MAX_PAGES,
  cacheFile: POCKETWORLD_CACHE_FILE,`,
    "PocketWorld page guard configuration",
  );

  content = replaceOnce(
    content,
    `  operationalRows: 0,
  operationalRadiusNm: ECOFAIR_OPERATIONAL_RADIUS_NM,
  lastLoadedAt: null,`,
    `  operationalRows: 0,
  operationalRadiusNm: ECOFAIR_OPERATIONAL_RADIUS_NM,
  countLimited: false,
  locationFilter: "none",
  discardedByLocation: 0,
  countPolicy: "unlimited-by-count; deduplicated by vessel ID; freshness-retained",
  lastLoadedAt: null,`,
    "global vessel input policy state",
  );

  content = replaceOnce(
    content,
    `function pocketWorldFailoverDue(datalasticRows) {
  if (!POCKETWORLD_AIS_ENABLED || datalasticRows > 0) return false;
  const lastPrimaryFrame = timestampMs(trackingAisState.lastFrameAt);
  if (lastPrimaryFrame > 0 && Date.now() - lastPrimaryFrame < AISSTREAM_SILENCE_TIMEOUT_MS) return false;
  const serviceStartedAt = timestampMs(SERVICE_STARTED_AT);
  return serviceStartedAt === 0 || Date.now() - serviceStartedAt >= POCKETWORLD_ACTIVATION_DELAY_MS;
}`,
    `function pocketWorldRefreshDue() {
  if (!POCKETWORLD_AIS_ENABLED) return false;
  const serviceStartedAt = timestampMs(SERVICE_STARTED_AT);
  return serviceStartedAt === 0 || Date.now() - serviceStartedAt >= POCKETWORLD_ACTIVATION_DELAY_MS;
}`,
    "continuous PocketWorld merge policy",
  );

  content = replaceOnce(
    content,
    `    if (pocketWorldFailoverDue(datalasticAis.length)) await pocketWorldProvider.refresh();`,
    `    if (pocketWorldRefreshDue()) await pocketWorldProvider.refresh();`,
    "continuous PocketWorld refresh call",
  );

  content = replaceOnce(
    content,
    `    const merged = new Map();
    for (const row of pocketWorldAis) merged.set(row.id, row);
    for (const row of datalasticAis) merged.set(row.id, row);
    for (const row of trackingAis) merged.set(row.id, row);`,
    `    const merged = new Map();
    const mergeLatest = (row) => {
      const existing = merged.get(row.id);
      if (!existing || timestampMs(row.timestamp) >= timestampMs(existing.timestamp)) {
        merged.set(row.id, { ...existing, ...row });
      }
    };
    for (const row of pocketWorldAis) mergeLatest(row);
    for (const row of datalasticAis) mergeLatest(row);
    for (const row of trackingAis) mergeLatest(row);`,
    "latest-observation multi-provider merge",
  );

  content = replaceOnce(
    content,
    `      rows: vesselInputState.trackingRows,
      maxRows: AISSTREAM_MAX_VESSELS,
    },`,
    `      rows: vesselInputState.trackingRows,
      maxRows: AISSTREAM_MAX_VESSELS,
      countLimited: AISSTREAM_MAX_VESSELS !== null,
      countPolicy: AISSTREAM_MAX_VESSELS === null ? "unlimited-by-count" : "configured-count-limit",
      locationFilter: "none",
      discardedByLocation: 0,
      validLatitudeRange: [-90, 90],
      validLongitudeRange: [-180, 180],
      retentionMs: AISSTREAM_MAX_AGE_MS,
    },`,
    "health tracking policy",
  );

  write(path, content);
}

function updateRuntimeContract() {
  const path = "scripts/check-runtime-contract.mjs";
  let content = read(path);

  content = replaceOnce(content, 'assertIncludes(runtime, "pocketWorldFailoverDue", "silent primary AIS does not activate the public fallback");', 'assertIncludes(runtime, "pocketWorldRefreshDue", "PocketWorld is not continuously merged with other AIS providers");', "PocketWorld runtime contract");
  content = replaceOnce(
    content,
    `assertIncludes(pocketWorldProvider, "PROVIDER_MAX_VESSELS = 50_000", "PocketWorld aggregate fleet limit is below the portal target");
assertIncludes(pocketWorldProvider, "Math.min(PROVIDER_MAX_VESSELS", "PocketWorld aggregate capacity is still capped by the per-request page size");`,
    `assertIncludes(pocketWorldProvider, "optionalCountLimit", "PocketWorld does not support an unlimited aggregate count policy");
assertIncludes(pocketWorldProvider, "countLimited: vesselLimit !== null", "PocketWorld count policy is not exposed");
assertNotIncludes(pocketWorldProvider, "PROVIDER_MAX_VESSELS", "PocketWorld still contains a hard aggregate vessel ceiling");`,
    "PocketWorld unbounded contract assertions",
  );
  content = replaceOnce(content, 'assertIncludes(pocketWorldProvider, "maxVessels = 50_000", "PocketWorld aggregate provider capacity remains below the portal target");', 'assertIncludes(pocketWorldProvider, "maxVessels = 0", "PocketWorld does not default to unlimited aggregate retention");', "PocketWorld default policy assertion");
  content = replaceOnce(content, 'assertIncludes(runtime, \'id: "primary-ports-position-only"\', "AIS recovery does not prioritize the primary ports");', 'assertIncludes(runtime, \'id: "world-position-only"\', "AIS recovery does not preserve worldwide position coverage");\nassertNotIncludes(runtime, \'id: "primary-ports-position-only"\', "tracking recovery can still narrow the subscription by location");\nassertNotIncludes(runtime, \'id: "red-sea-gulf-position-only"\', "tracking recovery can still narrow to a regional subscription");', "global-only recovery contract");
  content = replaceOnce(content, 'assertIncludes(startProd, \'process.env.POCKETWORLD_MAX_VESSELS ??= "50000"\', "production startup still limits PocketWorld to 5000 rows");', 'assertIncludes(startProd, \'process.env.AISSTREAM_MAX_VESSELS = "0"\', "production startup does not remove the AISStream count ceiling");\nassertIncludes(startProd, \'process.env.AISSTREAM_OPERATIONAL_MAX_VESSELS = "0"\', "production startup does not remove the operational cache count ceiling");\nassertIncludes(startProd, \'process.env.DATALASTIC_MAX_VESSELS = "0"\', "production startup does not remove the Datalastic cache ceiling");\nassertIncludes(startProd, \'process.env.POCKETWORLD_MAX_VESSELS = "0"\', "production startup does not remove the PocketWorld aggregate ceiling");', "production unlimited defaults contract");
  content = replaceOnce(content, 'assertIncludes(render, "AISSTREAM_MAX_VESSELS\\n        value: 20000", "Render AIS capacity was reduced");', 'assertIncludes(render, "AISSTREAM_MAX_VESSELS\\n        value: 0", "Render still applies an AISStream vessel-count ceiling");\nassertIncludes(render, "AISSTREAM_OPERATIONAL_MAX_VESSELS\\n        value: 0", "Render still caps the operational AIS cache");', "Render AIS unlimited assertions");
  content = replaceOnce(content, 'assertIncludes(render, "POCKETWORLD_MAX_VESSELS\\n        value: 50000", "Render public AIS capacity remains fixed at 5000");', 'assertIncludes(render, "POCKETWORLD_MAX_VESSELS\\n        value: 0", "Render still applies a PocketWorld aggregate vessel ceiling");\nassertIncludes(render, "POCKETWORLD_MAX_PAGES\\n        value: 1000", "Render does not allow complete provider pagination");\nassertIncludes(render, "DATALASTIC_MAX_VESSELS\\n        value: 0", "Render still caps Datalastic rows");', "Render provider unlimited assertions");
  content = replaceOnce(content, 'assertIncludes(envExample, "POCKETWORLD_MAX_VESSELS=50000", "environment template still caps PocketWorld at 5000");', 'assertIncludes(envExample, "AISSTREAM_MAX_VESSELS=0", "environment template does not document unlimited AISStream retention");\nassertIncludes(envExample, "POCKETWORLD_MAX_VESSELS=0", "environment template does not document unlimited PocketWorld retention");\nassertIncludes(envExample, "DATALASTIC_MAX_VESSELS=0", "environment template does not document unlimited Datalastic retention");', "environment unlimited policy assertions");
  content = replaceOnce(content, 'assertIncludes(packageJson, "scripts/smoke-ais-rate-limit-backoff.mjs", "AIS rate-limit smoke test is not part of verification");', 'assertIncludes(packageJson, "scripts/smoke-ais-rate-limit-backoff.mjs", "AIS rate-limit smoke test is not part of verification");\nassertIncludes(packageJson, "scripts/smoke-unbounded-global-ais.mjs", "unbounded global AIS smoke test is not part of verification");', "unbounded smoke contract");
  content = replaceOnce(content, 'assertNotIncludes(packageJson, "ingest:fixed-vessels", "manual vessel command remains available");', 'assertIncludes(runtime, "optionalCountLimit", "runtime does not support unlimited count policy");\nassertIncludes(runtime, \'locationFilter: "none"\', "runtime does not expose location-filter-free tracking");\nassertIncludes(runtime, "validLatitudeRange: [-90, 90]", "runtime does not expose the full geographic latitude range");\nassertNotIncludes(packageJson, "ingest:fixed-vessels", "manual vessel command remains available");', "runtime policy contract additions");

  write(path, content);
}

function updateAisSmoke() {
  const path = "scripts/smoke-ais-live.mjs";
  let content = read(path);
  content = replaceOnce(content, '  assert(JSON.stringify(recovered?.BoundingBoxes) === JSON.stringify([[[20.70, 38.35], [22.95, 39.85]]]), "First recovery profile did not prioritize Jeddah and King Abdullah Port");', '  assert(JSON.stringify(recovered?.BoundingBoxes) === JSON.stringify([[[-90, -180], [90, 180]]]), "Recovery subscription narrowed the worldwide bounding box");', "global recovery bounding box assertion");
  content = replaceOnce(content, '  assert(vessels.health?.activeProfile === "primary-ports-position-only", "Unexpected recovery profile: " + vessels.health?.activeProfile);', '  assert(vessels.health?.activeProfile === "world-position-only", "Unexpected recovery profile: " + vessels.health?.activeProfile);', "active global recovery profile assertion");
  content = replaceOnce(content, '  assert(vessels.health?.lastSuccessfulProfile === "primary-ports-position-only", "Successful primary-port recovery profile was not recorded");', '  assert(vessels.health?.lastSuccessfulProfile === "world-position-only", "Successful worldwide recovery profile was not recorded");', "successful global recovery profile assertion");
  content = replaceOnce(content, '  console.log("Adaptive live AIS recovery integration smoke test passed.");', '  assert(vessels.health?.countLimited === false && vessels.health?.locationFilter === "none", "AIS recovery did not preserve the unbounded global policy");\n  console.log("Worldwide live AIS recovery integration smoke test passed.");', "AIS recovery smoke completion");
  write(path, content);
}

function updateUiContract() {
  const path = "scripts/check-live-ui-contract.mjs";
  let content = read(path);
  content = replaceOnce(
    content,
    `assertIncludes(stabilizer, "const maxPerGridCell = 50_000", "the frontend still thins a complete PocketWorld fleet");
assertIncludes(stabilizer, "const maxDisplayRows = 50_000", "the frontend display cap is below the provider maximum");`,
    `assertIncludes(stabilizer, "countLimited: false", "the frontend does not expose an unbounded display policy");
assertIncludes(stabilizer, "discardedByLocation: 0", "the frontend does not expose zero geographic discards");
assertIncludes(stabilizer, "latitude >= -90", "the frontend does not accept the complete latitude range");
assertNotIncludes(stabilizer, "maxDisplayRows", "the frontend still contains a hard vessel display ceiling");
assertNotIncludes(stabilizer, "inMiddleEastOperationalCorridor", "the frontend still applies region-specific retention or prioritization");`,
    "frontend unbounded display contract",
  );
  write(path, content);
}

function removeBootstrapFiles() {
  for (const path of ["scripts/apply-unbounded-global-ais.mjs", ".github/workflows/apply-unbounded-global-ais.yml"]) {
    if (existsSync(path)) {
      rmSync(path);
      console.log(`removed ${path}`);
    }
  }
}

updateRuntime();
updateRuntimeContract();
updateAisSmoke();
updateUiContract();
removeBootstrapFiles();
console.log("Unbounded global AIS policy applied.");
