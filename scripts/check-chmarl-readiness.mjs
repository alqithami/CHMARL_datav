#!/usr/bin/env node

const baseUrl = process.env.PORTAL_BASE_URL ?? `http://127.0.0.1:${process.env.PORT ?? "8787"}`;

async function load(path) {
  const response = await fetch(`${baseUrl}${path}`, { headers: { Accept: "application/json" } });
  return { response, payload: await response.json().catch(() => null) };
}

const health = await load("/health");
const episode = await load("/api/chmarl/episode");
const vessels = await load("/api/vessels");
const vesselRows = Array.isArray(vessels.payload?.vessels) ? vessels.payload.vessels : [];
const steps = Array.isArray(episode.payload?.steps) ? episode.payload.steps : [];

console.log("CH-MARL readiness");
console.log("-".repeat(64));
console.log(`health=${health.response.status} active=${health.payload?.chmarl?.active ?? false}`);
console.log(`vessels=${vessels.response.status} rows=${vesselRows.length}`);
console.log(`episode=${episode.response.status} steps=${steps.length}`);
if (vesselRows.length === 0) console.log("WAIT: Online CH-MARL needs at least one live vessel row.");
if (episode.response.ok && steps.length > 0) {
  console.log(`READY: ${episode.payload?.source ?? "runtime"} ${episode.payload?.scenarioId ?? steps[0]?.scenarioId ?? "unknown"}`);
  process.exit(0);
}
process.exit(vesselRows.length > 0 ? 2 : 1);
