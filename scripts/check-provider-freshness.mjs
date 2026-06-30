#!/usr/bin/env node

const baseUrl = process.env.PORTAL_BASE_URL ?? `http://127.0.0.1:${process.env.PORT ?? "8787"}`;
const maxAgeMs = Number(process.env.FRESHNESS_MAX_AGE_MS ?? 30 * 60 * 1000);

function ageLabel(timestamp) {
  if (!timestamp) return "n/a";
  const parsed = Date.parse(String(timestamp));
  if (!Number.isFinite(parsed)) return "invalid";
  const ageMs = Date.now() - parsed;
  return `${Math.round(ageMs / 1000)}s`;
}

function newestTimestamp(rows) {
  const values = rows
    .map((row) => Date.parse(String(row.timestamp ?? "")))
    .filter((value) => Number.isFinite(value));
  return values.length > 0 ? new Date(Math.max(...values)).toISOString() : undefined;
}

async function json(path) {
  const response = await fetch(`${baseUrl}${path}`, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`${path} ${response.status} ${response.statusText}`);
  return response.json();
}

console.log(`Provider freshness check: ${baseUrl}`);
console.log("-".repeat(64));
try {
  const vesselsPayload = await json("/api/vessels");
  const vessels = Array.isArray(vesselsPayload.vessels) ? vesselsPayload.vessels : [];
  const latest = newestTimestamp(vessels);
  const stale = latest ? Date.now() - Date.parse(latest) > maxAgeMs : true;
  console.log(`vessels rows=${vessels.length} latest=${latest ?? "n/a"} age=${ageLabel(latest)} stale=${stale}`);

  const weatherPayload = await json("/api/weather").catch(() => null);
  const weatherPoints = Array.isArray(weatherPayload?.points) ? weatherPayload.points : [];
  console.log(`weather points=${weatherPoints.length} updatedAt=${weatherPayload?.updatedAt ?? "n/a"}`);
} catch (error) {
  console.log(`Freshness check failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
