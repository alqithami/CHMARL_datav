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

type MarkerCluster = ProjectedPoint & {
  key: string;
  count: number;
  center: GeoPoint;
  marker?: ShipMarker;
};

const PORTS_CENTER: GeoPoint = { lat: 23.2, lon: 43.5 };
const WORLD_CENTER: GeoPoint = { lat: 18, lon: 5 };
const DEFAULT_ZOOM = 5;
const MIN_ZOOM = 3;
const MAX_ZOOM = 9;
const VIEWPORT_TILES_X = 8;
const VIEWPORT_TILES_Y = 5.3;
const MARKER_VIEWPORT_MARGIN = 4;
const CLUSTER_MAX_ZOOM = 4;
const CLUSTER_CELL_PERCENT = 4;

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

function clampLatitude(latitude: number) {
  return Math.max(-85.051129, Math.min(85.051129, latitude));
}

function normalizeLongitude(longitude: number) {
  return ((longitude + 180) % 360 + 360) % 360 - 180;
}

function wrappedLongitudeDelta(longitude: number, centerLongitude: number) {
  return normalizeLongitude(longitude - centerLongitude);
}

function lonToTileX(lon: number, zoom: number) {
  return ((normalizeLongitude(lon) + 180) / 360) * 2 ** zoom;
}

