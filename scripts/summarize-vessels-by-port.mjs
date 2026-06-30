#!/usr/bin/env node

const baseUrl = process.env.PORTAL_BASE_URL ?? `http://127.0.0.1:${process.env.PORT ?? "8787"}`;
const maxDistanceNm = Number(process.env.PORT_SUMMARY_MAX_DISTANCE_NM ?? 120);

const ports = [
  { id: "Jeddah", latitude: 21.4858, longitude: 39.1925 },
  { id: "King Abdullah Port", latitude: 22.3924, longitude: 39.0953 },
  { id: "Yanbu", latitude: 24.0866, longitude: 38.0637 },
  { id: "Jizan", latitude: 16.8917, longitude: 42.5511 },
  { id: "Dammam", latitude: 26.4318, longitude: 50.1015 },
  { id: "Jebel Ali", latitude: 25.0114, longitude: 55.0611 },
  { id: "Suez", latitude: 29.9668, longitude: 32.5498 },
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
    .map((port) => ({ port: port.id, distance: distanceNm(point, port) }))
    .sort((a, b) => a.distance - b.distance)[0] ?? null;
}

const response = await fetch(`${baseUrl}/api/vessels`, { headers: { Accept: "application/json" } });
if (!response.ok) throw new Error(`/api/vessels ${response.status} ${response.statusText}`);
const payload = await response.json();
const rows = Array.isArray(payload.vessels) ? payload.vessels : [];
const summary = new Map();
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
  summary.set(nearest.port, (summary.get(nearest.port) ?? 0) + 1);
}

console.log(`Vessel nearest-port summary for ${baseUrl}`);
console.log("-".repeat(72));
console.log(`source=${payload.source ?? "unknown"} rows=${rows.length} maxDistanceNm=${maxDistanceNm}`);
for (const [port, count] of [...summary.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`${String(count).padStart(4)} ${port}`);
}
console.log(`${String(offshore).padStart(4)} offshore/outside threshold`);
console.log(`${String(missing).padStart(4)} missing position`);
