#!/usr/bin/env node

const url = process.env.PORT_EVENTS_URL || process.env.PORTAL_PORT_EVENTS_URL || `http://127.0.0.1:${process.env.PORT ?? "8787"}/api/port-events`;

function rows(payload, keys) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  for (const key of keys) if (Array.isArray(payload[key])) return payload[key];
  return [];
}

function validEvent(row) {
  return row && typeof row === "object" && row.portId && row.eventType && row.timestamp;
}

function validUtilization(row) {
  return row && typeof row === "object" && (row.name || row.portId || row.port) && Number.isFinite(Number(row.value ?? row.utilizationPct ?? row.utilization));
}

console.log(`Validating port operations feed: ${url}`);
try {
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  const payload = await response.json().catch(() => null);
  console.log(`HTTP ${response.status} ${response.statusText}`);
  if (!response.ok) {
    console.log("Feed is not active yet. This is expected until PORT_EVENTS_URL is connected or frontend demo mode is enabled.");
    process.exit(0);
  }

  const events = rows(payload, ["portEvents", "port_events", "events", "data", "items"]);
  const utilization = rows(payload, ["portUtilization", "port_utilization", "utilization", "ports"]);
  const queues = rows(payload, ["queueStatus", "queue_status", "queues", "berths"]);
  console.log(`events=${events.length} utilization=${utilization.length} queues=${queues.length}`);
  console.log(`valid events=${events.filter(validEvent).length}/${events.length}`);
  console.log(`valid utilization=${utilization.filter(validUtilization).length}/${utilization.length}`);
  if (events.length === 0 && utilization.length === 0 && queues.length === 0) process.exit(2);
} catch (error) {
  console.log(`Validation failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
