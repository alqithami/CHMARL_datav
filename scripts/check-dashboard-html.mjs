#!/usr/bin/env node

const baseUrl = process.env.PORTAL_BASE_URL ?? `http://127.0.0.1:${process.env.PORT ?? "8787"}`;
const response = await fetch(`${baseUrl}/`, { headers: { Accept: "text/html" } });
const html = await response.text();
console.log(`Dashboard HTML ${response.status} ${response.statusText}`);
if (!response.ok) process.exit(1);
const checks = [
  ["root element", html.includes('id="root"') || html.includes("id='root'")],
  ["module script", html.includes("type=\"module\"") || html.includes("type='module'")],
  ["assets", html.includes("/assets/")],
];
for (const [name, ok] of checks) console.log(`${ok ? "OK  " : "FAIL"} ${name}`);
if (checks.some(([, ok]) => !ok)) process.exit(2);
