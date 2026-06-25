import type { PortEvent } from "@/types/chmarl";

export interface RawPortEvent {
  eventId?: string;
  vesselId?: string;
  portId?: string;
  portName?: string;
  berthId?: string;
  eventType?: PortEvent["eventType"] | string;
  timestamp?: string;
  metadata?: Record<string, string | number | boolean>;
}

const supportedEventTypes = new Set<PortEvent["eventType"]>([
  "arrival",
  "departure",
  "anchorage_entry",
  "anchorage_exit",
  "berth_assigned",
  "service_started",
  "service_completed",
]);

function normalizeEventType(value: RawPortEvent["eventType"]): PortEvent["eventType"] {
  if (typeof value === "string" && supportedEventTypes.has(value as PortEvent["eventType"])) {
    return value as PortEvent["eventType"];
  }
  return "arrival";
}

export function normalizePortEvent(event: RawPortEvent): PortEvent {
  const timestamp = event.timestamp ?? new Date().toISOString();
  const portId = event.portId ?? event.portName ?? "unknown-port";

  return {
    eventId: event.eventId ?? `${portId}-${timestamp}`,
    vesselId: event.vesselId,
    portId,
    berthId: event.berthId,
    eventType: normalizeEventType(event.eventType),
    timestamp,
    metadata: event.metadata,
  };
}

export function normalizePortEventBatch(events: RawPortEvent[]) {
  return events.map(normalizePortEvent);
}

export function summarizePortEvents(events: PortEvent[]) {
  return events.reduce(
    (summary, event) => {
      if (event.eventType === "arrival") summary.arrivals += 1;
      if (event.eventType === "departure") summary.departures += 1;
      if (event.eventType === "berth_assigned") summary.berthAssignments += 1;
      if (event.eventType === "anchorage_entry") summary.anchorageEntries += 1;
      summary.total += 1;
      return summary;
    },
    {
      total: 0,
      arrivals: 0,
      departures: 0,
      berthAssignments: 0,
      anchorageEntries: 0,
    }
  );
}
