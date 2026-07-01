import { useMemo, useState } from "react";
import { vessels as fallbackVessels, type Vessel } from "@/data/chmarlData";
import type { PortEvent } from "@/types/chmarl";

type ShipSceneProps = {
  vessels?: Vessel[];
  portEvents?: PortEvent[];
  expanded?: boolean;
};

type GeoPoint = { lat: number; lon: number };
type ProjectedPoint = { left: number; top: number };
type VesselFilter = "All" | Vessel["status"];
type SortMode = "latest" | "name" | "speed";

type ShipMarker = ProjectedPoint & {
  vessel: Vessel;
  heading: number;
  tone: "cyan" | "yellow" | "red" | "blue";
};

const DEFAULT_CENTER: GeoPoint = { lat: 23.2, lon: 43.5 };
const DEFAULT_ZOOM = 5;
const MIN_ZOOM = 4;
const MAX_ZOOM = 9;
const VIEWPORT_TILES_X = 8;
const VIEWPORT_TILES_Y = 5.3;

const fallbackShipPositions = [
  { left: 21, top: 60, heading: -8, tone: "yellow" as const },
  { left: 30, top: 36, heading: 18, tone: "cyan" as const },
  { left: 70, top: 42, heading: -35, tone: "red" as const },
  { left: 18, top: 78, heading: 12, tone: "blue" as const },
  { left: 75, top: 58, heading: -8, tone: "yellow" as const },
];

const portGeo: Record<string, GeoPoint> = {
  Jeddah: { lat: 21.4858, lon: 39.1925 },
  "King Abdullah Port": { lat: 22.3924, lon: 39.0953 },
  Yanbu: { lat: 24.0866, lon: 38.0637 },
  Suez: { lat: 29.9668, lon: 32.5498 },
  Dammam: { lat: 26.4318, lon: 50.1015 },
  "Jebel Ali": { lat: 25.0114, lon: 55.0611 },
  Jizan: { lat: 16.8917, lon: 42.5511 },
};

const filterOptions: VesselFilter[] = ["All", "Nominal", "Watch", "Constrained"];

function lonToTileX(lon: number, zoom: number) {
  return ((lon + 180) / 360) * 2 ** zoom;
}

function latToTileY(lat: number, zoom: number) {
  const latRad = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * 2 ** zoom;
}

function projectGeo(point: GeoPoint, center: GeoPoint, zoom: number): ProjectedPoint {
  const centerX = lonToTileX(center.lon, zoom);
  const centerY = latToTileY(center.lat, zoom);
  const x = lonToTileX(point.lon, zoom);
  const y = latToTileY(point.lat, zoom);
  return {
    left: 50 + ((x - centerX) * 100) / VIEWPORT_TILES_X,
    top: 50 + ((y - centerY) * 100) / VIEWPORT_TILES_Y,
  };
}

function buildTileGrid(center: GeoPoint, zoom: number) {
  const centerX = lonToTileX(center.lon, zoom);
  const centerY = latToTileY(center.lat, zoom);
  const tileWidth = 100 / VIEWPORT_TILES_X;
  const tileHeight = 100 / VIEWPORT_TILES_Y;
  const baseX = Math.floor(centerX);
  const baseY = Math.floor(centerY);
  const maxTile = 2 ** zoom;
  const tiles: { key: string; href: string; x: number; y: number; width: number; height: number }[] = [];

  for (let dx = -5; dx <= 5; dx += 1) {
    for (let dy = -4; dy <= 4; dy += 1) {
      const tileX = baseX + dx;
      const tileY = baseY + dy;
      if (tileY < 0 || tileY >= maxTile) continue;
      const wrappedX = ((tileX % maxTile) + maxTile) % maxTile;
      tiles.push({
        key: `${zoom}-${wrappedX}-${tileY}`,
        href: `https://tile.openstreetmap.org/${zoom}/${wrappedX}/${tileY}.png`,
        x: 50 + ((tileX - centerX) * 100) / VIEWPORT_TILES_X,
        y: 50 + ((tileY - centerY) * 100) / VIEWPORT_TILES_Y,
        width: tileWidth,
        height: tileHeight,
      });
    }
  }

  return tiles;
}

