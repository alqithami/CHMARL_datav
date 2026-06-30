#!/usr/bin/env node

const baseUrl = process.env.PORTAL_BASE_URL ?? `http://127.0.0.1:${process.env.PORT ?? "8787"}`;
const timeoutMs = Number(process.env.WAIT_TIMEOUT_MS ?? 180000);
const intervalMs = Number(process.env.WAIT_INTERVAL_MS ?? 5000);
const minRows = Number(process.env.MIN_VESSEL_ROWS ?? 1);
const startedAt = Date.now();

async function loadVessels() {
  const response = await fetch(`${baseUrl}/api/vessels`, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

console.log(`Waiting for at least ${minRows} vessel row(s) at ${baseUrl}/api/vessels`);
while (Date.now() - startedAt < timeoutMs) {
  try {
    const payload = await loadVessels();
    const rows = Array.isArray(payload.vessels) ? payload.vessels : [];
    const health = payload.health ?? {};
    console.log(`${new Date().toISOString()} source=${payload.source ?? "unknown"} rows=${rows.length} connected=${health.connected ? "yes" : "no"} messages=${health.messageCount ?? 0}`);
    if (rows.length >= minRows) {
      console.log("Vessel feed is ready.");
      process.exit(0);
    }
  } catch (error) {
    console.log(`${new Date().toISOString()} wait: ${error instanceof Error ? error.message : String(error)}`);
  }
  await new Promise((resolve) => setTimeout(resolve, intervalMs));
}

console.log(`No vessel rows reached threshold within ${timeoutMs} ms.`);
process.exit(1);
