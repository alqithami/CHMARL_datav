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
  return content.slice(0, start) + replacement + content.slice(endStart);
}

function updateRegistry() {
  const path = "server/vessel-feed-proxy/vessel-registry.mjs";
  let source = read(path);

  source = replaceOnce(
    source,
    'import { mkdirSync } from "node:fs";',
    'import { mkdirSync, statSync } from "node:fs";',
    "registry filesystem imports",
  );

  source = replaceOnce(
    source,
    `function serializeJson(value) {
  try { return JSON.stringify(value); }
  catch { return "{}"; }
}
`,
    `function serializeJson(value) {
  try { return JSON.stringify(value); }
  catch { return "{}"; }
}

function fileSize(path) {
  try { return statSync(path).size; }
  catch { return 0; }
}
`,
    "registry storage helper",
  );

  source = replaceOnce(
    source,
    `      listVessels: () => ({ rows: [], total: 0, limit: 0, offset: 0 }),
      getVessel: () => null,`,
    `      listVessels: () => ({ rows: [], total: 0, limit: 0, offset: 0 }),
      listConflicts: () => ({ rows: [], total: 0, limit: 0, offset: 0, status: "open" }),
      getVessel: () => null,`,
    "disabled conflict-list API",
  );

  source = replaceRange(
    source,
    `  function listVessels({ query = "", status = "", limit = 100, offset = 0 } = {}) {`,
    `  function getVessel(uuid) {`,
    `  function listVessels({ query = "", status = "", limit = 100, offset = 0, sort = "latest", direction = "desc" } = {}) {
    const nowMs = now();
    const safeLimit = boundedInteger(limit, 100, 1, 500);
    const safeOffset = boundedInteger(offset, 0, 0, 10_000_000);
    const conditions = [];
    const params = [];
    const normalizedQuery = String(query ?? "").trim();
    if (normalizedQuery) {
      conditions.push("(v.current_name LIKE ? OR v.canonical_imo LIKE ? OR v.current_mmsi LIKE ? OR v.current_call_sign LIKE ?)");
      const pattern = \`%\${normalizedQuery.replace(/[%_]/g, "")}%\`;
      params.push(pattern, pattern, pattern, pattern);
    }
    const statusCondition = statusSql(status, nowMs);
    conditions.push(statusCondition.clause);
    params.push(...statusCondition.params);
    const where = conditions.length ? \`WHERE \${conditions.join(" AND ")}\` : "";
    const sortColumns = {
      latest: "COALESCE(lp.observed_ms, 0)",
      name: "v.current_name COLLATE NOCASE",
      "first-seen": "v.first_seen_at",
      "last-seen": "v.last_seen_at",
      confidence: "v.identity_confidence",
    };
    const safeSort = Object.hasOwn(sortColumns, sort) ? sort : "latest";
    const safeDirection = String(direction).toLowerCase() === "asc" ? "ASC" : "DESC";
    const countRow = database.prepare(\`
      SELECT COUNT(*) AS total FROM vessels v
      LEFT JOIN vessel_latest_positions lp ON lp.vessel_uuid = v.vessel_uuid
      \${where}
    \`).get(...params);
    const rows = database.prepare(\`
      SELECT v.*, lp.latitude, lp.longitude, lp.speed_knots, lp.course_deg, lp.heading_deg,
        lp.navigation_status, lp.destination, lp.eta, lp.observed_at, lp.observed_ms,
        lp.received_at, lp.provider, lp.operational
      FROM vessels v
      LEFT JOIN vessel_latest_positions lp ON lp.vessel_uuid = v.vessel_uuid
      \${where}
      ORDER BY \${sortColumns[safeSort]} \${safeDirection}, v.current_name COLLATE NOCASE ASC
      LIMIT ? OFFSET ?
    \`).all(...params, safeLimit, safeOffset).map((row) => ({
      ...row,
      registryStatus: classifyPosition(Number(row.observed_ms ?? 0), nowMs, thresholds),
      positionAgeMs: row.observed_ms ? Math.max(0, nowMs - Number(row.observed_ms)) : null,
    }));
    return {
      rows,
      total: Number(countRow?.total ?? 0),
      limit: safeLimit,
      offset: safeOffset,
      query: normalizedQuery,
      status: status || "all",
      sort: safeSort,
      direction: safeDirection.toLowerCase(),
    };
  }

  function listConflicts({ status = "open", limit = 100, offset = 0 } = {}) {
    const safeLimit = boundedInteger(limit, 100, 1, 500);
    const safeOffset = boundedInteger(offset, 0, 0, 10_000_000);
    const normalizedStatus = String(status ?? "open").trim().toLowerCase();
    const where = normalizedStatus && normalizedStatus !== "all" ? "WHERE c.resolution_status = ?" : "";
    const params = where ? [normalizedStatus] : [];
    const countRow = database.prepare(\`
      SELECT COUNT(*) AS total FROM vessel_identity_conflicts c \${where}
    \`).get(...params);
    const rows = database.prepare(\`
      SELECT c.*,
        existing.current_name AS existing_vessel_name,
        incoming.current_name AS incoming_vessel_name
      FROM vessel_identity_conflicts c
      LEFT JOIN vessels existing ON existing.vessel_uuid = c.existing_vessel_uuid
      LEFT JOIN vessels incoming ON incoming.vessel_uuid = c.incoming_vessel_uuid
      \${where}
      ORDER BY c.observed_at DESC, c.conflict_id DESC
      LIMIT ? OFFSET ?
    \`).all(...params, safeLimit, safeOffset);
    return {
      rows,
      total: Number(countRow?.total ?? 0),
      limit: safeLimit,
      offset: safeOffset,
      status: normalizedStatus || "all",
    };
  }

  function getVessel(uuid) {`,
    "sortable registry list and conflict queue",
  );

  source = replaceOnce(
    source,
    `    const conflicts = database.prepare("SELECT COUNT(*) AS count FROM vessel_identity_conflicts WHERE resolution_status = 'open'").get();
    const trackPoints = database.prepare("SELECT COUNT(*) AS count FROM vessel_track_points").get();
    const history = database.prepare("SELECT COUNT(*) AS count FROM vessel_identity_history").get();
    return {`,
    `    const conflicts = database.prepare("SELECT COUNT(*) AS count FROM vessel_identity_conflicts WHERE resolution_status = 'open'").get();
    const trackPoints = database.prepare("SELECT COUNT(*) AS count FROM vessel_track_points").get();
    const history = database.prepare("SELECT COUNT(*) AS count FROM vessel_identity_history").get();
    const identifiers = database.prepare("SELECT COUNT(*) AS count FROM vessel_identifiers WHERE active = 1").get();
    const observations = database.prepare("SELECT COUNT(*) AS count FROM vessel_provider_observations").get();
    const databaseBytes = fileSize(dbPath);
    const walBytes = fileSize(\`\${dbPath}-wal\`);
    const shmBytes = fileSize(\`\${dbPath}-shm\`);
    return {`,
    "registry operational statistics",
  );

  source = replaceOnce(
    source,
    `      trackPoints: Number(trackPoints?.count ?? 0),
      identityChanges: Number(history?.count ?? 0),
      storagePolicy: {`,
    `      trackPoints: Number(trackPoints?.count ?? 0),
      identityChanges: Number(history?.count ?? 0),
      activeIdentifiers: Number(identifiers?.count ?? 0),
      providerObservations: Number(observations?.count ?? 0),
      storage: {
        databaseBytes,
        walBytes,
        shmBytes,
        totalBytes: databaseBytes + walBytes + shmBytes,
      },
      storagePolicy: {`,
    "registry storage metrics",
  );

  source = replaceOnce(
    source,
    `      database.exec("PRAGMA wal_checkpoint(PASSIVE)");
      state.lastMaintenanceAt = new Date(nowMs).toISOString();`,
    `      database.exec("PRAGMA wal_checkpoint(PASSIVE)");
      database.exec("PRAGMA optimize");
      state.lastMaintenanceAt = new Date(nowMs).toISOString();`,
    "registry maintenance optimization",
  );

  source = replaceOnce(
    source,
    `    listVessels,
    getVessel,`,
    `    listVessels,
    listConflicts,
    getVessel,`,
    "registry conflict-list export",
  );

  write(path, source);
}

