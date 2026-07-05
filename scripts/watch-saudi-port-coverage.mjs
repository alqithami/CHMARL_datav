#!/usr/bin/env node

import { spawn } from "node:child_process";

const intervalMs = Math.max(5000, Number(process.env.PORT_WATCH_INTERVAL_MS ?? 30000));
const maxCycles = Math.max(0, Number(process.env.PORT_WATCH_CYCLES ?? 0));
let cycle = 0;

function runSummary() {
  cycle += 1;
  const stamp = new Date().toLocaleTimeString();
  console.log(`\n[${stamp}] Saudi AIS coverage watch cycle ${cycle}`);
  console.log("=".repeat(88));

  const child = spawn(process.execPath, ["scripts/summarize-vessels-by-port.mjs"], {
    stdio: "inherit",
    env: process.env,
  });

  child.on("exit", (code) => {
    if (code && code !== 0) console.log(`summary:ports exited with code ${code}; keep backend running with pnpm dev:proxy.`);
    if (maxCycles > 0 && cycle >= maxCycles) process.exit(code ?? 0);
  });
}

console.log("Live Saudi AIS port coverage watcher");
console.log(`intervalMs=${intervalMs} maxCycles=${maxCycles === 0 ? "unlimited" : maxCycles}`);
console.log("Run this while the backend is active, for example in a second terminal after pnpm dev:proxy.");

runSummary();
setInterval(runSummary, intervalMs);
