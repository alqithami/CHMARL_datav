#!/usr/bin/env node

const baseUrl = process.env.PORTAL_BASE_URL ?? `http://127.0.0.1:${process.env.PORT ?? "8787"}`;
const token = process.env.CHMARL_INGEST_TOKEN;
const now = new Date().toISOString();
const experimentId = `manual-demo-${now.slice(0, 10)}`;

const payload = {
  experimentId,
  scenarioId: "manual-demo",
  steps: [
    {
      experimentId,
      scenarioId: "manual-demo",
      episode: 1,
      step: Math.floor(Date.now() / 1000),
      timestamp: now,
      state: { source: "manual-ingest", note: "Operator-triggered CH-MARL demo ingest" },
      actions: [{ agentId: "coordinator", agentType: "fleet", actionType: "manual_validation", actionValue: true }],
      rewards: [{ agentId: "coordinator", component: "global", value: 0.82 }],
      constraints: [{ constraintId: "manual-demo", name: "Manual demo constraint", value: 18, limit: 100, satisfied: true, severity: "low" }],
      hierarchyDecisions: [{ level: "coordinator", decisionId: "manual-demo", decisionLabel: "Manual ingest validation", rationale: "Synthetic CH-MARL step used only to validate the ingest endpoint and UI path." }],
    },
  ],
};

const headers = { "content-type": "application/json", accept: "application/json" };
if (token) headers.authorization = `Bearer ${token}`;

const response = await fetch(`${baseUrl}/api/chmarl/ingest`, { method: "POST", headers, body: JSON.stringify(payload) });
const body = await response.text();
console.log(`POST /api/chmarl/ingest ${response.status} ${response.statusText}`);
console.log(body);
if (!response.ok) process.exit(1);
