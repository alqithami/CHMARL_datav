#!/usr/bin/env node

const baseUrl = process.env.PORTAL_BASE_URL ?? `http://127.0.0.1:${process.env.PORT ?? "8787"}`;
const maxDistanceNm = Number(process.env.PORT_SUMMARY_MAX_DISTANCE_NM ?? 120);
const staleAgeMs = Number(process.env.PORT_SUMMARY_STALE_MS ?? 30 * 60 * 1000);
const minExpectedBoxes = Number(process.env.SAUDI_AIS_MIN_BOXES ?? 7);

const ports = [
  { id: "Jeddah", area: "Saudi", latitude: 21.4858, longitude: 39.1925 },
  { id: "King Abdullah Port", area: "Saudi", latitude: 22.3924, longitude: 39.0953 },
  { id: "Yanbu", area: "Saudi", latitude: 24.0866, longitude: 38.0637 },
  { id: "Jizan", area: "Saudi", latitude: 16.8917, longitude: 42.5511 },
  { id: "Dammam", area: "Saudi", latitude: 26.4318, longitude: 50.1015 },
  { id: "Jebel Ali", area: "Regional", latitude: 25.0114, longitude: 55.0611 },
  { id: "Suez", area: "Regional", latitude: 29.9668, longitude: 32.5498 },
];

async function fetchJson(path) {
  const response = await fetch(`${baseUrl}${path}`, { headers: { accept: "application/json" } });
  const payload = await response.json().catch(() => null);
  return { response, payload };
}

function ageMs(iso) {
  const parsed = Date.parse(String(iso ?? ""));
  return Number.isFinite(parsed) ? Date.now() - parsed : undefined;
}

function fmtAge(ms) {
  if (ms === undefined) return "n/a";
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  return `${(ms / 3_600_000).toFixed(1)}h`;
}

function distanceNm(a, b) {
  const r = 3440.065;
  const rad = (value) => value * Math.PI / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLon = rad(b.longitude - a.longitude);
  const lat1 = rad(a.latitude);
  const lat2 = rad(b.latitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.min(1, Math.sqrt(h)));
}

function nearestPort(vessel) {
  if (!Number.isFinite(Number(vessel.latitude)) || !Number.isFinite(Number(vessel.longitude))) return null;
  const point = { latitude: Number(vessel.latitude), longitude: Number(vessel.longitude) };
  return ports.map((port) => ({ port, distance: distanceNm(point, port) })).sort((a, b) => a.distance - b.distance)[0] ?? null;
}

function isFresh(vessel) {
  const ts = ageMs(vessel.timestamp);
  return ts === undefined || ts <= staleAgeMs;
}

function summarizeVessels(rows) {
  const perPort = new Map(ports.map((port) => [port.id, { port, count: 0, fresh: 0, stale: 0, examples: [] }]));
  let missing = 0;
  let offshore = 0;
  for (const vessel of rows) {
    const nearest = nearestPort(vessel);
    if (!nearest) {
      missing += 1;
      continue;
    }
    if (nearest.distance > maxDistanceNm) {
      offshore += 1;
      continue;
    }
    const row = perPort.get(nearest.port.id);
    if (!row) continue;
    row.count += 1;
    if (isFresh(vessel)) row.fresh += 1;
    else row.stale += 1;
    if (row.examples.length < 3) row.examples.push(vessel.name ?? vessel.id ?? "unknown");
  }
  const rowsByPort = [...perPort.values()];
  return {
    rowsByPort,
    missing,
    offshore,
    saudi: rowsByPort.filter((row) => row.port.area === "Saudi").reduce((sum, row) => sum + row.count, 0),
    regional: rowsByPort.filter((row) => row.port.area === "Regional").reduce((sum, row) => sum + row.count, 0),
    stale: rows.filter((row) => !isFresh(row)).length,
    fresh: rows.filter(isFresh).length,
  };
}

function printPortRows(summary, totalRows) {
  console.log(`${"Port".padEnd(24)} ${"Area".padEnd(9)} ${"Rows".padStart(5)} ${"Fresh".padStart(5)} ${"Stale".padStart(5)} ${"Share".padStart(7)}  Examples`);
  console.log("-".repeat(96));
  for (const row of summary.rowsByPort.sort((a, b) => {
    if (a.port.area !== b.port.area) return a.port.area === "Saudi" ? -1 : 1;
    return b.count - a.count || a.port.id.localeCompare(b.port.id);
  })) {
    const share = totalRows > 0 ? `${((row.count / totalRows) * 100).toFixed(1)}%` : "0.0%";
    console.log(`${row.port.id.padEnd(24)} ${row.port.area.padEnd(9)} ${String(row.count).padStart(5)} ${String(row.fresh).padStart(5)} ${String(row.stale).padStart(5)} ${share.padStart(7)}  ${row.examples.join(", ") || "—"}`);
  }
}

