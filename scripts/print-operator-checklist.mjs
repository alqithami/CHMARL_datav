#!/usr/bin/env node

const checklist = [
  "Open the single-port Codespaces URL on port 8787.",
  "Confirm Provider quality shows AIS live or AIS waiting, not No vessel feed.",
  "Confirm Weather shows backend Open-Meteo with at least one point.",
  "Confirm Port ops is Kpler-like demo events until a real PORT_EVENTS_URL is connected.",
  "Wait until at least one AIS vessel row appears before judging CH-MARL state.",
  "Confirm CH-MARL reward components using pnpm diagnose:chmarl.",
  "Confirm reward movement using pnpm diagnose:reward-stability after several runtime steps.",
  "Use pnpm snapshot before reporting a bug so endpoint payloads are preserved.",
];

console.log("CH-MARL portal operator checklist");
console.log("-".repeat(72));
for (const [index, item] of checklist.entries()) console.log(`${String(index + 1).padStart(2)}. ${item}`);
