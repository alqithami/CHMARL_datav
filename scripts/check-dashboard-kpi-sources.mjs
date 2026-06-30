#!/usr/bin/env node

const baseUrl = process.env.PORTAL_BASE_URL ?? `http://127.0.0.1:${process.env.PORT ?? "8787"}`;

async function json(path) {
  const response = await fetch(`${baseUrl}${path}`, { headers: { Accept: "application/json" } });
  return { response, payload: await response.json().catch(() => null) };
}

const [health, vessels, chmarl, weather, ports] = await Promise.all([
  json("/health"),
  json("/api/vessels"),
  json("/api/chmarl/episode"),
  json("/api/weather"),
  json("/api/port-events"),
]);

const vesselRows = Array.isArray(vessels.payload?.vessels) ? vessels.payload.vessels : [];
const steps = Array.isArray(chmarl.payload?.steps) ? chmarl.payload.steps : [];
const rewards = Array.isArray(steps.at(-1)?.rewards) ? steps.at(-1).rewards : [];
const global = rewards.find((reward) => reward.component === "global")?.value;
const weatherPoints = Array.isArray(weather.payload?.points) ? weather.payload.points : [];
const portEvents = Array.isArray(ports.payload?.portEvents) ? ports.payload.portEvents : [];

console.log("Dashboard KPI source diagnostic");
console.log("-".repeat(72));
console.log(`Tracked vessels      ${vesselRows.length} source=${vessels.payload?.source ?? "unknown"} http=${vessels.response.status}`);
console.log(`Reward index         ${global ?? "n/a"} source=${chmarl.payload?.source ?? "none"} steps=${steps.length} http=${chmarl.response.status}`);
console.log(`Weather points       ${weatherPoints.length} source=${weather.payload?.source ?? "none"} http=${weather.response.status}`);
console.log(`Port events backend  ${portEvents.length} http=${ports.response.status}`);
console.log(`AIS socket           ${health.payload?.aisstream?.connected ? "connected" : "waiting"} cache=${health.payload?.aisstream?.cachedVessels ?? 0}`);
