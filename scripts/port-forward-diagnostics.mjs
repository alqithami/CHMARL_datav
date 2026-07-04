#!/usr/bin/env node

import { execFileSync } from "node:child_process";

const ports = [
  { name: "single-port portal", port: Number(process.env.PORT ?? 8787), path: "/" },
  { name: "backend health", port: Number(process.env.PORT ?? 8787), path: "/health" },
  { name: "dashboard mirror", port: Number(process.env.VITE_MIRROR_PORT ?? 3000), path: "/" },
  { name: "vite dashboard", port: Number(process.env.VITE_PORT ?? 5173), path: "/" },
];

function codespacesUrl(port, path) {
  const name = process.env.CODESPACE_NAME;
  const domain = process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN ?? "app.github.dev";
  return name ? `https://${name}-${port}.${domain}${path}` : null;
}

async function probe(label, url) {
  try {
    const response = await fetch(url, { headers: { Accept: "application/json,text/html" } });
    console.log(`${label.padEnd(24)} ${String(response.status).padEnd(4)} ${url}`);
    return { ok: response.ok, status: response.status, url };
  } catch (error) {
    console.log(`${label.padEnd(24)} FAIL ${url} · ${error instanceof Error ? error.message : String(error)}`);
    return { ok: false, status: 0, url, error: error instanceof Error ? error.message : String(error) };
  }
}

function runGh(args) {
  try {
    return execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

console.log("Codespaces port forwarding diagnostic");
console.log("-".repeat(88));
console.log(`CODESPACE_NAME=${process.env.CODESPACE_NAME ?? "not set"}`);
console.log(`GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN=${process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN ?? "app.github.dev"}`);
console.log("-".repeat(88));

const localResults = [];
for (const item of ports) {
  if (!Number.isFinite(item.port) || item.port <= 0) continue;
  localResults.push(await probe(`${item.name} local`, `http://127.0.0.1:${item.port}${item.path}`));
}

console.log("-".repeat(88));
const forwardResults = [];
for (const item of ports) {
  if (!Number.isFinite(item.port) || item.port <= 0) continue;
  const url = codespacesUrl(item.port, item.path);
  if (url) forwardResults.push(await probe(`${item.name} fw`, url));
}

console.log("-".repeat(88));
const localOk = localResults.some((result) => result.ok);
const external404 = forwardResults.some((result) => result.status === 404);
console.log(localOk ? "LOCAL: at least one portal endpoint is alive." : "LOCAL: no portal endpoint responded. Start pnpm dev:proxy first.");
if (localOk && external404) {
  console.log("FORWARDING: local services are alive, but Codespaces returned 404 externally. This is a Codespaces port-forward registration/visibility problem, not a React build failure.");
}

if (process.env.CODESPACE_NAME) {
  console.log("-".repeat(88));
  console.log("gh codespace ports:");
  console.log(runGh(["codespace", "ports", "-c", process.env.CODESPACE_NAME]));
  console.log("-".repeat(88));
  console.log("Recommended repair command:");
  console.log(`gh codespace ports visibility 5173:public 3000:public 8787:public -c ${process.env.CODESPACE_NAME}`);
  console.log("Then reopen 5173 or 3000 from the Codespaces Ports tab, not from browser history.");
}
