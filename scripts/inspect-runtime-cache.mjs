#!/usr/bin/env node

import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const targets = [
  ["AIS cache", process.env.AISSTREAM_CACHE_FILE ?? ".runtime/ais-cache.json", ["vessels"]],
  ["CH-MARL file", process.env.CHMARL_EXPERIMENT_FILE ?? ".runtime/chmarl_episode.json", ["steps"]],
  ["Port events file", process.env.PORT_EVENTS_FILE ?? ".runtime/port_events.json", ["portEvents", "events"]],
  ["Weather file", process.env.WEATHER_FILE ?? ".runtime/weather.json", ["points"]],
];

function countRows(payload, keys) {
  if (!payload || typeof payload !== "object") return 0;
  for (const key of keys) {
    if (Array.isArray(payload[key])) return payload[key].length;
  }
  return 0;
}

console.log("Runtime cache inspection");
console.log("-".repeat(88));
for (const [label, target, keys] of targets) {
  const path = resolve(target);
  if (!existsSync(path)) {
    console.log(`${label.padEnd(18)} missing ${path}`);
    continue;
  }
  try {
    const stat = statSync(path);
    const payload = JSON.parse(readFileSync(path, "utf8"));
    console.log(`${label.padEnd(18)} rows=${String(countRows(payload, keys)).padEnd(5)} size=${String(stat.size).padEnd(8)} modified=${stat.mtime.toISOString()} ${path}`);
  } catch (error) {
    console.log(`${label.padEnd(18)} unreadable ${path} · ${error instanceof Error ? error.message : String(error)}`);
  }
}
