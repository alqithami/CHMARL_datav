#!/usr/bin/env node

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const baseUrl = process.env.PORTAL_BASE_URL ?? `http://127.0.0.1:${process.env.PORT ?? "8787"}`;
const output = resolve(process.env.CHMARL_CSV_FILE ?? `.runtime/chmarl-${new Date().toISOString().replace(/[:.]/g, "-")}.csv`);
const columns = ["timestamp", "episode", "step", "global", "throughput", "safety", "fairness", "delay", "vesselCount", "avgSpeedKnots", "dataQualityScore", "congestionScore"];

function steps(payload) {
  if (Array.isArray(payload?.steps)) return payload.steps;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.items)) return payload.items;
  return [];
}

function reward(step, component) {
  const match = (Array.isArray(step?.rewards) ? step.rewards : []).find((item) => item.component === component);
  return match?.value ?? "";
}

function cell(value) {
  const text = value === undefined || value === null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const response = await fetch(`${baseUrl}/api/chmarl/episode`, { headers: { Accept: "application/json" } });
if (!response.ok) throw new Error(`/api/chmarl/episode ${response.status} ${response.statusText}`);
const payload = await response.json();
const rows = steps(payload);
const lines = [columns.join(",")];
for (const step of rows) {
  const state = step.state ?? {};
  lines.push(columns.map((column) => {
    if (["global", "throughput", "safety", "fairness", "delay"].includes(column)) return cell(reward(step, column));
    return cell(step[column] ?? state[column]);
  }).join(","));
}
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${lines.join("\n")}\n`);
console.log(`Exported ${rows.length} CH-MARL step(s) to ${output}`);
