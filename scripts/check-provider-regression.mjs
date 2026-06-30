#!/usr/bin/env node

const baseUrl = process.env.PORTAL_BASE_URL ?? `http://127.0.0.1:${process.env.PORT ?? "8787"}`;
const minWeatherPoints = Number(process.env.MIN_WEATHER_POINTS ?? 1);
const minVesselRows = Number(process.env.MIN_VESSEL_ROWS ?? 0);

async function json(path) {
  const response = await fetch(`${baseUrl}${path}`, { headers: { Accept: "application/json" } });
  const payload = await response.json().catch(() => null);
  return { response, payload };
}

const failures = [];
const vessels = await json("/api/vessels");
const weather = await json("/api/weather");
const chmarl = await json("/api/chmarl/episode");

const vesselRows = Array.isArray(vessels.payload?.vessels) ? vessels.payload.vessels : [];
const weatherRows = Array.isArray(weather.payload?.points) ? weather.payload.points : [];
const steps = Array.isArray(chmarl.payload?.steps) ? chmarl.payload.steps : [];

if (!vessels.response.ok) failures.push(`/api/vessels ${vessels.response.status}`);
if (vesselRows.length < minVesselRows) failures.push(`vessel rows ${vesselRows.length} < ${minVesselRows}`);
if (!weather.response.ok) failures.push(`/api/weather ${weather.response.status}`);
if (weatherRows.length < minWeatherPoints) failures.push(`weather points ${weatherRows.length} < ${minWeatherPoints}`);
if (vesselRows.length > 0 && steps.length === 0) failures.push("CH-MARL steps missing despite vessel rows");

console.log("Provider regression check");
console.log("-".repeat(72));
console.log(`vessels=${vesselRows.length} weather=${weatherRows.length} chmarlSteps=${steps.length}`);
if (failures.length > 0) {
  for (const failure of failures) console.log(`FAIL ${failure}`);
  process.exit(1);
}
console.log("Provider regression check passed.");