function updateRuntime() {
  const path = "server/vessel-feed-proxy/runtime-v3.mjs";
  let source = read(path);

  source = replaceOnce(
    source,
    `      limit: url.searchParams.get("limit") ?? 100,
      offset: url.searchParams.get("offset") ?? 0,
    }));
  }

  const registryRoute`,
    `      limit: url.searchParams.get("limit") ?? 100,
      offset: url.searchParams.get("offset") ?? 0,
      sort: url.searchParams.get("sort") ?? "latest",
      direction: url.searchParams.get("direction") ?? "desc",
    }));
  }

  if (path === "/api/registry/conflicts") {
    await loadCombinedVessels();
    return sendJson(response, 200, vesselRegistry.listConflicts({
      status: url.searchParams.get("status") ?? "open",
      limit: url.searchParams.get("limit") ?? 100,
      offset: url.searchParams.get("offset") ?? 0,
    }));
  }

  const registryRoute`,
    "registry query and conflict route",
  );

  source = replaceOnce(
    source,
    `"/api/registry/stats", "/api/registry/vessels", "/api/registry/vessels/:vessel_uuid",`,
    `"/api/registry/stats", "/api/registry/vessels", "/api/registry/conflicts", "/api/registry/vessels/:vessel_uuid",`,
    "registry endpoint inventory",
  );

  write(path, source);
}

