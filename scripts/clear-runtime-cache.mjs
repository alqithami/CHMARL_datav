#!/usr/bin/env node

import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const targets = [
  process.env.AISSTREAM_CACHE_FILE ?? ".runtime/ais-cache.json",
  process.env.CHMARL_EXPERIMENT_FILE ?? ".runtime/chmarl_episode.json",
  process.env.PORT_EVENTS_FILE ?? ".runtime/port_events.json",
  process.env.WEATHER_FILE ?? ".runtime/weather.json",
];

const yes = process.argv.includes("--yes") || process.argv.includes("-y");

console.log("Runtime cache cleanup");
console.log("-".repeat(64));
for (const target of targets) console.log(resolve(target));
console.log("-".repeat(64));

if (!yes) {
  console.log("Dry run only. Re-run with --yes to delete these files.");
  process.exit(0);
}

for (const target of targets) {
  const path = resolve(target);
  if (!existsSync(path)) {
    console.log(`skip missing ${path}`);
    continue;
  }
  rmSync(path, { force: true });
  console.log(`deleted ${path}`);
}
