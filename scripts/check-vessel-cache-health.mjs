#!/usr/bin/env node

import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const cacheFile = resolve(process.env.AISSTREAM_CACHE_FILE ?? ".runtime/ais-cache.json");
const maxAgeMs = Number(process.env.AISSTREAM_MAX_AGE_MS ?? 6 * 60 * 60 * 1000);

function timestampMs(value) {
  const parsed = Date.parse(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

console.log("AIS vessel cache health");
console.log("-".repeat(72));
console.log(`file=${cacheFile}`);
if (!existsSync(cacheFile)) {
  console.log("cache=missing");
  process.exit(0);
}

const stat = statSync(cacheFile);
const payload = JSON.parse(readFileSync(cacheFile, "utf8"));
const rows = Array.isArray(payload?.vessels) ? payload.vessels : [];
const fresh = rows.filter((row) => {
  const ts = timestampMs(row.timestamp);
  return ts === 0 || Date.now() - ts <= maxAgeMs;
});
const stale = rows.length - fresh.length;
const latestMs = Math.max(0, ...rows.map((row) => timestampMs(row.timestamp)));
console.log(`size=${stat.size}`);
console.log(`savedAt=${payload?.savedAt ?? "n/a"}`);
console.log(`rows=${rows.length}`);
console.log(`fresh=${fresh.length}`);
console.log(`stale=${stale}`);
console.log(`latest=${latestMs ? new Date(latestMs).toISOString() : "n/a"}`);
if (rows.length > 0 && fresh.length === 0) process.exit(2);