function latToTileY(lat: number, zoom: number) {
  const latRad = (clampLatitude(lat) * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * 2 ** zoom;
}

function wrappedTileDelta(x: number, centerX: number, zoom: number) {
  const worldWidth = 2 ** zoom;
  let delta = x - centerX;
  if (delta > worldWidth / 2) delta -= worldWidth;
  if (delta < -worldWidth / 2) delta += worldWidth;
  return delta;
}

function projectGeo(point: GeoPoint, center: GeoPoint, zoom: number): ProjectedPoint {
  const centerX = lonToTileX(center.lon, zoom);
  const centerY = latToTileY(center.lat, zoom);
  const x = lonToTileX(point.lon, zoom);
  const y = latToTileY(point.lat, zoom);
  return {
    left: 50 + (wrappedTileDelta(x, centerX, zoom) * 100) / VIEWPORT_TILES_X,
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
        key: `${zoom}-${tileX}-${tileY}`,
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
  return typeof vessel.latitude === "number"
    && Number.isFinite(vessel.latitude)
    && vessel.latitude >= -85.051129
    && vessel.latitude <= 85.051129
    && typeof vessel.longitude === "number"
    && Number.isFinite(vessel.longitude)
    && vessel.longitude >= -180
    && vessel.longitude <= 180;
}

function circularMeanLongitude(points: Array<Vessel & { latitude: number; longitude: number }>) {
  const vector = points.reduce(
    (sum, vessel) => {
      const radians = (vessel.longitude * Math.PI) / 180;
      return { sin: sum.sin + Math.sin(radians), cos: sum.cos + Math.cos(radians) };
    },
    { sin: 0, cos: 0 }
  );
  return normalizeLongitude((Math.atan2(vector.sin, vector.cos) * 180) / Math.PI);
}

function centerOfVessels(vessels: Vessel[]): GeoPoint | undefined {
  const points = vessels.filter(hasCoordinates);
  if (points.length === 0) return undefined;
  const latitude = points.reduce((sum, vessel) => sum + vessel.latitude, 0) / points.length;
  return { lat: latitude, lon: circularMeanLongitude(points) };
}

function zoomForVessels(vessels: Vessel[]) {
  const points = vessels.filter(hasCoordinates);
  if (points.length === 0) return DEFAULT_ZOOM;
  const center = centerOfVessels(points) ?? PORTS_CENTER;
  const latitudes = points.map((vessel) => vessel.latitude);
  const longitudeOffsets = points.map((vessel) => wrappedLongitudeDelta(vessel.longitude, center.lon));
  const latSpan = Math.max(0.1, Math.max(...latitudes) - Math.min(...latitudes));
  const lonSpan = Math.max(0.1, Math.max(...longitudeOffsets) - Math.min(...longitudeOffsets));
  const span = Math.max(latSpan * 1.35, lonSpan);
  if (span > 140) return 3;
  if (span > 65) return 4;
  if (span > 28) return 5;
  if (span > 12) return 6;
  if (span > 5) return 7;
  if (span > 2) return 8;
  return MAX_ZOOM;
}

function isInViewport(point: ProjectedPoint, margin = MARKER_VIEWPORT_MARGIN) {
  return point.left >= -margin && point.left <= 100 + margin && point.top >= -margin && point.top <= 100 + margin;
}

function buildTrailPath(vessel: Vessel, center: GeoPoint, zoom: number) {
  const trail = vessel.trail?.filter((point) => Number.isFinite(point.latitude) && Number.isFinite(point.longitude));
  if (!trail || trail.length < 2) return undefined;
  const projected = trail.map((point) => projectGeo({ lat: point.latitude, lon: point.longitude }, center, zoom));
  if (projected.some((point) => !isInViewport(point, 20))) return undefined;
  return projected.map((point, index) => `${index === 0 ? "M" : "L"} ${point.left} ${point.top}`).join(" ");
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

function clusterMarkers(markers: ShipMarker[], zoom: number): MarkerCluster[] {
  if (zoom > CLUSTER_MAX_ZOOM) return markers.map((marker) => ({ key: marker.vessel.id, count: 1, left: marker.left, top: marker.top, center: { lat: marker.vessel.latitude as number, lon: marker.vessel.longitude as number }, marker }));
  const buckets = new Map<string, ShipMarker[]>();
  for (const marker of markers) {
    const key = `${Math.floor(marker.left / CLUSTER_CELL_PERCENT)}:${Math.floor(marker.top / CLUSTER_CELL_PERCENT)}`;
    const bucket = buckets.get(key) ?? [];
    bucket.push(marker);
    buckets.set(key, bucket);
  }
  return [...buckets.entries()].map(([key, bucket]) => {
    if (bucket.length === 1) {
      const marker = bucket[0];
      return { key: marker.vessel.id, count: 1, left: marker.left, top: marker.top, center: { lat: marker.vessel.latitude as number, lon: marker.vessel.longitude as number }, marker };
    }
    const left = bucket.reduce((sum, marker) => sum + marker.left, 0) / bucket.length;
    const top = bucket.reduce((sum, marker) => sum + marker.top, 0) / bucket.length;
    const center = centerOfVessels(bucket.map((marker) => marker.vessel)) ?? PORTS_CENTER;
    return { key, count: bucket.length, left, top, center };
  });
}

export default function ShipScene({ vessels, portEvents = [], expanded = false }: ShipSceneProps) {
  const [mapZoom, setMapZoom] = useState(DEFAULT_ZOOM);
  const [manualCenter, setManualCenter] = useState<GeoPoint>(PORTS_CENTER);
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
  const allShipMarkers = useMemo<ShipMarker[]>(
    () => visibleVessels.filter(hasCoordinates).map((vessel) => {
      const projected = projectGeo({ lat: vessel.latitude, lon: vessel.longitude }, mapCenter, mapZoom);
      return { vessel, left: projected.left, top: projected.top, heading: vessel.headingDeg ?? vessel.courseDeg ?? 0, tone: toneForStatus(vessel.status) };
    }),
    [mapCenter, mapZoom, visibleVessels]
  );
  const shipMarkers = useMemo(() => allShipMarkers.filter((marker) => isInViewport(marker)), [allShipMarkers]);
  const markerClusters = useMemo(() => clusterMarkers(shipMarkers, mapZoom), [mapZoom, shipMarkers]);
  const eventMarkers = useMemo(
    () => portEvents.map((event) => {
      const port = portGeo[event.portId];
      if (!port) return null;
      const projected = projectGeo(port, mapCenter, mapZoom);
      return isInViewport(projected) ? { event, ...projected } : null;
    }).filter((event): event is { event: PortEvent; left: number; top: number } => event !== null),
    [mapCenter, mapZoom, portEvents]
  );
  const selectedShip = selectedShipId ? allShipMarkers.find((ship) => ship.vessel.id === selectedShipId) : undefined;
  const hoveredShip = hoveredShipId ? allShipMarkers.find((ship) => ship.vessel.id === hoveredShipId) : undefined;

  const fitVisibleVessels = () => {
    const center = centerOfVessels(visibleVessels);
    if (center) setManualCenter(center);
    setSelectedShipId("");
    setMapZoom(zoomForVessels(visibleVessels));
  };

  const showPortsOverview = () => {
    setSelectedShipId("");
    setHoveredShipId("");
    setManualCenter(PORTS_CENTER);
    setMapZoom(DEFAULT_ZOOM);
  };

  const showWorldOverview = () => {
    setSelectedShipId("");
    setHoveredShipId("");
    setManualCenter(WORLD_CENTER);
    setMapZoom(MIN_ZOOM);
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

  const renderShipMarker = (ship: ShipMarker) => (
    <button
      key={ship.vessel.id}
      type="button"
      aria-label={`Inspect ${ship.vessel.name}`}
      title={`Inspect ${ship.vessel.name}`}
      className={`ship-figurine ${ship.tone} ${ship.vessel.id === selectedShipId ? "selected" : ""}`}
      style={{ left: `${ship.left}%`, top: `${ship.top}%`, transform: `translate(-50%, -50%) rotate(${ship.heading}deg)` }}
      onClick={() => selectVessel(ship.vessel.id)}
      onFocus={() => setHoveredShipId(ship.vessel.id)}
      onMouseEnter={() => setHoveredShipId(ship.vessel.id)}
      onBlur={() => setHoveredShipId("")}
      onMouseLeave={() => setHoveredShipId("")}>
      <span />
    </button>
  );

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
      <div className={selectedShip ? "regional-map tile-map is-inspecting" : "regional-map tile-map"} aria-label="Maritime AIS tracking map">
        <svg className="regional-map-svg tile-map-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
          {tileGrid.map((tile) => <image key={tile.key} href={tile.href} x={tile.x} y={tile.y} width={tile.width} height={tile.height} opacity="0.78" preserveAspectRatio="none" />)}
          <rect x="0" y="0" width="100" height="100" fill="rgba(2, 10, 20, 0.18)" />
          {showTrails && shipMarkers.map(({ vessel }) => {
            const trailPath = buildTrailPath(vessel, mapCenter, mapZoom);
            return trailPath ? <path key={`${vessel.id}-trail`} className={`vessel-trail ${statusClass(vessel.status)}`} d={trailPath} fill="none" /> : null;
          })}
        </svg>

        {showPorts && Object.entries(portGeo).map(([name, geo]) => {
          const point = projectGeo(geo, mapCenter, mapZoom);
          if (!isInViewport(point)) return null;
          return (
            <button key={name} type="button" className="html-port-marker" style={{ left: `${point.left}%`, top: `${point.top}%` }} title={name} aria-label={`Center map on ${name}`} onClick={() => { setManualCenter(geo); setMapZoom(Math.max(mapZoom, 7)); }}>
              <span className="html-port-dot" />
              <span className="html-port-name">{name}</span>
            </button>
          );
        })}

        {showEvents && eventMarkers.map(({ event, left, top }) => <div key={event.eventId} className={`port-event-marker ${eventClass(event.eventType)}`} style={{ left: `${left}%`, top: `${top}%` }} title={`${labelForEvent(event.eventType)} · ${event.portId}`}><span /></div>)}

        {markerClusters.map((cluster) => cluster.marker
          ? renderShipMarker(cluster.marker)
          : <button key={cluster.key} type="button" className="vessel-cluster" style={{ left: `${cluster.left}%`, top: `${cluster.top}%` }} title={`${cluster.count} vessels · zoom in`} aria-label={`${cluster.count} vessels; zoom in`} onClick={() => { setManualCenter(cluster.center); setMapZoom((zoom) => Math.min(MAX_ZOOM, zoom + 1)); }}><span>{cluster.count}</span></button>)}
      </div>

      {hoveredShip && !selectedShip && isInViewport(hoveredShip) && <div className="vessel-hover-card" style={{ left: `${hoveredShip.left}%`, top: `${hoveredShip.top}%` }}><strong>{hoveredShip.vessel.name}</strong><span>{hoveredShip.vessel.route}</span><span>{hoveredShip.vessel.speed} · {hoveredShip.vessel.status}</span></div>}

      <div className="tile-map-controls">
        <button type="button" onClick={() => setMapZoom((zoom) => Math.min(MAX_ZOOM, zoom + 1))}>+</button>
        <button type="button" onClick={() => setMapZoom((zoom) => Math.max(MIN_ZOOM, zoom - 1))}>−</button>
        <button type="button" onClick={showWorldOverview}>World view</button>
        <button type="button" onClick={showPortsOverview}>Ports overview</button>
        <button type="button" onClick={fitVisibleVessels}>Fit vessels</button>
        <button type="button" className={showPorts ? "active layer-toggle" : "layer-toggle"} onClick={() => setShowPorts((value) => !value)}>Ports</button>
        <button type="button" className={showEvents ? "active layer-toggle" : "layer-toggle"} onClick={() => setShowEvents((value) => !value)}>Events</button>
        <button type="button" className={showTrails ? "active layer-toggle" : "layer-toggle"} onClick={() => setShowTrails((value) => !value)}>Trails</button>
        <span>{shipMarkers.length} in view · {visibleVessels.length}/{sceneVessels.length} tracked</span>
        {expanded && <span>{eventMarkers.length} events</span>}
        <span>Zoom {mapZoom}</span>
      </div>

      {expanded && <div className="tile-filter-bar" aria-label="Vessel status filter">{filterOptions.map((option) => <button key={option} type="button" className={filter === option ? "active" : ""} onClick={() => { setFilter(option); setSelectedShipId(""); setHoveredShipId(""); }}>{option}</button>)}</div>}

      {expanded && <aside className="expanded-map-rail" aria-label="Expanded map details">
        {vesselDetail}
        <section className="expanded-rail-section tile-vessel-list" aria-label="Visible vessel list">
          <div className="tile-vessel-list-header"><strong>Tracked vessels</strong><span>{visibleVessels.length}/{sceneVessels.length}</span></div>
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
