#!/usr/bin/env node

const baseUrl = process.env.PORTAL_BASE_URL ?? `http://127.0.0.1:${process.env.PORT ?? "8787"}`;
const endpoints = ["/", "/health", "/api/vessels", "/api/weather", "/api/chmarl/episode", "/api/port-events"];
const warnMs = Number(process.env.LATENCY_WARN_MS ?? 2000);

async function measure(path) {
  const started = performance.now();
  try {
    const response = await fetch(`${baseUrl}${path}`, { headers: { Accept: "application/json,text/html" } });
    const elapsed = Math.round(performance.now() - started);
    await response.arrayBuffer();
    return { path, status: response.status, elapsed, ok: response.ok || response.status === 404 };
  } catch (error) {
    return { path, status: 0, elapsed: Math.round(performance.now() - started), ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

console.log(`Endpoint latency check: ${baseUrl}`);
console.log("-".repeat(72));
let failed = false;
for (const endpoint of endpoints) {
  const result = await measure(endpoint);
  const slow = result.elapsed > warnMs;
  console.log(`${result.ok ? "OK  " : "FAIL"} ${endpoint.padEnd(22)} ${String(result.status).padEnd(4)} ${String(result.elapsed).padStart(5)} ms${slow ? " SLOW" : ""}${result.error ? ` ${result.error}` : ""}`);
  failed = failed || !result.ok;
}
if (failed) process.exit(1);
