#!/usr/bin/env node

const baseUrl = process.env.PORTAL_BASE_URL ?? `http://127.0.0.1:${process.env.PORT ?? "8787"}`;

function steps(payload) {
  return Array.isArray(payload?.steps) ? payload.steps : Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.items) ? payload.items : [];
}

function rewards(step) {
  return Array.isArray(step?.rewards) ? step.rewards : [];
}

const response = await fetch(`${baseUrl}/api/chmarl/episode`, { headers: { Accept: "application/json" } });
const payload = await response.json().catch(() => null);
console.log(`CH-MARL component summary ${response.status} ${response.statusText}`);
if (!response.ok) process.exit(1);

const totals = new Map();
const counts = new Map();
for (const step of steps(payload)) {
  for (const reward of rewards(step)) {
    const value = Number(reward.value);
    if (!Number.isFinite(value)) continue;
    totals.set(reward.component, (totals.get(reward.component) ?? 0) + value);
    counts.set(reward.component, (counts.get(reward.component) ?? 0) + 1);
  }
}

console.log("component        count       avg       total");
console.log("-".repeat(48));
for (const [component, total] of [...totals.entries()].sort()) {
  const count = counts.get(component) ?? 0;
  const avg = count > 0 ? total / count : 0;
  console.log(`${component.padEnd(16)} ${String(count).padStart(5)} ${avg.toFixed(3).padStart(9)} ${total.toFixed(3).padStart(10)}`);
}
