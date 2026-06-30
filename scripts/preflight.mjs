#!/usr/bin/env node

import { spawnSync } from "node:child_process";

const steps = [
  ["git", ["status", "--short"], false],
  ["node", ["scripts/check-portal-env.mjs"], true],
  ["node", ["scripts/check-lockfile-drift.mjs"], false],
  ["node", ["scripts/verify-build-artifacts.mjs"], false],
];

function run(command, args, required) {
  console.log("-".repeat(72));
  console.log(`$ ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, { stdio: "inherit", env: process.env });
  if (required && result.status !== 0) process.exit(result.status ?? 1);
  return result.status ?? 0;
}

console.log("CH-MARL portal preflight");
for (const [command, args, required] of steps) run(command, args, required);
console.log("-".repeat(72));
console.log("Preflight completed. Start the portal with pnpm dev, then run pnpm smoke in another terminal.");
