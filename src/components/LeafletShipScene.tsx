import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as L from "leaflet";
import type { Vessel } from "@/data/chmarlData";
import type { PortEvent } from "@/types/chmarl";

type ShipSceneProps = {
  vessels?: Vessel[];
  portEvents?: PortEvent[];
  expanded?: boolean;
};

type GeoPoint = { lat: number; lon: number };
type VesselFilter = "All" | Vessel["status"];
type SortMode = "latest" | "name" | "speed";

type PortReference = GeoPoint & {
  id: string;
  label: string;
  primary?: boolean;
};

const PRIMARY_PORTS_CENTER: L.LatLngExpression = [21.94, 39.14];
const WORLD_CENTER: L.LatLngExpression = [18, 5];
const PRIMARY_PORTS_ZOOM = 7;
const MIN_ZOOM = 2;
const MAX_ZOOM = 18;
const OPERATIONAL_RADIUS_METERS = 120 * 1852;
const RAIL_ROW_LIMIT = 500;

const BASE_TILE_URL = import.meta.env.VITE_MAP_TILE_URL?.trim()
  || "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const SEAMARK_TILE_URL = import.meta.env.VITE_SEAMARK_TILE_URL?.trim()
  || "https://t1.openseamap.org/seamark/{z}/{x}/{y}.png";
const BASE_TILE_ATTRIBUTION = "&copy; OpenStreetMap contributors";
const SEAMARK_ATTRIBUTION = "Seamarks &copy; OpenSeaMap contributors";

const ports: PortReference[] = [
  { id: "Jeddah", label: "Jeddah Islamic Port", latitude: 21.4858, longitude: 39.1925, lat: 21.4858, lon: 39.1925, primary: true },
  { id: "King Abdullah Port", label: "King Abdullah Port", latitude: 22.3924, longitude: 39.0953, lat: 22.3924, lon: 39.0953, primary: true },
  { id: "Yanbu", label: "Yanbu Commercial Port", latitude: 24.0866, longitude: 38.0637, lat: 24.0866, lon: 38.0637 },
  { id: "Jizan", label: "Jizan Port", latitude: 16.8917, longitude: 42.5511, lat: 16.8917, lon: 42.5511 },
  { id: "Dammam", label: "King Abdulaziz Port, Dammam", latitude: 26.4318, longitude: 50.1015, lat: 26.4318, lon: 50.1015 },
  { id: "Jubail Commercial Port", label: "Jubail Commercial Port", latitude: 27.0333, longitude: 49.6667, lat: 27.0333, lon: 49.6667 },
  { id: "Jebel Ali", label: "Jebel Ali Port", latitude: 25.0114, longitude: 55.0611, lat: 25.0114, lon: 55.0611 },
  { id: "Suez", label: "Suez", latitude: 29.9668, longitude: 32.5498, lat: 29.9668, lon: 32.5498 },
];

const portById = new Map(ports.map((port) => [port.id, port]));
const primaryPorts = ports.filter((port) => port.primary);
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
  return timestamp > 0 && Date.now() - timestamp > 30 * 60 * 1000;
}

function formatTimestamp(vessel: Vessel) {
  if (!vessel.timestamp) return "No timestamp";
  const timestamp = vesselTimestampMs(vessel);
  if (timestamp === 0) return vessel.timestamp;
  return new Date(timestamp).toLocaleString();
}

function matchesQuery(vessel: Vessel, query: string) {
  if (!query) return true;
  return `${vessel.name} ${vessel.id} ${vessel.route} ${vessel.cargo} ${vessel.inputSource ?? ""}`
    .toLowerCase()
    .includes(query);
}

function sortVessels(vessels: Vessel[], mode: SortMode) {
  return [...vessels].sort((a, b) => {
    if (mode === "name") return a.name.localeCompare(b.name);
    if (mode === "speed") return (speedKnots(b) ?? -1) - (speedKnots(a) ?? -1);
    return vesselTimestampMs(b) - vesselTimestampMs(a);
  });
}

function distanceNm(a: GeoPoint, b: GeoPoint) {
  const radiusNm = 3440.065;
  const radians = (value: number) => (value * Math.PI) / 180;
  const dLat = radians(b.lat - a.lat);
  const dLon = radians(b.lon - a.lon);
  const lat1 = radians(a.lat);
  const lat2 = radians(b.lat);
  const haversine = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * radiusNm * Math.asin(Math.min(1, Math.sqrt(haversine)));
}

