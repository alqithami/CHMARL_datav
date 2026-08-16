import { useMemo, useRef, useState } from "react";
import { vessels as fallbackVessels, type Vessel } from "@/data/chmarlData";
import type { PortEvent } from "@/types/chmarl";
import Tx97ChartMap, {
  type Tx97ChartMapHandle,
  type Tx97ChartStatus,
  type Tx97ViewportState,
} from "./Tx97ChartMap";

type ShipSceneProps = {
  vessels?: Vessel[];
  portEvents?: PortEvent[];
  expanded?: boolean;
};

type VesselFilter = "All" | Vessel["status"];
type SortMode = "latest" | "name" | "speed";

const filterOptions: VesselFilter[] = ["All", "Nominal", "Watch", "Constrained"];

function hasCoordinates(vessel: Vessel): vessel is Vessel & { latitude: number; longitude: number } {
  return typeof vessel.latitude === "number"
    && Number.isFinite(vessel.latitude)
    && vessel.latitude >= -85.051129
    && vessel.latitude <= 85.051129
    && typeof vessel.longitude === "number"
    && Number.isFinite(vessel.longitude)
    && vessel.longitude >= -180
    && vessel.longitude <= 180;
}

function statusClass(status: Vessel["status"]) {
  if (status === "Constrained") return "alert";
  if (status === "Watch") return "warning";
  return "nominal";
}

