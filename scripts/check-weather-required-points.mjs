#!/usr/bin/env node

const baseUrl = process.env.PORTAL_BASE_URL ?? `http://127.0.0.1:${process.env.PORT ?? "8787"}`;
const expected = (process.env.WEATHER_EXPECTED_IDS ?? "suez,jeddah,kaec,yanbu,jizan,dammam,jebel-ali")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

const response = await fetch(`${baseUrl}/api/weather`, { headers: { Accept: "application/json" } });
const payload = await response.json().catch(() => null);
console.log(`Weather expected-point coverage ${response.status} ${response.statusText}`);
if (!response.ok) process.exit(1);
const points = Array.isArray(payload?.points) ? payload.points : [];
const ids = new Set(points.map((point) => point.locationId).filter(Boolean));
const missing = expected.filter((id) => !ids.has(id));
console.log(`points=${points.length} expected=${expected.length} missing=${missing.join(",") || "none"}`);
if (missing.length > 0) process.exit(2);
console.log("Weather expected-point coverage passed.");
