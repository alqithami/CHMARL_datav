#!/usr/bin/env node

const baseUrl = process.env.PORTAL_BASE_URL ?? `http://127.0.0.1:${process.env.PORT ?? "8787"}`;

const rules = [
  ["waveHeightM", 0, 20],
  ["wavePeriodS", 0, 40],
  ["waveDirectionDeg", 0, 360],
  ["seaSurfaceTemperatureC", -5, 45],
  ["airTemperatureC", -20, 60],
  ["windSpeedMs", 0, 80],
  ["windDirectionDeg", 0, 360],
];

const response = await fetch(`${baseUrl}/api/weather`, { headers: { Accept: "application/json" } });
const payload = await response.json().catch(() => null);
console.log(`Weather value ranges ${response.status} ${response.statusText}`);
if (!response.ok) process.exit(1);
const points = Array.isArray(payload?.points) ? payload.points : [];
let failures = 0;
for (const point of points) {
  for (const [key, min, max] of rules) {
    if (point[key] === undefined) continue;
    const value = Number(point[key]);
    const ok = Number.isFinite(value) && value >= min && value <= max;
    console.log(`${ok ? "OK  " : "FAIL"} ${(point.locationId ?? point.name ?? "point").padEnd(12)} ${key.padEnd(24)} ${value}`);
    if (!ok) failures += 1;
  }
}
if (points.length === 0) failures += 1;
if (failures > 0) process.exit(2);
console.log("Weather value ranges are plausible.");
