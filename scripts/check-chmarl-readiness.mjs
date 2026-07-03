#!/usr/bin/env node

const baseUrl = process.env.PORTAL_BASE_URL ?? `http://127.0.0.1:${process.env.PORT ?? "8787"}`;

const ports = [
  { id: "Jeddah", latitude: 21.4858, longitude: 39.1925 },
  { id: "King Abdullah Port", latitude: 22.3924, longitude: 39.0953 },
  { id: "Yanbu", latitude: 24.0866, longitude: 38.0637 },
  { id: "Jizan", latitude: 16.8917, longitude: 42.5511 },
  { id: "Dammam", latitude: 26.4318, longitude: 50.1015 },
  { id: "Jebel Ali", latitude: 25.0114, longitude: 55.0611 },
  { id: "Suez", latitude: 29.9668, longitude: 32.5498 },
];

async function load(path) {
  const response = await fetch(`${baseUrl}${path}`, { headers: { Accept: "application/json" } });
  return { response, payload: await response.json().catch(() => null) };
}

function rewardMap(step) {
  const map = new Map();
  for (const reward of Array.isArray(step?.rewards) ? step.rewards : []) map.set(reward.component, reward.value);
  return map;
}

function speedKnots(vessel) {
  const parsed = Number.parseFloat(String(vessel?.speed ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function ratio(count, total, fallback = 0) {
  return total > 0 ? count / total : fallback;
}

function timestampMs(value) {
  const parsed = Date.parse(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function distanceNm(a, b) {
  const r = 3440.065;
  const rad = (value) => value * Math.PI / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLon = rad(b.longitude - a.longitude);
  const lat1 = rad(a.latitude);
  const lat2 = rad(b.latitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.min(1, Math.sqrt(h)));
}

function nearestPort(vessel) {
  if (!Number.isFinite(Number(vessel?.latitude)) || !Number.isFinite(Number(vessel?.longitude))) return null;
  const point = { latitude: Number(vessel.latitude), longitude: Number(vessel.longitude) };
  return ports
    .map((port) => ({ port, distance: distanceNm(point, port) }))
    .sort((a, b) => a.distance - b.distance)[0] ?? null;
}

function gini(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((total, value) => total + value, 0);
  if (sum === 0) return 0;
  let weighted = 0;
  for (let index = 0; index < sorted.length; index += 1) weighted += (index + 1) * sorted[index];
  return (2 * weighted) / (sorted.length * sum) - (sorted.length + 1) / sorted.length;
}

function computeLiveReward(vessels) {
  const total = vessels.length;
  const speeds = vessels.map(speedKnots).filter((value) => value !== undefined);
  const moving = speeds.filter((speed) => speed > 0.5).length;
  const lowSpeed = speeds.filter((speed) => speed <= 0.5).length;
  const knownSpeedRatio = ratio(speeds.length, total, 0);
  const movingRatio = ratio(moving, total, 0);
  const lowSpeedPct = ratio(lowSpeed, total, 0);
  const validPositionRatio = ratio(vessels.filter((vessel) => Number.isFinite(Number(vessel.latitude)) && Number.isFinite(Number(vessel.longitude))).length, total, 0);
  const freshRatio = ratio(vessels.filter((vessel) => {
    const ts = timestampMs(vessel.timestamp);
    return ts === 0 || Date.now() - ts <= 30 * 60 * 1000;
  }).length, total, 0);

  const nearestCounts = new Map();
  for (const vessel of vessels) {
    const nearest = nearestPort(vessel);
    if (nearest && nearest.distance <= 120) nearestCounts.set(nearest.port.id, (nearestCounts.get(nearest.port.id) ?? 0) + 1);
  }
  const busiest = [...nearestCounts.entries()].sort((a, b) => b[1] - a[1])[0];
  const portPressure = busiest ? ratio(busiest[1], Math.max(1, total), 0) : 0;
  const speedFairness = speeds.length >= 2 ? clamp(1 - gini(speeds)) : 1;
  const avgSpeed = speeds.length > 0 ? speeds.reduce((sum, value) => sum + value, 0) / speeds.length : 0;
  const speedScore = clamp(avgSpeed / 14, 0, 1);
  const throughputScore = clamp(0.7 * movingRatio + 0.3 * knownSpeedRatio, 0, 1);
  const dataQualityScore = clamp(0.6 * validPositionRatio + 0.4 * freshRatio, 0, 1);
  const congestionScore = clamp(1 - portPressure, 0, 1);
  const reward = clamp(
    0.30 * throughputScore
    + 0.25 * dataQualityScore
    + 0.20 * speedFairness
    + 0.15 * congestionScore
    + 0.10 * speedScore,
    0,
    1,
  );

  return {
    total,
    moving,
    knownSpeedRatio,
    movingRatio,
    lowSpeedPct,
    validPositionRatio,
    freshRatio,
    busiest,
    portPressure,
    speedFairness,
    avgSpeed,
    speedScore,
    throughputScore,
    dataQualityScore,
    congestionScore,
    reward,
  };
}

function nearlyEqual(a, b, epsilon = 0.0015) {
  return typeof a === "number" && typeof b === "number" && Math.abs(a - b) <= epsilon;
}

const health = await load("/health");
const episode = await load("/api/chmarl/episode");
const vessels = await load("/api/vessels");
const vesselRows = Array.isArray(vessels.payload?.vessels) ? vessels.payload.vessels : [];
const steps = Array.isArray(episode.payload?.steps) ? episode.payload.steps : [];
const latest = steps.at(-1);
const calculated = computeLiveReward(vesselRows);

console.log("CH-MARL readiness and live-reward verification");
console.log("-".repeat(72));
console.log(`baseUrl=${baseUrl}`);
console.log(`health=${health.response.status} active=${health.payload?.chmarl?.active ?? false} source=${health.payload?.chmarl?.source ?? "n/a"}`);
console.log(`vessels=${vessels.response.status} source=${vessels.payload?.source ?? "n/a"} rows=${vesselRows.length}`);
console.log(`episode=${episode.response.status} source=${episode.payload?.source ?? "n/a"} steps=${steps.length}`);
console.log(`formula=0.30 throughput + 0.25 dataQuality + 0.20 fairness + 0.15 congestion + 0.10 speed`);
console.log(`computed global=${calculated.reward.toFixed(3)} throughput=${calculated.throughputScore.toFixed(3)} dataQuality=${calculated.dataQualityScore.toFixed(3)} fairness=${calculated.speedFairness.toFixed(3)} congestion=${calculated.congestionScore.toFixed(3)} speed=${calculated.speedScore.toFixed(3)}`);
console.log(`input moving=${calculated.moving}/${calculated.total} avgSpeed=${calculated.avgSpeed.toFixed(3)} busiest=${calculated.busiest?.[0] ?? "none"} portPressure=${calculated.portPressure.toFixed(3)}`);

if (latest) {
  const rewards = rewardMap(latest);
  const global = rewards.get("global");
  console.log(`latestTimestamp=${latest.timestamp ?? "n/a"}`);
  console.log(`reported global=${global ?? "n/a"} throughput=${rewards.get("throughput") ?? "n/a"} safety=${rewards.get("safety") ?? "n/a"} fairness=${rewards.get("fairness") ?? "n/a"} delay=${rewards.get("delay") ?? "n/a"}`);
  console.log(`state=${JSON.stringify(latest.state ?? {})}`);
  if (nearlyEqual(global, Number(calculated.reward.toFixed(3)))) {
    console.log("PASS: Reported CH-MARL global reward matches the live AIS recomputation.");
  } else {
    console.log("FAIL: Reported CH-MARL reward does not match the live AIS recomputation.");
    process.exit(3);
  }
}

if (vesselRows.length === 0) {
  console.log("WAIT: Online CH-MARL needs at least one live vessel row.");
  process.exit(1);
}

if (episode.response.ok && steps.length > 0) {
  console.log(`READY: ${episode.payload?.source ?? "runtime"} ${episode.payload?.scenarioId ?? steps[0]?.scenarioId ?? "unknown"}`);
  process.exit(0);
}

process.exit(2);
