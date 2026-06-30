#!/usr/bin/env node

const baseUrl = process.env.PORTAL_BASE_URL ?? `http://127.0.0.1:${process.env.PORT ?? "8787"}`;
const minTrailRows = Number(process.env.MIN_TRAIL_ROWS ?? 0);

const response = await fetch(`${baseUrl}/api/vessels`, { headers: { Accept: "application/json" } });
if (!response.ok) throw new Error(`/api/vessels ${response.status} ${response.statusText}`);
const payload = await response.json();
const rows = Array.isArray(payload.vessels) ? payload.vessels : [];
const withTrail = rows.filter((row) => Array.isArray(row.trail) && row.trail.length > 1);
const maxTrail = Math.max(0, ...rows.map((row) => Array.isArray(row.trail) ? row.trail.length : 0));
console.log("Vessel trail diagnostic");
console.log("-".repeat(64));
console.log(`rows=${rows.length} withTrail=${withTrail.length} maxTrail=${maxTrail}`);
for (const row of withTrail.slice(0, 10)) console.log(`${row.id ?? row.name}: trail=${row.trail.length}`);
if (withTrail.length < minTrailRows) process.exit(2);
