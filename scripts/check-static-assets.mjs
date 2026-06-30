#!/usr/bin/env node

const baseUrl = process.env.PORTAL_BASE_URL ?? `http://127.0.0.1:${process.env.PORT ?? "8787"}`;
const response = await fetch(`${baseUrl}/`, { headers: { Accept: "text/html" } });
const html = await response.text();
if (!response.ok) throw new Error(`dashboard ${response.status} ${response.statusText}`);

const assetMatches = [...html.matchAll(/(?:src|href)="([^"]*\/assets\/[^"]+)"/g)].map((match) => match[1]);
const assets = [...new Set(assetMatches)].slice(0, Number(process.env.ASSET_CHECK_LIMIT ?? 20));
console.log(`Static asset reachability: ${baseUrl}`);
console.log("-".repeat(72));
console.log(`assetsFound=${assetMatches.length} checking=${assets.length}`);
let failed = false;
for (const asset of assets) {
  const url = asset.startsWith("http") ? asset : `${baseUrl}${asset.startsWith("/") ? "" : "/"}${asset}`;
  const assetResponse = await fetch(url);
  console.log(`${assetResponse.ok ? "OK  " : "FAIL"} ${String(assetResponse.status).padEnd(4)} ${url}`);
  failed = failed || !assetResponse.ok;
}
if (failed) process.exit(1);
