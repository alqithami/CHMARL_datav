#!/usr/bin/env node

const baseUrl = process.env.PORTAL_BASE_URL ?? `http://127.0.0.1:${process.env.PORT ?? "8787"}`;
const maxDistanceNm = Number(process.env.PORT_SUMMARY_MAX_DISTANCE_NM ?? 120);
const staleAgeMs = Number(process.env.PORT_SUMMARY_STALE_MS ?? 30 * 60 * 1000);

const ports = [
  { id: "Jeddah", latitude: 21.4858, longitude: 39.1925, country: "Saudi" },
  { id: "King Abdullah Port", latitude: 22.3924, longitude: 39.0953, country: "Saudi" },
  { id: "Yanbu", latitude: 24.0866, longitude: 38.0637, country: "Saudi" },
  { id: "Jizan", latitude: 16.8917, longitude: 42.5511, country: "Saudi" },
  { id: "Dammam", latitude: 26.4318, longitude: 50.1015, country: "Saudi" },
  { id: "Jebel Ali", latitude: 25.0114, longitude: 55.0611, country: "Regional" },
  { id: "Suez", latitude: 29.9668, longitude: 32.5498, country: "Regional" },
];

function distanceNm(a, b) {
  const r = 3440.065;
  const rad = (value) => value * Math.PI / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLon = rad(b.longitude - a.longitude);
  const lat1 = rad(a.latitude);
  const lat2 = rad(b.latitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.min(1, Math.sqrt(h)));
}

function nearestPort(vessel) {
  if (!Number.isFinite(Number(vessel.latitude)) || !Number.isFinite(Number(vessel.longitude))) return null;
  const point = { latitude: Number(vessel.latitude), longitude: Number(vessel.longitude) };
  return ports
    .map((port) => ({ port, distance: distanceNm(point, port) }))
    .sort((a, b) => a.distance - b.distance)[0] ?? null;
}

function timestampMs(value) {
  const parsed = Date.parse(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function isFresh(row) {
  const ts = timestampMs(row.timestamp);
  return ts === 0 || Date.now() - ts <= staleAgeMs;
}

function formatPct(count, total) {
  if (total <= 0) return "0.0%";
  return `${((count / total) * 100).toFixed(1)}%`;
}

const response = await fetch(`${baseUrl}/api/vessels`, { headers: { Accept: "application/json" } });
if (!response.ok) throw new Error(`/api/vessels ${response.status} ${response.statusText}`);
const payload = await response.json();
const rows = Array.isArray(payload.vessels) ? payload.vessels : [];
const summary = new Map(ports.map((port) => [port.id, { port, count: 0, fresh: 0, stale: 0, examples: [] }]));
let offshore = 0;
let missing = 0;

for (const vessel of rows) {
  const nearest = nearestPort(vessel);
  if (!nearest) {
    missing += 1;
    continue;
  }
  if (nearest.distance > maxDistanceNm) {
    offshore += 1;
    continue;
  }
  const bucket = summary.get(nearest.port.id);
  if (!bucket) continue;
  bucket.count += 1;
  if (isFresh(vessel)) bucket.fresh += 1;
  else bucket.stale += 1;
  if (bucket.examples.length < 3) bucket.examples.push(vessel.name ?? vessel.id ?? "unknown vessel");
}

const saudiCount = [...summary.values()].filter((row) => row.port.country === "Saudi").reduce((total, row) => total + row.count, 0);
const regionalCount = [...summary.values()].filter((row) => row.port.country !== "Saudi").reduce((total, row) => total + row.count, 0);

console.log(`Vessel nearest-port summary for ${baseUrl}`);
console.log("-".repeat(88));
console.log(`source=${payload.source ?? "unknown"} rows=${rows.length} maxDistanceNm=${maxDistanceNm} staleMs=${staleAgeMs}`);
console.log(`saudiNearPort=${saudiCount} regionalNearPort=${regionalCount} offshore=${offshore} missingPosition=${missing}`);
console.log("-".repeat(88));
console.log(`${"Port".padEnd(24)} ${"Area".padEnd(9)} ${"Rows".padStart(5)} ${"Fresh".padStart(5)} ${"Stale".padStart(5)} ${"Share".padStart(7)}  Examples`);
console.log("-".repeat(88));
for (const row of [...summary.values()].sort((a, b) => {
  if (a.port.country !== b.port.country) return a.port.country === "Saudi" ? -1 : 1;
  return b.count - a.count || a.port.id.localeCompare(b.port.id);
})) {
  console.log(`${row.port.id.padEnd(24)} ${row.port.country.padEnd(9)} ${String(row.count).padStart(5)} ${String(row.fresh).padStart(5)} ${String(row.stale).padStart(5)} ${formatPct(row.count, rows.length).padStart(7)}  ${row.examples.join(", ") || "—"}`);
}
console.log("-".repeat(88));
console.log(`${String(offshore).padStart(4)} offshore/outside threshold`);
console.log(`${String(missing).padStart(4)} missing position`);

if (rows.length > 0 && saudiCount === 0) {
  console.log("WARN: no current AIS rows fall within the Saudi port threshold. This means the feed is not observing Saudi-port traffic yet; it is not a UI placeholder.");
}