function primaryFocusVessels(vessels: Vessel[]) {
  return vessels.filter(hasCoordinates).filter((vessel) => (
    primaryPorts.some((port) => distanceNm(
      { lat: vessel.latitude, lon: vessel.longitude },
      { lat: port.lat, lon: port.lon },
    ) <= 120)
  ));
}

function statusColor(status: Vessel["status"]) {
  if (status === "Constrained") return "#ff7474";
  if (status === "Watch") return "#ffd780";
  return "#65e4cb";
}

function eventColor(eventType: PortEvent["eventType"]) {
  if (eventType === "departure" || eventType === "service_completed") return "#bda0ff";
  if (eventType === "anchorage_entry" || eventType === "anchorage_exit") return "#ffd780";
  if (eventType === "berth_assigned" || eventType === "service_started") return "#8ddcff";
  return "#65e4cb";
}

function statusClass(status: Vessel["status"]) {
  if (status === "Constrained") return "alert";
  if (status === "Watch") return "warning";
  return "nominal";
}

function labelForEvent(eventType: PortEvent["eventType"]) {
  return eventType
    .split("_")
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

function tooltipLine(value: string, className?: string) {
  const line = document.createElement("span");
  if (className) line.className = className;
  line.textContent = value;
  return line;
}

function buildVesselTooltip(vessel: Vessel) {
  const container = document.createElement("div");
  container.className = "leaflet-vessel-tooltip-content";
  const title = document.createElement("strong");
  title.textContent = vessel.name;
  container.append(title);
  container.append(tooltipLine(`${vessel.id} · ${vessel.status}`));
  container.append(tooltipLine(`${vessel.speed} · ${vessel.route}`));
  container.append(tooltipLine(formatTimestamp(vessel), isStale(vessel) ? "is-stale" : ""));
  if (vessel.inputSource) container.append(tooltipLine(`Source: ${vessel.inputSource}`));
  return container;
}

function buildEventTooltip(event: PortEvent, port: PortReference) {
  const container = document.createElement("div");
  container.className = "leaflet-event-tooltip-content";
  const title = document.createElement("strong");
  title.textContent = labelForEvent(event.eventType);
  container.append(title);
  container.append(tooltipLine(port.label));
  container.append(tooltipLine(event.timestamp));
  return container;
}

function markerOptions(vessel: Vessel, selected: boolean): L.CircleMarkerOptions {
  const color = statusColor(vessel.status);
  const stale = isStale(vessel);
  return {
    radius: selected ? 7 : stale ? 3 : 4.5,
    color: selected ? "#ffffff" : color,
    weight: selected ? 2.5 : 1,
    opacity: stale ? 0.56 : 0.95,
    fillColor: color,
    fillOpacity: stale ? 0.28 : 0.78,
    bubblingMouseEvents: false,
    className: stale ? "leaflet-vessel-path is-stale" : "leaflet-vessel-path",
  };
}

function boundsForVessels(vessels: Vessel[]) {
  const points = vessels.filter(hasCoordinates);
  if (points.length === 0) return null;
  return L.latLngBounds(points.map((vessel) => [vessel.latitude, vessel.longitude] as L.LatLngTuple));
}

export default function LeafletShipScene({ vessels = [], portEvents = [], expanded = false }: ShipSceneProps) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const seamarkLayerRef = useRef<L.TileLayer | null>(null);
  const vesselLayerRef = useRef<L.LayerGroup | null>(null);
  const portLayerRef = useRef<L.LayerGroup | null>(null);
  const zoneLayerRef = useRef<L.LayerGroup | null>(null);
  const eventLayerRef = useRef<L.LayerGroup | null>(null);
  const trailLayerRef = useRef<L.LayerGroup | null>(null);
  const vesselMarkersRef = useRef(new Map<string, L.CircleMarker>());
  const eventLocationsRef = useRef<L.LatLng[]>([]);
  const selectedHeadingMarkerRef = useRef<L.Marker | null>(null);
  const hasAutoFittedPrimaryRef = useRef(false);

  const [mapReady, setMapReady] = useState(false);
  const [mapZoom, setMapZoom] = useState(PRIMARY_PORTS_ZOOM);
  const [inViewCount, setInViewCount] = useState(0);
  const [eventsInView, setEventsInView] = useState(0);
  const [tileErrorCount, setTileErrorCount] = useState(0);
  const [selectedShipId, setSelectedShipId] = useState("");
  const [filter, setFilter] = useState<VesselFilter>("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [movingOnly, setMovingOnly] = useState(false);
  const [staleOnly, setStaleOnly] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>("latest");
  const [showPorts, setShowPorts] = useState(true);
  const [showZones, setShowZones] = useState(true);
  const [showEvents, setShowEvents] = useState(true);
  const [showTrails, setShowTrails] = useState(false);
  const [showSeamarks, setShowSeamarks] = useState(true);

  const query = searchQuery.trim().toLowerCase();
  const visibleVessels = useMemo(() => {
    const statusFiltered = filter === "All"
      ? vessels
      : vessels.filter((vessel) => vessel.status === filter);
    return sortVessels(
      statusFiltered.filter((vessel) => (
        matchesQuery(vessel, query)
        && (!movingOnly || isMoving(vessel))
        && (!staleOnly || isStale(vessel))
      )),
      sortMode,
    );
  }, [filter, movingOnly, query, sortMode, staleOnly, vessels]);

  const selectedVessel = selectedShipId
    ? vessels.find((vessel) => vessel.id === selectedShipId)
    : undefined;
  const railVessels = visibleVessels.slice(0, RAIL_ROW_LIMIT);

  const updateViewportStats = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const bounds = map.getBounds();
    let vesselCount = 0;
    for (const marker of vesselMarkersRef.current.values()) {
      if (bounds.contains(marker.getLatLng())) vesselCount += 1;
    }
    setInViewCount(vesselCount);
    setEventsInView(eventLocationsRef.current.filter((location) => bounds.contains(location)).length);
    setMapZoom(map.getZoom());
  }, []);

  const fitVesselRows = useCallback((rows: Vessel[], maxZoom = 10) => {
    const map = mapRef.current;
    const bounds = boundsForVessels(rows);
    if (!map || !bounds || !bounds.isValid()) return false;
    map.fitBounds(bounds, {
      animate: true,
      duration: 0.65,
      maxZoom,
      padding: expanded ? [70, 70] : [38, 38],
    });
    return true;
  }, [expanded]);

  useEffect(() => {
    const container = mapContainerRef.current;
    if (!container || mapRef.current) return;

    const map = L.map(container, {
      center: PRIMARY_PORTS_CENTER,
      zoom: PRIMARY_PORTS_ZOOM,
      minZoom: MIN_ZOOM,
      maxZoom: MAX_ZOOM,
      preferCanvas: true,
      worldCopyJump: true,
      zoomControl: false,
      attributionControl: true,
      zoomSnap: 0.5,
      zoomDelta: 0.5,
      wheelPxPerZoomLevel: 80,
    });

    const baseLayer = L.tileLayer(BASE_TILE_URL, {
      minZoom: MIN_ZOOM,
      maxZoom: 19,
      maxNativeZoom: 19,
      attribution: BASE_TILE_ATTRIBUTION,
      crossOrigin: true,
      keepBuffer: 4,
      updateWhenIdle: true,
    });
    baseLayer.on("tileerror", () => setTileErrorCount((count) => count + 1));
    baseLayer.addTo(map);

    const seamarks = L.tileLayer(SEAMARK_TILE_URL, {
      minZoom: MIN_ZOOM,
      maxZoom: 18,
      maxNativeZoom: 18,
      opacity: 0.88,
      attribution: SEAMARK_ATTRIBUTION,
      crossOrigin: true,
      keepBuffer: 3,
      updateWhenIdle: true,
      pane: "overlayPane",
    });
    seamarks.setZIndex(250);

    mapRef.current = map;
    seamarkLayerRef.current = seamarks;
    vesselLayerRef.current = L.layerGroup().addTo(map);
    portLayerRef.current = L.layerGroup().addTo(map);
    zoneLayerRef.current = L.layerGroup().addTo(map);
    eventLayerRef.current = L.layerGroup().addTo(map);
    trailLayerRef.current = L.layerGroup().addTo(map);

    L.control.zoom({ position: "bottomright" }).addTo(map);
    L.control.scale({ position: "bottomleft", imperial: false, metric: true }).addTo(map);
    map.on("moveend zoomend", updateViewportStats);

    setMapReady(true);
    requestAnimationFrame(() => map.invalidateSize());

    return () => {
      map.off("moveend zoomend", updateViewportStats);
      map.remove();
      mapRef.current = null;
      seamarkLayerRef.current = null;
      vesselLayerRef.current = null;
      portLayerRef.current = null;
      zoneLayerRef.current = null;
      eventLayerRef.current = null;
      trailLayerRef.current = null;
      selectedHeadingMarkerRef.current = null;
      vesselMarkersRef.current.clear();
      eventLocationsRef.current = [];
      setMapReady(false);
    };
  }, [updateViewportStats]);

  useEffect(() => {
    if (!mapReady) return;
    const timer = window.setTimeout(() => mapRef.current?.invalidateSize(), 0);
    return () => window.clearTimeout(timer);
  }, [expanded, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    const seamarks = seamarkLayerRef.current;
    if (!map || !seamarks) return;
    if (showSeamarks && !map.hasLayer(seamarks)) seamarks.addTo(map);
    if (!showSeamarks && map.hasLayer(seamarks)) map.removeLayer(seamarks);
  }, [mapReady, showSeamarks]);

  useEffect(() => {
    const map = mapRef.current;
    const portLayer = portLayerRef.current;
    const zoneLayer = zoneLayerRef.current;
    if (!map || !portLayer || !zoneLayer) return;
    portLayer.clearLayers();
    zoneLayer.clearLayers();

    if (showZones) {
      for (const port of ports) {
        L.circle([port.lat, port.lon], {
          radius: OPERATIONAL_RADIUS_METERS,
          color: port.primary ? "#65e4cb" : "#8ddcff",
          weight: port.primary ? 1.5 : 1,
          opacity: port.primary ? 0.62 : 0.34,
          fillColor: port.primary ? "#65e4cb" : "#8ddcff",
          fillOpacity: port.primary ? 0.055 : 0.025,
          interactive: false,
          className: port.primary ? "leaflet-operational-zone is-primary" : "leaflet-operational-zone",
        }).addTo(zoneLayer);
      }
    }

    if (showPorts) {
      for (const port of ports) {
        const marker = L.circleMarker([port.lat, port.lon], {
          radius: port.primary ? 6.5 : 5,
          color: "#ffffff",
          weight: port.primary ? 2 : 1.4,
          fillColor: port.primary ? "#65e4cb" : "#8ddcff",
          fillOpacity: 0.95,
          className: port.primary ? "leaflet-port-marker is-primary" : "leaflet-port-marker",
        });
        marker.bindTooltip(port.label, {
          permanent: true,
          direction: "right",
          offset: [7, 0],
          className: port.primary ? "leaflet-port-label is-primary" : "leaflet-port-label",
          opacity: 0.96,
        });
        marker.on("click", () => map.flyTo([port.lat, port.lon], Math.max(map.getZoom(), 8), { duration: 0.65 }));
        marker.addTo(portLayer);
      }
    }
  }, [mapReady, showPorts, showZones]);

  useEffect(() => {
    const eventLayer = eventLayerRef.current;
    if (!eventLayer) return;
    eventLayer.clearLayers();
    eventLocationsRef.current = [];
    if (!showEvents) {
      updateViewportStats();
      return;
    }

    for (const event of portEvents) {
      const port = portById.get(event.portId);
      if (!port) continue;
      const location = L.latLng(port.lat, port.lon);
      eventLocationsRef.current.push(location);
      const color = eventColor(event.eventType);
      const marker = L.circleMarker(location, {
        radius: 8,
        color: "#ffffff",
        weight: 1.3,
        opacity: 0.92,
        fillColor: color,
        fillOpacity: 0.76,
        className: "leaflet-port-event-marker",
      });
      marker.bindTooltip(buildEventTooltip(event, port), {
        direction: "top",
        offset: [0, -8],
        className: "leaflet-event-tooltip",
        opacity: 0.96,
      });
      marker.addTo(eventLayer);
    }
    updateViewportStats();
  }, [portEvents, showEvents, updateViewportStats]);

  useEffect(() => {
    const layer = vesselLayerRef.current;
    if (!layer) return;
    const nextIds = new Set<string>();

    for (const vessel of visibleVessels) {
      if (!hasCoordinates(vessel)) continue;
      nextIds.add(vessel.id);
      let marker = vesselMarkersRef.current.get(vessel.id);
      const selected = vessel.id === selectedShipId;
      const options = markerOptions(vessel, selected);

      if (!marker) {
        marker = L.circleMarker([vessel.latitude, vessel.longitude], options);
        marker.bindTooltip(buildVesselTooltip(vessel), {
          direction: "top",
          sticky: true,
          offset: [0, -7],
          className: "leaflet-vessel-tooltip",
          opacity: 0.97,
        });
        marker.on("click", () => {
          setSelectedShipId(vessel.id);
          mapRef.current?.panTo(marker?.getLatLng() ?? [vessel.latitude, vessel.longitude], { animate: true });
        });
        marker.addTo(layer);
        vesselMarkersRef.current.set(vessel.id, marker);
      } else {
        marker.setLatLng([vessel.latitude, vessel.longitude]);
        marker.setStyle(options);
        marker.setRadius(options.radius ?? 4.5);
        marker.setTooltipContent(buildVesselTooltip(vessel));
      }
    }

    for (const [id, marker] of vesselMarkersRef.current.entries()) {
      if (nextIds.has(id)) continue;
      layer.removeLayer(marker);
      vesselMarkersRef.current.delete(id);
    }
    updateViewportStats();
  }, [selectedShipId, updateViewportStats, visibleVessels]);

  useEffect(() => {
    const map = mapRef.current;
    const existing = selectedHeadingMarkerRef.current;
    if (map && existing) map.removeLayer(existing);
    selectedHeadingMarkerRef.current = null;
    if (!map || !selectedVessel || !hasCoordinates(selectedVessel)) return;

    const rawHeading = selectedVessel.headingDeg ?? selectedVessel.courseDeg ?? 0;
    const heading = Number.isFinite(rawHeading) ? rawHeading : 0;
    const icon = L.divIcon({
      className: "leaflet-selected-vessel-heading",
      html: `<span style="transform: rotate(${heading}deg)"></span>`,
      iconSize: [34, 34],
      iconAnchor: [17, 17],
    });
    selectedHeadingMarkerRef.current = L.marker(
      [selectedVessel.latitude, selectedVessel.longitude],
      { icon, interactive: false, keyboard: false, zIndexOffset: 2000 },
    ).addTo(map);
  }, [selectedVessel]);

  useEffect(() => {
    const trailLayer = trailLayerRef.current;
    if (!trailLayer) return;
    trailLayer.clearLayers();
    if (!showTrails) return;

    for (const vessel of visibleVessels) {
      const trail = vessel.trail?.filter((point) => (
        Number.isFinite(point.latitude) && Number.isFinite(point.longitude)
      ));
      if (!trail || trail.length < 2) continue;
      L.polyline(
        trail.map((point) => [point.latitude, point.longitude] as L.LatLngTuple),
        {
          color: statusColor(vessel.status),
          weight: 2,
          opacity: isStale(vessel) ? 0.32 : 0.72,
          dashArray: "5 6",
          interactive: false,
          className: "leaflet-vessel-trail",
        },
      ).addTo(trailLayer);
    }
  }, [showTrails, visibleVessels]);

  useEffect(() => {
    if (!mapReady || hasAutoFittedPrimaryRef.current || vessels.length === 0) return;
    const primary = primaryFocusVessels(vessels);
    if (primary.length > 0 && fitVesselRows(primary, 11)) hasAutoFittedPrimaryRef.current = true;
  }, [fitVesselRows, mapReady, vessels]);

  const showPrimaryPorts = () => {
    setSelectedShipId("");
    const map = mapRef.current;
    if (!map) return;
    const bounds = L.latLngBounds(primaryPorts.map((port) => [port.lat, port.lon] as L.LatLngTuple));
    map.fitBounds(bounds, { padding: [44, 44], maxZoom: PRIMARY_PORTS_ZOOM, animate: true, duration: 0.65 });
  };

  const showPortsOverview = () => {
    setSelectedShipId("");
    const map = mapRef.current;
    if (!map) return;
    const bounds = L.latLngBounds(ports.map((port) => [port.lat, port.lon] as L.LatLngTuple));
    map.fitBounds(bounds, { padding: [46, 46], maxZoom: 5, animate: true, duration: 0.65 });
  };

  const showWorldOverview = () => {
    setSelectedShipId("");
    mapRef.current?.setView(WORLD_CENTER, MIN_ZOOM, { animate: true });
  };

  const fitVisibleVessels = () => {
    setSelectedShipId("");
    if (!fitVesselRows(visibleVessels, 10)) showWorldOverview();
  };

  const selectVessel = (vesselId: string) => {
    setSelectedShipId(vesselId);
    const vessel = vessels.find((row) => row.id === vesselId);
    const map = mapRef.current;
    if (!map || !vessel || !hasCoordinates(vessel)) return;
    map.flyTo([vessel.latitude, vessel.longitude], Math.max(map.getZoom(), 9), { duration: 0.65 });
  };

  const resetRailFilters = () => {
    setSearchQuery("");
    setMovingOnly(false);
    setStaleOnly(false);
    setSortMode("latest");
    setSelectedShipId("");
  };

  const vesselDetail = selectedVessel ? (
    <section className="expanded-rail-section vessel-detail-section">
      <div className="rail-section-header"><span>Selected vessel</span><strong>{selectedVessel.name}</strong></div>
      <span className={`ship-status ${statusClass(selectedVessel.status)}`}>{selectedVessel.status}</span>
      <dl className="rail-detail-list">
        <div><dt>ID</dt><dd>{selectedVessel.id}</dd></div>
        <div><dt>Route</dt><dd>{selectedVessel.route}</dd></div>
        <div><dt>Cargo</dt><dd>{selectedVessel.cargo}</dd></div>
        <div><dt>ETA</dt><dd>{selectedVessel.eta}</dd></div>
        <div><dt>Speed</dt><dd>{selectedVessel.speed}</dd></div>
        <div><dt>Updated</dt><dd>{formatTimestamp(selectedVessel)}</dd></div>
        {selectedVessel.inputSource && <div><dt>Source</dt><dd>{selectedVessel.inputSource}</dd></div>}
        {hasCoordinates(selectedVessel) && <div><dt>Position</dt><dd>{selectedVessel.latitude.toFixed(4)}, {selectedVessel.longitude.toFixed(4)}</dd></div>}
        {selectedVessel.trail && selectedVessel.trail.length > 1 && <div><dt>Trail</dt><dd>{selectedVessel.trail.length} points</dd></div>}
      </dl>
      <button type="button" className="rail-action-button" onClick={() => setSelectedShipId("")}>Clear selection</button>
    </section>
  ) : (
    <section className="expanded-rail-section vessel-detail-section muted">
      <div className="rail-section-header"><span>Selected vessel</span><strong>No vessel selected</strong></div>
      <p>Select a vessel point or row to inspect AIS properties.</p>
    </section>
  );

  return (
    <div className={expanded ? "scene-container static-map-container expanded-map" : "scene-container static-map-container"}>
      <div className={selectedVessel ? "regional-map tile-map leaflet-map-shell is-inspecting" : "regional-map tile-map leaflet-map-shell"}>
        <div ref={mapContainerRef} className="leaflet-map-root" aria-label="Interactive maritime AIS map" />
        {!mapReady && <div className="leaflet-map-loading">Initializing interactive maritime map…</div>}
      </div>

      <div className="tile-map-controls leaflet-map-controls" aria-label="Interactive map controls">
        <button type="button" onClick={showPrimaryPorts}>Jeddah + KAP</button>
        <button type="button" onClick={showPortsOverview}>8 ports</button>
        <button type="button" onClick={showWorldOverview}>World AIS</button>
        <button type="button" onClick={fitVisibleVessels}>Fit vessels</button>
        <button type="button" className={showPorts ? "active layer-toggle" : "layer-toggle"} onClick={() => setShowPorts((value) => !value)}>Ports</button>
        <button type="button" className={showZones ? "active layer-toggle" : "layer-toggle"} onClick={() => setShowZones((value) => !value)}>120 NM zones</button>
        <button type="button" className={showEvents ? "active layer-toggle" : "layer-toggle"} onClick={() => setShowEvents((value) => !value)}>Events</button>
        <button type="button" className={showTrails ? "active layer-toggle" : "layer-toggle"} onClick={() => setShowTrails((value) => !value)}>Trails</button>
        <button type="button" className={showSeamarks ? "active layer-toggle" : "layer-toggle"} onClick={() => setShowSeamarks((value) => !value)}>Seamarks</button>
        <span>{inViewCount} in view · {visibleVessels.length}/{vessels.length} tracked</span>
        {expanded && <span>{eventsInView} events in view</span>}
        <span>Leaflet · Zoom {mapZoom.toFixed(1)}</span>
        {tileErrorCount > 0 && <span className="leaflet-tile-warning">{tileErrorCount} tile errors</span>}
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
        <aside className="expanded-map-rail" aria-label="Expanded map details">
          {vesselDetail}
          <section className="expanded-rail-section tile-vessel-list" aria-label="Tracked vessel list">
            <div className="tile-vessel-list-header">
              <strong>Tracked vessels</strong>
              <span>{Math.min(visibleVessels.length, RAIL_ROW_LIMIT)}/{visibleVessels.length}</span>
            </div>
            <div className="rail-search-tools">
              <input value={searchQuery} onChange={(event) => { setSearchQuery(event.target.value); setSelectedShipId(""); }} placeholder="Search name, MMSI, route" aria-label="Search vessels" />
              <select value={sortMode} onChange={(event) => setSortMode(event.target.value as SortMode)} aria-label="Sort vessels">
                <option value="latest">Latest update</option>
                <option value="name">Name</option>
                <option value="speed">Speed</option>
              </select>
              <label><input type="checkbox" checked={movingOnly} onChange={(event) => setMovingOnly(event.target.checked)} />Moving only</label>
              <label><input type="checkbox" checked={staleOnly} onChange={(event) => setStaleOnly(event.target.checked)} />Last-known only</label>
              <button type="button" onClick={resetRailFilters}>Reset filters</button>
            </div>
            <div className="tile-vessel-list-items">
              {visibleVessels.length === 0
                ? <p className="rail-empty-state">No vessels match the current search and filters.</p>
                : railVessels.map((vessel) => (
                  <button
                    key={vessel.id}
                    type="button"
                    className={`${vessel.id === selectedShipId ? "active" : ""} ${isStale(vessel) ? "stale" : ""}`}
                    onClick={() => selectVessel(vessel.id)}>
                    <span>{vessel.name}</span>
                    <small>{vessel.status} · {vessel.speed} · {formatTimestamp(vessel)}</small>
                  </button>
                ))}
              {visibleVessels.length > RAIL_ROW_LIMIT && (
                <p className="rail-empty-state">Search or filter to inspect rows beyond the first {RAIL_ROW_LIMIT}; all {visibleVessels.length} remain on the map.</p>
              )}
            </div>
          </section>
          <section className="expanded-rail-section tile-event-list" aria-label="Port event list">
            <div className="tile-vessel-list-header"><strong>Port events</strong><span>{portEvents.length}</span></div>
            <div className="tile-vessel-list-items">
              {portEvents.length === 0
                ? <p className="rail-empty-state">No port events are connected for this feed.</p>
                : portEvents.map((event) => (
                  <button key={event.eventId} type="button" onClick={() => {
                    const port = portById.get(event.portId);
                    if (port) mapRef.current?.flyTo([port.lat, port.lon], 9, { duration: 0.65 });
                  }}>
                    <span>{labelForEvent(event.eventType)}</span>
                    <small>{event.portId} · {event.timestamp}</small>
                  </button>
                ))}
            </div>
          </section>
        </aside>
      )}

      {!expanded && selectedVessel && (
        <aside className="ship-inspector-card">
          <div className="ship-inspector-header">
            <div><span className="ship-inspector-kicker">Selected vessel</span><h3>{selectedVessel.name}</h3></div>
            <span className={`ship-status ${statusClass(selectedVessel.status)}`}>{selectedVessel.status}</span>
          </div>
          <dl>
            <div><dt>ID</dt><dd>{selectedVessel.id}</dd></div>
            <div><dt>Route</dt><dd>{selectedVessel.route}</dd></div>
            <div><dt>Cargo</dt><dd>{selectedVessel.cargo}</dd></div>
            <div><dt>ETA</dt><dd>{selectedVessel.eta}</dd></div>
            <div><dt>Speed</dt><dd>{selectedVessel.speed}</dd></div>
            <div><dt>Updated</dt><dd>{formatTimestamp(selectedVessel)}</dd></div>
            {selectedVessel.inputSource && <div><dt>Source</dt><dd>{selectedVessel.inputSource}</dd></div>}
            {hasCoordinates(selectedVessel) && <div><dt>Position</dt><dd>{selectedVessel.latitude.toFixed(4)}, {selectedVessel.longitude.toFixed(4)}</dd></div>}
          </dl>
          <button type="button" onClick={() => setSelectedShipId("")}>Clear selection</button>
        </aside>
      )}
    </div>
  );
}
