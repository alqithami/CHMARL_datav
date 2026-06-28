import { useMemo, useState } from "react";
import { routes, vessels as fallbackVessels, type Vessel, type VesselTrailPoint } from "@/data/chmarlData";
import type { PortEvent } from "@/types/chmarl";

type ShipSceneProps = {
  vessels?: Vessel[];
  portEvents?: PortEvent[];
  expanded?: boolean;
};

type GeoPoint = {
  lat: number;
  lon: number;
};

type ProjectedPoint = {
  left: number;
  top: number;
};

type ShipMarker = ProjectedPoint & {
  vessel: Vessel;
  heading: number;
  tone: "cyan" | "yellow" | "red" | "blue";
};

type Tile = {
  key: string;
  href: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

type VesselFilter = "All" | Vessel["status"];

const DEFAULT_CENTER: GeoPoint = { lat: 18.9, lon: 35.4 };
const DEFAULT_ZOOM = 6;
const MIN_ZOOM = 5;
const MAX_ZOOM = 8;
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
  Jeddah: { lat: 21.485, lon: 39.173 },
  "King Abdullah Port": { lat: 22.393, lon: 39.097 },
  Yanbu: { lat: 24.086, lon: 38.063 },
  Suez: { lat: 29.966, lon: 32.549 },
  Dammam: { lat: 26.43, lon: 50.09 },
  "Jebel Ali": { lat: 25.011, lon: 55.061 },
  Jizan: { lat: 16.889, lon: 42.551 },
};

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

function routeColor(risk: string) {
  if (risk === "high") return "#ff7474";
  if (risk === "medium") return "#ffd780";
  return "#65e4cb";
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
  return (
    typeof vessel.latitude === "number" &&
    Number.isFinite(vessel.latitude) &&
    typeof vessel.longitude === "number" &&
    Number.isFinite(vessel.longitude)
  );
}

function isTrailPoint(point: VesselTrailPoint): point is VesselTrailPoint {
  return Number.isFinite(point.latitude) && Number.isFinite(point.longitude);
}

function geoFromVessel(vessel: Vessel | undefined): GeoPoint | undefined {
  if (!vessel || !hasCoordinates(vessel)) return undefined;
  return { lat: vessel.latitude, lon: vessel.longitude };
}

function centerOfVessels(vessels: Vessel[]): GeoPoint | undefined {
  const points = vessels.filter(hasCoordinates);
  if (points.length === 0) return undefined;

  const total = points.reduce(
    (sum, vessel) => ({ lat: sum.lat + vessel.latitude, lon: sum.lon + vessel.longitude }),
    { lat: 0, lon: 0 }
  );

  return {
    lat: total.lat / points.length,
    lon: total.lon / points.length,
  };
}

function buildTrailPath(vessel: Vessel, center: GeoPoint, zoom: number) {
  const trail = vessel.trail?.filter(isTrailPoint);
  if (!trail || trail.length < 2) return undefined;

  return trail
    .map((point, index) => {
      const projected = projectGeo({ lat: point.latitude, lon: point.longitude }, center, zoom);
      return `${index === 0 ? "M" : "L"} ${projected.left} ${projected.top}`;
    })
    .join(" ");
}

