#!/usr/bin/env node

import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";

const files = ["dist/index.html"];
const dirs = ["dist/assets"];

console.log("Build artifact verification");
console.log("-".repeat(64));
let ok = true;
for (const file of files) {
  const path = resolve(file);
  const exists = existsSync(path) && statSync(path).isFile();
  console.log(`${exists ? "OK  " : "FAIL"} file ${file}`);
  ok = ok && exists;
}
for (const dir of dirs) {
  const path = resolve(dir);
  const exists = existsSync(path) && statSync(path).isDirectory();
  console.log(`${exists ? "OK  " : "FAIL"} dir  ${dir}`);
  ok = ok && exists;
}
if (!ok) {
  console.log("Run pnpm build or pnpm dev:single to create production artifacts.");
  process.exit(1);
}
console.log("Build artifacts are present.");
