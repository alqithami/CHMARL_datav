#!/usr/bin/env node

import { readFileSync } from "node:fs";

const baseUrl = process.env.PORTAL_BASE_URL ?? `http://127.0.0.1:${process.env.PORT ?? "8787"}`;
const filePath = process.env.FIXED_VESSELS_FILE ?? process.argv[2] ?? "public/data/manual_vessels.sample.json";
const token = process.env.FIXED_VESSEL_INGEST_TOKEN;

const payload = JSON.parse(readFileSync(filePath, "utf8"));
const headers = { "content-type": "application/json", accept: "application/json" };
if (token) headers.authorization = `Bearer ${token}`;

const response = await fetch(`${baseUrl}/api/vessels/ingest`, {
  method: "POST",
  headers,
  body: JSON.stringify(payload),
});

const body = await response.text();
console.log(body);
if (!response.ok) process.exit(1);
