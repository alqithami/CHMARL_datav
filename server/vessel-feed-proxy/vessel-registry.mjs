import { createHash } from "node:crypto";
import { mkdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const SCHEMA_VERSION = 1;
const DEFAULT_LIVE_AGE_MS = 10 * 60_000;
const DEFAULT_DELAYED_AGE_MS = 30 * 60_000;
const DEFAULT_LAST_KNOWN_AGE_MS = 24 * 60 * 60_000;
const DEFAULT_GLOBAL_TRACK_BUCKET_MS = 6 * 60 * 60_000;
const DEFAULT_OPERATIONAL_TRACK_BUCKET_MS = 5 * 60_000;
const DEFAULT_FINE_TRACK_DAYS = 7;
const DEFAULT_GLOBAL_TRACK_RETENTION_DAYS = 90;
const DEFAULT_OPERATIONAL_TRACK_RETENTION_DAYS = 365;
const DAY_MS = 24 * 60 * 60_000;

function numeric(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(/[^0-9.\-]/g, ""));
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function text(value) {
  if (value === undefined || value === null) return undefined;
  const normalized = String(value).trim();
  return normalized ? normalized : undefined;
}

function timestampMs(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value < 10_000_000_000 ? value * 1000 : value;
  const parsed = Date.parse(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function iso(value, fallbackMs) {
  const milliseconds = timestampMs(value) || fallbackMs;
  return new Date(milliseconds).toISOString();
}

function validCoordinates(latitude, longitude) {
  return Number.isFinite(latitude)
    && Number.isFinite(longitude)
    && latitude >= -90
    && latitude <= 90
    && longitude >= -180
    && longitude <= 180;
}

function normalizeMmsi(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  return /^\d{9}$/.test(digits) && digits !== "000000000" ? digits : undefined;
}

function normalizeImo(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!/^\d{7}$/.test(digits) || digits === "0000000") return undefined;
  const checksum = [...digits.slice(0, 6)].reduce((sum, digit, index) => sum + Number(digit) * (7 - index), 0) % 10;
  return checksum === Number(digits[6]) ? digits : undefined;
}

function normalizeCallSign(value) {
  const normalized = text(value)?.toUpperCase().replace(/\s+/g, " ");
  return normalized && normalized !== "N/A" && normalized !== "UNKNOWN" ? normalized : undefined;
}

function genericName(value) {
  const normalized = String(value ?? "").trim().toUpperCase();
  return !normalized || /^MMSI\s*\d+$/.test(normalized) || /^IMO\s*\d+$/.test(normalized) || normalized === "UNKNOWN VESSEL";
}

function stableUuid(key) {
  const hash = createHash("sha256").update(String(key)).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-${((parseInt(hash.slice(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, "0")}${hash.slice(18, 20)}-${hash.slice(20, 32)}`;
}

function providerName(vessel) {
  return text(vessel?.inputSource ?? vessel?.sourceProvider ?? vessel?.provider ?? vessel?.source) ?? "unknown";
}

function sourceId(vessel) {
  return text(vessel?.sourceVesselId ?? vessel?.providerVesselId ?? vessel?.id);
}

function speedKnots(vessel) {
  return numeric(vessel?.sog ?? vessel?.speedKnots ?? vessel?.speed);
}

function shipType(vessel) {
  return text(vessel?.shipType ?? vessel?.vesselType ?? vessel?.typeName ?? vessel?.type_name ?? vessel?.cargo);
}

function currentName(vessel) {
  return text(vessel?.name ?? vessel?.vesselName ?? vessel?.shipName) ?? "Unknown Vessel";
}

function identityPayload(vessel, provider, observedAt) {
  return {
    provider,
    observedAt,
    sourceId: sourceId(vessel),
    imo: normalizeImo(vessel?.imo ?? vessel?.IMO),
    mmsi: normalizeMmsi(vessel?.mmsi ?? vessel?.MMSI),
    name: currentName(vessel),
    callSign: normalizeCallSign(vessel?.callSign ?? vessel?.callsign ?? vessel?.call_sign),
    flag: text(vessel?.flag ?? vessel?.countryCode ?? vessel?.country_code ?? vessel?.country),
    shipType: shipType(vessel),
    lengthM: numeric(vessel?.lengthM ?? vessel?.length_m ?? vessel?.length),
    beamM: numeric(vessel?.beamM ?? vessel?.beam_m ?? vessel?.beam ?? vessel?.width),
    draughtM: numeric(vessel?.draughtM ?? vessel?.draught_m ?? vessel?.draught ?? vessel?.draft),
  };
}

function observationPayload(vessel, nowMs, operational) {
  const provider = providerName(vessel);
  const observedMs = timestampMs(vessel?.timestamp ?? vessel?.observedAt ?? vessel?.updatedAt) || nowMs;
  const latitude = numeric(vessel?.latitude ?? vessel?.lat);
  const longitude = numeric(vessel?.longitude ?? vessel?.lon ?? vessel?.lng);
  return {
    provider,
    observedAt: new Date(observedMs).toISOString(),
    observedMs,
    receivedAt: new Date(nowMs).toISOString(),
    identity: identityPayload(vessel, provider, new Date(observedMs).toISOString()),
    latitude,
    longitude,
    hasPosition: validCoordinates(latitude, longitude),
    speed: speedKnots(vessel),
    course: numeric(vessel?.courseDeg ?? vessel?.course ?? vessel?.cog),
    heading: numeric(vessel?.headingDeg ?? vessel?.heading ?? vessel?.true_heading),
    navigationStatus: text(vessel?.navigationStatus ?? vessel?.navStatus ?? vessel?.nav_status ?? vessel?.status),
    destination: text(vessel?.destination ?? vessel?.destinationPort ?? vessel?.dest ?? vessel?.route),
    eta: text(vessel?.eta ?? vessel?.ETA),
    operational: Boolean(operational),
  };
}

function observationSignature(vessel, operational) {
  return JSON.stringify([
    vessel?.timestamp,
    vessel?.latitude,
    vessel?.longitude,
    vessel?.sog,
    vessel?.speed,
    vessel?.courseDeg,
    vessel?.headingDeg,
    vessel?.status,
    vessel?.imo,
    vessel?.mmsi,
    vessel?.name,
    vessel?.callSign,
    vessel?.flag,
    vessel?.cargo,
    vessel?.lengthM,
    vessel?.beamM,
    vessel?.draughtM,
    Boolean(operational),
  ]);
}

function distanceNm(a, b) {
  if (!validCoordinates(a?.latitude, a?.longitude) || !validCoordinates(b?.latitude, b?.longitude)) return Number.POSITIVE_INFINITY;
  const radiusNm = 3440.065;
  const radians = (value) => value * Math.PI / 180;
  const dLat = radians(b.latitude - a.latitude);
  const dLon = radians(b.longitude - a.longitude);
  const lat1 = radians(a.latitude);
  const lat2 = radians(b.latitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * radiusNm * Math.asin(Math.min(1, Math.sqrt(h)));
}

function classifyPosition(observedMs, nowMs, thresholds) {
  if (!observedMs) return "identity-only";
  const age = Math.max(0, nowMs - observedMs);
  if (age <= thresholds.liveAgeMs) return "live";
  if (age <= thresholds.delayedAgeMs) return "delayed";
  if (age <= thresholds.lastKnownAgeMs) return "last-known";
  return "archived";
}

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.floor(parsed)));
}

function serializeJson(value) {
  try { return JSON.stringify(value); }
  catch { return "{}"; }
}

function fileSize(path) {
  try { return statSync(path).size; }
  catch { return 0; }
}

export function createVesselRegistry({
  enabled = true,
  databaseFile = ".runtime/vessel-registry.sqlite",
  now = Date.now,
  liveAgeMs = DEFAULT_LIVE_AGE_MS,
  delayedAgeMs = DEFAULT_DELAYED_AGE_MS,
  lastKnownAgeMs = DEFAULT_LAST_KNOWN_AGE_MS,
  globalTrackBucketMs = DEFAULT_GLOBAL_TRACK_BUCKET_MS,
  operationalTrackBucketMs = DEFAULT_OPERATIONAL_TRACK_BUCKET_MS,
  fineTrackDays = DEFAULT_FINE_TRACK_DAYS,
  globalTrackRetentionDays = DEFAULT_GLOBAL_TRACK_RETENTION_DAYS,
  operationalTrackRetentionDays = DEFAULT_OPERATIONAL_TRACK_RETENTION_DAYS,
} = {}) {
  const active = Boolean(enabled);
  const dbPath = resolve(databaseFile);
  const thresholds = {
    liveAgeMs: Math.max(60_000, Number(liveAgeMs) || DEFAULT_LIVE_AGE_MS),
    delayedAgeMs: Math.max(60_000, Number(delayedAgeMs) || DEFAULT_DELAYED_AGE_MS),
    lastKnownAgeMs: Math.max(60_000, Number(lastKnownAgeMs) || DEFAULT_LAST_KNOWN_AGE_MS),
  };
  thresholds.delayedAgeMs = Math.max(thresholds.liveAgeMs, thresholds.delayedAgeMs);
  thresholds.lastKnownAgeMs = Math.max(thresholds.delayedAgeMs, thresholds.lastKnownAgeMs);

  const policy = {
    globalTrackBucketMs: Math.max(60_000, Number(globalTrackBucketMs) || DEFAULT_GLOBAL_TRACK_BUCKET_MS),
    operationalTrackBucketMs: Math.max(60_000, Number(operationalTrackBucketMs) || DEFAULT_OPERATIONAL_TRACK_BUCKET_MS),
    fineTrackDays: boundedInteger(fineTrackDays, DEFAULT_FINE_TRACK_DAYS, 1, 90),
    globalTrackRetentionDays: boundedInteger(globalTrackRetentionDays, DEFAULT_GLOBAL_TRACK_RETENTION_DAYS, 7, 3650),
    operationalTrackRetentionDays: boundedInteger(operationalTrackRetentionDays, DEFAULT_OPERATIONAL_TRACK_RETENTION_DAYS, 30, 3650),
  };

  const state = {
    enabled: active,
    databaseFile: active ? dbPath : null,
    schemaVersion: SCHEMA_VERSION,
    status: active ? "initializing" : "disabled",
    lastIngestAt: null,
    lastMaintenanceAt: null,
    lastError: null,
    observedRows: 0,
    changedRows: 0,
    skippedUnchangedRows: 0,
    identityConflicts: 0,
  };

  if (!active) {
    const disabled = () => ({ ...state, storagePolicy: { ...policy }, freshness: { ...thresholds } });
    return {
      observeBatch: (rows) => rows,
      stats: disabled,
      listVessels: () => ({ rows: [], total: 0, limit: 0, offset: 0 }),
      listConflicts: () => ({ rows: [], total: 0, limit: 0, offset: 0, status: "open" }),
      getVessel: () => null,
      identityHistory: () => [],
      track: () => [],
      observations: () => [],
      maintenance: () => disabled(),
      publicState: disabled,
      close: () => {},
    };
  }

  mkdirSync(dirname(dbPath), { recursive: true });
  const database = new DatabaseSync(dbPath);
  database.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
  database.exec(`
    CREATE TABLE IF NOT EXISTS vessels (
      vessel_uuid TEXT PRIMARY KEY,
      canonical_imo TEXT,
      current_mmsi TEXT,
      current_name TEXT NOT NULL,
      current_call_sign TEXT,
      current_flag TEXT,
      ship_type TEXT,
      length_m REAL,
      beam_m REAL,
      draught_m REAL,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      identity_confidence REAL NOT NULL,
      verified_status TEXT NOT NULL,
      preferred_source TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;
    CREATE UNIQUE INDEX IF NOT EXISTS vessels_imo_unique ON vessels(canonical_imo) WHERE canonical_imo IS NOT NULL;
    CREATE INDEX IF NOT EXISTS vessels_mmsi_index ON vessels(current_mmsi);
    CREATE INDEX IF NOT EXISTS vessels_name_index ON vessels(current_name);

    CREATE TABLE IF NOT EXISTS vessel_identifiers (
      identifier_id INTEGER PRIMARY KEY AUTOINCREMENT,
      vessel_uuid TEXT NOT NULL REFERENCES vessels(vessel_uuid) ON DELETE CASCADE,
      identifier_type TEXT NOT NULL,
      identifier_value TEXT NOT NULL,
      valid_from TEXT NOT NULL,
      valid_to TEXT,
      last_observed_at TEXT NOT NULL,
      source TEXT,
      confidence REAL NOT NULL,
      active INTEGER NOT NULL CHECK(active IN (0, 1))
    ) STRICT;
    CREATE UNIQUE INDEX IF NOT EXISTS vessel_identifier_active_unique
      ON vessel_identifiers(identifier_type, identifier_value) WHERE active = 1;
    CREATE INDEX IF NOT EXISTS vessel_identifier_vessel_index ON vessel_identifiers(vessel_uuid, active);

    CREATE TABLE IF NOT EXISTS vessel_identity_history (
      history_id INTEGER PRIMARY KEY AUTOINCREMENT,
      vessel_uuid TEXT NOT NULL REFERENCES vessels(vessel_uuid) ON DELETE CASCADE,
      attribute TEXT NOT NULL,
      old_value TEXT,
      new_value TEXT,
      valid_from TEXT NOT NULL,
      observed_at TEXT NOT NULL,
      source TEXT,
      confidence REAL NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS vessel_history_vessel_index ON vessel_identity_history(vessel_uuid, observed_at DESC);

    CREATE TABLE IF NOT EXISTS vessel_identity_conflicts (
      conflict_id INTEGER PRIMARY KEY AUTOINCREMENT,
      identifier_type TEXT NOT NULL,
      identifier_value TEXT NOT NULL,
      existing_vessel_uuid TEXT,
      incoming_vessel_uuid TEXT,
      incoming_imo TEXT,
      incoming_mmsi TEXT,
      observed_at TEXT NOT NULL,
      source TEXT,
      resolution_status TEXT NOT NULL DEFAULT 'open',
      details_json TEXT
    ) STRICT;
    CREATE INDEX IF NOT EXISTS vessel_conflict_status_index ON vessel_identity_conflicts(resolution_status, observed_at DESC);

    CREATE TABLE IF NOT EXISTS vessel_latest_positions (
      vessel_uuid TEXT PRIMARY KEY REFERENCES vessels(vessel_uuid) ON DELETE CASCADE,
      mmsi TEXT,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      speed_knots REAL,
      course_deg REAL,
      heading_deg REAL,
      navigation_status TEXT,
      destination TEXT,
      eta TEXT,
      observed_at TEXT NOT NULL,
      observed_ms INTEGER NOT NULL,
      received_at TEXT NOT NULL,
      provider TEXT NOT NULL,
      operational INTEGER NOT NULL CHECK(operational IN (0, 1))
    ) STRICT;
    CREATE INDEX IF NOT EXISTS vessel_latest_observed_index ON vessel_latest_positions(observed_ms DESC);

    CREATE TABLE IF NOT EXISTS vessel_track_points (
      track_id INTEGER PRIMARY KEY AUTOINCREMENT,
      vessel_uuid TEXT NOT NULL REFERENCES vessels(vessel_uuid) ON DELETE CASCADE,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      speed_knots REAL,
      course_deg REAL,
      heading_deg REAL,
      navigation_status TEXT,
      observed_at TEXT NOT NULL,
      observed_ms INTEGER NOT NULL,
      received_at TEXT NOT NULL,
      provider TEXT NOT NULL,
      operational INTEGER NOT NULL CHECK(operational IN (0, 1)),
      resolution_seconds INTEGER NOT NULL,
      bucket_start_ms INTEGER NOT NULL,
      UNIQUE(vessel_uuid, bucket_start_ms, resolution_seconds)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS vessel_track_vessel_index ON vessel_track_points(vessel_uuid, observed_ms DESC);
    CREATE INDEX IF NOT EXISTS vessel_track_age_index ON vessel_track_points(observed_ms, operational, resolution_seconds);

    CREATE TABLE IF NOT EXISTS vessel_provider_observations (
      observation_id INTEGER PRIMARY KEY AUTOINCREMENT,
      vessel_uuid TEXT NOT NULL REFERENCES vessels(vessel_uuid) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      observation_kind TEXT NOT NULL,
      observation_hash TEXT NOT NULL UNIQUE,
      observed_at TEXT NOT NULL,
      payload_json TEXT NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS vessel_observation_vessel_index ON vessel_provider_observations(vessel_uuid, observed_at DESC);

    PRAGMA user_version = ${SCHEMA_VERSION};
  `);

  const statements = {
    vesselByUuid: database.prepare("SELECT * FROM vessels WHERE vessel_uuid = ?"),
    vesselByImo: database.prepare("SELECT vessel_uuid FROM vessel_identifiers WHERE identifier_type = 'imo' AND identifier_value = ? AND active = 1 LIMIT 1"),
    vesselByMmsi: database.prepare("SELECT vessel_uuid FROM vessel_identifiers WHERE identifier_type = 'mmsi' AND identifier_value = ? AND active = 1 LIMIT 1"),
    vesselByProviderId: database.prepare("SELECT vessel_uuid FROM vessel_identifiers WHERE identifier_type = 'provider_id' AND identifier_value = ? AND active = 1 LIMIT 1"),
    insertVessel: database.prepare(`
      INSERT OR IGNORE INTO vessels (
        vessel_uuid, canonical_imo, current_mmsi, current_name, current_call_sign, current_flag,
        ship_type, length_m, beam_m, draught_m, first_seen_at, last_seen_at,
        identity_confidence, verified_status, preferred_source, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    updateVessel: database.prepare(`
      UPDATE vessels SET canonical_imo = ?, current_mmsi = ?, current_name = ?, current_call_sign = ?,
        current_flag = ?, ship_type = ?, length_m = ?, beam_m = ?, draught_m = ?, last_seen_at = ?,
        identity_confidence = ?, verified_status = ?, preferred_source = ?, updated_at = ?
      WHERE vessel_uuid = ?
    `),
    insertIdentifier: database.prepare(`
      INSERT OR IGNORE INTO vessel_identifiers (
        vessel_uuid, identifier_type, identifier_value, valid_from, valid_to,
        last_observed_at, source, confidence, active
      ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, 1)
    `),
    touchIdentifier: database.prepare(`
      UPDATE vessel_identifiers SET last_observed_at = ?, source = COALESCE(?, source), confidence = MAX(confidence, ?)
      WHERE vessel_uuid = ? AND identifier_type = ? AND identifier_value = ? AND active = 1
    `),
    activeMmsiForVessel: database.prepare(`
      SELECT identifier_value FROM vessel_identifiers
      WHERE vessel_uuid = ? AND identifier_type = 'mmsi' AND active = 1 AND identifier_value <> ?
    `),
    closeOtherMmsi: database.prepare(`
      UPDATE vessel_identifiers SET active = 0, valid_to = ?
      WHERE vessel_uuid = ? AND identifier_type = 'mmsi' AND active = 1 AND identifier_value <> ?
    `),
    insertHistory: database.prepare(`
      INSERT INTO vessel_identity_history (
        vessel_uuid, attribute, old_value, new_value, valid_from, observed_at, source, confidence
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `),
    insertConflict: database.prepare(`
      INSERT INTO vessel_identity_conflicts (
        identifier_type, identifier_value, existing_vessel_uuid, incoming_vessel_uuid,
        incoming_imo, incoming_mmsi, observed_at, source, details_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    latestByUuid: database.prepare("SELECT * FROM vessel_latest_positions WHERE vessel_uuid = ?"),
    upsertLatest: database.prepare(`
      INSERT INTO vessel_latest_positions (
        vessel_uuid, mmsi, latitude, longitude, speed_knots, course_deg, heading_deg,
        navigation_status, destination, eta, observed_at, observed_ms, received_at, provider, operational
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(vessel_uuid) DO UPDATE SET
        mmsi = excluded.mmsi,
        latitude = excluded.latitude,
        longitude = excluded.longitude,
        speed_knots = excluded.speed_knots,
        course_deg = excluded.course_deg,
        heading_deg = excluded.heading_deg,
        navigation_status = excluded.navigation_status,
        destination = excluded.destination,
        eta = excluded.eta,
        observed_at = excluded.observed_at,
        observed_ms = excluded.observed_ms,
        received_at = excluded.received_at,
        provider = excluded.provider,
        operational = excluded.operational
      WHERE excluded.observed_ms >= vessel_latest_positions.observed_ms
    `),
    upsertTrack: database.prepare(`
      INSERT INTO vessel_track_points (
        vessel_uuid, latitude, longitude, speed_knots, course_deg, heading_deg,
        navigation_status, observed_at, observed_ms, received_at, provider,
        operational, resolution_seconds, bucket_start_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(vessel_uuid, bucket_start_ms, resolution_seconds) DO UPDATE SET
        latitude = excluded.latitude,
        longitude = excluded.longitude,
        speed_knots = excluded.speed_knots,
        course_deg = excluded.course_deg,
        heading_deg = excluded.heading_deg,
        navigation_status = excluded.navigation_status,
        observed_at = excluded.observed_at,
        observed_ms = excluded.observed_ms,
        received_at = excluded.received_at,
        provider = excluded.provider,
        operational = MAX(vessel_track_points.operational, excluded.operational)
      WHERE excluded.observed_ms >= vessel_track_points.observed_ms
    `),
    insertObservation: database.prepare(`
      INSERT OR IGNORE INTO vessel_provider_observations (
        vessel_uuid, provider, observation_kind, observation_hash, observed_at, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?)
    `),
  };

  const identifierCache = new Map();
  const vesselCache = new Map();
  const latestCache = new Map();
  const sourceSignatureCache = new Map();

  for (const row of database.prepare("SELECT identifier_type, identifier_value, vessel_uuid FROM vessel_identifiers WHERE active = 1").all()) {
    identifierCache.set(`${row.identifier_type}:${row.identifier_value}`, row.vessel_uuid);
  }
  for (const row of database.prepare("SELECT * FROM vessels").all()) vesselCache.set(row.vessel_uuid, row);
  for (const row of database.prepare("SELECT * FROM vessel_latest_positions").all()) latestCache.set(row.vessel_uuid, row);
  state.status = "ready";

  function identifierUuid(type, value) {
    if (!value) return undefined;
    const key = `${type}:${value}`;
    if (identifierCache.has(key)) return identifierCache.get(key);
    const statement = type === "imo" ? statements.vesselByImo : type === "mmsi" ? statements.vesselByMmsi : statements.vesselByProviderId;
    const row = statement.get(value);
    if (row?.vessel_uuid) identifierCache.set(key, row.vessel_uuid);
    return row?.vessel_uuid;
  }

  function ensureVessel(uuid, identity, observedAt) {
    if (vesselCache.has(uuid)) return vesselCache.get(uuid);
    const confidence = identity.imo ? 1 : identity.mmsi ? 0.75 : 0.5;
    const verifiedStatus = identity.imo ? "imo-anchored" : identity.mmsi ? "mmsi-anchored" : "provider-anchored";
    statements.insertVessel.run(
      uuid,
      identity.imo ?? null,
      identity.mmsi ?? null,
      identity.name,
      identity.callSign ?? null,
      identity.flag ?? null,
      identity.shipType ?? null,
      identity.lengthM ?? null,
      identity.beamM ?? null,
      identity.draughtM ?? null,
      observedAt,
      observedAt,
      confidence,
      verifiedStatus,
      identity.provider,
      observedAt,
      observedAt,
    );
    const row = statements.vesselByUuid.get(uuid);
    vesselCache.set(uuid, row);
    return row;
  }

  function recordConflict(type, value, existingUuid, incomingUuid, identity, details) {
    const observedAt = identity.observedAt;
    statements.insertConflict.run(
      type,
      value,
      existingUuid ?? null,
      incomingUuid ?? null,
      identity.imo ?? null,
      identity.mmsi ?? null,
      observedAt,
      identity.provider,
      serializeJson(details),
    );
    state.identityConflicts += 1;
  }

  function resolveUuid(identity) {
    const providerIdentifier = identity.sourceId ? `${identity.provider}:${identity.sourceId}` : undefined;
    const imoUuid = identifierUuid("imo", identity.imo);
    const mmsiUuid = identifierUuid("mmsi", identity.mmsi);
    const providerUuid = identifierUuid("provider_id", providerIdentifier);

    if (imoUuid && mmsiUuid && imoUuid !== mmsiUuid) {
      recordConflict("mmsi", identity.mmsi, mmsiUuid, imoUuid, identity, { reason: "reported MMSI is active on a different IMO-anchored vessel" });
      return imoUuid;
    }
    if (imoUuid) return imoUuid;

    if (mmsiUuid) {
      const existing = vesselCache.get(mmsiUuid) ?? statements.vesselByUuid.get(mmsiUuid);
      if (identity.imo && existing?.canonical_imo && existing.canonical_imo !== identity.imo) {
        const incomingUuid = stableUuid(`imo:${identity.imo}`);
        ensureVessel(incomingUuid, identity, identity.observedAt);
        recordConflict("mmsi", identity.mmsi, mmsiUuid, incomingUuid, identity, { reason: "same MMSI reported a different valid IMO" });
        return incomingUuid;
      }
      return mmsiUuid;
    }
    if (providerUuid) return providerUuid;
    if (identity.imo) return stableUuid(`imo:${identity.imo}`);
    if (identity.mmsi) return stableUuid(`mmsi:${identity.mmsi}`);
    return stableUuid(`provider:${identity.provider}:${identity.sourceId ?? identity.name}`);
  }

  function ensureIdentifier(uuid, type, value, identity, confidence) {
    if (!value) return;
    const key = `${type}:${value}`;
    const existingUuid = identifierUuid(type, value);
    if (existingUuid && existingUuid !== uuid) {
      recordConflict(type, value, existingUuid, uuid, identity, { reason: "identifier is already active on another vessel" });
      return;
    }
    if (type === "mmsi" && identity.imo) {
      const formerMmsi = statements.activeMmsiForVessel.all(uuid, value);
      statements.closeOtherMmsi.run(identity.observedAt, uuid, value);
      for (const row of formerMmsi) identifierCache.delete(`mmsi:${row.identifier_value}`);
    }
    statements.insertIdentifier.run(uuid, type, value, identity.observedAt, identity.observedAt, identity.provider, confidence);
    statements.touchIdentifier.run(identity.observedAt, identity.provider, confidence, uuid, type, value);
    identifierCache.set(key, uuid);
  }

  function updateIdentity(uuid, identity, recordInitial = false) {
    const existing = vesselCache.get(uuid) ?? statements.vesselByUuid.get(uuid);
    const confidence = identity.imo ? 1 : identity.mmsi ? 0.75 : 0.5;
    const changes = [];
    const choose = (attribute, oldValue, incomingValue, options = {}) => {
      if (incomingValue === undefined || incomingValue === null || incomingValue === "") return oldValue;
      if (options.preserveSpecificName && genericName(incomingValue) && !genericName(oldValue)) return oldValue;
      if (String(oldValue ?? "") !== String(incomingValue)) changes.push([attribute, oldValue, incomingValue]);
      return incomingValue;
    };

    const next = {
      canonicalImo: choose("imo", existing?.canonical_imo, identity.imo),
      currentMmsi: choose("mmsi", existing?.current_mmsi, identity.mmsi),
      currentName: choose("name", existing?.current_name, identity.name, { preserveSpecificName: true }) ?? "Unknown Vessel",
      currentCallSign: choose("call_sign", existing?.current_call_sign, identity.callSign),
      currentFlag: choose("flag", existing?.current_flag, identity.flag),
      shipType: choose("ship_type", existing?.ship_type, identity.shipType),
      lengthM: choose("length_m", existing?.length_m, identity.lengthM),
      beamM: choose("beam_m", existing?.beam_m, identity.beamM),
      draughtM: choose("draught_m", existing?.draught_m, identity.draughtM),
    };

    for (const [attribute, oldValue, newValue] of changes) {
      statements.insertHistory.run(uuid, attribute, oldValue === undefined ? null : String(oldValue), newValue === undefined ? null : String(newValue), identity.observedAt, identity.observedAt, identity.provider, confidence);
    }

    const verifiedStatus = next.canonicalImo ? "imo-anchored" : next.currentMmsi ? "mmsi-anchored" : "provider-anchored";
    statements.updateVessel.run(
      next.canonicalImo ?? null,
      next.currentMmsi ?? null,
      next.currentName,
      next.currentCallSign ?? null,
      next.currentFlag ?? null,
      next.shipType ?? null,
      next.lengthM ?? null,
      next.beamM ?? null,
      next.draughtM ?? null,
      identity.observedAt,
      Math.max(Number(existing?.identity_confidence ?? 0), confidence),
      verifiedStatus,
      identity.provider,
      identity.observedAt,
      uuid,
    );

    ensureIdentifier(uuid, "imo", identity.imo, identity, 1);
    ensureIdentifier(uuid, "mmsi", identity.mmsi, identity, 0.75);
    if (identity.sourceId) ensureIdentifier(uuid, "provider_id", `${identity.provider}:${identity.sourceId}`, identity, 0.5);

    const row = statements.vesselByUuid.get(uuid);
    vesselCache.set(uuid, row);

    if (changes.length > 0 || recordInitial) {
      const observationHash = createHash("sha256").update(`${uuid}|${identity.provider}|${serializeJson(identity)}`).digest("hex");
      statements.insertObservation.run(uuid, identity.provider, "identity", observationHash, identity.observedAt, serializeJson(identity));
    }
    return row;
  }

  function updatePosition(uuid, observation) {
    if (!observation.hasPosition) return;
    const existing = latestCache.get(uuid) ?? statements.latestByUuid.get(uuid);
    if (existing && Number(existing.observed_ms) > observation.observedMs) return;

    statements.upsertLatest.run(
      uuid,
      observation.identity.mmsi ?? null,
      observation.latitude,
      observation.longitude,
      observation.speed ?? null,
      observation.course ?? null,
      observation.heading ?? null,
      observation.navigationStatus ?? null,
      observation.destination ?? null,
      observation.eta ?? null,
      observation.observedAt,
      observation.observedMs,
      observation.receivedAt,
      observation.provider,
      observation.operational ? 1 : 0,
    );
    const latest = statements.latestByUuid.get(uuid);
    latestCache.set(uuid, latest);

    const bucketMs = observation.operational ? policy.operationalTrackBucketMs : policy.globalTrackBucketMs;
    const resolutionSeconds = Math.round(bucketMs / 1000);
    const bucketStartMs = Math.floor(observation.observedMs / bucketMs) * bucketMs;
    const movedNm = existing ? distanceNm(existing, observation) : Number.POSITIVE_INFINITY;
    const bucketChanged = !existing || Math.floor(Number(existing.observed_ms) / bucketMs) * bucketMs !== bucketStartMs;
    if (bucketChanged || movedNm >= 1 || Boolean(existing?.operational) !== observation.operational) {
      statements.upsertTrack.run(
        uuid,
        observation.latitude,
        observation.longitude,
        observation.speed ?? null,
        observation.course ?? null,
        observation.heading ?? null,
        observation.navigationStatus ?? null,
        observation.observedAt,
        observation.observedMs,
        observation.receivedAt,
        observation.provider,
        observation.operational ? 1 : 0,
        resolutionSeconds,
        bucketStartMs,
      );
    }
  }

  function registryStatusFor(uuid, nowMs = now()) {
    const latest = latestCache.get(uuid) ?? statements.latestByUuid.get(uuid);
    return classifyPosition(Number(latest?.observed_ms ?? 0), nowMs, thresholds);
  }

  function enrichVessel(vessel, uuid, nowMs = now()) {
    const record = vesselCache.get(uuid);
    return {
      ...vessel,
      vesselUuid: uuid,
      imo: record?.canonical_imo ?? normalizeImo(vessel?.imo),
      mmsi: record?.current_mmsi ?? normalizeMmsi(vessel?.mmsi),
      callSign: record?.current_call_sign ?? normalizeCallSign(vessel?.callSign),
      flag: record?.current_flag ?? text(vessel?.flag),
      shipType: record?.ship_type ?? shipType(vessel),
      lengthM: record?.length_m ?? numeric(vessel?.lengthM),
      beamM: record?.beam_m ?? numeric(vessel?.beamM),
      draughtM: record?.draught_m ?? numeric(vessel?.draughtM),
      registryStatus: registryStatusFor(uuid, nowMs),
      identityConfidence: Number(record?.identity_confidence ?? 0.5),
      verifiedStatus: record?.verified_status ?? "provider-anchored",
    };
  }

  function observeBatch(rows, { operationalIds = new Set() } = {}) {
    if (!Array.isArray(rows) || rows.length === 0) return [];
    const nowMs = now();
    const changed = [];
    const resolved = new Map();

    for (const vessel of rows) {
      const provider = providerName(vessel);
      const sourceKey = `${provider}:${sourceId(vessel) ?? vessel?.id ?? vessel?.name}`;
      const operational = operationalIds.has(vessel?.id) || operationalIds.has(vessel?.vesselUuid);
      const signature = observationSignature(vessel, operational);
      state.observedRows += 1;
      if (sourceSignatureCache.get(sourceKey) === signature) {
        state.skippedUnchangedRows += 1;
        const identity = identityPayload(vessel, provider, iso(vessel?.timestamp, nowMs));
        const uuid = identifierUuid("imo", identity.imo)
          ?? identifierUuid("mmsi", identity.mmsi)
          ?? (identity.sourceId ? identifierUuid("provider_id", `${provider}:${identity.sourceId}`) : undefined);
        if (uuid) resolved.set(vessel, uuid);
        continue;
      }
      sourceSignatureCache.set(sourceKey, signature);
      changed.push({ vessel, operational });
    }

    if (changed.length > 0) {
      database.exec("BEGIN IMMEDIATE");
      try {
        for (const { vessel, operational } of changed) {
          const observation = observationPayload(vessel, nowMs, operational);
          const uuid = resolveUuid(observation.identity);
          const wasKnown = vesselCache.has(uuid);
          ensureVessel(uuid, observation.identity, observation.observedAt);
          updateIdentity(uuid, observation.identity, !wasKnown);
          updatePosition(uuid, observation);
          resolved.set(vessel, uuid);
          state.changedRows += 1;
        }
        database.exec("COMMIT");
        state.lastIngestAt = new Date(nowMs).toISOString();
        state.lastError = null;
      } catch (error) {
        try { database.exec("ROLLBACK"); } catch {}
        state.lastError = error instanceof Error ? error.message : String(error);
        throw error;
      }
    }

    return rows.map((vessel) => {
      let uuid = resolved.get(vessel);
      if (!uuid) {
        const identity = identityPayload(vessel, providerName(vessel), iso(vessel?.timestamp, nowMs));
        uuid = identifierUuid("imo", identity.imo)
          ?? identifierUuid("mmsi", identity.mmsi)
          ?? (identity.sourceId ? identifierUuid("provider_id", `${identity.provider}:${identity.sourceId}`) : undefined)
          ?? stableUuid(`provider:${identity.provider}:${identity.sourceId ?? identity.name}`);
      }
      return enrichVessel(vessel, uuid, nowMs);
    });
  }

  function statusSql(status, nowMs) {
    if (status === "live") return { clause: "lp.observed_ms >= ?", params: [nowMs - thresholds.liveAgeMs] };
    if (status === "delayed") return { clause: "lp.observed_ms < ? AND lp.observed_ms >= ?", params: [nowMs - thresholds.liveAgeMs, nowMs - thresholds.delayedAgeMs] };
    if (status === "last-known") return { clause: "lp.observed_ms < ? AND lp.observed_ms >= ?", params: [nowMs - thresholds.delayedAgeMs, nowMs - thresholds.lastKnownAgeMs] };
    if (status === "archived") return { clause: "lp.observed_ms < ?", params: [nowMs - thresholds.lastKnownAgeMs] };
    if (status === "identity-only") return { clause: "lp.vessel_uuid IS NULL", params: [] };
    return { clause: "1 = 1", params: [] };
  }

  function listVessels({ query = "", status = "", limit = 100, offset = 0, sort = "latest", direction = "desc" } = {}) {
    const nowMs = now();
    const safeLimit = boundedInteger(limit, 100, 1, 500);
    const safeOffset = boundedInteger(offset, 0, 0, 10_000_000);
    const conditions = [];
    const params = [];
    const normalizedQuery = String(query ?? "").trim();
    if (normalizedQuery) {
      conditions.push("(v.current_name LIKE ? OR v.canonical_imo LIKE ? OR v.current_mmsi LIKE ? OR v.current_call_sign LIKE ?)");
      const pattern = `%${normalizedQuery.replace(/[%_]/g, "")}%`;
      params.push(pattern, pattern, pattern, pattern);
    }
    const statusCondition = statusSql(status, nowMs);
    conditions.push(statusCondition.clause);
    params.push(...statusCondition.params);
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const sortColumns = {
      latest: "COALESCE(lp.observed_ms, 0)",
      name: "v.current_name COLLATE NOCASE",
      "first-seen": "v.first_seen_at",
      "last-seen": "v.last_seen_at",
      confidence: "v.identity_confidence",
    };
    const safeSort = Object.hasOwn(sortColumns, sort) ? sort : "latest";
    const safeDirection = String(direction).toLowerCase() === "asc" ? "ASC" : "DESC";
    const countRow = database.prepare(`
      SELECT COUNT(*) AS total FROM vessels v
      LEFT JOIN vessel_latest_positions lp ON lp.vessel_uuid = v.vessel_uuid
      ${where}
    `).get(...params);
    const rows = database.prepare(`
      SELECT v.*, lp.latitude, lp.longitude, lp.speed_knots, lp.course_deg, lp.heading_deg,
        lp.navigation_status, lp.destination, lp.eta, lp.observed_at, lp.observed_ms,
        lp.received_at, lp.provider, lp.operational
      FROM vessels v
      LEFT JOIN vessel_latest_positions lp ON lp.vessel_uuid = v.vessel_uuid
      ${where}
      ORDER BY ${sortColumns[safeSort]} ${safeDirection}, v.current_name COLLATE NOCASE ASC
      LIMIT ? OFFSET ?
    `).all(...params, safeLimit, safeOffset).map((row) => ({
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
    const countRow = database.prepare(`
      SELECT COUNT(*) AS total FROM vessel_identity_conflicts c ${where}
    `).get(...params);
    const rows = database.prepare(`
      SELECT c.*,
        existing.current_name AS existing_vessel_name,
        incoming.current_name AS incoming_vessel_name
      FROM vessel_identity_conflicts c
      LEFT JOIN vessels existing ON existing.vessel_uuid = c.existing_vessel_uuid
      LEFT JOIN vessels incoming ON incoming.vessel_uuid = c.incoming_vessel_uuid
      ${where}
      ORDER BY c.observed_at DESC, c.conflict_id DESC
      LIMIT ? OFFSET ?
    `).all(...params, safeLimit, safeOffset);
    return {
      rows,
      total: Number(countRow?.total ?? 0),
      limit: safeLimit,
      offset: safeOffset,
      status: normalizedStatus || "all",
    };
  }

  function getVessel(uuid) {
    const row = database.prepare(`
      SELECT v.*, lp.latitude, lp.longitude, lp.speed_knots, lp.course_deg, lp.heading_deg,
        lp.navigation_status, lp.destination, lp.eta, lp.observed_at, lp.observed_ms,
        lp.received_at, lp.provider, lp.operational
      FROM vessels v
      LEFT JOIN vessel_latest_positions lp ON lp.vessel_uuid = v.vessel_uuid
      WHERE v.vessel_uuid = ?
    `).get(uuid);
    if (!row) return null;
    return {
      ...row,
      registryStatus: classifyPosition(Number(row.observed_ms ?? 0), now(), thresholds),
      identifiers: database.prepare("SELECT * FROM vessel_identifiers WHERE vessel_uuid = ? ORDER BY active DESC, identifier_type, valid_from DESC").all(uuid),
    };
  }

  function identityHistory(uuid, { limit = 200 } = {}) {
    return database.prepare("SELECT * FROM vessel_identity_history WHERE vessel_uuid = ? ORDER BY observed_at DESC LIMIT ?").all(uuid, boundedInteger(limit, 200, 1, 1000));
  }

  function track(uuid, { from, to, limit = 2000 } = {}) {
    const endMs = timestampMs(to) || now();
    const startMs = timestampMs(from) || endMs - 7 * DAY_MS;
    return database.prepare(`
      SELECT * FROM vessel_track_points
      WHERE vessel_uuid = ? AND observed_ms BETWEEN ? AND ?
      ORDER BY observed_ms ASC LIMIT ?
    `).all(uuid, startMs, endMs, boundedInteger(limit, 2000, 1, 10_000));
  }

  function observations(uuid, { limit = 100 } = {}) {
    return database.prepare("SELECT * FROM vessel_provider_observations WHERE vessel_uuid = ? ORDER BY observed_at DESC LIMIT ?").all(uuid, boundedInteger(limit, 100, 1, 1000));
  }

  function stats() {
    const nowMs = now();
    const row = database.prepare(`
      SELECT
        COUNT(*) AS known_vessels,
        SUM(CASE WHEN lp.vessel_uuid IS NOT NULL THEN 1 ELSE 0 END) AS with_position,
        SUM(CASE WHEN lp.vessel_uuid IS NULL THEN 1 ELSE 0 END) AS identity_only,
        SUM(CASE WHEN lp.observed_ms >= ? THEN 1 ELSE 0 END) AS live,
        SUM(CASE WHEN lp.observed_ms < ? AND lp.observed_ms >= ? THEN 1 ELSE 0 END) AS delayed,
        SUM(CASE WHEN lp.observed_ms < ? AND lp.observed_ms >= ? THEN 1 ELSE 0 END) AS last_known,
        SUM(CASE WHEN lp.observed_ms < ? THEN 1 ELSE 0 END) AS archived,
        SUM(CASE WHEN v.canonical_imo IS NOT NULL THEN 1 ELSE 0 END) AS imo_anchored,
        SUM(CASE WHEN v.current_mmsi IS NOT NULL THEN 1 ELSE 0 END) AS mmsi_anchored
      FROM vessels v LEFT JOIN vessel_latest_positions lp ON lp.vessel_uuid = v.vessel_uuid
    `).get(
      nowMs - thresholds.liveAgeMs,
      nowMs - thresholds.liveAgeMs,
      nowMs - thresholds.delayedAgeMs,
      nowMs - thresholds.delayedAgeMs,
      nowMs - thresholds.lastKnownAgeMs,
      nowMs - thresholds.lastKnownAgeMs,
    );
    const conflicts = database.prepare("SELECT COUNT(*) AS count FROM vessel_identity_conflicts WHERE resolution_status = 'open'").get();
    const trackPoints = database.prepare("SELECT COUNT(*) AS count FROM vessel_track_points").get();
    const history = database.prepare("SELECT COUNT(*) AS count FROM vessel_identity_history").get();
    const identifiers = database.prepare("SELECT COUNT(*) AS count FROM vessel_identifiers WHERE active = 1").get();
    const observations = database.prepare("SELECT COUNT(*) AS count FROM vessel_provider_observations").get();
    const databaseBytes = fileSize(dbPath);
    const walBytes = fileSize(`${dbPath}-wal`);
    const shmBytes = fileSize(`${dbPath}-shm`);
    return {
      ...state,
      status: state.lastError ? "degraded" : "ready",
      knownVessels: Number(row?.known_vessels ?? 0),
      withPosition: Number(row?.with_position ?? 0),
      live: Number(row?.live ?? 0),
      delayed: Number(row?.delayed ?? 0),
      lastKnown: Number(row?.last_known ?? 0),
      archived: Number(row?.archived ?? 0),
      identityOnly: Number(row?.identity_only ?? 0),
      imoAnchored: Number(row?.imo_anchored ?? 0),
      mmsiAnchored: Number(row?.mmsi_anchored ?? 0),
      openIdentityConflicts: Number(conflicts?.count ?? 0),
      trackPoints: Number(trackPoints?.count ?? 0),
      identityChanges: Number(history?.count ?? 0),
      activeIdentifiers: Number(identifiers?.count ?? 0),
      providerObservations: Number(observations?.count ?? 0),
      storage: {
        databaseBytes,
        walBytes,
        shmBytes,
        totalBytes: databaseBytes + walBytes + shmBytes,
      },
      storagePolicy: {
        permanentVesselRecords: true,
        permanentIdentityHistory: true,
        latestPositionRetained: true,
        globalTrackBucketMs: policy.globalTrackBucketMs,
        operationalTrackBucketMs: policy.operationalTrackBucketMs,
        fineTrackDays: policy.fineTrackDays,
        globalTrackRetentionDays: policy.globalTrackRetentionDays,
        operationalTrackRetentionDays: policy.operationalTrackRetentionDays,
      },
      freshness: { ...thresholds },
    };
  }

  function maintenance() {
    const nowMs = now();
    const fineCutoff = nowMs - policy.fineTrackDays * DAY_MS;
    const globalCutoff = nowMs - policy.globalTrackRetentionDays * DAY_MS;
    const operationalCutoff = nowMs - policy.operationalTrackRetentionDays * DAY_MS;
    database.exec("BEGIN IMMEDIATE");
    try {
      database.prepare(`
        INSERT OR IGNORE INTO vessel_track_points (
          vessel_uuid, latitude, longitude, speed_knots, course_deg, heading_deg,
          navigation_status, observed_at, observed_ms, received_at, provider,
          operational, resolution_seconds, bucket_start_ms
        )
        SELECT t.vessel_uuid, t.latitude, t.longitude, t.speed_knots, t.course_deg, t.heading_deg,
          t.navigation_status, t.observed_at, t.observed_ms, t.received_at, t.provider,
          t.operational, 86400, CAST(t.observed_ms / 86400000 AS INTEGER) * 86400000
        FROM vessel_track_points t
        INNER JOIN (
          SELECT vessel_uuid, operational,
            CAST(observed_ms / 86400000 AS INTEGER) AS day_bucket,
            MAX(observed_ms) AS max_observed_ms
          FROM vessel_track_points
          WHERE observed_ms < ? AND resolution_seconds < 86400
          GROUP BY vessel_uuid, operational, day_bucket
        ) grouped
          ON grouped.vessel_uuid = t.vessel_uuid
          AND grouped.operational = t.operational
          AND grouped.max_observed_ms = t.observed_ms
      `).run(fineCutoff);
      database.prepare("DELETE FROM vessel_track_points WHERE observed_ms < ? AND resolution_seconds < 86400").run(fineCutoff);
      database.prepare("DELETE FROM vessel_track_points WHERE operational = 0 AND observed_ms < ?").run(globalCutoff);
      database.prepare("DELETE FROM vessel_track_points WHERE operational = 1 AND observed_ms < ?").run(operationalCutoff);
      database.prepare("DELETE FROM vessel_provider_observations WHERE observed_at < ?").run(new Date(nowMs - 365 * DAY_MS).toISOString());
      database.exec("COMMIT");
      database.exec("PRAGMA wal_checkpoint(PASSIVE)");
      database.exec("PRAGMA optimize");
      state.lastMaintenanceAt = new Date(nowMs).toISOString();
      state.lastError = null;
    } catch (error) {
      try { database.exec("ROLLBACK"); } catch {}
      state.lastError = error instanceof Error ? error.message : String(error);
    }
    return stats();
  }

  function close() {
    try { maintenance(); } catch {}
    database.close();
    state.status = "closed";
  }

  return {
    observeBatch,
    stats,
    listVessels,
    listConflicts,
    getVessel,
    identityHistory,
    track,
    observations,
    maintenance,
    publicState: stats,
    close,
  };
}
