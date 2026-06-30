#!/usr/bin/env node

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
    return response.ok;
  } catch (error) {
    console.log(`${label.padEnd(24)} FAIL ${url} · ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

console.log("Codespaces port forwarding diagnostic");
console.log("-".repeat(72));
let localOk = false;
for (const item of ports) {
  if (!Number.isFinite(item.port) || item.port <= 0) continue;
  const ok = await probe(`${item.name} local`, `http://127.0.0.1:${item.port}${item.path}`);
  localOk = localOk || ok;
}
console.log("-".repeat(72));
for (const item of ports) {
  if (!Number.isFinite(item.port) || item.port <= 0) continue;
  const url = codespacesUrl(item.port, item.path);
  if (url) await probe(`${item.name} fw`, url);
}
console.log("-".repeat(72));
console.log(localOk ? "At least one local portal endpoint is alive." : "No local portal endpoint responded. Start pnpm dev first.");
