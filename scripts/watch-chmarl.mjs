#!/usr/bin/env node

const baseUrl = process.env.PORTAL_BASE_URL ?? `http://127.0.0.1:${process.env.PORT ?? "8787"}`;
const intervalMs = Number(process.env.WATCH_INTERVAL_MS ?? 5000);
const iterations = Number(process.env.WATCH_ITERATIONS ?? 24);

async function loadEpisode() {
  const response = await fetch(`${baseUrl}/api/chmarl/episode`, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

function steps(payload) {
  return Array.isArray(payload?.steps) ? payload.steps : [];
}

function reward(step, component = "global") {
  const match = (Array.isArray(step?.rewards) ? step.rewards : []).find((item) => item.component === component);
  return Number.isFinite(Number(match?.value)) ? Number(match.value) : undefined;
}

console.log(`Watching CH-MARL runtime at ${baseUrl}/api/chmarl/episode`);
for (let index = 0; index < iterations; index += 1) {
  try {
    const payload = await loadEpisode();
    const rows = steps(payload);
    const latest = rows.at(-1);
    console.log(`${new Date().toISOString()} source=${payload.source ?? "unknown"} steps=${rows.length} global=${reward(latest)?.toFixed(3) ?? "n/a"} throughput=${reward(latest, "throughput")?.toFixed(3) ?? "n/a"} fairness=${reward(latest, "fairness")?.toFixed(3) ?? "n/a"} vessels=${latest?.state?.vesselCount ?? "n/a"}`);
  } catch (error) {
    console.log(`${new Date().toISOString()} WAIT ${error instanceof Error ? error.message : String(error)}`);
  }
  if (index < iterations - 1) await new Promise((resolve) => setTimeout(resolve, intervalMs));
}
