#!/usr/bin/env node

const baseUrl = process.env.PORTAL_BASE_URL ?? `http://127.0.0.1:${process.env.PORT ?? "8787"}`;
const endpoints = ["/health", "/api/vessels", "/api/weather"];

console.log(`CORS/proxy header check: ${baseUrl}`);
console.log("-".repeat(72));
let failed = false;
for (const endpoint of endpoints) {
  const response = await fetch(`${baseUrl}${endpoint}`, { headers: { Accept: "application/json" } }).catch((error) => ({ error }));
  if (response.error) {
    console.log(`FAIL ${endpoint} ${response.error.message}`);
    failed = true;
    continue;
  }
  const cors = response.headers.get("access-control-allow-origin") ?? "missing";
  const type = response.headers.get("content-type") ?? "missing";
  const ok = response.ok && type.includes("application/json");
  console.log(`${ok ? "OK  " : "WARN"} ${endpoint.padEnd(16)} status=${response.status} cors=${cors} type=${type}`);
}
if (failed) process.exit(1);
