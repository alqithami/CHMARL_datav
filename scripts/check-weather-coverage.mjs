#!/usr/bin/env node

const baseUrl = process.env.PORTAL_BASE_URL ?? `http://127.0.0.1:${process.env.PORT ?? "8787"}`;
const expectedMin = Number(process.env.WEATHER_MIN_POINTS ?? 1);

const response = await fetch(`${baseUrl}/api/weather`, { headers: { Accept: "application/json" } });
const payload = await response.json().catch(() => null);
console.log(`Weather coverage ${response.status} ${response.statusText}`);
if (!response.ok) process.exit(1);
const points = Array.isArray(payload?.points) ? payload.points : [];
const marine = points.filter((point) => point.provider === "open-meteo-marine" || point.waveHeightM !== undefined).length;
const forecast = points.filter((point) => point.provider === "open-meteo-forecast" || point.windSpeedMs !== undefined || point.airTemperatureC !== undefined).length;
const usable = points.filter((point) => point.waveHeightM !== undefined || point.windSpeedMs !== undefined || point.airTemperatureC !== undefined || point.seaSurfaceTemperatureC !== undefined).length;
console.log(`points=${points.length} usable=${usable} marine=${marine} forecastFallback=${forecast}`);
for (const point of points) console.log(`${point.locationId ?? point.name}: provider=${point.provider ?? "unknown"} usable=${point.waveHeightM !== undefined || point.windSpeedMs !== undefined || point.airTemperatureC !== undefined}`);
if (points.length < expectedMin || usable === 0) process.exit(2);