function toneForStatus(status: Vessel["status"]): ShipMarker["tone"] {
  if (status === "Constrained") return "red";
  if (status === "Watch") return "yellow";
  return "cyan";
}

function statusClass(status: Vessel["status"]) {
  if (status === "Constrained") return "alert";
  if (status === "Watch") return "warning";
  return "nominal";
}

function hasCoordinates(vessel: Vessel): vessel is Vessel & { latitude: number; longitude: number } {
  return typeof vessel.latitude === "number" && Number.isFinite(vessel.latitude) && typeof vessel.longitude === "number" && Number.isFinite(vessel.longitude);
}

function centerOfVessels(vessels: Vessel[]): GeoPoint | undefined {
  const points = vessels.filter(hasCoordinates);
  if (points.length === 0) return undefined;
  const total = points.reduce((sum, vessel) => ({ lat: sum.lat + vessel.latitude, lon: sum.lon + vessel.longitude }), { lat: 0, lon: 0 });
  return { lat: total.lat / points.length, lon: total.lon / points.length };
}

function vesselBounds(vessels: Vessel[]) {
  const points = vessels.filter(hasCoordinates);
  if (points.length === 0) return undefined;
  return points.reduce(
    (bounds, vessel) => ({
      minLat: Math.min(bounds.minLat, vessel.latitude),
      maxLat: Math.max(bounds.maxLat, vessel.latitude),
      minLon: Math.min(bounds.minLon, vessel.longitude),
      maxLon: Math.max(bounds.maxLon, vessel.longitude),
    }),
    { minLat: points[0].latitude, maxLat: points[0].latitude, minLon: points[0].longitude, maxLon: points[0].longitude }
  );
}

function zoomForVessels(vessels: Vessel[]) {
  const bounds = vesselBounds(vessels);
  if (!bounds) return DEFAULT_ZOOM;
  const latSpan = Math.max(0.1, bounds.maxLat - bounds.minLat);
  const lonSpan = Math.max(0.1, bounds.maxLon - bounds.minLon);
  const span = Math.max(latSpan * 1.35, lonSpan);
  if (span > 36) return MIN_ZOOM;
  if (span > 18) return 5;
  if (span > 8) return 6;
  if (span > 4) return 7;
  return MAX_ZOOM;
}

function buildTrailPath(vessel: Vessel, center: GeoPoint, zoom: number) {
  const trail = vessel.trail?.filter((point) => Number.isFinite(point.latitude) && Number.isFinite(point.longitude));
  if (!trail || trail.length < 2) return undefined;
  return trail
    .map((point, index) => {
      const projected = projectGeo({ lat: point.latitude, lon: point.longitude }, center, zoom);
      return `${index === 0 ? "M" : "L"} ${projected.left} ${projected.top}`;
    })
    .join(" ");
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
  return eventType.split("_").map((part) => part.slice(0, 1).toUpperCase() + part.slice(1)).join(" ");
}

function eventClass(eventType: PortEvent["eventType"]) {
  if (eventType === "departure" || eventType === "service_completed") return "complete";
  if (eventType === "anchorage_entry" || eventType === "anchorage_exit") return "watch";
  if (eventType === "berth_assigned" || eventType === "service_started") return "active";
  return "arrival";
}

