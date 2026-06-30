import { useMemo, useState } from "react";
import type { PortEvent } from "@/types/chmarl";
import type { PortOpsDataSource } from "@/data/loadSampleDashboardData";

export type PortEventFeedProps = {
  events: PortEvent[];
  source: PortOpsDataSource;
  compact?: boolean;
};

type EventFilter = "all" | "berth" | "arrival" | "departure" | "anchorage" | "service";

const eventFilters: { id: EventFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "berth", label: "Berth" },
  { id: "arrival", label: "Arrivals" },
  { id: "departure", label: "Departures" },
  { id: "anchorage", label: "Anchorage" },
  { id: "service", label: "Service" },
];

function label(eventType: PortEvent["eventType"]) {
  return eventType.split("_").map((part) => part.slice(0, 1).toUpperCase() + part.slice(1)).join(" ");
}

function eventTone(eventType: PortEvent["eventType"]) {
  if (eventType === "departure" || eventType === "service_completed") return "complete";
  if (eventType === "berth_assigned" || eventType === "service_started") return "active";
  if (eventType === "anchorage_entry" || eventType === "anchorage_exit") return "watch";
  return "arrival";
}

function eventMatches(event: PortEvent, filter: EventFilter) {
  if (filter === "all") return true;
  if (filter === "berth") return event.eventType.includes("berth");
  if (filter === "arrival") return event.eventType === "arrival";
  if (filter === "departure") return event.eventType === "departure";
  if (filter === "anchorage") return event.eventType.includes("anchorage");
  if (filter === "service") return event.eventType.includes("service");
  return true;
}

function sourceNote(source: PortOpsDataSource) {
  if (source === "runtime") return "real provider";
  if (source === "demo") return "Kpler-like demo while provider is pending";
  if (source === "local-json") return "local fixture";
  return "provider required";
}

export default function PortEventFeed({ events, source, compact = false }: PortEventFeedProps) {
  const [filter, setFilter] = useState<EventFilter>("all");
  const recent = useMemo(
    () => [...events].filter((event) => eventMatches(event, filter)).slice(-10).reverse(),
    [events, filter]
  );

  return (
    <div className="port-event-feed insight-panel-content">
      <div className="insight-panel-summary">
        <span>Port event feed</span>
        <strong>{compact ? events.length : recent.length}</strong>
        <small>{sourceNote(source)}</small>
      </div>
      {!compact && (
        <div className="inline-filter-tabs" role="tablist" aria-label="Port event type filter">
          {eventFilters.map((item) => (
            <button key={item.id} type="button" className={filter === item.id ? "active" : ""} onClick={() => setFilter(item.id)}>{item.label}</button>
          ))}
        </div>
      )}
      <div className={compact ? "port-event-list compact" : "port-event-list"}>
        {recent.length === 0 ? (
          <p className="insight-empty-state">No port events available for the selected filter.</p>
        ) : recent.map((event) => (
          <article key={event.eventId} className={`port-event-row ${eventTone(event.eventType)}`}>
            <span>{label(event.eventType)}</span>
            <strong>{event.portId}</strong>
            <small>{event.berthId ? `${event.berthId} · ` : ""}{event.timestamp}</small>
          </article>
        ))}
      </div>
    </div>
  );
}
