#!/usr/bin/env node

const baseUrl = process.env.PORTAL_BASE_URL ?? `http://127.0.0.1:${process.env.PORT ?? "8787"}`;

function speedKnots(row) {
  const parsed = Number.parseFloat(String(row.speed ?? row.speedKnots ?? row.sog ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : undefined;
}

const buckets = [
  { name: "stationary", test: (speed) => speed <= 0.5, count: 0 },
  { name: "slow", test: (speed) => speed > 0.5 && speed < 5, count: 0 },
  { name: "transit", test: (speed) => speed >= 5 && speed <= 15, count: 0 },
  { name: "fast", test: (speed) => speed > 15, count: 0 },
];

const response = await fetch(`${baseUrl}/api/vessels`, { headers: { Accept: "application/json" } });
if (!response.ok) throw new Error(`/api/vessels ${response.status} ${response.statusText}`);
const payload = await response.json();
const rows = Array.isArray(payload.vessels) ? payload.vessels : [];
let unknown = 0;
const speeds = [];

for (const row of rows) {
  const speed = speedKnots(row);
  if (speed === undefined) {
    unknown += 1;
    continue;
  }
  speeds.push(speed);
  const bucket = buckets.find((item) => item.test(speed));
  if (bucket) bucket.count += 1;
}

const avg = speeds.length ? speeds.reduce((sum, value) => sum + value, 0) / speeds.length : undefined;
console.log(`Vessel speed distribution for ${baseUrl}`);
console.log("-".repeat(64));
console.log(`rows=${rows.length} knownSpeed=${speeds.length} avg=${avg === undefined ? "n/a" : `${avg.toFixed(2)} kn`}`);
for (const bucket of buckets) console.log(`${bucket.name.padEnd(12)} ${bucket.count}`);
console.log(`${"unknown".padEnd(12)} ${unknown}`);
