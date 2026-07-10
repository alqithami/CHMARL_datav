#!/usr/bin/env node

import { existsSync, readdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";

const defaultTargets = [
  process.env.AISSTREAM_CACHE_FILE ?? ".runtime/ais-cache.json",
  process.env.CHMARL_EXPERIMENT_FILE ?? ".runtime/chmarl_episode.json",
  process.env.PORT_EVENTS_FILE ?? ".runtime/port_events.json",
  process.env.WEATHER_FILE ?? ".runtime/weather.json",
  process.env.ECOFAIR_STATE_FILE ?? ".runtime/ecofair-state.json",
];

const globTargets = [
  ".runtime/ais-cache*.json",
  ".runtime/ecofair-state*.json",
  "/tmp/chmarl-ais-cache*.json",
  "/tmp/ecofair-state*.json",
];

const yes = process.argv.includes("--yes") || process.argv.includes("-y");
const includeManual = process.argv.includes("--manual-vessels");

function listGlob(pattern) {
  const star = pattern.indexOf("*");
  if (star === -1) return [pattern];
  const dir = resolve(dirname(pattern));
  const base = pattern.slice(pattern.lastIndexOf("/") + 1);
  const [prefix, suffix] = base.split("*");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.startsWith(prefix) && name.endsWith(suffix ?? ""))
    .map((name) => resolve(dir, name));
}

const targets = new Set(defaultTargets.map((target) => resolve(target)));
for (const pattern of globTargets) {
  for (const target of listGlob(pattern)) targets.add(resolve(target));
}
if (includeManual) {
  targets.add(resolve(process.env.FIXED_VESSEL_DATA_FILE ?? ".runtime/manual_vessels.json"));
}

console.log("Runtime cache cleanup");
console.log("-".repeat(72));
for (const target of [...targets].sort()) console.log(target);
console.log("-".repeat(72));

if (!yes) {
  console.log("Dry run only. Re-run with --yes to delete these files.");
  console.log("Add --manual-vessels only when you intentionally want to remove fixed/manual vessel input.");
  process.exit(0);
}

for (const target of [...targets].sort()) {
  if (!existsSync(target)) {
    console.log(`skip missing ${target}`);
    continue;
  }
  rmSync(target, { force: true });
  console.log(`deleted ${target}`);
}
