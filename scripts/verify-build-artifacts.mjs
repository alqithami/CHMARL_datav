#!/usr/bin/env node

import { existsSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";

const files = ["dist/index.html"];
const dirs = ["dist/assets"];
const maxJavaScriptChunkBytes = Math.max(
  100_000,
  Number(process.env.MAX_PRODUCTION_JS_CHUNK_BYTES ?? 900_000)
);
const forbiddenChunkPatterns = [
  /vendor-three-/i,
  /vendor-echarts-/i,
];

console.log("Build artifact verification");
console.log("-".repeat(72));
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

const assetDirectory = resolve("dist/assets");
if (existsSync(assetDirectory) && statSync(assetDirectory).isDirectory()) {
  const javascriptAssets = readdirSync(assetDirectory)
    .filter((name) => name.endsWith(".js"))
    .map((name) => ({
      name,
      bytes: statSync(resolve(assetDirectory, name)).size,
    }))
    .sort((a, b) => b.bytes - a.bytes);

  if (javascriptAssets.length === 0) {
    console.log("FAIL no JavaScript assets were generated");
    ok = false;
  }

  for (const asset of javascriptAssets) {
    const sizeKb = (asset.bytes / 1024).toFixed(1).padStart(7);
    const forbidden = forbiddenChunkPatterns.some((pattern) =>
      pattern.test(asset.name)
    );
    const oversized = asset.bytes > maxJavaScriptChunkBytes;
    const state = forbidden || oversized ? "FAIL" : "OK  ";
    console.log(`${state} js   ${sizeKb} kB  ${asset.name}`);

    if (forbidden) {
      console.log(
        `     ${asset.name} is a retired forced bundle; use only modules reached by the active Leaflet and ECharts imports.`
      );
      ok = false;
    }
    if (oversized) {
      console.log(
        `     ${asset.name} exceeds the ${Math.round(maxJavaScriptChunkBytes / 1024)} kB production chunk budget.`
      );
      ok = false;
    }
  }
}

if (!ok) {
  console.log(
    "Run pnpm build and review Vite module imports or manual chunking before deployment."
  );
  process.exit(1);
}
console.log("Build artifacts and production bundle budgets are valid.");
