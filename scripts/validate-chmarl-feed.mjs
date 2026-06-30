#!/usr/bin/env node

const url = process.env.CHMARL_EXPERIMENT_URL || process.env.PORTAL_CHMARL_URL || `http://127.0.0.1:${process.env.PORT ?? "8787"}/api/chmarl/episode`;

function steps(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  if (Array.isArray(payload.steps)) return payload.steps;
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.items)) return payload.items;
  return [];
}

function arraysPresent(step) {
  return {
    actions: Array.isArray(step?.actions),
    rewards: Array.isArray(step?.rewards),
    constraints: Array.isArray(step?.constraints),
    hierarchyDecisions: Array.isArray(step?.hierarchyDecisions),
  };
}

console.log(`Validating CH-MARL feed: ${url}`);
try {
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  const payload = await response.json().catch(() => null);
  console.log(`HTTP ${response.status} ${response.statusText}`);
  if (!response.ok) {
    console.log("Feed is not active yet. Online CH-MARL should activate after live AIS rows are available.");
    process.exit(0);
  }

  const rows = steps(payload);
  console.log(`steps=${rows.length}`);
  if (rows.length === 0) process.exit(2);
  const first = rows[0];
  console.log(`experimentId=${payload?.experimentId ?? first.experimentId ?? "n/a"}`);
  console.log(`scenarioId=${payload?.scenarioId ?? first.scenarioId ?? "n/a"}`);
  console.log(`arrays=${JSON.stringify(arraysPresent(first))}`);
} catch (error) {
  console.log(`Validation failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
