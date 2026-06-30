#!/usr/bin/env node

const baseUrl = process.env.PORTAL_BASE_URL ?? `http://127.0.0.1:${process.env.PORT ?? "8787"}`;

function steps(payload) {
  return Array.isArray(payload?.steps) ? payload.steps : Array.isArray(payload?.data) ? payload.data : [];
}

const response = await fetch(`${baseUrl}/api/chmarl/episode`, { headers: { Accept: "application/json" } });
const payload = await response.json().catch(() => null);
console.log(`CH-MARL constraint summary ${response.status} ${response.statusText}`);
if (!response.ok) process.exit(1);

const summary = new Map();
for (const step of steps(payload)) {
  for (const constraint of Array.isArray(step?.constraints) ? step.constraints : []) {
    const key = constraint.constraintId ?? constraint.name ?? "unknown";
    const row = summary.get(key) ?? { name: constraint.name ?? key, count: 0, violated: 0, latest: null };
    row.count += 1;
    if (!constraint.satisfied) row.violated += 1;
    row.latest = constraint;
    summary.set(key, row);
  }
}

console.log("constraint                 count violated latestValue limit severity");
console.log("-".repeat(76));
for (const row of [...summary.values()].sort((a, b) => b.violated - a.violated || a.name.localeCompare(b.name))) {
  const latest = row.latest ?? {};
  console.log(`${row.name.padEnd(26)} ${String(row.count).padStart(5)} ${String(row.violated).padStart(8)} ${String(latest.value ?? "n/a").padStart(11)} ${String(latest.limit ?? "n/a").padStart(5)} ${latest.severity ?? "n/a"}`);
}
if (summary.size === 0) {
  console.log("No constraints found in CH-MARL episode steps.");
  process.exit(2);
}
