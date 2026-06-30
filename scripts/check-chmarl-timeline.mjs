#!/usr/bin/env node

const baseUrl = process.env.PORTAL_BASE_URL ?? `http://127.0.0.1:${process.env.PORT ?? "8787"}`;

const response = await fetch(`${baseUrl}/api/chmarl/episode`, { headers: { Accept: "application/json" } });
const payload = await response.json().catch(() => null);
console.log(`CH-MARL timeline diagnostic ${response.status} ${response.statusText}`);
if (!response.ok) process.exit(1);
const steps = Array.isArray(payload?.steps) ? payload.steps : [];
let decisions = 0;
for (const step of steps) {
  const timeline = Array.isArray(step.hierarchyDecisions) ? step.hierarchyDecisions : [];
  decisions += timeline.length;
  for (const decision of timeline.slice(0, 3)) {
    console.log(`${step.timestamp ?? step.step} ${decision.level ?? "level"}: ${decision.decisionLabel ?? decision.decisionId ?? "decision"}`);
  }
}
console.log(`steps=${steps.length} decisions=${decisions}`);
if (steps.length > 0 && decisions === 0) process.exit(2);
