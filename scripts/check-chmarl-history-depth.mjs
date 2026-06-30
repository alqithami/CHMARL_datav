#!/usr/bin/env node

const baseUrl = process.env.PORTAL_BASE_URL ?? `http://127.0.0.1:${process.env.PORT ?? "8787"}`;
const minSteps = Number(process.env.CHMARL_MIN_HISTORY_STEPS ?? 2);

const response = await fetch(`${baseUrl}/api/chmarl/episode`, { headers: { Accept: "application/json" } });
const payload = await response.json().catch(() => null);
console.log(`CH-MARL history depth ${response.status} ${response.statusText}`);
if (!response.ok) process.exit(1);
const steps = Array.isArray(payload?.steps) ? payload.steps : [];
const timestamps = steps.map((step) => step.timestamp).filter(Boolean);
console.log(`steps=${steps.length} minRequired=${minSteps}`);
console.log(`first=${timestamps[0] ?? "n/a"}`);
console.log(`last=${timestamps.at(-1) ?? "n/a"}`);
if (steps.length < minSteps) {
  console.log("WAIT: CH-MARL online runtime needs more AIS changes or time to accumulate a trend history.");
  process.exit(2);
}
console.log("CH-MARL history depth is sufficient for trend display.");
