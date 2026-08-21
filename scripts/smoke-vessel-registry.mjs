import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createVesselRegistry } from "../server/vessel-feed-proxy/vessel-registry.mjs";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const runtimeDir = mkdtempSync(join(tmpdir(), "chmarl-vessel-registry-"));
const databaseFile = join(runtimeDir, "registry.sqlite");
let nowMs = Date.parse("2026-01-01T00:00:00.000Z");
const now = () => nowMs;

function vessel({
  id,
  mmsi,
  imo,
  name,
  latitude,
  longitude,
  timestamp = new Date(nowMs).toISOString(),
  inputSource = "test-live-ais",
  operational = false,
  ...rest
}) {
  return {
    id,
    mmsi,
    imo,
    name,
    latitude,
    longitude,
    timestamp,
    inputSource,
    speed: "12.0 kn",
    sog: 12,
    courseDeg: 180,
    headingDeg: 181,
    status: "Nominal",
    operational,
    ...rest,
  };
}

let registry;
try {
  registry = createVesselRegistry({
    databaseFile,
    now,
    globalTrackBucketMs: 6 * 60 * 60_000,
    operationalTrackBucketMs: 5 * 60_000,
    fineTrackDays: 2,
    globalTrackRetentionDays: 30,
    operationalTrackRetentionDays: 90,
  });

  const firstRows = registry.observeBatch([
    vessel({
      id: "MMSI-111111111",
      mmsi: "111111111",
      name: "ALPHA TEST",
      latitude: 59.91,
      longitude: 10.75,
      callSign: "LAAA",
      flag: "NO",
      cargo: "Cargo",
      lengthM: 180,
      beamM: 28,
    }),
  ]);
  const firstUuid = firstRows[0].vesselUuid;
  assert(firstUuid, "The first vessel did not receive a persistent UUID");
  assert(firstRows[0].registryStatus === "live", "A current position was not classified as live");

  nowMs += 60_000;
  const imoRows = registry.observeBatch([
    vessel({
      id: "MMSI-111111111",
      mmsi: "111111111",
      imo: "IMO 9074729",
      name: "ALPHA TEST",
      latitude: 59.92,
      longitude: 10.77,
      callSign: "LAAA",
      flag: "NO",
      cargo: "Cargo",
      lengthM: 180,
      beamM: 28,
    }),
  ]);
  assert(imoRows[0].vesselUuid === firstUuid, "Adding a valid IMO split the existing MMSI vessel");
  assert(imoRows[0].imo === "9074729", "The valid IMO was not normalized and retained");

  nowMs += 60_000;
  const changedMmsiRows = registry.observeBatch([
    vessel({
      id: "MMSI-222222222",
      mmsi: "222222222",
      imo: "9074729",
      name: "ALPHA RENAMED",
      latitude: 59.94,
      longitude: 10.8,
      callSign: "LABB",
      flag: "NO",
      cargo: "Cargo",
      lengthM: 180,
      beamM: 28,
    }),
  ]);
  assert(changedMmsiRows[0].vesselUuid === firstUuid, "An MMSI change split an IMO-anchored vessel");
  assert(changedMmsiRows[0].mmsi === "222222222", "The current MMSI was not updated");
  assert(changedMmsiRows[0].name === "ALPHA RENAMED", "The current vessel name was not updated");

  nowMs += 60_000;
  const conflictRows = registry.observeBatch([
    vessel({
      id: "MMSI-222222222-CONFLICT",
      mmsi: "222222222",
      imo: "9319466",
      name: "BRAVO TEST",
      latitude: 1.27,
      longitude: 103.82,
      inputSource: "test-second-provider",
      cargo: "Tanker",
    }),
  ]);
  assert(conflictRows[0].vesselUuid !== firstUuid, "A conflicting IMO/MMSI report was merged automatically");

  nowMs += 5 * 60_000;
  const operationalIds = new Set(["MMSI-222222222"]);
  registry.observeBatch([
    vessel({
      id: "MMSI-222222222",
      mmsi: "222222222",
      imo: "9074729",
      name: "ALPHA RENAMED",
      latitude: 21.4858,
      longitude: 39.1925,
      cargo: "Cargo",
    }),
  ], { operationalIds });

  let stats = registry.stats();
  assert(stats.knownVessels === 2, `Expected two physical vessels, received ${stats.knownVessels}`);
  assert(stats.imoAnchored === 2, "Both valid IMO records were not retained");
  assert(stats.openIdentityConflicts >= 1, "The conflicting identity report was not recorded");
  assert(stats.trackPoints >= 2, "Track history was not recorded");
  assert(stats.live === 2, "Current registry positions were not classified as live");

  const alpha = registry.getVessel(firstUuid);
  assert(alpha?.canonical_imo === "9074729", "The registry detail lost the IMO anchor");
  assert(alpha?.current_mmsi === "222222222", "The registry detail lost the new MMSI");
  assert(alpha?.current_name === "ALPHA RENAMED", "The registry detail lost the renamed vessel");
  assert(alpha?.operational === 1, "The latest operational position was not marked operational");
  assert(alpha?.identifiers?.some((row) => row.identifier_type === "mmsi" && row.identifier_value === "111111111" && row.active === 0), "The former MMSI was not closed in identifier history");
  assert(alpha?.identifiers?.some((row) => row.identifier_type === "mmsi" && row.identifier_value === "222222222" && row.active === 1), "The current MMSI is not active");

  const history = registry.identityHistory(firstUuid);
  assert(history.some((row) => row.attribute === "mmsi" && row.new_value === "222222222"), "MMSI history was not versioned");
  assert(history.some((row) => row.attribute === "name" && row.new_value === "ALPHA RENAMED"), "Name history was not versioned");

  const track = registry.track(firstUuid, { from: "2025-12-31T00:00:00.000Z", to: "2026-01-02T00:00:00.000Z" });
  assert(track.length >= 2, "The latest and operational movement history was not queryable");

  nowMs += 20 * 60_000;
  assert(registry.listVessels({ status: "delayed" }).rows.some((row) => row.vessel_uuid === firstUuid), "The delayed state was not queryable");
  nowMs += 2 * 60 * 60_000;
  assert(registry.listVessels({ status: "last-known" }).rows.some((row) => row.vessel_uuid === firstUuid), "The last-known state was not queryable");
  nowMs += 25 * 60 * 60_000;
  assert(registry.listVessels({ status: "archived" }).rows.some((row) => row.vessel_uuid === firstUuid), "The archived state was not queryable");

  registry.close();
  registry = createVesselRegistry({ databaseFile, now });
  stats = registry.stats();
  assert(stats.knownVessels === 2, "Permanent vessel identities did not survive a registry restart");
  assert(registry.getVessel(firstUuid)?.current_name === "ALPHA RENAMED", "The latest identity did not survive a registry restart");
  assert(registry.getVessel(firstUuid)?.latitude === 21.4858, "The last-known position did not survive a registry restart");

  registry.maintenance();
  const postMaintenance = registry.stats();
  assert(postMaintenance.knownVessels === 2, "Registry maintenance deleted permanent vessel records");
  assert(postMaintenance.storagePolicy.permanentVesselRecords === true, "The permanent registry policy is not exposed");

  console.log("Persistent vessel registry smoke test passed.");
} finally {
  try { registry?.close(); } catch {}
  rmSync(runtimeDir, { recursive: true, force: true });
}
