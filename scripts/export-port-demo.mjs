#!/usr/bin/env node

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const output = resolve(process.env.PORT_DEMO_FILE ?? ".runtime/port_events.demo.json");
const timestamp = new Date().toISOString();
const ports = ["Jeddah", "King Abdullah Port", "Yanbu", "Jizan", "Dammam", "Suez"];
const types = ["arrival", "anchorage_entry", "berth_assigned", "service_started", "departure"];
const portEvents = [];
const portUtilization = [];

for (let portIndex = 0; portIndex < ports.length; portIndex += 1) {
  const portId = ports[portIndex];
  const eventCount = (portIndex % 4) + 1;
  portUtilization.push({ name: portId, value: Math.min(96, Math.max(28, eventCount * 18 + portIndex * 3)) });
  for (let index = 0; index < eventCount; index += 1) {
    const eventType = types[(portIndex + index) % types.length];
    portEvents.push({
      eventId: `demo-kpler-static-${portIndex}-${index}`,
      vesselId: `DEMO-MMSI-${500000000 + portIndex * 1000 + index}`,
      portId,
      berthId: eventType === "berth_assigned" || eventType === "service_started" ? `${portId.slice(0, 3).toUpperCase()}-B${index + 1}` : undefined,
      eventType,
      timestamp,
      metadata: { demo: true, providerShape: "kpler-real-time-events-like" },
    });
  }
}

const payload = { source: "demo", updatedAt: timestamp, portEvents, portUtilization, queueStatus: [] };
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify(payload, null, 2));
console.log(`Wrote ${portEvents.length} demo port event(s) to ${output}`);
