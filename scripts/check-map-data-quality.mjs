#!/usr/bin/env node

const baseUrl = process.env.PORTAL_BASE_URL ?? `http://127.0.0.1:${process.env.PORT ?? "8787"}`;

function hasZeroZero(row) {
  return Number(row.latitude) === 0 && Number(row.longitude) === 0;
}

function hasPosition(row) {
  return Number.isFinite(Number(row.latitude)) && Number.isFinite(Number(row.longitude));
}

const response = await fetch(`${baseUrl}/api/vessels`, { headers: { Accept: "application/json" } });
if (!response.ok) throw new Error(`/api/vessels ${response.status} ${response.statusText}`);
const payload = await response.json();
const rows = Array.isArray(payload.vessels) ? payload.vessels : [];
const positioned = rows.filter(hasPosition);
const zeroZero = rows.filter(hasZeroZero);
const withTrail = rows.filter((row) => Array.isArray(row.trail) && row.trail.length > 1);

console.log("Map data quality");
console.log("-".repeat(64));
console.log(`rows=${rows.length}`);
console.log(`positioned=${positioned.length}`);
console.log(`zeroZero=${zeroZero.length}`);
console.log(`withTrail=${withTrail.length}`);
if (zeroZero.length > 0) {
  console.log("WARN: vessels at 0,0 detected. Inspect coordinate normalization.");
  zeroZero.slice(0, 10).forEach((row) => console.log(`  ${row.id ?? row.name ?? "unknown"}`));
  process.exit(1);
}
console.log("Map data quality check passed.");
