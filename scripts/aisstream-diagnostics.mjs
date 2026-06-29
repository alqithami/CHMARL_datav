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

function parseBoundingBoxes(value) {
  return value.split("|").map((box) => {
    const corners = box.split(";").map((corner) => corner.split(",").map((item) => Number(item.trim())));
    if (corners.length !== 2 || corners.some((corner) => corner.length !== 2 || corner.some((number) => !Number.isFinite(number)))) {
      throw new Error(`Invalid AISSTREAM_BBOX segment: ${box}`);
    }
    return corners;
  });
}

function messageType(payload) {
  if (!payload || typeof payload !== "object") return "unknown";
  return payload.MessageType ?? payload.messageType ?? payload.type ?? "unknown";
}

function printSummary(opened, received, seenTypes, lastError) {
  console.log("-".repeat(64));
  console.log(`Opened: ${opened ? "yes" : "no"}`);
  console.log(`Messages received: ${received}`);
  console.log(`Types: ${[...seenTypes.entries()].map(([type, count]) => `${type}:${count}`).join(", ") || "none"}`);
  if (lastError) console.log(`Last error: ${lastError}`);
}

loadEnvFile(".env");
loadEnvFile(".env.local");

const regionalBbox = "11,32;31,56";
const focusedBbox = [
  "20.70,38.35;22.95,39.85",
  "23.25,37.15;24.90,38.90",
  "16.15,41.75;17.55,43.35",
  "25.70,49.25;27.25,50.90",
  "24.35,54.35;25.65,55.75",
  "29.20,32.00;30.55,33.25",
].join("|");

const apiKey = process.env.AISSTREAM_API_KEY;
const url = process.env.AISSTREAM_URL ?? "wss://stream.aisstream.io/v0/stream";
const bboxText = process.env.AISSTREAM_USE_SAUDI_PORT_BBOXES === "true" ? focusedBbox : (process.env.AISSTREAM_BBOX ?? regionalBbox);
const filterTypes = (process.env.AISSTREAM_FILTER_TYPES ?? "")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);
const timeoutMs = Number(process.env.AISSTREAM_DIAGNOSTIC_MS ?? 30000);
const passAfterMessages = Math.max(1, Number(process.env.AISSTREAM_DIAGNOSTIC_PASS_MESSAGES ?? 1));

console.log("AISStream direct diagnostic");
console.log("-".repeat(64));
console.log(`URL: ${url}`);
console.log(`API key loaded: ${apiKey ? "yes" : "no"}`);

if (!apiKey) {
  console.log("FAIL: AISSTREAM_API_KEY is missing from .env.local or environment.");
  process.exit(2);
}

let boxes;
try {
  boxes = parseBoundingBoxes(bboxText);
} catch (error) {
  console.log(`FAIL: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
}

console.log(`Bounding boxes: ${boxes.length}`);
console.log(`Message filters: ${filterTypes.join(", ") || "none"}`);
console.log(`Timeout: ${timeoutMs} ms`);
console.log(`Pass threshold: ${passAfterMessages} message(s)`);
console.log("-".repeat(64));

let opened = false;
let received = 0;
let lastError = "";
const seenTypes = new Map();
const socket = new WebSocket(url);

const timer = setTimeout(() => {
  socket.close();
  printSummary(opened, received, seenTypes, lastError);
  if (!opened) process.exit(3);
  if (received === 0) process.exit(4);
  console.log("PASS: AISStream is active and returned at least one message.");
  process.exit(0);
}, timeoutMs);

timer.unref?.();

socket.on("open", () => {
  opened = true;
  console.log("Socket opened. Subscription sent.");
  socket.send(JSON.stringify({ APIKey: apiKey, BoundingBoxes: boxes, ...(filterTypes.length > 0 ? { FilterMessageTypes: filterTypes } : {}) }));
});

socket.on("message", (data) => {
  try {
    const payload = JSON.parse(data.toString());
    if (payload.error) {
      lastError = String(payload.error);
      console.log(`Provider error: ${lastError}`);
      return;
    }
    received += 1;
    const type = String(messageType(payload));
    seenTypes.set(type, (seenTypes.get(type) ?? 0) + 1);
    if (received <= 5) console.log(`Message ${received}: ${type}`);
    if (received >= passAfterMessages) {
      socket.close();
      clearTimeout(timer);
      printSummary(opened, received, seenTypes, lastError);
      console.log("PASS: AISStream is active and returning messages.");
      process.exit(0);
    }
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
  }
});

socket.on("error", (error) => {
  lastError = error.message;
  console.log(`Socket error: ${lastError}`);
});

socket.on("close", () => {
  if (!opened) console.log("Socket closed before opening.");
});
