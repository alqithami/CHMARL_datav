import { useMemo, useState } from "react";
import type { Vessel } from "@/data/chmarlData";
import type { DashboardData } from "@/data/loadSampleDashboardData";
import type { PortEvent } from "@/types/chmarl";
import PortCoverageMatrix from "./insights/PortCoverageMatrix";

export type CommandWorkspaceFocus = "registry" | "fleet" | "port-coverage" | "vessels" | "port-events" | "weather";

export type CommandWorkspaceProps = {
  data: DashboardData;
  onFocus: (panel: CommandWorkspaceFocus) => void;
};

type WorkspaceTab = "summary" | "coverage" | "preview";

type CommandMetric = {
  label: string;
  value: string;
  detail: string;
  tone: "good" | "info" | "warning" | "missing";
  focus: CommandWorkspaceFocus;
};

const integer = new Intl.NumberFormat("en-US");

function speedKnots(vessel: Vessel) {
  const parsed = Number.parseFloat(vessel.speed.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function median(values: number[]) {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function formatAge(milliseconds: number | undefined) {
  if (milliseconds === undefined) return "n/a";
  if (milliseconds < 60_000) return `${Math.round(milliseconds / 1_000)}s`;
  if (milliseconds < 3_600_000) return `${Math.round(milliseconds / 60_000)}m`;
  return `${(milliseconds / 3_600_000).toFixed(1)}h`;
}

function eventLabel(event: PortEvent) {
  return event.eventType.split("_").map((part) => part.slice(0, 1).toUpperCase() + part.slice(1)).join(" ");
}

function formatTime(timestamp: string | undefined) {
  if (!timestamp) return "—";
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) return timestamp;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(parsed));
}

function vesselForEvent(vessels: Vessel[], event: PortEvent) {
  if (!event.vesselId) return undefined;
  return vessels.find((vessel) => (
    vessel.id === event.vesselId
    || vessel.id.endsWith(String(event.vesselId))
    || vessel.name === event.vesselId
  ));
}

function commandMetrics(data: DashboardData): CommandMetric[] {
  const tracking = data.vesselScope?.trackingRows ?? data.vessels.length;
  const knownVessels = data.registry?.knownVessels ?? tracking;
  const operational = data.vesselScope?.operationalRows ?? 0;
  const radius = data.vesselScope?.operationalRadiusNm ?? 120;
  const moving = data.vessels.filter((vessel) => (speedKnots(vessel) ?? 0) > 0.5).length;
  const positioned = data.vessels.filter((vessel) => Number.isFinite(vessel.latitude) && Number.isFinite(vessel.longitude)).length;
  const dataQuality = tracking === 0 ? undefined : (positioned / tracking) * 100;
  const ages = data.vessels
    .map((vessel) => Date.parse(String(vessel.timestamp ?? "")))
    .filter((value) => Number.isFinite(value) && value > 0)
    .map((value) => Math.max(0, Date.now() - value));
  const medianAge = median(ages);
  const movingShare = tracking === 0 ? 0 : (moving / tracking) * 100;

  return [
    { label: "Known vessels", value: integer.format(knownVessels), detail: `${integer.format(tracking)} currently tracked`, tone: knownVessels > 0 ? "good" : "missing", focus: "registry" },
    { label: "Moving vessels", value: integer.format(moving), detail: `${movingShare.toFixed(1)}% of tracked`, tone: tracking > 0 ? "info" : "missing", focus: "fleet" },
    { label: `Within ${radius} NM ports`, value: integer.format(operational), detail: operational > 0 ? "Fresh operational rows" : "No current rows", tone: operational > 0 ? "good" : "missing", focus: "port-coverage" },
    { label: "Port events", value: integer.format(data.portEvents.length), detail: data.portOpsSource === "none" ? "Provider required" : data.portOpsSource, tone: data.portEvents.length > 0 ? "info" : "missing", focus: "port-events" },
    { label: "AIS age (median)", value: formatAge(medianAge), detail: medianAge === undefined ? "No timestamps" : medianAge <= 30 * 60_000 ? "Operationally fresh" : "Last-known cohort", tone: medianAge === undefined ? "missing" : medianAge <= 30 * 60_000 ? "good" : "warning", focus: "fleet" },
    { label: "Data quality", value: dataQuality === undefined ? "n/a" : `${dataQuality.toFixed(1)}%`, detail: `${integer.format(positioned)} positioned rows`, tone: dataQuality === undefined ? "missing" : dataQuality >= 98 ? "good" : dataQuality >= 90 ? "info" : "warning", focus: "fleet" },
  ];
}

function EventPreview({ data, onFocus }: { data: DashboardData; onFocus: (panel: CommandWorkspaceFocus) => void }) {
  const events = [...data.portEvents]
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
    .slice(0, 4);

  return (
    <div className="command-event-preview">
      <table>
        <thead>
          <tr><th>Time (UTC)</th><th>Event type</th><th>Vessel</th><th>Port</th><th>Status</th><th>Speed</th><th>Course</th></tr>
        </thead>
        <tbody>
          {events.length === 0 ? (
            <tr><td colSpan={7}><span className="command-empty-row">No connected port events are available for preview.</span></td></tr>
          ) : events.map((event) => {
            const vessel = vesselForEvent(data.vessels, event);
            return (
              <tr key={event.eventId}>
                <td>{formatTime(event.timestamp)}</td>
                <td>{eventLabel(event)}</td>
                <td>{vessel?.name ?? event.vesselId ?? "Unassigned"}</td>
                <td>{event.portId}</td>
                <td><span className="command-event-status">{event.berthId ? "At berth" : "Active"}</span></td>
                <td>{vessel?.speed ?? "—"}</td>
                <td>{vessel?.courseDeg === undefined ? "—" : `${vessel.courseDeg.toFixed(0)}°`}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <button type="button" className="command-workspace-link" onClick={() => onFocus("port-events")}>View full events table <span>→</span></button>
    </div>
  );
}

function VesselEventPreview({ data, onFocus }: { data: DashboardData; onFocus: (panel: CommandWorkspaceFocus) => void }) {
  const vessels = useMemo(() => [...data.vessels]
    .sort((a, b) => Date.parse(String(b.timestamp ?? "")) - Date.parse(String(a.timestamp ?? "")))
    .slice(0, 6), [data.vessels]);
  const events = useMemo(() => [...data.portEvents]
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
    .slice(0, 6), [data.portEvents]);

  return (
    <div className="command-preview-grid">
      <section>
        <header><span>Latest vessel rows</span><button type="button" onClick={() => onFocus("vessels")}>Open table</button></header>
        <div className="command-preview-list">
          {vessels.length === 0 ? <p>No vessel rows are available.</p> : vessels.map((vessel) => (
            <article key={vessel.id}><i className={`vessel-status-dot ${vessel.status.toLowerCase()}`} /><div><strong>{vessel.name}</strong><small>{vessel.route}</small></div><span>{vessel.speed}</span></article>
          ))}
        </div>
      </section>
      <section>
        <header><span>Recent port events</span><button type="button" onClick={() => onFocus("port-events")}>Open feed</button></header>
        <div className="command-preview-list">
          {events.length === 0 ? <p>No port events are connected.</p> : events.map((event) => (
            <article key={event.eventId}><i className="command-event-dot" /><div><strong>{eventLabel(event)}</strong><small>{event.portId}</small></div><span>{formatTime(event.timestamp)}</span></article>
          ))}
        </div>
      </section>
    </div>
  );
}

export default function CommandWorkspace({ data, onFocus }: CommandWorkspaceProps) {
  const [tab, setTab] = useState<WorkspaceTab>("summary");
  const metrics = useMemo(() => commandMetrics(data), [data]);

  return (
    <section className="portal-command-workspace" aria-label="Command summary and operational drill-down">
      <header className="command-workspace-header">
        <div><span>Command summary</span><strong>{tab === "summary" ? "At-a-glance operations" : tab === "coverage" ? "Eight-port coverage" : "Vessel and event preview"}</strong></div>
        <div className="command-workspace-tabs" role="tablist" aria-label="Command workspace mode">
          <button type="button" role="tab" aria-selected={tab === "summary"} className={tab === "summary" ? "active" : ""} onClick={() => setTab("summary")}>Command summary</button>
          <button type="button" role="tab" aria-selected={tab === "coverage"} className={tab === "coverage" ? "active" : ""} onClick={() => setTab("coverage")}>Port coverage matrix</button>
          <button type="button" role="tab" aria-selected={tab === "preview"} className={tab === "preview" ? "active" : ""} onClick={() => setTab("preview")}>Vessel &amp; event preview</button>
        </div>
      </header>

      {tab === "summary" && (
        <div className="command-workspace-summary">
          <div className="command-metric-grid">
            {metrics.map((metric) => (
              <button key={metric.label} type="button" className={`command-metric-card ${metric.tone}`} onClick={() => onFocus(metric.focus)}>
                <span>{metric.label}</span><strong>{metric.value}</strong><small>{metric.detail}</small>
              </button>
            ))}
          </div>
          <EventPreview data={data} onFocus={onFocus} />
        </div>
      )}

      {tab === "coverage" && (
        <div className="command-workspace-coverage"><PortCoverageMatrix vessels={data.vessels} /></div>
      )}

      {tab === "preview" && <VesselEventPreview data={data} onFocus={onFocus} />}
    </section>
  );
}