function printDiagnosis(health, vesselPayload, summary, rows) {
  const ais = health?.aisstream ?? {};
  const boxCount = Array.isArray(ais.boundingBoxes) ? ais.boundingBoxes.length : 0;
  const issues = [];

  if (!ais.enabled) issues.push("AISStream is disabled or AISSTREAM_API_KEY is missing.");
  if (!ais.connected) issues.push("AISStream socket is not currently connected.");
  if (boxCount < minExpectedBoxes) issues.push(`Effective AIS subscription has ${boxCount} boxes; expected at least ${minExpectedBoxes} for regional + Saudi approach coverage.`);
  if ((ais.messageCount ?? 0) === 0) issues.push("AISStream socket has not received provider messages since backend start.");
  if (rows.length === 0) issues.push("/api/vessels returned zero rows; online CH-MARL and map are waiting for live AIS cache rows.");
  if (rows.length > 0 && summary.stale === rows.length) issues.push("All cached vessel rows are stale under the 30-minute operational threshold; clear cache or wait for new AIS updates.");
  if (rows.length > 0 && summary.saudi === 0 && summary.regional > 0) issues.push("Live/cache rows are currently regional/Suez only. Saudi ports are monitored, but the feed has not delivered rows within the Saudi port threshold.");
  if ((ais.restoredVessels ?? 0) > 0 && (ais.messageCount ?? 0) === 0) issues.push("Rows appear restored from disk cache only; no fresh provider messages have arrived after start.");
  if (summary.offshore > 0) issues.push(`${summary.offshore} row(s) are outside the ${maxDistanceNm} nm monitored-port threshold; adjust PORT_SUMMARY_MAX_DISTANCE_NM only if operationally justified.`);

  console.log("Diagnosis");
  console.log("-".repeat(96));
  if (issues.length === 0) {
    console.log("PASS: No obvious Saudi AIS configuration constraints detected.");
  } else {
    for (const issue of issues) console.log(`- ${issue}`);
  }

  console.log("-".repeat(96));
  console.log("Recommended next checks");
  console.log("- Run: PORT_WATCH_CYCLES=12 PORT_WATCH_INTERVAL_MS=10000 PORTAL_BASE_URL=http://127.0.0.1:8787 pnpm run watch:ports");
  console.log("- Run: AISSTREAM_DIAGNOSTIC_MS=180000 AISSTREAM_DIAGNOSTIC_PASS_MESSAGES=5 pnpm run diagnose:ais");
  console.log("- If only stale cache rows appear, run: pnpm cache:clear -- --yes, then keep pnpm dev:proxy running for several minutes.");
  console.log(`- Current /api/vessels source: ${vesselPayload?.source ?? "unknown"}`);
}

const healthResult = await fetchJson("/health").catch((error) => ({ response: { status: 0 }, payload: { error: String(error) } }));
const vesselResult = await fetchJson("/api/vessels").catch((error) => ({ response: { status: 0 }, payload: { error: String(error), vessels: [] } }));
const health = healthResult.payload;
const vesselPayload = vesselResult.payload;
const rows = Array.isArray(vesselPayload?.vessels) ? vesselPayload.vessels : [];
const summary = summarizeVessels(rows);
const ais = health?.aisstream ?? {};

console.log("Saudi AIS constraint diagnostic");
console.log("=".repeat(96));
console.log(`baseUrl=${baseUrl}`);
console.log(`healthStatus=${healthResult.response.status} vesselStatus=${vesselResult.response.status}`);
console.log(`aisEnabled=${ais.enabled ?? "n/a"} connected=${ais.connected ?? "n/a"} boxes=${Array.isArray(ais.boundingBoxes) ? ais.boundingBoxes.length : "n/a"} messages=${ais.messageCount ?? "n/a"} cached=${ais.cachedVessels ?? "n/a"} restored=${ais.restoredVessels ?? "n/a"}`);
console.log(`lastMessageAt=${ais.lastMessageAt ?? "n/a"} lastMessageAge=${fmtAge(ageMs(ais.lastMessageAt))} lastError=${ais.lastError ?? "none"}`);
console.log(`rows=${rows.length} fresh=${summary.fresh} stale=${summary.stale} saudi=${summary.saudi} regional=${summary.regional} offshore=${summary.offshore} missingPosition=${summary.missing}`);
console.log("-".repeat(96));
printPortRows(summary, rows.length);
console.log("=".repeat(96));
printDiagnosis(health, vesselPayload, summary, rows);

if (summary.saudi > 0) process.exit(0);
process.exit(rows.length > 0 ? 2 : 1);
