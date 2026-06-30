#!/usr/bin/env node

const baseUrl = process.env.PORTAL_BASE_URL ?? `http://127.0.0.1:${process.env.PORT ?? "8787"}`;

const contracts = [
  { path: "/health", keys: ["ok", "aisstream", "weather"] },
  { path: "/api/vessels", keys: ["source", "vessels", "health"] },
  { path: "/api/weather", keys: ["source", "updatedAt", "points"], optional: true },
];

async function checkContract(contract) {
  const response = await fetch(`${baseUrl}${contract.path}`, { headers: { Accept: "application/json" } });
  if (!response.ok) {
    console.log(`${contract.optional ? "WARN" : "FAIL"} ${contract.path} ${response.status}`);
    return Boolean(contract.optional);
  }
  const payload = await response.json();
  const missing = contract.keys.filter((key) => !(key in payload));
  console.log(`${missing.length === 0 ? "OK  " : "FAIL"} ${contract.path} missing=${missing.join(",") || "none"}`);
  return missing.length === 0;
}

console.log(`API contract check: ${baseUrl}`);
console.log("-".repeat(64));
const results = [];
for (const contract of contracts) results.push(await checkContract(contract).catch((error) => {
  console.log(`FAIL ${contract.path} ${error instanceof Error ? error.message : String(error)}`);
  return false;
}));
if (results.some((ok) => !ok)) process.exit(1);
console.log("Required API contracts are present.");
