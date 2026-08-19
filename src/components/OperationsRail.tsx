import { useMemo, useState } from "react";
import type { Vessel } from "@/data/chmarlData";
import type { DashboardData } from "@/data/loadSampleDashboardData";
import type { PortEvent } from "@/types/chmarl";

export type OperationsRailFocus = "vessels" | "watchlist" | "port-events" | "port-coverage";

export type OperationsRailProps = {
  data: DashboardData;
  selectedVesselId: string;
  onSelectVessel: (vesselId: string) => void;
  onFocus: (panel: OperationsRailFocus) => void;
};

type SortMode = "latest" | "name" | "speed";

type WatchItem = {
  tone: "good" | "warning" | "critical" | "info";
  title: string;
  detail: string;
};

function speedKnots(vessel: Vessel) {
  const parsed = Number.parseFloat(vessel.speed.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function timestampMs(vessel: Vessel) {
  const parsed = Date.parse(String(vessel.timestamp ?? ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function isStale(vessel: Vessel) {
  const timestamp = timestampMs(vessel);
  return timestamp > 0 && Date.now() - timestamp > 30 * 60 * 1_000;
}

function formatTimestamp(value: string | undefined) {
  if (!value) return "No timestamp";
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(parsed));
}

function eventLabel(event: PortEvent) {
  return event.eventType.split("_").map((part) => part.slice(0, 1).toUpperCase() + part.slice(1)).join(" ");
}

function watchItems(data: DashboardData): WatchItem[] {
  const operationalRows = data.vesselScope?.operationalRows ?? 0;
  const constrained = data.vessels.filter((vessel) => vessel.status === "Constrained").length;
  const watch = data.vessels.filter((vessel) => vessel.status === "Watch").length;
  const items: WatchItem[] = [];

  if (operationalRows === 0) {
    items.push({
      tone: "info",
      title: "Awaiting port-scope vessel rows",
      detail: "EcoFair-CH-MARL remains outside the calculation gate.",
    });
  } else {
    items.push({
      tone: "good",
      title: `${operationalRows} port-scope vessel${operationalRows === 1 ? "" : "s"}`,
      detail: "Fresh AIS rows are available for operational calculations.",
    });
  }

  if (data.source === "aisstream-waiting") {
    items.push({ tone: "warning", title: "AIS provider is silent", detail: "The connection is open but no current positions are arriving." });
  } else if (data.vessels.length > 0) {
    items.push({ tone: "good", title: "Vessel tracking active", detail: `${data.vessels.length.toLocaleString()} rows available to the map.` });
  }

  if (constrained > 0 || watch > 0) {
    items.push({
      tone: constrained > 0 ? "critical" : "warning",
      title: `${constrained} constrained · ${watch} watch`,
      detail: "Review vessel exceptions before changing fleet policy.",
    });
  }

  if (data.portOpsSource === "none") {
    items.push({ tone: "warning", title: "Port operations feed required", detail: "Queue, berth, and utilization truth is not connected." });
  } else if (data.portEvents.length > 0) {
    items.push({ tone: "good", title: `${data.portEvents.length} port event${data.portEvents.length === 1 ? "" : "s"}`, detail: "Recent operational activity is available." });
  }

  if (data.chmarlSource !== "runtime") {
    items.push({ tone: "info", title: "Online CH-MARL state unavailable", detail: "The portal is retaining observability without fabricating a score." });
  }

  return items.slice(0, 4);
}

export default function OperationsRail({ data, selectedVesselId, onSelectVessel, onFocus }: OperationsRailProps) {
  const [query, setQuery] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("latest");
  const [movingOnly, setMovingOnly] = useState(false);
  const [staleOnly, setStaleOnly] = useState(false);

  const selected = data.vessels.find((vessel) => vessel.id === selectedVesselId);
  const normalizedQuery = query.trim().toLowerCase();
  const filteredVessels = useMemo(() => {
    const rows = data.vessels.filter((vessel) => {
      const matches = !normalizedQuery || `${vessel.name} ${vessel.id} ${vessel.route} ${vessel.cargo}`.toLowerCase().includes(normalizedQuery);
      return matches
        && (!movingOnly || (speedKnots(vessel) ?? 0) > 0.5)
        && (!staleOnly || isStale(vessel));
    });
    return rows.sort((a, b) => {
      if (sortMode === "name") return a.name.localeCompare(b.name);
      if (sortMode === "speed") return (speedKnots(b) ?? -1) - (speedKnots(a) ?? -1);
      return timestampMs(b) - timestampMs(a);
    });
  }, [data.vessels, movingOnly, normalizedQuery, sortMode, staleOnly]);

  const watchlist = watchItems(data);
  const recentEvents = [...data.portEvents]
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
    .slice(0, 2);

  return (
    <aside className="portal-operations-rail" aria-label="Self-contained operations rail">
      <section className="operations-rail-section selected-vessel-context">
        <header><span>Selected vessel</span><small>{selected ? "AIS" : "Context"}</small></header>
        {selected ? (
          <div className="selected-vessel-body">
            <div className="selected-vessel-title">
              <i className={`vessel-status-dot ${selected.status.toLowerCase()}`} />
              <div><strong>{selected.name}</strong><small>{selected.id}</small></div>
              <span className={`ship-status ${selected.status === "Constrained" ? "alert" : selected.status === "Watch" ? "warning" : "nominal"}`}>{selected.status}</span>
            </div>
            <div className="selected-vessel-facts">
              <span><b>Speed</b>{selected.speed}</span>
              <span><b>Course</b>{selected.courseDeg === undefined ? "n/a" : `${selected.courseDeg.toFixed(0)}°`}</span>
              <span><b>Route</b>{selected.route}</span>
              <span><b>Updated</b>{formatTimestamp(selected.timestamp)}</span>
            </div>
          </div>
        ) : (
          <div className="operations-empty-context">
            <strong>No vessel selected</strong>
            <small>Select a tracked vessel row or a vessel point on the map to inspect its AIS context.</small>
          </div>
        )}
      </section>

      <section className="operations-rail-section tracked-vessel-context">
        <header>
          <span>Tracked vessels</span>
          <button type="button" onClick={() => onFocus("vessels")}>{Math.min(filteredVessels.length, 5)}/{data.vessels.length}</button>
        </header>
        <div className="operations-vessel-filters">
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, MMSI, or route" aria-label="Search tracked vessels" />
          <select value={sortMode} onChange={(event) => setSortMode(event.target.value as SortMode)} aria-label="Sort tracked vessels">
            <option value="latest">Latest update</option>
            <option value="name">Name</option>
            <option value="speed">Speed</option>
          </select>
          <div>
            <label><input type="checkbox" checked={movingOnly} onChange={(event) => setMovingOnly(event.target.checked)} />Moving only</label>
            <label><input type="checkbox" checked={staleOnly} onChange={(event) => setStaleOnly(event.target.checked)} />Last-known only</label>
          </div>
        </div>
        <div className="operations-vessel-list">
          {filteredVessels.length === 0 ? (
            <p>No vessels match the current filters.</p>
          ) : filteredVessels.slice(0, 5).map((vessel) => (
            <button
              key={vessel.id}
              type="button"
              className={`${vessel.id === selectedVesselId ? "active" : ""} ${isStale(vessel) ? "stale" : ""}`}
              onClick={() => onSelectVessel(vessel.id)}>
              <i className={`vessel-status-dot ${vessel.status.toLowerCase()}`} />
              <span><strong>{vessel.name}</strong><small>{vessel.status} · {formatTimestamp(vessel.timestamp)}</small></span>
              <b>{vessel.speed}</b>
            </button>
          ))}
        </div>
        <button type="button" className="operations-rail-link" onClick={() => onFocus("vessels")}>View all tracked vessels <span>→</span></button>
      </section>

      <section className="operations-rail-section operational-watch-context">
        <header><span>Operational watchlist</span><button type="button" onClick={() => onFocus("watchlist")}>{watchlist.length}</button></header>
        <div className="compact-watchlist">
          {watchlist.slice(0, 3).map((item) => (
            <article key={item.title} className={item.tone}>
              <i />
              <div><strong>{item.title}</strong><small>{item.detail}</small></div>
            </article>
          ))}
        </div>
        <button type="button" className="operations-rail-link" onClick={() => onFocus("watchlist")}>View all recommendations <span>→</span></button>
      </section>

      <section className="operations-rail-section port-event-context">
        <header><span>Port events</span><button type="button" onClick={() => onFocus("port-events")}>{data.portEvents.length}</button></header>
        <div className="compact-port-events">
          {recentEvents.length === 0 ? <p>No connected port events.</p> : recentEvents.map((event) => (
            <article key={event.eventId}>
              <i />
              <div><strong>{eventLabel(event)}</strong><small>{event.portId} · {formatTimestamp(event.timestamp)}</small></div>
            </article>
          ))}
        </div>
        <button type="button" className="operations-rail-link" onClick={() => onFocus("port-events")}>View all port events <span>→</span></button>
      </section>
    </aside>
  );
}
