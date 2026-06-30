#!/usr/bin/env node

const baseUrl = process.env.PORTAL_BASE_URL ?? `http://127.0.0.1:${process.env.PORT ?? "8787"}`;
const response = await fetch(`${baseUrl}/api/weather`, { headers: { Accept: "application/json" } });
const payload = await response.json().catch(() => null);
console.log(`Weather feed ${response.status} ${response.statusText}`);
if (!response.ok) process.exit(1);
const points = Array.isArray(payload?.points) ? payload.points : [];
console.log(`source=${payload?.source ?? "unknown"} updatedAt=${payload?.updatedAt ?? "n/a"} points=${points.length}`);
for (const point of points) {
  const wave = point.waveHeightM === undefined ? "n/a" : `${Number(point.waveHeightM).toFixed(2)}m`;
  const temp = point.seaSurfaceTemperatureC === undefined ? "n/a" : `${Number(point.seaSurfaceTemperatureC).toFixed(1)}C`;
  console.log(`${point.locationId ?? point.name}: wave=${wave} temp=${temp}`);
}
if (points.length === 0) process.exit(2);
