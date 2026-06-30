#!/usr/bin/env node

const baseUrl = process.env.PORTAL_BASE_URL ?? `http://127.0.0.1:${process.env.PORT ?? "8787"}`;
const intervalMs = Number(process.env.WATCH_INTERVAL_MS ?? 5000);
const iterations = Number(process.env.WATCH_ITERATIONS ?? 24);

async function loadJson(path) {
  const response = await fetch(`${baseUrl}${path}`, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

function latestTimestamp(rows) {
  const times = rows
    .map((row) => Date.parse(String(row.timestamp ?? "")))
    .filter((value) => Number.isFinite(value));
  return times.length > 0 ? new Date(Math.max(...times)).toISOString() : "n/a";
}

console.log(`Watching vessel feed at ${baseUrl}/api/vessels`);
console.log("Press Ctrl+C to stop.");

for (let index = 0; index < iterations; index += 1) {
  try {
    const payload = await loadJson("/api/vessels");
    const rows = Array.isArray(payload.vessels) ? payload.vessels : [];
    const health = payload.health ?? {};
    console.log(`${new Date().toISOString()} source=${payload.source ?? "unknown"} rows=${rows.length} socket=${health.connected ? "connected" : "waiting"} messages=${health.messageCount ?? 0} latest=${latestTimestamp(rows)}`);
  } catch (error) {
    console.log(`${new Date().toISOString()} ERROR ${error instanceof Error ? error.message : String(error)}`);
  }
  if (index < iterations - 1) await new Promise((resolve) => setTimeout(resolve, intervalMs));
}
