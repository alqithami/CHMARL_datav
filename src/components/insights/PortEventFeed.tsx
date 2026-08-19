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
  { id: "all", label: "All events" },
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
  if (source === "runtime") return "Runtime provider";
  if (source === "demo") return "Demonstration feed";
  if (source === "local-json") return "Local fixture";
  return "Provider required";
}

function sourceTone(source: PortOpsDataSource) {
  if (source === "runtime") return "good";
  if (source === "demo" || source === "local-json") return "warning";
  return "missing";
}

function timestampMs(timestamp: string) {
  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formattedTimestamp(timestamp: string) {
  const parsed = timestampMs(timestamp);
  if (parsed === 0) return timestamp;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(parsed));
}

function emptyMessage(source: PortOpsDataSource, filter: EventFilter) {
  if (source === "none") {
    return {
      title: "Port event provider not connected",
      detail: "Connect a berth, queue, or port-event provider to populate this operational feed.",
    };
  }
  if (filter !== "all") {
    return {
      title: "No events match this filter",
      detail: "The provider is available, but no current rows match the selected event category.",
    };
  }
  return {
    title: "No active port events",
    detail: "The provider is available and currently reports no arrival, anchorage, berth, service, or departure events.",
  };
}

export default function PortEventFeed({ events, source, compact = false }: PortEventFeedProps) {
  const [filter, setFilter] = useState<EventFilter>("all");
  const orderedEvents = useMemo(
    () => [...events].sort((a, b) => timestampMs(b.timestamp) - timestampMs(a.timestamp)),
    [events],
  );
  const filteredEvents = useMemo(
    () => orderedEvents.filter((event) => eventMatches(event, filter)),
    [filter, orderedEvents],
  );
  const visibleEvents = compact ? filteredEvents.slice(0, 4) : filteredEvents;
  const uniquePorts = new Set(events.map((event) => event.portId)).size;
  const activeEvents = events.filter((event) => eventTone(event.eventType) === "active").length;
  const latest = orderedEvents[0];
  const emptyState = emptyMessage(source, filter);

  return (
    <section className={compact ? "port-event-feed insight-panel-content is-compact" : "port-event-feed insight-panel-content is-expanded"}>
      <header className="port-event-overview">
        <div className="insight-panel-summary">
          <span>Port event feed</span>
          <strong>{events.length.toLocaleString()}</strong>
          <small>{sourceNote(source)}</small>
        </div>
        {!compact && (
          <div className="port-event-stat-grid" aria-label="Port event summary">
            <article><span>Matching rows</span><strong>{filteredEvents.length.toLocaleString()}</strong><small>{filter === "all" ? "all event types" : `${filter} filter`}</small></article>
            <article><span>Ports represented</span><strong>{uniquePorts.toLocaleString()}</strong><small>unique port identifiers</small></article>
            <article><span>Active service / berth</span><strong>{activeEvents.toLocaleString()}</strong><small>current operational actions</small></article>
            <article><span>Latest update</span><strong>{latest ? formattedTimestamp(latest.timestamp).split(", ").at(-1) : "n/a"}</strong><small>{latest ? latest.portId : "no event timestamp"}</small></article>
          </div>
        )}
      </header>

      {!compact && (
        <div className="port-event-toolbar">
          <div className="inline-filter-tabs" role="tablist" aria-label="Port event type filter">
            {eventFilters.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={filter === item.id}
                className={filter === item.id ? "active" : ""}
                onClick={() => setFilter(item.id)}>
                {item.label}
              </button>
            ))}
          </div>
          <span className={`port-event-provider-state ${sourceTone(source)}`}><i />{sourceNote(source)}</span>
        </div>
      )}

      <div className={compact ? "port-event-list compact" : "port-event-table-shell"}>
        {visibleEvents.length === 0 ? (
          <div className="portal-focus-empty-state" role="status">
            <span className="portal-focus-empty-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24"><path d="M5 4h14v16H5z" /><path d="M8 8h8M8 12h5" /><circle cx="17" cy="17" r="3" /><path d="m19.2 19.2 2 2" /></svg>
            </span>
            <strong>{emptyState.title}</strong>
            <p>{emptyState.detail}</p>
            {filter !== "all" && <button type="button" onClick={() => setFilter("all")}>Show all event types</button>}
          </div>
        ) : compact ? (
          visibleEvents.map((event) => (
            <article key={event.eventId} className={`port-event-row ${eventTone(event.eventType)}`}>
              <span>{label(event.eventType)}</span>
              <strong>{event.portId}</strong>
              <small>{event.berthId ? `${event.berthId} · ` : ""}{formattedTimestamp(event.timestamp)}</small>
            </article>
          ))
        ) : (
          <table className="port-event-table">
            <thead>
              <tr><th>Time (UTC)</th><th>Event</th><th>Port</th><th>Vessel</th><th>Berth</th><th>State</th></tr>
            </thead>
            <tbody>
              {visibleEvents.map((event) => (
                <tr key={event.eventId}>
                  <td>{formattedTimestamp(event.timestamp)}</td>
                  <td><span className={`port-event-type ${eventTone(event.eventType)}`}><i />{label(event.eventType)}</span></td>
                  <td><strong>{event.portId}</strong></td>
                  <td>{event.vesselId ?? "Unassigned"}</td>
                  <td>{event.berthId ?? "—"}</td>
                  <td><span className={`port-event-state ${eventTone(event.eventType)}`}>{eventTone(event.eventType)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
