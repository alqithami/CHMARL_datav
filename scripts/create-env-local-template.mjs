#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync, chmodSync } from "node:fs";

const target = ".env.local";
const force = process.argv.includes("--force");

if (existsSync(target) && !force) {
  console.log(`${target} already exists. Re-run with --force to overwrite.`);
  process.exit(0);
}

const template = existsSync(".env.example") ? readFileSync(".env.example", "utf8") : "";
const lines = template
  .split(/\r?\n/)
  .map((line) => {
    if (line.startsWith("AISSTREAM_API_KEY=")) return "AISSTREAM_API_KEY=PASTE_YOUR_AISSTREAM_KEY_HERE";
    if (line.startsWith("AISSTREAM_USE_SAUDI_PORT_BBOXES=")) return "AISSTREAM_USE_SAUDI_PORT_BBOXES=false";
    if (line.startsWith("AISSTREAM_BBOX=")) return "AISSTREAM_BBOX=11,32;31,56";
    if (line.startsWith("AISSTREAM_FILTER_TYPES=")) return "AISSTREAM_FILTER_TYPES=";
    return line;
  });

writeFileSync(target, `${lines.join("\n").trim()}\n`);
chmodSync(target, 0o600);
console.log(`Created ${target}. Add your AISSTREAM_API_KEY before running pnpm dev.`);
