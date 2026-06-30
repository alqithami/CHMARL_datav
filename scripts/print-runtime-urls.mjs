#!/usr/bin/env node

const ports = [
  { label: "Single-port portal", port: process.env.PORT ?? "8787", path: "/" },
  { label: "Backend health", port: process.env.PORT ?? "8787", path: "/health" },
  { label: "Dashboard mirror", port: process.env.VITE_MIRROR_PORT ?? "3000", path: "/" },
  { label: "Vite dashboard", port: process.env.VITE_PORT ?? "5173", path: "/" },
];

const codespace = process.env.CODESPACE_NAME;
const domain = process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN ?? "app.github.dev";

console.log("Runtime URLs");
console.log("-".repeat(72));
for (const item of ports) {
  console.log(`${item.label.padEnd(20)} local:     http://127.0.0.1:${item.port}${item.path}`);
  if (codespace) console.log(`${"".padEnd(20)} forwarded: https://${codespace}-${item.port}.${domain}${item.path}`);
}
console.log("-".repeat(72));
console.log("For Codespaces, prefer the single-port portal on 8787. Use 3000 only if 8787 forwarding is stale.");
