import type { PortEvent } from "@/types/chmarl";
import type { PortOpsDataSource } from "@/data/loadSampleDashboardData";

export type PortEventFeedProps = {
  events: PortEvent[];
  source: PortOpsDataSource;
  compact?: boolean;
};

function label(eventType: PortEvent["eventType"]) {
  return eventType.split("_").map((part) => part.slice(0, 1).toUpperCase() + part.slice(1)).join(" ");
}

function eventTone(eventType: PortEvent["eventType"]) {
  if (eventType === "departure" || eventType === "service_completed") return "complete";
  if (eventType === "berth_assigned" || eventType === "service_started") return "active";
  if (eventType === "anchorage_entry" || eventType === "anchorage_exit") return "watch";
  return "arrival";
}

function sourceNote(source: PortOpsDataSource) {
  if (source === "runtime") return "real provider";
  if (source === "demo") return "Kpler-like demo while provider is pending";
  if (source === "local-json") return "local fixture";
  return "provider required";
}

export default function PortEventFeed({ events, source, compact = false }: PortEventFeedProps) {
  const recent = [...events].slice(-10).reverse();

  return (
    <div className="port-event-feed insight-panel-content">
      <div className="insight-panel-summary">
        <span>Port event feed</span>
        <strong>{events.length}</strong>
        <small>{sourceNote(source)}</small>
      </div>
      <div className={compact ? "port-event-list compact" : "port-event-list"}>
        {recent.length === 0 ? (
          <p className="insight-empty-state">No port events available. Connect PORT_EVENTS_URL or enable the Kpler-like demo.</p>
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
