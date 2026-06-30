#!/usr/bin/env node

const baseUrl = process.env.PORTAL_BASE_URL ?? `http://127.0.0.1:${process.env.PORT ?? "8787"}`;
const windowSize = Number(process.env.CHMARL_STABILITY_WINDOW ?? 10);
const minRange = Number(process.env.CHMARL_MIN_REWARD_RANGE ?? 0.005);

function steps(payload) {
  return Array.isArray(payload?.steps) ? payload.steps : [];
}

function reward(step) {
  const found = (Array.isArray(step?.rewards) ? step.rewards : []).find((item) => item.component === "global");
  const value = Number(found?.value);
  return Number.isFinite(value) ? value : undefined;
}

const response = await fetch(`${baseUrl}/api/chmarl/episode`, { headers: { Accept: "application/json" } });
const payload = await response.json().catch(() => null);
console.log(`CH-MARL reward stability window ${response.status} ${response.statusText}`);
if (!response.ok) process.exit(1);
const values = steps(payload).map(reward).filter((value) => value !== undefined).slice(-windowSize);
const min = values.length ? Math.min(...values) : undefined;
const max = values.length ? Math.max(...values) : undefined;
const range = min === undefined || max === undefined ? 0 : max - min;
console.log(`window=${values.length}/${windowSize} min=${min?.toFixed(3) ?? "n/a"} max=${max?.toFixed(3) ?? "n/a"} range=${range.toFixed(3)}`);
console.log(`values=${values.map((value) => value.toFixed(3)).join(",") || "none"}`);
if (values.length >= 2 && range < minRange) {
  console.log("WARN: reward is very stable in the current window. Check whether AIS messages are changing enough to move CH-MARL inputs.");
  process.exit(2);
}