function buildTileGrid(center: GeoPoint, zoom: number): Tile[] {
  const centerX = lonToTileX(center.lon, zoom);
  const centerY = latToTileY(center.lat, zoom);
  const tileWidth = 100 / VIEWPORT_TILES_X;
  const tileHeight = 100 / VIEWPORT_TILES_Y;
  const baseX = Math.floor(centerX);
  const baseY = Math.floor(centerY);
  const maxTile = 2 ** zoom;
  const tiles: Tile[] = [];

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

function labelForEvent(eventType: PortEvent["eventType"]) {
  return eventType
    .split("_")
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

function eventClass(eventType: PortEvent["eventType"]) {
  if (eventType === "departure" || eventType === "service_completed") return "complete";
  if (eventType === "anchorage_entry" || eventType === "anchorage_exit") return "watch";
  if (eventType === "berth_assigned" || eventType === "service_started") return "active";
  return "arrival";
}

const filterOptions: VesselFilter[] = ["All", "Nominal", "Watch", "Constrained"];

export default function ShipScene({ vessels = fallbackVessels, portEvents = [], expanded = false }: ShipSceneProps) {
  const [mapZoom, setMapZoom] = useState(DEFAULT_ZOOM);
  const [manualCenter, setManualCenter] = useState<GeoPoint>(DEFAULT_CENTER);
  const [selectedShipId, setSelectedShipId] = useState("");
  const [hoveredShipId, setHoveredShipId] = useState("");
  const [filter, setFilter] = useState<VesselFilter>("All");
  const sceneVessels = vessels.length > 0 ? vessels : fallbackVessels;
  const visibleVessels = useMemo(
    () => (filter === "All" ? sceneVessels : sceneVessels.filter((vessel) => vessel.status === filter)),
    [filter, sceneVessels]
  );
  const selectedVessel = selectedShipId ? visibleVessels.find((vessel) => vessel.id === selectedShipId) : undefined;
  const mapCenter = geoFromVessel(selectedVessel) ?? manualCenter;
  const tileGrid = useMemo(() => buildTileGrid(mapCenter, mapZoom), [mapCenter, mapZoom]);
  const shipMarkers = useMemo<ShipMarker[]>(
    () =>
      visibleVessels.map((vessel, index) => {
        const fallback = fallbackShipPositions[index % fallbackShipPositions.length];
        const projected = hasCoordinates(vessel) ? projectGeo({ lat: vessel.latitude, lon: vessel.longitude }, mapCenter, mapZoom) : fallback;
        return {
          vessel,
          left: projected.left,
          top: projected.top,
          heading: vessel.headingDeg ?? vessel.courseDeg ?? fallback.heading,
          tone: toneForStatus(vessel.status),
        };
      }),
    [mapCenter, mapZoom, visibleVessels]
  );
  const eventMarkers = useMemo(
    () =>
      portEvents
        .map((event) => {
          const port = portGeo[event.portId];
          if (!port) return null;
          const point = projectGeo(port, mapCenter, mapZoom);
          return { event, ...point };
        })
        .filter((event): event is { event: PortEvent; left: number; top: number } => event !== null),
    [mapCenter, mapZoom, portEvents]
  );
  const selectedShip = selectedShipId ? shipMarkers.find((ship) => ship.vessel.id === selectedShipId) : undefined;
  const hoveredShip = hoveredShipId ? shipMarkers.find((ship) => ship.vessel.id === hoveredShipId) : undefined;

  const mapStyle = selectedShip
    ? {
        transformOrigin: `${selectedShip.left}% ${selectedShip.top}%`,
      }
    : undefined;

  const selectVessel = (vesselId: string) => {
    setSelectedShipId(vesselId);
    const selected = visibleVessels.find((vessel) => vessel.id === vesselId);
    const center = geoFromVessel(selected);
    if (center) setManualCenter(center);
  };

  const fitVisibleVessels = () => {
    const center = centerOfVessels(visibleVessels);
    if (center) setManualCenter(center);
    setSelectedShipId("");
    setMapZoom(7);
  };

  const resetOverview = () => {
    setSelectedShipId("");
    setHoveredShipId("");
    setManualCenter(DEFAULT_CENTER);
    setMapZoom(DEFAULT_ZOOM);
  };

  return (
    <div className={expanded ? "scene-container static-map-container expanded-map" : "scene-container static-map-container"}>
      <div
        className={selectedShip ? "regional-map tile-map is-inspecting" : "regional-map tile-map"}
        style={mapStyle}
        aria-label="CH-MARL maritime tile map inspection view">
        <svg className="regional-map-svg tile-map-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
          {tileGrid.map((tile) => (
            <image
              key={tile.key}
              href={tile.href}
              x={tile.x}
              y={tile.y}
              width={tile.width}
              height={tile.height}
              opacity="0.78"
              preserveAspectRatio="none"
            />
          ))}
          <rect x="0" y="0" width="100" height="100" fill="rgba(2, 10, 20, 0.18)" />

          {routes.map((route) => {
            const from = portGeo[route.from];
            const to = portGeo[route.to];
            if (!from || !to) return null;

            const start = projectGeo(from, mapCenter, mapZoom);
            const end = projectGeo(to, mapCenter, mapZoom);
            const midX = (start.left + end.left) / 2;
            const midY = Math.min(start.top, end.top) - 7;

            return (
              <path
                key={`${route.from}-${route.to}`}
                d={`M ${start.left} ${start.top} Q ${midX} ${midY} ${end.left} ${end.top}`}
                stroke={routeColor(route.risk)}
                strokeWidth="0.55"
                strokeDasharray="1.8 1.4"
                fill="none"
                opacity="0.9"
              />
            );
          })}

          {visibleVessels.map((vessel) => {
            const trailPath = buildTrailPath(vessel, mapCenter, mapZoom);
            if (!trailPath) return null;
            return (
              <path
                key={`${vessel.id}-trail`}
                className={`vessel-trail ${statusClass(vessel.status)}`}
                d={trailPath}
                fill="none"
              />
            );
          })}
        </svg>

        {Object.entries(portGeo).map(([name, geo]) => {
          const point = projectGeo(geo, mapCenter, mapZoom);
          return (
            <div
              key={name}
              className="html-port-marker"
              style={{ left: `${point.left}%`, top: `${point.top}%` }}>
              <span className="html-port-dot" />
              <span className="html-port-name">{name}</span>
            </div>
          );
        })}

        {eventMarkers.map(({ event, left, top }) => (
          <div
            key={event.eventId}
            className={`port-event-marker ${eventClass(event.eventType)}`}
            style={{ left: `${left}%`, top: `${top}%` }}
            title={`${labelForEvent(event.eventType)} · ${event.portId}`}>
            <span />
          </div>
        ))}

        {shipMarkers.map((ship) => (
          <button
            key={ship.vessel.id}
            type="button"
            aria-label={`Inspect ${ship.vessel.name}`}
            title={`Inspect ${ship.vessel.name}`}
            className={`ship-figurine ${ship.tone} ${ship.vessel.id === selectedShipId ? "selected" : ""}`}
            style={{
              left: `${ship.left}%`,
              top: `${ship.top}%`,
              transform: `translate(-50%, -50%) rotate(${ship.heading}deg)`,
            }}
            onClick={() => selectVessel(ship.vessel.id)}
            onFocus={() => setHoveredShipId(ship.vessel.id)}
            onMouseEnter={() => setHoveredShipId(ship.vessel.id)}
            onBlur={() => setHoveredShipId("")}
            onMouseLeave={() => setHoveredShipId("")}>
            <span />
          </button>
        ))}
      </div>

      {hoveredShip && !selectedShip && (
        <div
          className="vessel-hover-card"
          style={{ left: `${hoveredShip.left}%`, top: `${hoveredShip.top}%` }}>
          <strong>{hoveredShip.vessel.name}</strong>
          <span>{hoveredShip.vessel.route}</span>
          <span>{hoveredShip.vessel.speed} · {hoveredShip.vessel.status}</span>
        </div>
      )}

      <div className="tile-map-controls">
        <button type="button" onClick={() => setMapZoom((zoom) => Math.min(MAX_ZOOM, zoom + 1))}>+</button>
        <button type="button" onClick={() => setMapZoom((zoom) => Math.max(MIN_ZOOM, zoom - 1))}>−</button>
        <button type="button" onClick={resetOverview}>Overview</button>
        <button type="button" onClick={fitVisibleVessels}>Fit vessels</button>
        <span>{visibleVessels.length}/{sceneVessels.length} vessels</span>
        {expanded && <span>{eventMarkers.length} events</span>}
        <span>Zoom {mapZoom}</span>
      </div>

      <div className="tile-filter-bar" aria-label="Vessel status filter">
        {filterOptions.map((option) => (
          <button
            key={option}
            type="button"
            className={filter === option ? "active" : ""}
            onClick={() => {
              setFilter(option);
              setSelectedShipId("");
              setHoveredShipId("");
            }}>
            {option}
          </button>
        ))}
      </div>

      {expanded && (
        <aside className="tile-vessel-list" aria-label="Visible vessel list">
          <div className="tile-vessel-list-header">
            <strong>Visible vessels</strong>
            <span>{visibleVessels.length}</span>
          </div>
          <div className="tile-vessel-list-items">
            {visibleVessels.slice(0, 12).map((vessel) => (
              <button
                key={vessel.id}
                type="button"
                className={vessel.id === selectedShipId ? "active" : ""}
                onClick={() => selectVessel(vessel.id)}>
                <span>{vessel.name}</span>
                <small>{vessel.status} · {vessel.speed}</small>
              </button>
            ))}
          </div>
        </aside>
      )}

      {expanded && (
        <aside className="tile-event-list" aria-label="Port event list">
          <div className="tile-vessel-list-header">
            <strong>Port events</strong>
            <span>{eventMarkers.length}</span>
          </div>
          <div className="tile-vessel-list-items">
            {eventMarkers.slice(0, 8).map(({ event }) => (
              <button key={event.eventId} type="button">
                <span>{labelForEvent(event.eventType)}</span>
                <small>{event.portId} · {event.timestamp}</small>
              </button>
            ))}
          </div>
        </aside>
      )}

      <div className="tile-attribution">© OpenStreetMap contributors</div>

      {selectedShip && (
        <aside className="ship-inspector-card">
          <div className="ship-inspector-header">
            <div>
              <span className="ship-inspector-kicker">Selected vessel</span>
              <h3>{selectedShip.vessel.name}</h3>
            </div>
            <span className={`ship-status ${statusClass(selectedShip.vessel.status)}`}>{selectedShip.vessel.status}</span>
          </div>
          <dl>
            <div><dt>ID</dt><dd>{selectedShip.vessel.id}</dd></div>
            <div><dt>Route</dt><dd>{selectedShip.vessel.route}</dd></div>
            <div><dt>Cargo</dt><dd>{selectedShip.vessel.cargo}</dd></div>
            <div><dt>ETA</dt><dd>{selectedShip.vessel.eta}</dd></div>
            <div><dt>Speed</dt><dd>{selectedShip.vessel.speed}</dd></div>
            {hasCoordinates(selectedShip.vessel) && (
              <div><dt>Position</dt><dd>{selectedShip.vessel.latitude.toFixed(3)}, {selectedShip.vessel.longitude.toFixed(3)}</dd></div>
            )}
            {selectedShip.vessel.trail && selectedShip.vessel.trail.length > 1 && (
              <div><dt>Trail</dt><dd>{selectedShip.vessel.trail.length} points</dd></div>
            )}
          </dl>
          <button type="button" onClick={() => setSelectedShipId("")}>Clear selection</button>
        </aside>
      )}
    </div>
  );
}