function updateRegistrySmoke() {
  const path = "scripts/smoke-vessel-registry.mjs";
  let source = read(path);

  source = replaceOnce(
    source,
    `  assert(stats.openIdentityConflicts >= 1, "The conflicting identity report was not recorded");
  assert(stats.trackPoints >= 2, "Track history was not recorded");`,
    `  assert(stats.openIdentityConflicts >= 1, "The conflicting identity report was not recorded");
  const conflictQueue = registry.listConflicts({ status: "open", limit: 10 });
  assert(conflictQueue.total >= 1, "The identity conflict queue is not queryable");
  assert(conflictQueue.rows.some((row) => row.identifier_value === "222222222"), "The MMSI conflict is absent from the operator queue");
  assert(stats.trackPoints >= 2, "Track history was not recorded");`,
    "registry conflict queue smoke assertions",
  );

  source = replaceOnce(
    source,
    `  const track = registry.track(firstUuid, { from: "2025-12-31T00:00:00.000Z", to: "2026-01-02T00:00:00.000Z" });
  assert(track.length >= 2, "The latest and operational movement history was not queryable");
`,
    `  const track = registry.track(firstUuid, { from: "2025-12-31T00:00:00.000Z", to: "2026-01-02T00:00:00.000Z" });
  assert(track.length >= 2, "The latest and operational movement history was not queryable");
  const observations = registry.observations(firstUuid, { limit: 100 });
  assert(observations.length >= 1, "Provider audit observations were not retained");
  const firstPage = registry.listVessels({ sort: "name", direction: "asc", limit: 1, offset: 0 });
  const secondPage = registry.listVessels({ sort: "name", direction: "asc", limit: 1, offset: 1 });
  assert(firstPage.rows.length === 1 && secondPage.rows.length === 1, "Registry pagination did not return stable pages");
  assert(firstPage.rows[0].vessel_uuid !== secondPage.rows[0].vessel_uuid, "Registry pagination repeated the same vessel");
  assert(firstPage.sort === "name" && firstPage.direction === "asc", "Registry sorting metadata was not preserved");
`,
    "registry movement, source, pagination, and sort smoke assertions",
  );

  source = replaceOnce(
    source,
    `  assert(postMaintenance.storagePolicy.permanentVesselRecords === true, "The permanent registry policy is not exposed");
`,
    `  assert(postMaintenance.storagePolicy.permanentVesselRecords === true, "The permanent registry policy is not exposed");
  assert(postMaintenance.activeIdentifiers >= 2, "Active identifier statistics are absent");
  assert(postMaintenance.providerObservations >= 1, "Provider observation statistics are absent");
  assert(postMaintenance.storage?.totalBytes > 0, "Registry storage usage is not exposed");
`,
    "registry storage smoke assertions",
  );

  write(path, source);
}

function updateRuntimeContract() {
  const path = "scripts/check-runtime-contract.mjs";
  let source = read(path);

  source = replaceOnce(
    source,
    `assertIncludes(runtime, 'path === "/api/registry/vessels"', "registry list endpoint is absent");
assertIncludes(runtime, "vesselRegistry.observeBatch",`,
    `assertIncludes(runtime, 'path === "/api/registry/vessels"', "registry list endpoint is absent");
assertIncludes(runtime, 'path === "/api/registry/conflicts"', "registry conflict queue endpoint is absent");
assertIncludes(runtime, 'url.searchParams.get("sort")', "registry sorting is not exposed by the API");
assertIncludes(runtime, "vesselRegistry.observeBatch",`,
    "runtime registry operations contract",
  );

  source = replaceOnce(
    source,
    `assertIncludes(vesselRegistry, "vessel_identity_conflicts", "identity conflicts cannot be quarantined");
assertIncludes(vesselRegistry, 'return "archived"',`,
    `assertIncludes(vesselRegistry, "vessel_identity_conflicts", "identity conflicts cannot be quarantined");
assertIncludes(vesselRegistry, "function listConflicts", "identity conflicts cannot be listed for operator review");
assertIncludes(vesselRegistry, "sortColumns", "registry records cannot be sorted safely");
assertIncludes(vesselRegistry, "databaseBytes", "registry storage usage is not exposed");
assertIncludes(vesselRegistry, 'database.exec("PRAGMA optimize")', "registry maintenance does not optimize SQLite indexes");
assertIncludes(vesselRegistry, 'return "archived"',`,
    "registry backend operations contract",
  );

  write(path, source);
}