export default function ShipScene({ vessels, portEvents = [], expanded = false }: ShipSceneProps) {
  const [mapZoom, setMapZoom] = useState(DEFAULT_ZOOM);
  const [manualCenter, setManualCenter] = useState<GeoPoint>(DEFAULT_CENTER);
  const [selectedShipId, setSelectedShipId] = useState("");
  const [hoveredShipId, setHoveredShipId] = useState("");
  const [filter, setFilter] = useState<VesselFilter>("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [movingOnly, setMovingOnly] = useState(false);
  const [staleOnly, setStaleOnly] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>("latest");
  const [showPorts, setShowPorts] = useState(true);
  const [showEvents, setShowEvents] = useState(true);
  const [showTrails, setShowTrails] = useState(false);
  const sceneVessels = vessels ?? fallbackVessels;
  const query = searchQuery.trim().toLowerCase();
  const visibleVessels = useMemo(() => {
    const statusFiltered = filter === "All" ? sceneVessels : sceneVessels.filter((vessel) => vessel.status === filter);
    return sortVessels(
      statusFiltered.filter((vessel) => matchesQuery(vessel, query) && (!movingOnly || isMoving(vessel)) && (!staleOnly || isStale(vessel))),
      sortMode
    );
  }, [filter, movingOnly, query, sceneVessels, sortMode, staleOnly]);
  const mapCenter = manualCenter;
  const tileGrid = useMemo(() => buildTileGrid(mapCenter, mapZoom), [mapCenter, mapZoom]);
  const shipMarkers = useMemo<ShipMarker[]>(
    () => visibleVessels.map((vessel, index) => {
      const fallback = fallbackShipPositions[index % fallbackShipPositions.length];
      const projected = hasCoordinates(vessel) ? projectGeo({ lat: vessel.latitude, lon: vessel.longitude }, mapCenter, mapZoom) : fallback;
      return { vessel, left: projected.left, top: projected.top, heading: vessel.headingDeg ?? vessel.courseDeg ?? fallback.heading, tone: toneForStatus(vessel.status) };
    }),
    [mapCenter, mapZoom, visibleVessels]
  );
  const eventMarkers = useMemo(
    () => portEvents.map((event) => {
      const port = portGeo[event.portId];
      if (!port) return null;
      return { event, ...projectGeo(port, mapCenter, mapZoom) };
    }).filter((event): event is { event: PortEvent; left: number; top: number } => event !== null),
    [mapCenter, mapZoom, portEvents]
  );
  const selectedShip = selectedShipId ? shipMarkers.find((ship) => ship.vessel.id === selectedShipId) : undefined;
  const hoveredShip = hoveredShipId ? shipMarkers.find((ship) => ship.vessel.id === hoveredShipId) : undefined;

  const fitVisibleVessels = () => {
    const center = centerOfVessels(visibleVessels);
    if (center) setManualCenter(center);
    setSelectedShipId("");
    setMapZoom(zoomForVessels(visibleVessels));
  };

  const resetOverview = () => {
    setSelectedShipId("");
    setHoveredShipId("");
    setManualCenter(DEFAULT_CENTER);
    setMapZoom(DEFAULT_ZOOM);
  };

  const selectVessel = (vesselId: string) => {
    setSelectedShipId(vesselId);
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
      <div className="rail-section-header"><span>Selected vessel</span><strong>{selectedShip.vessel.name}</strong></div>
      <span className={`ship-status ${statusClass(selectedShip.vessel.status)}`}>{selectedShip.vessel.status}</span>
      <dl className="rail-detail-list">
        <div><dt>ID</dt><dd>{selectedShip.vessel.id}</dd></div>
        <div><dt>Route</dt><dd>{selectedShip.vessel.route}</dd></div>
        <div><dt>Cargo</dt><dd>{selectedShip.vessel.cargo}</dd></div>
        <div><dt>ETA</dt><dd>{selectedShip.vessel.eta}</dd></div>
        <div><dt>Speed</dt><dd>{selectedShip.vessel.speed}</dd></div>
        <div><dt>Updated</dt><dd>{formatTimestamp(selectedShip.vessel)}</dd></div>
        {hasCoordinates(selectedShip.vessel) && <div><dt>Position</dt><dd>{selectedShip.vessel.latitude.toFixed(3)}, {selectedShip.vessel.longitude.toFixed(3)}</dd></div>}
        {selectedShip.vessel.trail && selectedShip.vessel.trail.length > 1 && <div><dt>Trail</dt><dd>{selectedShip.vessel.trail.length} points</dd></div>}
      </dl>
      <button type="button" className="rail-action-button" onClick={() => setSelectedShipId("")}>Clear selection</button>
    </section>
  ) : (
    <section className="expanded-rail-section vessel-detail-section muted">
      <div className="rail-section-header"><span>Selected vessel</span><strong>No vessel selected</strong></div>
      <p>Select a ship marker or a vessel row to inspect AIS properties.</p>
    </section>
  );

  return (
    <div className={expanded ? "scene-container static-map-container expanded-map" : "scene-container static-map-container"}>
      <div className={selectedShip ? "regional-map tile-map is-inspecting" : "regional-map tile-map"} aria-label="CH-MARL maritime tile map inspection view">
        <svg className="regional-map-svg tile-map-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
          {tileGrid.map((tile) => <image key={tile.key} href={tile.href} x={tile.x} y={tile.y} width={tile.width} height={tile.height} opacity="0.78" preserveAspectRatio="none" />)}
          <rect x="0" y="0" width="100" height="100" fill="rgba(2, 10, 20, 0.18)" />
          {showTrails && visibleVessels.map((vessel) => {
            const trailPath = buildTrailPath(vessel, mapCenter, mapZoom);
            return trailPath ? <path key={`${vessel.id}-trail`} className={`vessel-trail ${statusClass(vessel.status)}`} d={trailPath} fill="none" /> : null;
          })}
        </svg>

        {showPorts && Object.entries(portGeo).map(([name, geo]) => {
          const point = projectGeo(geo, mapCenter, mapZoom);
          return (
            <button key={name} type="button" className="html-port-marker" style={{ left: `${point.left}%`, top: `${point.top}%` }} title={name} aria-label={`Center map on ${name}`} onClick={() => setManualCenter(geo)}>
              <span className="html-port-dot" />
              <span className="html-port-name">{name}</span>
            </button>
          );
        })}

        {showEvents && eventMarkers.map(({ event, left, top }) => <div key={event.eventId} className={`port-event-marker ${eventClass(event.eventType)}`} style={{ left: `${left}%`, top: `${top}%` }} title={`${labelForEvent(event.eventType)} · ${event.portId}`}><span /></div>)}

        {shipMarkers.map((ship) => <button key={ship.vessel.id} type="button" aria-label={`Inspect ${ship.vessel.name}`} title={`Inspect ${ship.vessel.name}`} className={`ship-figurine ${ship.tone} ${ship.vessel.id === selectedShipId ? "selected" : ""}`} style={{ left: `${ship.left}%`, top: `${ship.top}%`, transform: `translate(-50%, -50%) rotate(${ship.heading}deg)` }} onClick={() => selectVessel(ship.vessel.id)} onFocus={() => setHoveredShipId(ship.vessel.id)} onMouseEnter={() => setHoveredShipId(ship.vessel.id)} onBlur={() => setHoveredShipId("")} onMouseLeave={() => setHoveredShipId("")}><span /></button>)}
      </div>

      {hoveredShip && !selectedShip && <div className="vessel-hover-card" style={{ left: `${hoveredShip.left}%`, top: `${hoveredShip.top}%` }}><strong>{hoveredShip.vessel.name}</strong><span>{hoveredShip.vessel.route}</span><span>{hoveredShip.vessel.speed} · {hoveredShip.vessel.status}</span></div>}

      <div className="tile-map-controls">
        <button type="button" onClick={() => setMapZoom((zoom) => Math.min(MAX_ZOOM, zoom + 1))}>+</button>
        <button type="button" onClick={() => setMapZoom((zoom) => Math.max(MIN_ZOOM, zoom - 1))}>−</button>
        <button type="button" onClick={resetOverview}>Regional overview</button>
        <button type="button" onClick={fitVisibleVessels}>Fit vessels</button>
        <button type="button" className={showPorts ? "active layer-toggle" : "layer-toggle"} onClick={() => setShowPorts((value) => !value)}>Ports</button>
        <button type="button" className={showEvents ? "active layer-toggle" : "layer-toggle"} onClick={() => setShowEvents((value) => !value)}>Events</button>
        <button type="button" className={showTrails ? "active layer-toggle" : "layer-toggle"} onClick={() => setShowTrails((value) => !value)}>Trails</button>
        <span>{visibleVessels.length}/{sceneVessels.length} vessels</span>
        {expanded && <span>{eventMarkers.length} events</span>}
        <span>Zoom {mapZoom}</span>
      </div>

      {expanded && <div className="tile-filter-bar" aria-label="Vessel status filter">{filterOptions.map((option) => <button key={option} type="button" className={filter === option ? "active" : ""} onClick={() => { setFilter(option); setSelectedShipId(""); setHoveredShipId(""); }}>{option}</button>)}</div>}

      {expanded && <aside className="expanded-map-rail" aria-label="Expanded map details">
        {vesselDetail}
        <section className="expanded-rail-section tile-vessel-list" aria-label="Visible vessel list">
          <div className="tile-vessel-list-header"><strong>Visible vessels</strong><span>{visibleVessels.length}/{sceneVessels.length}</span></div>
          <div className="rail-search-tools">
            <input value={searchQuery} onChange={(event) => { setSearchQuery(event.target.value); setSelectedShipId(""); }} placeholder="Search name, MMSI, route" aria-label="Search vessels" />
            <select value={sortMode} onChange={(event) => setSortMode(event.target.value as SortMode)} aria-label="Sort vessels"><option value="latest">Latest update</option><option value="name">Name</option><option value="speed">Speed</option></select>
            <label><input type="checkbox" checked={movingOnly} onChange={(event) => setMovingOnly(event.target.checked)} />Moving only</label>
            <label><input type="checkbox" checked={staleOnly} onChange={(event) => setStaleOnly(event.target.checked)} />Stale only</label>
            <button type="button" onClick={resetRailFilters}>Reset filters</button>
          </div>
          <div className="tile-vessel-list-items">
            {visibleVessels.length === 0 ? <p className="rail-empty-state">No vessels match the current search and filters.</p> : visibleVessels.map((vessel) => <button key={vessel.id} type="button" className={`${vessel.id === selectedShipId ? "active" : ""} ${isStale(vessel) ? "stale" : ""}`} onClick={() => selectVessel(vessel.id)}><span>{vessel.name}</span><small>{vessel.status} · {vessel.speed} · {formatTimestamp(vessel)}</small></button>)}
          </div>
        </section>
        <section className="expanded-rail-section tile-event-list" aria-label="Port event list">
          <div className="tile-vessel-list-header"><strong>Port events</strong><span>{eventMarkers.length}</span></div>
          <div className="tile-vessel-list-items">
            {eventMarkers.length === 0 ? <p className="rail-empty-state">No port events are connected for this feed.</p> : eventMarkers.map(({ event }) => <button key={event.eventId} type="button"><span>{labelForEvent(event.eventType)}</span><small>{event.portId} · {event.timestamp}</small></button>)}
          </div>
        </section>
      </aside>}

      <div className="tile-attribution">© OpenStreetMap contributors</div>

      {!expanded && selectedShip && <aside className="ship-inspector-card">
        <div className="ship-inspector-header"><div><span className="ship-inspector-kicker">Selected vessel</span><h3>{selectedShip.vessel.name}</h3></div><span className={`ship-status ${statusClass(selectedShip.vessel.status)}`}>{selectedShip.vessel.status}</span></div>
        <dl>
          <div><dt>ID</dt><dd>{selectedShip.vessel.id}</dd></div><div><dt>Route</dt><dd>{selectedShip.vessel.route}</dd></div><div><dt>Cargo</dt><dd>{selectedShip.vessel.cargo}</dd></div><div><dt>ETA</dt><dd>{selectedShip.vessel.eta}</dd></div><div><dt>Speed</dt><dd>{selectedShip.vessel.speed}</dd></div><div><dt>Updated</dt><dd>{formatTimestamp(selectedShip.vessel)}</dd></div>
          {hasCoordinates(selectedShip.vessel) && <div><dt>Position</dt><dd>{selectedShip.vessel.latitude.toFixed(3)}, {selectedShip.vessel.longitude.toFixed(3)}</dd></div>}
          {selectedShip.vessel.trail && selectedShip.vessel.trail.length > 1 && <div><dt>Trail</dt><dd>{selectedShip.vessel.trail.length} points</dd></div>}
        </dl>
        <button type="button" onClick={() => setSelectedShipId("")}>Clear selection</button>
      </aside>}
    </div>
  );
}
