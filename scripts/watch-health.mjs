#!/usr/bin/env node

const baseUrl = process.env.PORTAL_BASE_URL ?? `http://127.0.0.1:${process.env.PORT ?? "8787"}`;
const intervalMs = Number(process.env.WATCH_INTERVAL_MS ?? 5000);
const iterations = Number(process.env.WATCH_ITERATIONS ?? 24);

async function loadHealth() {
  const response = await fetch(`${baseUrl}/health`, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

console.log(`Watching backend health at ${baseUrl}/health`);
for (let index = 0; index < iterations; index += 1) {
  try {
    const health = await loadHealth();
    const ais = health.aisstream ?? {};
    const chmarl = health.chmarl ?? {};
    const weather = health.weather ?? {};
    const portOps = health.portOps ?? {};
    console.log(`${new Date().toISOString()} ais=${ais.connected ? "connected" : ais.enabled ? "waiting" : "disabled"} cache=${ais.cachedVessels ?? 0} messages=${ais.messageCount ?? 0} chmarl=${chmarl.active ? "active" : "inactive"} weather=${weather.active ? "active" : "missing"} port=${portOps.active ? "active" : "pending"}`);
  } catch (error) {
    console.log(`${new Date().toISOString()} ERROR ${error instanceof Error ? error.message : String(error)}`);
  }
  if (index < iterations - 1) await new Promise((resolve) => setTimeout(resolve, intervalMs));
}
