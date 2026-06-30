#!/usr/bin/env node

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const baseUrl = process.env.PORTAL_BASE_URL ?? `http://127.0.0.1:${process.env.PORT ?? "8787"}`;
const output = resolve(process.env.PORT_EVENTS_CSV_FILE ?? `.runtime/port-events-${new Date().toISOString().replace(/[:.]/g, "-")}.csv`);
const columns = ["eventId", "vesselId", "portId", "berthId", "eventType", "timestamp"];

function csvCell(value) {
  const text = value === undefined || value === null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function rows(payload) {
  if (Array.isArray(payload?.portEvents)) return payload.portEvents;
  if (Array.isArray(payload?.events)) return payload.events;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

const response = await fetch(`${baseUrl}/api/port-events`, { headers: { Accept: "application/json" } });
if (!response.ok) {
  console.log(`/api/port-events ${response.status} ${response.statusText}; no CSV exported because backend provider is not active.`);
  process.exit(0);
}
const payload = await response.json();
const events = rows(payload);
const csv = [columns.join(","), ...events.map((row) => columns.map((column) => csvCell(row[column])).join(","))].join("\n");
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${csv}\n`);
console.log(`Exported ${events.length} port event(s) to ${output}`);