function speedKnots(vessel: Vessel) {
  const parsed = Number.parseFloat(vessel.speed.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function vesselTimestampMs(vessel: Vessel) {
  if (!vessel.timestamp) return 0;
  const parsed = Date.parse(vessel.timestamp);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isMoving(vessel: Vessel) {
  const speed = speedKnots(vessel);
  return speed !== undefined && speed > 0.5;
}

function isStale(vessel: Vessel) {
  const timestamp = vesselTimestampMs(vessel);
  if (timestamp === 0) return false;
  return Date.now() - timestamp > 30 * 60 * 1000;
}

function formatTimestamp(vessel: Vessel) {
  if (!vessel.timestamp) return "No timestamp";
  const timestamp = vesselTimestampMs(vessel);
  if (timestamp === 0) return vessel.timestamp;
  return new Date(timestamp).toLocaleTimeString();
}

function matchesQuery(vessel: Vessel, query: string) {
  if (!query) return true;
  return `${vessel.name} ${vessel.id} ${vessel.route} ${vessel.cargo}`.toLowerCase().includes(query);
}

function sortVessels(vessels: Vessel[], mode: SortMode) {
  return [...vessels].sort((a, b) => {
    if (mode === "name") return a.name.localeCompare(b.name);
    if (mode === "speed") return (speedKnots(b) ?? -1) - (speedKnots(a) ?? -1);
    return vesselTimestampMs(b) - vesselTimestampMs(a);
  });
}

function labelForEvent(eventType: PortEvent["eventType"]) {
  return eventType
    .split("_")
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

export default function ShipScene({ vessels, portEvents = [], expanded = false }: ShipSceneProps) {
  const chartRef = useRef<Tx97ChartMapHandle | null>(null);
  const [selectedShipId, setSelectedShipId] = useState("");
  const [filter, setFilter] = useState<VesselFilter>("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [movingOnly, setMovingOnly] = useState(false);
  const [staleOnly, setStaleOnly] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>("latest");
  const [showPorts, setShowPorts] = useState(true);
  const [showEvents, setShowEvents] = useState(true);
  const [showTrails, setShowTrails] = useState(false);
  const [viewport, setViewport] = useState<Tx97ViewportState>({ inView: 0, zoom: 0 });
  const [chartStatus, setChartStatus] = useState<Tx97ChartStatus>({
    state: "checking",
    label: "Checking TX-97 chart service",
    detail: "Validating the licensed chart gateway.",
  });

  const sceneVessels = vessels ?? fallbackVessels;
  const query = searchQuery.trim().toLowerCase();
  const visibleVessels = useMemo(() => {
    const statusFiltered = filter === "All"
      ? sceneVessels
      : sceneVessels.filter((vessel) => vessel.status === filter);
    return sortVessels(
      statusFiltered.filter((vessel) => (
        matchesQuery(vessel, query)
        && (!movingOnly || isMoving(vessel))
        && (!staleOnly || isStale(vessel))
      )),
      sortMode,
    );
  }, [filter, movingOnly, query, sceneVessels, sortMode, staleOnly]);

  const selectedShip = selectedShipId
    ? sceneVessels.find((vessel) => vessel.id === selectedShipId)
    : undefined;
  const controlsDisabled = chartStatus.state !== "ready";

  const selectVessel = (vesselId: string) => {
    setSelectedShipId(vesselId);
    chartRef.current?.centerOnVessel(vesselId);
  };

  const resetRailFilters = () => {
    setSearchQuery("");
    setMovingOnly(false);
    setStaleOnly(false);
    setSortMode("latest");
    setSelectedShipId("");
  };

  const vesselDetail = selectedShip ? (
    <section className="expanded-rail-section vessel-detail-section">
      <div className="rail-section-header"><span>Selected vessel</span><strong>{selectedShip.name}</strong></div>
      <span className={`ship-status ${statusClass(selectedShip.status)}`}>{selectedShip.status}</span>
      <dl className="rail-detail-list">
        <div><dt>ID</dt><dd>{selectedShip.id}</dd></div>
        <div><dt>Route</dt><dd>{selectedShip.route}</dd></div>
        <div><dt>Cargo</dt><dd>{selectedShip.cargo}</dd></div>
        <div><dt>ETA</dt><dd>{selectedShip.eta}</dd></div>
        <div><dt>Speed</dt><dd>{selectedShip.speed}</dd></div>
        <div><dt>Updated</dt><dd>{formatTimestamp(selectedShip)}</dd></div>
        {hasCoordinates(selectedShip) && <div><dt>Position</dt><dd>{selectedShip.latitude.toFixed(3)}, {selectedShip.longitude.toFixed(3)}</dd></div>}
        {selectedShip.trail && selectedShip.trail.length > 1 && <div><dt>Trail</dt><dd>{selectedShip.trail.length} points</dd></div>}
      </dl>
      <button type="button" className="rail-action-button" onClick={() => setSelectedShipId("")}>Clear selection</button>
    </section>
  ) : (
    <section className="expanded-rail-section vessel-detail-section muted">
      <div className="rail-section-header"><span>Selected vessel</span><strong>No vessel selected</strong></div>
      <p>Select a vessel symbol or a row to inspect live AIS properties.</p>
    </section>
  );

  return (
    <div className={expanded ? "scene-container static-map-container expanded-map" : "scene-container static-map-container"}>
      <div className={selectedShip ? "regional-map tile-map tx97-map is-inspecting" : "regional-map tile-map tx97-map"}>
        <Tx97ChartMap
          ref={chartRef}
          vessels={visibleVessels}
          portEvents={portEvents}
          selectedVesselId={selectedShipId}
          showPorts={showPorts}
          showEvents={showEvents}
          showTrails={showTrails}
          expanded={expanded}
          onSelectVessel={selectVessel}
          onViewportChange={setViewport}
          onStatusChange={setChartStatus}
        />
      </div>

      <div className="tile-map-controls" aria-label="TX-97 chart controls">
        <button type="button" disabled={controlsDisabled} onClick={() => chartRef.current?.zoomIn()}>+</button>
        <button type="button" disabled={controlsDisabled} onClick={() => chartRef.current?.zoomOut()}>−</button>
        <button type="button" disabled={controlsDisabled} onClick={() => chartRef.current?.fitWorld()}>World view</button>
        <button type="button" disabled={controlsDisabled} onClick={() => chartRef.current?.fitPorts()}>Ports overview</button>
        <button type="button" disabled={controlsDisabled} onClick={() => chartRef.current?.fitVessels()}>Fit vessels</button>
        <button type="button" className={showPorts ? "active layer-toggle" : "layer-toggle"} onClick={() => setShowPorts((value) => !value)}>Ports</button>
        <button type="button" className={showEvents ? "active layer-toggle" : "layer-toggle"} onClick={() => setShowEvents((value) => !value)}>Events</button>
        <button type="button" className={showTrails ? "active layer-toggle" : "layer-toggle"} onClick={() => setShowTrails((value) => !value)}>Trails</button>
        <span>{viewport.inView} in view · {visibleVessels.length}/{sceneVessels.length} tracked</span>
        {expanded && <span>{portEvents.length} events</span>}
        <span>{viewport.zoom > 0 ? `Zoom ${viewport.zoom}` : chartStatus.state}</span>
      </div>

      {expanded && (
        <div className="tile-filter-bar" aria-label="Vessel status filter">
          {filterOptions.map((option) => (
            <button
              key={option}
              type="button"
              className={filter === option ? "active" : ""}
              onClick={() => {
                setFilter(option);
                setSelectedShipId("");
              }}>
              {option}
            </button>
          ))}
        </div>
      )}

      {expanded && (
        <aside className="expanded-map-rail" aria-label="Expanded TX-97 chart details">
          {vesselDetail}
          <section className="expanded-rail-section tile-vessel-list" aria-label="Visible vessel list">
            <div className="tile-vessel-list-header"><strong>Tracked vessels</strong><span>{visibleVessels.length}/{sceneVessels.length}</span></div>
            <div className="rail-search-tools">
              <input
                value={searchQuery}
                onChange={(event) => {
                  setSearchQuery(event.target.value);
                  setSelectedShipId("");
                }}
                placeholder="Search name, MMSI, route"
                aria-label="Search vessels"
              />
              <select value={sortMode} onChange={(event) => setSortMode(event.target.value as SortMode)} aria-label="Sort vessels">
                <option value="latest">Latest update</option>
                <option value="name">Name</option>
                <option value="speed">Speed</option>
              </select>
              <label><input type="checkbox" checked={movingOnly} onChange={(event) => setMovingOnly(event.target.checked)} />Moving only</label>
              <label><input type="checkbox" checked={staleOnly} onChange={(event) => setStaleOnly(event.target.checked)} />Stale only</label>
              <button type="button" onClick={resetRailFilters}>Reset filters</button>
            </div>
            <div className="tile-vessel-list-items">
              {visibleVessels.length === 0
                ? <p className="rail-empty-state">No vessels match the current search and filters.</p>
                : visibleVessels.map((vessel) => (
                  <button
                    key={vessel.id}
                    type="button"
                    className={`${vessel.id === selectedShipId ? "active" : ""} ${isStale(vessel) ? "stale" : ""}`}
                    onClick={() => selectVessel(vessel.id)}>
                    <span>{vessel.name}</span>
                    <small>{vessel.status} · {vessel.speed} · {formatTimestamp(vessel)}</small>
                  </button>
                ))}
            </div>
          </section>
          <section className="expanded-rail-section tile-event-list" aria-label="Port event list">
            <div className="tile-vessel-list-header"><strong>Port events</strong><span>{portEvents.length}</span></div>
            <div className="tile-vessel-list-items">
              {portEvents.length === 0
                ? <p className="rail-empty-state">No port events are connected for this feed.</p>
                : portEvents.map((event) => (
                  <button key={event.eventId} type="button">
                    <span>{labelForEvent(event.eventType)}</span>
                    <small>{event.portId} · {event.timestamp}</small>
                  </button>
                ))}
            </div>
          </section>
        </aside>
      )}

      <div className="tile-attribution">Wärtsilä TX-97 vector charts · licensed service</div>

      {!expanded && selectedShip && (
        <aside className="ship-inspector-card">
          <div className="ship-inspector-header">
            <div><span className="ship-inspector-kicker">Selected vessel</span><h3>{selectedShip.name}</h3></div>
            <span className={`ship-status ${statusClass(selectedShip.status)}`}>{selectedShip.status}</span>
          </div>
          <dl>
            <div><dt>ID</dt><dd>{selectedShip.id}</dd></div>
            <div><dt>Route</dt><dd>{selectedShip.route}</dd></div>
            <div><dt>Cargo</dt><dd>{selectedShip.cargo}</dd></div>
            <div><dt>ETA</dt><dd>{selectedShip.eta}</dd></div>
            <div><dt>Speed</dt><dd>{selectedShip.speed}</dd></div>
            <div><dt>Updated</dt><dd>{formatTimestamp(selectedShip)}</dd></div>
            {hasCoordinates(selectedShip) && <div><dt>Position</dt><dd>{selectedShip.latitude.toFixed(3)}, {selectedShip.longitude.toFixed(3)}</dd></div>}
            {selectedShip.trail && selectedShip.trail.length > 1 && <div><dt>Trail</dt><dd>{selectedShip.trail.length} points</dd></div>}
          </dl>
          <button type="button" onClick={() => setSelectedShipId("")}>Clear selection</button>
        </aside>
      )}
    </div>
  );
}
