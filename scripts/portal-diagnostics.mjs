#!/usr/bin/env node

const baseUrl = process.env.PORTAL_BASE_URL ?? `http://localhost:${process.env.PORT ?? "8787"}`;

const endpoints = [
  { key: "health", path: "/health", required: true },
  { key: "vessels", path: "/api/vessels", required: true },
  { key: "chmarl", path: "/api/chmarl/episode", required: false },
  { key: "weather", path: "/api/weather", required: false },
  { key: "portOps", path: "/api/port-events", required: false },
];

async function loadJson(path) {
  const url = `${baseUrl}${path}`;
  try {
    const response = await fetch(url, { headers: { Accept: "application/json" } });
    const text = await response.text();
    let payload = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = { raw: text };
    }
    return { ok: response.ok, status: response.status, url, payload };
  } catch (error) {
    return { ok: false, status: 0, url, payload: { error: error instanceof Error ? error.message : String(error) } };
  }
}

function countRows(payload, keys) {
  for (const key of keys) {
    if (Array.isArray(payload?.[key])) return payload[key].length;
  }
  if (Array.isArray(payload)) return payload.length;
  return 0;
}

function line(label, value, status = "") {
  const padded = `${label}:`.padEnd(18, " ");
  console.log(`${padded}${value}${status ? `  ${status}` : ""}`);
}

function warn(message) {
  console.log(`  WARN: ${message}`);
}

function fail(message) {
  console.log(`  FAIL: ${message}`);
}

function summarizeHealth(result) {
  const payload = result.payload;
  line("backend", result.ok ? "reachable" : "unreachable", `${result.status}`);
  if (!result.ok) return;

  const ais = payload.aisstream;
  if (ais) {
    line("AIS socket", ais.connected ? "connected" : ais.enabled ? "waiting" : "disabled");
    line("AIS boxes", Array.isArray(ais.boundingBoxes) ? String(ais.boundingBoxes.length) : "n/a");
    line("AIS cache", `${ais.cachedVessels ?? 0}/${ais.cacheLimit ?? "?"}`);
    if (ais.lastError) warn(`AIS error: ${ais.lastError}`);
  }

  const chmarl = payload.chmarl;
  if (chmarl) {
    line("CH-MARL", chmarl.active ? `${chmarl.source} · ${chmarl.steps} step(s)` : "inactive");
    if (chmarl.lastError) warn(`CH-MARL error: ${chmarl.lastError}`);
  }

  const portOps = payload.portOps;
  if (portOps) {
    line("port ops", portOps.active ? `${portOps.source} · ${portOps.events} events` : "provider missing");
    if (portOps.lastError) warn(`Port ops error: ${portOps.lastError}`);
  }

  const weather = payload.weather;
  if (weather) {
    line("weather", weather.active ? `${weather.source} · ${weather.points} point(s)` : "missing");
    if (weather.lastError) warn(`Weather error: ${weather.lastError}`);
  }
}

function summarizeVessels(result) {
  const rows = countRows(result.payload, ["vessels", "data", "items"]);
  const source = result.payload?.source ?? "unknown";
  line("vessel feed", result.ok ? `${source} · ${rows} row(s)` : "failed", `${result.status}`);
  if (result.ok && rows === 0) warn("No vessel rows are available; AIS may still be waiting or all cached rows are stale.");
}

function summarizeChmarl(result) {
  const rows = countRows(result.payload, ["steps", "data", "items"]);
  line("CH-MARL feed", result.ok ? `${result.payload?.source ?? "runtime"} · ${rows} step(s)` : "not active", `${result.status}`);
  if (!result.ok) warn("CH-MARL should become active when live AIS rows exist or /api/chmarl/ingest receives steps.");
}

function summarizeWeather(result) {
  const rows = countRows(result.payload, ["points", "data", "items"]);
  line("weather feed", result.ok ? `${result.payload?.source ?? "unknown"} · ${rows} point(s)` : "failed", `${result.status}`);
  if (!result.ok || rows === 0) warn("Weather should route through /api/weather; check backend internet access if Open-Meteo fails.");
}

function summarizePortOps(result) {
  const events = countRows(result.payload, ["portEvents", "port_events", "events"]);
  const utilization = countRows(result.payload, ["portUtilization", "port_utilization", "utilization", "ports"]);
  const queues = countRows(result.payload, ["queueStatus", "queue_status", "queues", "berths"]);
  line("port ops feed", result.ok ? `${events} events · ${utilization} utilization · ${queues} queues` : "provider missing", `${result.status}`);
  if (!result.ok) warn("This is expected until PORT_EVENTS_URL is connected to a real berth/queue/utilization provider.");
}

console.log(`CH-MARL DataV diagnostics for ${baseUrl}`);
console.log("-".repeat(64));

const results = new Map();
for (const endpoint of endpoints) {
  results.set(endpoint.key, await loadJson(endpoint.path));
}

summarizeHealth(results.get("health"));
console.log("-".repeat(64));
summarizeVessels(results.get("vessels"));
summarizeChmarl(results.get("chmarl"));
summarizeWeather(results.get("weather"));
summarizePortOps(results.get("portOps"));
console.log("-".repeat(64));

const hardFailures = endpoints
  .filter((endpoint) => endpoint.required)
  .map((endpoint) => results.get(endpoint.key))
  .filter((result) => !result.ok);

if (hardFailures.length > 0) {
  fail("Required backend endpoints are not healthy.");
  process.exit(1);
}

console.log("Diagnostics completed. Optional provider warnings are shown above.");
