#!/usr/bin/env node

import { existsSync } from "node:fs";

const hasPackageLock = existsSync("package-lock.json");
const hasPnpmLock = existsSync("pnpm-lock.yaml");

console.log("Lockfile drift check");
console.log("-".repeat(64));
console.log(`pnpm-lock.yaml: ${hasPnpmLock ? "present" : "missing"}`);
console.log(`package-lock.json: ${hasPackageLock ? "present" : "missing"}`);

if (hasPackageLock) {
  console.log("WARN: package-lock.json is present. This project uses pnpm; remove package-lock.json before committing.");
}

if (!hasPnpmLock) {
  console.log("WARN: pnpm-lock.yaml is missing. Run pnpm install and commit the lockfile if dependency versions change.");
}

if (hasPackageLock) process.exit(1);