function updateUiContract() {
  const path = "scripts/check-live-ui-contract.mjs";
  let source = read(path);

  source = replaceOnce(
    source,
    `assertIncludes(vesselRegistryPanel, "Persistent identity and last-known state", "the operator registry workspace is absent");
assertIncludes(vesselRegistryPanel, "/api/registry/vessels", "the registry workspace does not query permanent records");
assertIncludes(vesselRegistryCss, ".vessel-registry-workspace", "the registry workspace layout is absent");`,
    `assertIncludes(vesselRegistryPanel, "Persistent identity, movement, and source audit", "the operator registry workspace is absent");
assertIncludes(vesselRegistryPanel, "/api/registry/vessels", "the registry workspace does not query permanent records");
assertIncludes(vesselRegistryPanel, "/api/registry/conflicts", "the registry workspace does not expose identity conflicts");
assertIncludes(vesselRegistryPanel, "/track?limit=2000", "the registry workspace does not retrieve movement history");
assertIncludes(vesselRegistryPanel, "/observations?limit=200", "the registry workspace does not retrieve source audit observations");
assertIncludes(vesselRegistryPanel, "Export page", "the registry workspace cannot export the current result page");
assertIncludes(vesselRegistryPanel, "Previous", "the registry workspace lacks pagination");
assertIncludes(vesselRegistryPanel, "Movement", "the registry workspace lacks a movement detail view");
assertIncludes(vesselRegistryPanel, "Sources", "the registry workspace lacks a provider-source detail view");
assertIncludes(vesselRegistryCss, ".vessel-registry-workspace", "the registry workspace layout is absent");
assertIncludes(vesselRegistryCss, ".vessel-registry-pagination", "the registry pagination layout is absent");
assertIncludes(vesselRegistryCss, ".vessel-track-figure", "the retained movement trace is not styled");
assertIncludes(vesselRegistryCss, ".vessel-source-timeline", "the provider source timeline is not styled");`,
    "registry operator UI contract",
  );

  write(path, source);
}

function updateDocumentation() {
  const path = "docs/VESSEL_REGISTRY.md";
  let source = read(path);
  source = replaceOnce(
    source,
    `GET /api/registry/vessels?q=&status=&limit=&offset=
GET /api/registry/vessels/:vessel_uuid`,
    `GET /api/registry/vessels?q=&status=&sort=&direction=&limit=&offset=
GET /api/registry/conflicts?status=&limit=&offset=
GET /api/registry/vessels/:vessel_uuid`,
    "registry API documentation",
  );
  source += `
## Operations workspace

The production registry window supports paginated browsing, state filters, safe server-side sorting, and CSV export of the current result page. Selecting a vessel opens three evidence views:

- **Identity** — canonical specifications, active and historical identifiers, and versioned identity changes;
- **Movement** — retained track statistics, a compact trace, and recent downsampled track points;
- **Sources** — provider audit observations and identity-confidence context.

Open IMO/MMSI conflicts are exposed as a read-only operator review queue. They are never resolved or merged automatically by the interface.

Registry statistics also expose active identifiers, provider audit observations, SQLite database/WAL/shared-memory sizes, storage policy, freshness thresholds, and the last maintenance time. Hourly maintenance checkpoints the WAL, downsamples historical tracks, removes only expired track/provider-observation rows, and runs SQLite index optimization. Permanent vessel identities and identity history are preserved.
`;
  write(path, source);
}

function removeBootstrapFiles() {
  for (const path of [
    "scripts/apply-registry-operations-upgrade.mjs",
    ".github/workflows/apply-registry-operations-upgrade.yml",
  ]) {
    if (existsSync(path)) rmSync(path);
  }
}

updateRegistry();
updateRuntime();
updateRegistrySmoke();
updateRuntimeContract();
updateUiContract();
updateDocumentation();
removeBootstrapFiles();
console.log("Vessel registry operations upgrade applied.");
