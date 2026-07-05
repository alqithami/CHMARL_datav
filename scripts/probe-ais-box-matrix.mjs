#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import WebSocket from "ws";

function loadEnvFile(fileName) {
  const filePath = resolve(process.cwd(), fileName);
  if (!existsSync(filePath)) return;
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const equals = trimmed.indexOf("=");
    if (equals === -1) continue;
    const key = trimmed.slice(0, equals).trim();
    let value = trimmed.slice(equals + 1).trim();
    if (!key || process.env[key] !== undefined) continue;
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[key] = value;
  }
}

const labeledBoxes = [
  { label: "Regional broad Red Sea/Gulf", bbox: "11,32;31,56" },
  { label: "Jeddah + King Abdullah Port", bbox: "20.70,38.35;22.95,39.85" },
  { label: "Yanbu", bbox: "23.25,37.15;24.90,38.90" },
  { label: "Jizan", bbox: "16.15,41.75;17.55,43.35" },
  { label: "Dammam / Ras Tanura", bbox: "25.70,49.25;27.25,50.90" },
  { label: "Jebel Ali reference", bbox: "24.35,54.35;25.65,55.75" },
  { label: "Suez reference", bbox: "29.20,32.00;30.55,33.25" },
];

const ports = [
  { id: "Jeddah", latitude: 21.4858, longitude: 39.1925 },
  { id: "King Abdullah Port", latitude: 22.3924, longitude: 39.0953 },
  { id: "Yanbu", latitude: 24.0866, longitude: 38.0637 },
  { id: "Jizan", latitude: 16.8917, longitude: 42.5511 },
  { id: "Dammam", latitude: 26.4318, longitude: 50.1015 },
  { id: "Jebel Ali", latitude: 25.0114, longitude: 55.0611 },
  { id: "Suez", latitude: 29.9668, longitude: 32.5498 },
];

function parseBoundingBox(value) {
  const corners = value.split(";").map((corner) => corner.split(",").map((item) => Number(item.trim())));
  if (corners.length !== 2 || corners.some((corner) => corner.length !== 2 || corner.some((number) => !Number.isFinite(number)))) {
    throw new Error(`Invalid bbox: ${value}`);
  }
  return corners;
}

function messageType(payload) {
  if (!payload || typeof payload !== "object") return "unknown";
  return payload.MessageType ?? payload.messageType ?? payload.type ?? "unknown";
}

function numberValue(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function messageBody(message) {
  const type = message?.MessageType;
  return message?.Message?.[type]
    ?? message?.Message?.PositionReport
    ?? message?.Message?.StandardClassBPositionReport
    ?? message?.Message?.ExtendedClassBPositionReport
    ?? {};
}

function coordinates(payload) {
  const metadata = payload?.MetaData ?? payload?.Metadata ?? {};
  const body = messageBody(payload);
  const latitude = numberValue(metadata.latitude ?? metadata.Latitude ?? body.Latitude);
  const longitude = numberValue(metadata.longitude ?? metadata.Longitude ?? body.Longitude);
  if (latitude === undefined || longitude === undefined) return null;
  return { latitude, longitude };
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

function nearestPort(point) {
  return ports
    .map((port) => ({ port: port.id, distance: distanceNm(point, port) }))
    .sort((a, b) => a.distance - b.distance)[0] ?? null;
}

function probeBox({ label, bbox }, apiKey, url, timeoutMs, passMessages, filterTypes) {
  return new Promise((resolveProbe) => {
    const boxes = [parseBoundingBox(bbox)];
    const seenTypes = new Map();
    const nearestCounts = new Map();
    const samples = [];
    let opened = false;
    let received = 0;
    let lastError = "";
    const socket = new WebSocket(url);
    const timer = setTimeout(() => {
      socket.close();
      resolveProbe({ label, bbox, opened, received, seenTypes, nearestCounts, samples, lastError });
    }, timeoutMs);
    timer.unref?.();

    socket.on("open", () => {
      opened = true;
      socket.send(JSON.stringify({ APIKey: apiKey, BoundingBoxes: boxes, ...(filterTypes.length > 0 ? { FilterMessageTypes: filterTypes } : {}) }));
    });

    socket.on("message", (data) => {
      try {
        const payload = JSON.parse(data.toString());
        if (payload.error) {
          lastError = String(payload.error);
          return;
        }
        received += 1;
        const type = String(messageType(payload));
        seenTypes.set(type, (seenTypes.get(type) ?? 0) + 1);
        const point = coordinates(payload);
        if (point) {
          const nearest = nearestPort(point);
          if (nearest) nearestCounts.set(nearest.port, (nearestCounts.get(nearest.port) ?? 0) + 1);
          if (samples.length < 3) samples.push(`${point.latitude.toFixed(3)},${point.longitude.toFixed(3)} near ${nearest?.port ?? "n/a"} ${nearest ? nearest.distance.toFixed(1) : "?"}nm`);
        }
        if (received >= passMessages) {
          clearTimeout(timer);
          socket.close();
          resolveProbe({ label, bbox, opened, received, seenTypes, nearestCounts, samples, lastError });
        }
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
    });

    socket.on("error", (error) => {
      lastError = error.message;
    });
  });
}

function mapText(map) {
  return [...map.entries()].map(([key, count]) => `${key}:${count}`).join(", ") || "none";
}

loadEnvFile(".env");
loadEnvFile(".env.local");

const apiKey = process.env.AISSTREAM_API_KEY;
const url = process.env.AISSTREAM_URL ?? "wss://stream.aisstream.io/v0/stream";
const timeoutMs = Number(process.env.AISSTREAM_BOX_PROBE_MS ?? 60_000);
const passMessages = Math.max(1, Number(process.env.AISSTREAM_BOX_PROBE_PASS_MESSAGES ?? 1));
const filterTypes = (process.env.AISSTREAM_FILTER_TYPES ?? "").split(",").map((item) => item.trim()).filter(Boolean);

console.log("AISStream per-box probe");
console.log("-".repeat(96));
console.log(`url=${url}`);
console.log(`keyLoaded=${apiKey ? "yes" : "no"}`);
console.log(`timeoutMs=${timeoutMs} passMessages=${passMessages} filters=${filterTypes.join(",") || "none"}`);
console.log("-".repeat(96));

if (!apiKey) {
  console.log("FAIL: AISSTREAM_API_KEY is missing.");
  process.exit(2);
}

let anyMessages = false;
for (const box of labeledBoxes) {
  const result = await probeBox(box, apiKey, url, timeoutMs, passMessages, filterTypes);
  anyMessages = anyMessages || result.received > 0;
  console.log(`${box.label}`);
  console.log(`  bbox=${box.bbox}`);
  console.log(`  opened=${result.opened ? "yes" : "no"} messages=${result.received} types=${mapText(result.seenTypes)} nearest=${mapText(result.nearestCounts)} error=${result.lastError || "none"}`);
  if (result.samples.length > 0) console.log(`  samples=${result.samples.join(" | ")}`);
}

console.log("-".repeat(96));
if (!anyMessages) {
  console.log("FAIL: no AISStream messages were received in any individual box. This points to provider/key/feed availability rather than Saudi filtering in the portal.");
  process.exit(1);
}
console.log("PASS: at least one AISStream box returned messages. Compare Saudi boxes against Suez/regional rows above.");
