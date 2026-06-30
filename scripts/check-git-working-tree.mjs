#!/usr/bin/env node

import { spawnSync } from "node:child_process";

function git(args) {
  const result = spawnSync("git", args, { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : "";
}

const status = git(["status", "--short"]);
const stash = git(["stash", "list"]);

console.log("Git working tree check");
console.log("-".repeat(64));
if (status) {
  console.log(status);
  console.log("-".repeat(64));
  console.log("WARN: working tree has local changes. Stash or commit before pulling remote fixes.");
} else {
  console.log("Working tree is clean.");
}

if (stash) {
  console.log("-".repeat(64));
  console.log("Stashes present:");
  console.log(stash);
}

if (status) process.exit(1);
