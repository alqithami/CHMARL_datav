#!/usr/bin/env node

const baseUrl = process.env.PORTAL_BASE_URL ?? `http://127.0.0.1:${process.env.PORT ?? "8787"}`;
const tolerance = Number(process.env.CHMARL_FORMULA_TOLERANCE ?? 0.015);

function steps(payload) {
  return Array.isArray(payload?.steps) ? payload.steps : [];
}

function reward(step, component) {
  const match = (Array.isArray(step?.rewards) ? step.rewards : []).find((item) => item.component === component);
  return Number.isFinite(Number(match?.value)) ? Number(match.value) : undefined;
}

const response = await fetch(`${baseUrl}/api/chmarl/episode`, { headers: { Accept: "application/json" } });
const payload = await response.json().catch(() => null);
console.log(`CH-MARL formula check ${response.status} ${response.statusText}`);
if (!response.ok) process.exit(1);

let failures = 0;
for (const step of steps(payload)) {
  const global = reward(step, "global");
  const throughput = reward(step, "throughput");
  const safety = reward(step, "safety");
  const fairness = reward(step, "fairness");
  const delay = reward(step, "delay");
  const state = step.state ?? {};
  const speedScore = Number(state.speedScore ?? state.avgSpeedKnots ? Math.min(1, Number(state.avgSpeedKnots ?? 0) / 14) : 0);
  const congestion = Number(state.congestionScore ?? (delay !== undefined ? 1 + delay : 0));
  if ([global, throughput, safety, fairness].some((value) => value === undefined)) continue;
  const expected = Math.max(0, Math.min(1, 0.30 * throughput + 0.25 * safety + 0.20 * fairness + 0.15 * congestion + 0.10 * speedScore));
  const delta = Math.abs(global - expected);
  console.log(`${step.timestamp ?? step.step} global=${global.toFixed(3)} expected=${expected.toFixed(3)} delta=${delta.toFixed(3)}`);
  if (delta > tolerance) failures += 1;
}

if (failures > 0) {
  console.log(`FAIL: ${failures} step(s) differ from the expected online formula by more than ${tolerance}.`);
  process.exit(2);
}
console.log("CH-MARL formula check completed.");
