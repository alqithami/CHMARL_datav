#!/usr/bin/env node

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const baseUrl = process.env.PORTAL_BASE_URL ?? `http://127.0.0.1:${process.env.PORT ?? "8787"}`;
const outputPath = resolve(process.env.SNAPSHOT_FILE ?? `.runtime/snapshot-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
const endpoints = ["/health", "/api/vessels", "/api/chmarl/episode", "/api/weather", "/api/port-events"];

async function fetchJson(path) {
  try {
    const response = await fetch(`${baseUrl}${path}`, { headers: { Accept: "application/json" } });
    const text = await response.text();
    return { ok: response.ok, status: response.status, body: text ? JSON.parse(text) : null };
  } catch (error) {
    return { ok: false, status: 0, error: error instanceof Error ? error.message : String(error) };
  }
}

const snapshot = {
  createdAt: new Date().toISOString(),
  baseUrl,
  endpoints: {},
};

for (const endpoint of endpoints) {
  snapshot.endpoints[endpoint] = await fetchJson(endpoint);
}

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, JSON.stringify(snapshot, null, 2));
console.log(`Runtime snapshot written to ${outputPath}`);
