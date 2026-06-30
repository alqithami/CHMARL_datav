#!/usr/bin/env node

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const baseUrl = process.env.PORTAL_BASE_URL ?? `http://127.0.0.1:${process.env.PORT ?? "8787"}`;
const output = resolve(process.env.VESSEL_CSV_FILE ?? `.runtime/vessels-${new Date().toISOString().replace(/[:.]/g, "-")}.csv`);
const columns = ["id", "name", "route", "cargo", "eta", "speed", "status", "latitude", "longitude", "headingDeg", "courseDeg", "timestamp"];

function csvCell(value) {
  const text = value === undefined || value === null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const response = await fetch(`${baseUrl}/api/vessels`, { headers: { Accept: "application/json" } });
if (!response.ok) throw new Error(`/api/vessels ${response.status} ${response.statusText}`);
const payload = await response.json();
const rows = Array.isArray(payload.vessels) ? payload.vessels : [];
const csv = [columns.join(","), ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(","))].join("\n");
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${csv}\n`);
console.log(`Exported ${rows.length} vessel row(s) to ${output}`);
