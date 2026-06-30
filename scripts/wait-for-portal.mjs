#!/usr/bin/env node

const baseUrl = process.env.PORTAL_BASE_URL ?? `http://127.0.0.1:${process.env.PORT ?? "8787"}`;
const timeoutMs = Number(process.env.WAIT_TIMEOUT_MS ?? 60000);
const intervalMs = Number(process.env.WAIT_INTERVAL_MS ?? 1500);
const startedAt = Date.now();

async function probe(path) {
  try {
    const response = await fetch(`${baseUrl}${path}`, { headers: { Accept: "application/json,text/html" } });
    return response.ok;
  } catch {
    return false;
  }
}

console.log(`Waiting for portal readiness at ${baseUrl}`);
while (Date.now() - startedAt < timeoutMs) {
  const dashboard = await probe("/");
  const health = await probe("/health");
  console.log(`${new Date().toISOString()} dashboard=${dashboard ? "ok" : "wait"} health=${health ? "ok" : "wait"}`);
  if (dashboard && health) {
    console.log("Portal is ready.");
    process.exit(0);
  }
  await new Promise((resolve) => setTimeout(resolve, intervalMs));
}

console.log(`Portal did not become ready within ${timeoutMs} ms.`);
process.exit(1);
