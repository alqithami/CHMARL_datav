#!/usr/bin/env node

const commands = [
  "git pull --ff-only",
  "pnpm install",
  "pnpm diagnose:env",
  "pnpm diagnose:ais",
  "pnpm dev",
  "# second terminal:",
  "pnpm wait:portal",
  "pnpm smoke",
  "pnpm wait:vessels",
  "pnpm diagnose:contracts",
  "pnpm diagnose:map",
  "pnpm diagnose:weather",
  "pnpm diagnose:chmarl",
  "pnpm watch:health",
];

console.log("Recommended CH-MARL portal test plan");
console.log("-".repeat(72));
for (const command of commands) console.log(command);
console.log("-".repeat(72));
console.log("Use the single-port Codespaces forwarded URL on port 8787 for browser testing.");
