#!/usr/bin/env node

const baseUrl = process.env.PORTAL_BASE_URL ?? `http://127.0.0.1:${process.env.PORT ?? "8787"}`;

const checks = [
  { name: "dashboard", path: "/", required: true, expectJson: false },
  { name: "health", path: "/health", required: true, expectJson: true },
  { name: "vessels", path: "/api/vessels", required: true, expectJson: true },
  { name: "weather", path: "/api/weather", required: false, expectJson: true },
  { name: "chmarl", path: "/api/chmarl/episode", required: false, expectJson: true },
  { name: "port ops", path: "/api/port-events", required: false, expectJson: true },
];

async function check(item) {
  const url = `${baseUrl}${item.path}`;
  try {
    const response = await fetch(url, { headers: { Accept: item.expectJson ? "application/json" : "text/html,application/json" } });
    const contentType = response.headers.get("content-type") ?? "";
    const ok = item.required ? response.ok : true;
    console.log(`${ok ? "OK  " : "FAIL"} ${item.name.padEnd(10)} ${String(response.status).padEnd(4)} ${contentType} ${url}`);
    return ok;
  } catch (error) {
    console.log(`${item.required ? "FAIL" : "WARN"} ${item.name.padEnd(10)} 0    ${url} · ${error instanceof Error ? error.message : String(error)}`);
    return !item.required;
  }
}

console.log(`Portal smoke test: ${baseUrl}`);
console.log("-".repeat(96));
const results = [];
for (const item of checks) results.push(await check(item));
console.log("-".repeat(96));
if (results.some((ok) => !ok)) {
  console.log("Smoke test failed. Start pnpm dev and open the single-port forwarded URL on 8787.");
  process.exit(1);
}
console.log("Smoke test passed for required portal endpoints.");
