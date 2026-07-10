#!/usr/bin/env node

const baseUrl = (process.env.PORTAL_BASE_URL ?? "http://127.0.0.1:8787").replace(/\/$/, "");

async function getJson(path) {
  const response = await fetch(`${baseUrl}${path}`, { headers: { accept: "application/json" } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${path}: ${response.status} ${JSON.stringify(payload)}`);
  return payload;
}

const [health, tracking, operational] = await Promise.all([
  getJson("/health"),
  getJson("/api/vessels"),
  getJson("/api/vessels?scope=operational"),
]);

console.log(`Live scope verification for ${baseUrl}`);
console.log("-".repeat(88));
console.log(`AIS enabled/connected : ${health.aisstream?.enabled ?? "n/a"}/${health.aisstream?.connected ?? "n/a"}`);
console.log(`AIS messages/positions: ${health.aisstream?.messageCount ?? 0}/${health.aisstream?.usablePositionMessages ?? 0}`);
console.log(`Tracking mode         : ${health.trackingScope?.mode ?? health.aisstream?.trackingMode ?? "n/a"}`);
console.log(`Tracking BBOX         : ${health.trackingScope?.bbox ?? health.aisstream?.trackingBbox ?? "n/a"}`);
console.log(`Tracking rows         : ${tracking.vessels?.length ?? 0}`);
console.log(`Operational rows      : ${operational.vessels?.length ?? 0}`);
console.log(`Operational radius    : ${health.operationalScope?.radiusNm ?? "n/a"} nm`);
console.log(`Background tick       : ${health.runtime?.lastTickAt ?? "not started"}`);
console.log(`AIS cache file        : ${health.persistence?.aisCacheFile ?? "n/a"}`);
console.log(`EcoFair state file    : ${health.persistence?.ecofairStateFile ?? "n/a"}`);
console.log("-".repeat(88));

if (!health.aisstream?.enabled) {
  console.error("FAIL: AISSTREAM_API_KEY is not configured.");
  process.exit(2);
}
if (!health.aisstream?.connected) {
  console.error("FAIL: AIS websocket is not connected.");
  process.exit(3);
}
if (!health.runtime?.lastTickAt) {
  console.error("FAIL: background EcoFair tick has not run.");
  process.exit(4);
}
if ((tracking.vessels?.length ?? 0) === 0) {
  console.warn("WARN: tracking feed currently has zero rows. Check provider messages/key/account capacity.");
  process.exitCode = 1;
} else {
  console.log("PASS: tracking feed is populated independently of the port calculation subset.");
}

if ((operational.vessels?.length ?? 0) === 0) {
  console.warn("WARN: no tracked vessels currently fall inside the monitored-port calculation radius.");
} else {
  console.log("PASS: EcoFair-CH-MARL has port-scope vessel inputs.");
}
