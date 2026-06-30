import type { PortEvent } from "@/types/chmarl";
import { fetchFirstJson } from "./backendUrl";

export type PortUtilizationDatum = {
  name: string;
  value: number;
};

export type PortQueueStatus = {
  portId: string;
  berthId?: string;
  queueLength?: number;
  waitingVessels?: number;
  utilizationPct?: number;
  timestamp?: string;
};

export type PortOperationsFeed = {
  source: "runtime" | "demo";
  portEvents: PortEvent[];
  portUtilization: PortUtilizationDatum[];
  queueStatus: PortQueueStatus[];
};

const demoPorts = ["Jeddah", "King Abdullah Port", "Yanbu", "Jizan", "Dammam", "Suez"];
const demoEventTypes: PortEvent["eventType"][] = ["arrival", "anchorage_entry", "berth_assigned", "service_started", "departure"];

function endpointUrl() {
  return import.meta.env.VITE_PORT_EVENTS_URL?.trim() || "/api/port-events";
}

function demoEnabled() {
  return import.meta.env.VITE_PORT_EVENTS_DEMO_ENABLED !== "false";
}

function runtimePortFeedExplicitlyEnabled() {
  return import.meta.env.VITE_PORT_EVENTS_DEMO_ENABLED === "false";
}

function demoBucket() {
  return Math.floor(Date.now() / (15 * 60 * 1000));
}

function demoUtilizationPct(eventCount: number, portIndex: number, bucket: number) {
  const base = eventCount * 18 + ((bucket + portIndex) % 5) * 4;
  return Math.min(96, Math.max(28, base));
}

function kplerLikeDemoPortOperations(): PortOperationsFeed {
  const bucket = demoBucket();
  const timestamp = new Date(bucket * 15 * 60 * 1000).toISOString();
  const portEvents: PortEvent[] = [];
  const portUtilization: PortUtilizationDatum[] = [];
  const queueStatus: PortQueueStatus[] = [];

  for (let portIndex = 0; portIndex < demoPorts.length; portIndex += 1) {
    const portId = demoPorts[portIndex];
    const eventCount = ((bucket + portIndex * 3) % 4) + 1;
    const utilizationPct = demoUtilizationPct(eventCount, portIndex, bucket);
    const queueLength = Math.max(0, Math.round((utilizationPct - 45) / 12));
    portUtilization.push({ name: portId, value: utilizationPct });
    queueStatus.push({
      portId,
      berthId: `${portId.slice(0, 3).toUpperCase()}-ALL`,
      queueLength,
      waitingVessels: Math.max(queueLength, eventCount - 1),
      utilizationPct,
      timestamp,
    });

    for (let index = 0; index < eventCount; index += 1) {
      const eventType = demoEventTypes[(bucket + portIndex + index) % demoEventTypes.length];
      portEvents.push({
        eventId: `demo-kpler-${bucket}-${portIndex}-${index}`,
        vesselId: `DEMO-MMSI-${500000000 + portIndex * 1000 + index}`,
        portId,
        berthId: eventType === "berth_assigned" || eventType === "service_started" ? `${portId.slice(0, 3).toUpperCase()}-B${index + 1}` : undefined,
        eventType,
        timestamp,
        metadata: {
          demo: true,
          providerShape: "kpler-real-time-events-like",
          note: "Temporary demo event shape while awaiting provider access; not operational truth.",
        },
      });
    }
  }

  return { source: "demo", portEvents, portUtilization, queueStatus };
}

function normalizeEventType(value: unknown): PortEvent["eventType"] {
  const text = String(value ?? "arrival").toLowerCase().replace(/[\s-]+/g, "_");
  if (text === "departure") return "departure";
  if (text === "anchorage_entry") return "anchorage_entry";
  if (text === "anchorage_exit") return "anchorage_exit";
  if (text === "berth_assigned") return "berth_assigned";
  if (text === "service_started") return "service_started";
  if (text === "service_completed") return "service_completed";
  return "arrival";
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function rowsFrom(payload: unknown, keys: string[]) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  const record = payload as Record<string, unknown>;
  for (const key of keys) {
    if (Array.isArray(record[key])) return record[key] as unknown[];
  }
  return [];
}

