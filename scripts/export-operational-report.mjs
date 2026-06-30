#!/usr/bin/env node

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const baseUrl = process.env.PORTAL_BASE_URL ?? `http://127.0.0.1:${process.env.PORT ?? "8787"}`;
const output = resolve(process.env.OPERATIONAL_REPORT_FILE ?? `.runtime/operational-report-${new Date().toISOString().replace(/[:.]/g, "-")}.md`);

async function load(path) {
  const response = await fetch(`${baseUrl}${path}`, { headers: { Accept: "application/json" } });
  const payload = await response.json().catch(() => null);
  return { status: response.status, ok: response.ok, payload };
}

const [health, vessels, chmarl, weather, portOps] = await Promise.all([
  load("/health"),
  load("/api/vessels"),
  load("/api/chmarl/episode"),
  load("/api/weather"),
  load("/api/port-events"),
]);

const vesselRows = Array.isArray(vessels.payload?.vessels) ? vessels.payload.vessels : [];
const steps = Array.isArray(chmarl.payload?.steps) ? chmarl.payload.steps : [];
const latest = steps.at(-1);
const rewards = Array.isArray(latest?.rewards) ? latest.rewards : [];
const reward = rewards.find((item) => item.component === "global")?.value ?? "n/a";
const weatherRows = Array.isArray(weather.payload?.points) ? weather.payload.points : [];
const portEvents = Array.isArray(portOps.payload?.portEvents) ? portOps.payload.portEvents : [];

const report = `# CH-MARL Operational Report

Generated: ${new Date().toISOString()}
Base URL: ${baseUrl}

## Provider Status

- Backend health: ${health.status}
- AIS socket: ${health.payload?.aisstream?.connected ? "connected" : "waiting"}
- AIS cached vessels: ${health.payload?.aisstream?.cachedVessels ?? 0}
- Vessel feed: ${vessels.payload?.source ?? "unknown"} / ${vesselRows.length} rows
- CH-MARL: ${chmarl.ok ? chmarl.payload?.source ?? "runtime" : "inactive"} / ${steps.length} steps
- Weather: ${weather.payload?.source ?? "unknown"} / ${weatherRows.length} points
- Port ops backend: ${portOps.ok ? "active" : "provider missing"} / ${portEvents.length} events

## CH-MARL Latest State

- Reward index: ${reward}
- Scenario: ${chmarl.payload?.scenarioId ?? latest?.scenarioId ?? "n/a"}
- Latest timestamp: ${latest?.timestamp ?? "n/a"}
- State: ${JSON.stringify(latest?.state ?? {}, null, 2)}

## Notes

Port operations may be shown by the frontend Kpler-like demo while the backend provider is pending.
`;

mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, report);
console.log(`Operational report written to ${output}`);
