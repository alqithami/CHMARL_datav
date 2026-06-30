#!/usr/bin/env node

const baseUrl = process.env.PORTAL_BASE_URL ?? `http://127.0.0.1:${process.env.PORT ?? "8787"}`;
const minUnique = Number(process.env.CHMARL_MIN_UNIQUE_REWARDS ?? 2);

function steps(payload) {
  if (Array.isArray(payload?.steps)) return payload.steps;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.items)) return payload.items;
  return [];
}

function globalReward(step) {
  const rewards = Array.isArray(step?.rewards) ? step.rewards : [];
  const match = rewards.find((reward) => reward.component === "global");
  return Number.isFinite(Number(match?.value)) ? Number(match.value) : undefined;
}

const response = await fetch(`${baseUrl}/api/chmarl/episode`, { headers: { Accept: "application/json" } });
const payload = await response.json().catch(() => null);
console.log(`CH-MARL variation check ${response.status} ${response.statusText}`);
if (!response.ok) {
  console.log("No active CH-MARL episode feed. Wait for AIS rows or connect a runtime experiment feed.");
  process.exit(1);
}

const rows = steps(payload);
const rewards = rows.map(globalReward).filter((value) => value !== undefined);
const unique = [...new Set(rewards.map((value) => value.toFixed(3)))];
console.log(`steps=${rows.length} rewards=${rewards.length} uniqueRewards=${unique.length}`);
console.log(`rewardSeries=${rewards.slice(-20).map((value) => value.toFixed(3)).join(",") || "none"}`);
if (rewards.length > 1 && unique.length < minUnique) {
  console.log("WARN: CH-MARL reward has not varied across retained runtime steps. Inspect AIS row changes and reward components.");
  process.exit(2);
}
console.log("CH-MARL reward variation check passed.");