function normalizePortEvent(row: unknown, index: number): PortEvent | null {
  if (!row || typeof row !== "object") return null;
  const record = row as Record<string, unknown>;
  const portId = String(record.portId ?? record.port_id ?? record.port ?? record.portName ?? record.unlocode ?? "").trim();
  if (!portId) return null;
  const eventType = normalizeEventType(record.eventType ?? record.event_type ?? record.type ?? record.status);
  const timestamp = String(record.timestamp ?? record.time ?? record.updatedAt ?? new Date().toISOString());

  return {
    eventId: String(record.eventId ?? record.event_id ?? record.id ?? `${portId}-${eventType}-${index}`),
    vesselId: record.vesselId || record.vessel_id || record.mmsi ? String(record.vesselId ?? record.vessel_id ?? record.mmsi) : undefined,
    portId,
    berthId: record.berthId || record.berth_id || record.berth ? String(record.berthId ?? record.berth_id ?? record.berth) : undefined,
    eventType,
    timestamp,
    metadata: record.metadata && typeof record.metadata === "object" ? record.metadata as Record<string, string | number | boolean> : undefined,
  };
}

function normalizePortUtilization(row: unknown): PortUtilizationDatum | null {
  if (!row || typeof row !== "object") return null;
  const record = row as Record<string, unknown>;
  const name = String(record.name ?? record.portName ?? record.port_name ?? record.portId ?? record.port_id ?? record.port ?? "").trim();
  if (!name) return null;
  const value = numberValue(record.value ?? record.utilizationPct ?? record.utilization_pct ?? record.utilization ?? record.berthUtilizationPct ?? record.berth_utilization_pct ?? record.berthUtilization ?? record.queueLength ?? record.waitingVessels);
  return { name, value: value ?? 0 };
}

function normalizeQueueStatus(row: unknown): PortQueueStatus | null {
  if (!row || typeof row !== "object") return null;
  const record = row as Record<string, unknown>;
  const portId = String(record.portId ?? record.port_id ?? record.port ?? record.name ?? "").trim();
  if (!portId) return null;
  return {
    portId,
    berthId: record.berthId || record.berth_id || record.berth ? String(record.berthId ?? record.berth_id ?? record.berth) : undefined,
    queueLength: numberValue(record.queueLength ?? record.queue_length ?? record.queue),
    waitingVessels: numberValue(record.waitingVessels ?? record.waiting_vessels ?? record.waiting),
    utilizationPct: numberValue(record.utilizationPct ?? record.utilization_pct ?? record.berthUtilizationPct ?? record.berth_utilization_pct),
    timestamp: record.timestamp || record.time || record.updatedAt ? String(record.timestamp ?? record.time ?? record.updatedAt) : undefined,
  };
}

export async function loadRuntimePortOperations(): Promise<PortOperationsFeed | null> {
  if (demoEnabled() && !runtimePortFeedExplicitlyEnabled()) return kplerLikeDemoPortOperations();

  const payload = await fetchFirstJson<unknown>(endpointUrl());
  if (!payload) return demoEnabled() ? kplerLikeDemoPortOperations() : null;

  const portEvents = rowsFrom(payload, ["portEvents", "port_events", "events", "data", "items"])
    .map(normalizePortEvent)
    .filter((event): event is PortEvent => event !== null);
  const portUtilization = rowsFrom(payload, ["portUtilization", "port_utilization", "utilization", "ports"])
    .map(normalizePortUtilization)
    .filter((item): item is PortUtilizationDatum => item !== null);
  const queueStatus = rowsFrom(payload, ["queueStatus", "queue_status", "queues", "berths"])
    .map(normalizeQueueStatus)
    .filter((item): item is PortQueueStatus => item !== null);

  if (portEvents.length === 0 && portUtilization.length === 0 && queueStatus.length === 0) return demoEnabled() ? kplerLikeDemoPortOperations() : null;

  return { source: "runtime", portEvents, portUtilization, queueStatus };
}
