import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import * as maplibregl from "maplibre-gl";
import type { Vessel } from "@/data/chmarlData";
import type { PortEvent } from "@/types/chmarl";

const TX97_STATUS_URL = "/api/charts/tx97/status";
const TX97_STYLE_URL = "/api/charts/tx97/style.json";
const VESSEL_SOURCE = "chmarl-vessels";
const SELECTED_SOURCE = "chmarl-selected-vessel";
const PORT_SOURCE = "chmarl-ports";
const EVENT_SOURCE = "chmarl-port-events";
const TRAIL_SOURCE = "chmarl-vessel-trails";
const CLUSTER_LAYER = "chmarl-vessel-clusters";
const VESSEL_LAYER = "chmarl-vessel-markers";
const SELECTED_LAYER = "chmarl-selected-vessel-ring";
const PORT_DOT_LAYER = "chmarl-port-dots";
const PORT_LABEL_LAYER = "chmarl-port-labels";
const EVENT_LAYER = "chmarl-port-events";
const TRAIL_LAYER = "chmarl-vessel-trails";

const portGeo: Record<string, { lat: number; lon: number }> = {
  Jeddah: { lat: 21.4858, lon: 39.1925 },
  "King Abdullah Port": { lat: 22.3924, lon: 39.0953 },
  Yanbu: { lat: 24.0866, lon: 38.0637 },
  Suez: { lat: 29.9668, lon: 32.5498 },
  Dammam: { lat: 26.4318, lon: 50.1015 },
  "Jebel Ali": { lat: 25.0114, lon: 55.0611 },
  Jizan: { lat: 16.8917, lon: 42.5511 },
};

export type Tx97ChartState = "checking" | "loading" | "ready" | "unconfigured" | "restricted" | "error";

export type Tx97ChartStatus = {
  state: Tx97ChartState;
  label: string;
  detail: string;
  chartCollection?: string;
};

export type Tx97ViewportState = {
  inView: number;
  zoom: number;
};

export type Tx97ChartMapHandle = {
  zoomIn: () => void;
  zoomOut: () => void;
  fitWorld: () => void;
  fitPorts: () => void;
  fitVessels: () => void;
  centerOnVessel: (vesselId: string) => void;
};

type Tx97ChartMapProps = {
  vessels: Vessel[];
  portEvents: PortEvent[];
  selectedVesselId?: string;
  showPorts: boolean;
  showEvents: boolean;
  showTrails: boolean;
  expanded?: boolean;
  onSelectVessel?: (vesselId: string) => void;
  onViewportChange?: (state: Tx97ViewportState) => void;
  onStatusChange?: (status: Tx97ChartStatus) => void;
};

type GatewayStatus = {
  provider?: string;
  chartCollection?: string;
  enabled?: boolean;
  configured?: boolean;
  publicDisplayAuthorized?: boolean;
  ready?: boolean;
  reason?: string | null;
};

type JsonProperty = string | number | boolean | null;
type ChartProperties = Record<string, JsonProperty>;
type Position = [number, number];

type PointFeature = {
  type: "Feature";
  id?: string;
  properties: ChartProperties;
  geometry: { type: "Point"; coordinates: Position };
};

type LineFeature = {
  type: "Feature";
  id?: string;
  properties: ChartProperties;
  geometry: { type: "LineString"; coordinates: Position[] };
};

type PointCollection = { type: "FeatureCollection"; features: PointFeature[] };
type LineCollection = { type: "FeatureCollection"; features: LineFeature[] };

function validCoordinates(vessel: Vessel): vessel is Vessel & { latitude: number; longitude: number } {
  return typeof vessel.latitude === "number"
    && Number.isFinite(vessel.latitude)
    && vessel.latitude >= -85.051129
    && vessel.latitude <= 85.051129
    && typeof vessel.longitude === "number"
    && Number.isFinite(vessel.longitude)
    && vessel.longitude >= -180
    && vessel.longitude <= 180;
}

function emptyPoints(): PointCollection {
  return { type: "FeatureCollection", features: [] };
}

function emptyLines(): LineCollection {
  return { type: "FeatureCollection", features: [] };
}

function vesselCollection(vessels: Vessel[]): PointCollection {
  return {
    type: "FeatureCollection",
    features: vessels.filter(validCoordinates).map((vessel) => ({
      type: "Feature",
      id: vessel.id,
      properties: {
        id: vessel.id,
        name: vessel.name,
        route: vessel.route,
        cargo: vessel.cargo,
        eta: vessel.eta,
        speed: vessel.speed,
        status: vessel.status,
        heading: vessel.headingDeg ?? vessel.courseDeg ?? 0,
        timestamp: vessel.timestamp ?? "",
        inputSource: vessel.inputSource ?? "live-ais",
      },
      geometry: { type: "Point", coordinates: [vessel.longitude, vessel.latitude] },
    })),
  };
}

function selectedCollection(vessels: Vessel[], selectedVesselId?: string): PointCollection {
  const selected = selectedVesselId
    ? vessels.find((vessel) => vessel.id === selectedVesselId && validCoordinates(vessel))
    : undefined;
  if (!selected || !validCoordinates(selected)) return emptyPoints();
  return {
    type: "FeatureCollection",
    features: [{
      type: "Feature",
      id: selected.id,
      properties: { id: selected.id, status: selected.status },
      geometry: { type: "Point", coordinates: [selected.longitude, selected.latitude] },
    }],
  };
}

function portCollection(): PointCollection {
  return {
    type: "FeatureCollection",
    features: Object.entries(portGeo).map(([name, point]) => ({
      type: "Feature",
      id: name,
      properties: { id: name, name },
      geometry: { type: "Point", coordinates: [point.lon, point.lat] },
    })),
  };
}

function portEventCollection(events: PortEvent[]): PointCollection {
  return {
    type: "FeatureCollection",
    features: events.flatMap((event) => {
      const point = portGeo[event.portId];
      if (!point) return [];
      return [{
        type: "Feature" as const,
        id: event.eventId,
        properties: {
          id: event.eventId,
          portId: event.portId,
          eventType: event.eventType,
          timestamp: event.timestamp,
        },
        geometry: { type: "Point" as const, coordinates: [point.lon, point.lat] as Position },
      }];
    }),
  };
}

function vesselTrailCollection(vessels: Vessel[]): LineCollection {
  return {
    type: "FeatureCollection",
    features: vessels.flatMap((vessel) => {
      const coordinates = vessel.trail
        ?.filter((point) => Number.isFinite(point.latitude) && Number.isFinite(point.longitude))
        .map((point) => [point.longitude, point.latitude] as Position) ?? [];
      if (coordinates.length < 2) return [];
      return [{
        type: "Feature" as const,
        id: `${vessel.id}-trail`,
        properties: { id: vessel.id, status: vessel.status },
        geometry: { type: "LineString" as const, coordinates },
      }];
    }),
  };
}

function setSourceData(map: maplibregl.Map, sourceId: string, data: PointCollection | LineCollection) {
  const source = map.getSource(sourceId) as maplibregl.GeoJSONSource | undefined;
  source?.setData(data);
}

function layerVisibility(map: maplibregl.Map, layerId: string, visible: boolean) {
  if (!map.getLayer(layerId)) return;
  map.setLayoutProperty(layerId, "visibility", visible ? "visible" : "none");
}

function chartPadding(expanded: boolean) {
  return expanded
    ? { top: 92, bottom: 72, left: 48, right: 390 }
    : { top: 82, bottom: 68, left: 42, right: 42 };
}

function fitPositions(map: maplibregl.Map, positions: Position[], expanded: boolean, maxZoom = 10) {
  if (positions.length === 0) return;
  if (positions.length === 1) {
    map.easeTo({ center: positions[0], zoom: Math.max(map.getZoom(), 8), duration: 700 });
    return;
  }
  const bounds = new maplibregl.LngLatBounds(positions[0], positions[0]);
  for (const position of positions.slice(1)) bounds.extend(position);
  map.fitBounds(bounds, {
    padding: chartPadding(expanded),
    maxZoom,
    duration: 800,
  });
}

function vesselPositions(vessels: Vessel[]): Position[] {
  return vessels.filter(validCoordinates).map((vessel) => [vessel.longitude, vessel.latitude]);
}

function portPositions(): Position[] {
  return Object.values(portGeo).map((point) => [point.lon, point.lat]);
}

function vesselMarkerImage(fill: string, stroke: string) {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D context is unavailable.");
  context.translate(size / 2, size / 2);
  context.shadowColor = fill;
  context.shadowBlur = 9;
  context.beginPath();
  context.moveTo(0, -24);
  context.lineTo(11, 18);
  context.lineTo(0, 12);
  context.lineTo(-11, 18);
  context.closePath();
  context.fillStyle = fill;
  context.fill();
  context.shadowBlur = 0;
  context.lineWidth = 3;
  context.strokeStyle = stroke;
  context.stroke();
  return context.getImageData(0, 0, size, size);
}

function popupNode(properties: ChartProperties) {
  const container = document.createElement("div");
  container.className = "tx97-popup-content";
  const title = document.createElement("strong");
  title.textContent = String(properties.name ?? properties.id ?? "Vessel");
  const route = document.createElement("span");
  route.textContent = String(properties.route ?? "AIS live position");
  const status = document.createElement("span");
  status.textContent = `${String(properties.speed ?? "TBD")} · ${String(properties.status ?? "Nominal")}`;
  const source = document.createElement("small");
  source.textContent = String(properties.inputSource ?? "live AIS");
  container.append(title, route, status, source);
  return container;
}

function statusFromGateway(gateway: GatewayStatus): Tx97ChartStatus {
  if (gateway.ready) {
    return {
      state: "loading",
      label: "Loading TX-97 vector charts",
      detail: gateway.chartCollection ?? "Authorized chart collection",
      chartCollection: gateway.chartCollection,
    };
  }
  if (gateway.configured && gateway.publicDisplayAuthorized === false) {
    return {
      state: "restricted",
      label: "TX-97 chart display is restricted",
      detail: gateway.reason ?? "Public chart display has not been authorized.",
      chartCollection: gateway.chartCollection,
    };
  }
  return {
    state: "unconfigured",
    label: "TX-97 chart service is not configured",
    detail: gateway.reason ?? "Connect an authorized TX-97 vector chart service.",
    chartCollection: gateway.chartCollection,
  };
}

const Tx97ChartMap = forwardRef<Tx97ChartMapHandle, Tx97ChartMapProps>(function Tx97ChartMap({
  vessels,
  portEvents,
  selectedVesselId,
  showPorts,
  showEvents,
  showTrails,
  expanded = false,
  onSelectVessel,
  onViewportChange,
  onStatusChange,
}, forwardedRef) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const vesselsRef = useRef(vessels);
  const selectRef = useRef(onSelectVessel);
  const viewportRef = useRef(onViewportChange);
  const statusRef = useRef(onStatusChange);
  const autoFittedRef = useRef(false);
  const selectedRef = useRef("");
  const [gatewayStatus, setGatewayStatus] = useState<GatewayStatus | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [chartStatus, setChartStatus] = useState<Tx97ChartStatus>({
    state: "checking",
    label: "Checking TX-97 chart service",
    detail: "Validating the licensed chart gateway.",
  });

  useEffect(() => { vesselsRef.current = vessels; }, [vessels]);
  useEffect(() => { selectRef.current = onSelectVessel; }, [onSelectVessel]);
  useEffect(() => { viewportRef.current = onViewportChange; }, [onViewportChange]);
  useEffect(() => { statusRef.current = onStatusChange; }, [onStatusChange]);

  const publishStatus = (next: Tx97ChartStatus) => {
    setChartStatus(next);
    statusRef.current?.(next);
  };

  useEffect(() => {
    const controller = new AbortController();
    fetch(TX97_STATUS_URL, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json() as GatewayStatus;
        if (!response.ok) throw new Error(payload.reason ?? `TX-97 status returned HTTP ${response.status}`);
        setGatewayStatus(payload);
        publishStatus(statusFromGateway(payload));
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        publishStatus({
          state: "error",
          label: "TX-97 chart gateway unavailable",
          detail: error instanceof Error ? error.message : String(error),
        });
      });
    return () => controller.abort();
  }, []);

  const updateViewport = (map: maplibregl.Map) => {
    const bounds = map.getBounds();
    const inView = vesselsRef.current.filter((vessel) => (
      validCoordinates(vessel) && bounds.contains([vessel.longitude, vessel.latitude])
    )).length;
    viewportRef.current?.({
      inView,
      zoom: Number(map.getZoom().toFixed(1)),
    });
  };

  useEffect(() => {
    if (!gatewayStatus?.ready || !containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: TX97_STYLE_URL,
      center: [43.5, 23.2],
      zoom: 5,
      minZoom: 1,
      maxZoom: 18,
      attributionControl: false,
      renderWorldCopies: false,
    });
    mapRef.current = map;
    popupRef.current = new maplibregl.Popup({
      closeButton: false,
      closeOnClick: false,
      offset: 20,
      className: "tx97-vessel-popup",
    });
    map.addControl(new maplibregl.ScaleControl({ unit: "nautical", maxWidth: 120 }), "bottom-right");

    map.on("error", (event) => {
      if (map.isStyleLoaded()) return;
      publishStatus({
        state: "error",
        label: "TX-97 chart could not be rendered",
        detail: event.error?.message ?? "The authorized vector-chart style failed to load.",
        chartCollection: gatewayStatus.chartCollection,
      });
    });

    map.on("load", () => {
      map.addImage("chmarl-vessel-nominal", vesselMarkerImage("#65e4cb", "#eaffff"), { pixelRatio: 2 });
      map.addImage("chmarl-vessel-watch", vesselMarkerImage("#ffd780", "#fff7df"), { pixelRatio: 2 });
      map.addImage("chmarl-vessel-alert", vesselMarkerImage("#ff7474", "#fff0f0"), { pixelRatio: 2 });

      map.addSource(VESSEL_SOURCE, {
        type: "geojson",
        data: emptyPoints(),
        cluster: true,
        clusterMaxZoom: 7,
        clusterRadius: 46,
      });
      map.addSource(SELECTED_SOURCE, { type: "geojson", data: emptyPoints() });
      map.addSource(PORT_SOURCE, { type: "geojson", data: portCollection() });
      map.addSource(EVENT_SOURCE, { type: "geojson", data: emptyPoints() });
      map.addSource(TRAIL_SOURCE, { type: "geojson", data: emptyLines() });

      map.addLayer({
        id: TRAIL_LAYER,
        type: "line",
        source: TRAIL_SOURCE,
        layout: { visibility: "visible", "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": [
            "match", ["get", "status"],
            "Constrained", "#ff7474",
            "Watch", "#ffd780",
            "#65e4cb",
          ],
          "line-width": 2,
          "line-opacity": 0.78,
          "line-dasharray": [1.5, 1.2],
        },
      } as maplibregl.LineLayerSpecification);

      map.addLayer({
        id: PORT_DOT_LAYER,
        type: "circle",
        source: PORT_SOURCE,
        layout: { visibility: "visible" },
        paint: {
          "circle-radius": 5,
          "circle-color": "#8ddcff",
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 1.5,
          "circle-opacity": 0.95,
        },
      } as maplibregl.CircleLayerSpecification);

      map.addLayer({
        id: PORT_LABEL_LAYER,
        type: "symbol",
        source: PORT_SOURCE,
        layout: {
          visibility: "visible",
          "text-field": ["get", "name"],
          "text-size": 11,
          "text-offset": [0, 1.2],
          "text-anchor": "top",
          "text-allow-overlap": false,
        },
        paint: {
          "text-color": "#eafcff",
          "text-halo-color": "#04111f",
          "text-halo-width": 1.2,
        },
      } as maplibregl.SymbolLayerSpecification);

      map.addLayer({
        id: EVENT_LAYER,
        type: "circle",
        source: EVENT_SOURCE,
        layout: { visibility: "visible" },
        paint: {
          "circle-radius": 7,
          "circle-color": [
            "match", ["get", "eventType"],
            "departure", "#bda0ff",
            "service_completed", "#bda0ff",
            "anchorage_entry", "#ffd780",
            "anchorage_exit", "#ffd780",
            "berth_assigned", "#8ddcff",
            "service_started", "#8ddcff",
            "#65e4cb",
          ],
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 1.5,
          "circle-opacity": 0.92,
        },
      } as maplibregl.CircleLayerSpecification);

      map.addLayer({
        id: CLUSTER_LAYER,
        type: "circle",
        source: VESSEL_SOURCE,
        filter: ["has", "point_count"],
        paint: {
          "circle-radius": ["step", ["get", "point_count"], 13, 25, 17, 100, 22, 500, 28],
          "circle-color": "#163e55",
          "circle-stroke-color": "#65e4cb",
          "circle-stroke-width": 2,
          "circle-opacity": 0.88,
        },
      } as maplibregl.CircleLayerSpecification);

      map.addLayer({
        id: VESSEL_LAYER,
        type: "symbol",
        source: VESSEL_SOURCE,
        filter: ["!", ["has", "point_count"]],
        layout: {
          "icon-image": [
            "match", ["get", "status"],
            "Constrained", "chmarl-vessel-alert",
            "Watch", "chmarl-vessel-watch",
            "chmarl-vessel-nominal",
          ],
          "icon-size": 0.55,
          "icon-rotate": ["coalesce", ["get", "heading"], 0],
          "icon-rotation-alignment": "map",
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
        },
      } as maplibregl.SymbolLayerSpecification);

      map.addLayer({
        id: SELECTED_LAYER,
        type: "circle",
        source: SELECTED_SOURCE,
        paint: {
          "circle-radius": 15,
          "circle-color": "rgba(255,255,255,0)",
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 3,
          "circle-opacity": 1,
        },
      } as maplibregl.CircleLayerSpecification);

      map.on("click", CLUSTER_LAYER, async (event) => {
        const feature = event.features?.[0];
        const clusterId = Number(feature?.properties?.cluster_id);
        const source = map.getSource(VESSEL_SOURCE) as maplibregl.GeoJSONSource | undefined;
        if (!Number.isFinite(clusterId) || !source) return;
        const expansionZoom = await source.getClusterExpansionZoom(clusterId);
        map.easeTo({ center: event.lngLat, zoom: expansionZoom, duration: 500 });
      });

      map.on("click", VESSEL_LAYER, (event) => {
        const id = String(event.features?.[0]?.properties?.id ?? "");
        if (id) selectRef.current?.(id);
      });

      map.on("mouseenter", VESSEL_LAYER, (event) => {
        map.getCanvas().style.cursor = "pointer";
        const properties = event.features?.[0]?.properties as ChartProperties | undefined;
        if (!properties) return;
        popupRef.current?.setLngLat(event.lngLat).setDOMContent(popupNode(properties)).addTo(map);
      });
      map.on("mouseleave", VESSEL_LAYER, () => {
        map.getCanvas().style.cursor = "";
        popupRef.current?.remove();
      });
      map.on("mouseenter", CLUSTER_LAYER, () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", CLUSTER_LAYER, () => { map.getCanvas().style.cursor = ""; });

      map.on("click", PORT_DOT_LAYER, (event) => {
        const name = String(event.features?.[0]?.properties?.name ?? "");
        if (!name) return;
        const node = document.createElement("div");
        node.className = "tx97-popup-content";
        const title = document.createElement("strong");
        title.textContent = name;
        const body = document.createElement("span");
        body.textContent = "Monitored CH-MARL port reference";
        node.append(title, body);
        new maplibregl.Popup({ offset: 14 }).setLngLat(event.lngLat).setDOMContent(node).addTo(map);
      });

      const handleMoveEnd = () => updateViewport(map);
      map.on("moveend", handleMoveEnd);
      setMapReady(true);
      publishStatus({
        state: "ready",
        label: "TX-97 vector charts",
        detail: gatewayStatus.chartCollection ?? "Authorized chart collection",
        chartCollection: gatewayStatus.chartCollection,
      });
      updateViewport(map);
    });

    return () => {
      popupRef.current?.remove();
      popupRef.current = null;
      map.remove();
      mapRef.current = null;
      setMapReady(false);
      autoFittedRef.current = false;
    };
  }, [gatewayStatus]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    setSourceData(map, VESSEL_SOURCE, vesselCollection(vessels));
    setSourceData(map, EVENT_SOURCE, portEventCollection(portEvents));
    setSourceData(map, TRAIL_SOURCE, vesselTrailCollection(vessels));
    setSourceData(map, SELECTED_SOURCE, selectedCollection(vessels, selectedVesselId));
    if (!autoFittedRef.current && vesselPositions(vessels).length > 0) {
      fitPositions(map, vesselPositions(vessels), expanded);
      autoFittedRef.current = true;
    }
    window.requestAnimationFrame(() => updateViewport(map));
  }, [expanded, mapReady, portEvents, selectedVesselId, vessels]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    layerVisibility(map, PORT_DOT_LAYER, showPorts);
    layerVisibility(map, PORT_LABEL_LAYER, showPorts);
    layerVisibility(map, EVENT_LAYER, showEvents);
    layerVisibility(map, TRAIL_LAYER, showTrails);
  }, [mapReady, showEvents, showPorts, showTrails]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !selectedVesselId || selectedRef.current === selectedVesselId) return;
    const vessel = vessels.find((row) => row.id === selectedVesselId);
    if (!vessel || !validCoordinates(vessel)) return;
    selectedRef.current = selectedVesselId;
    map.easeTo({
      center: [vessel.longitude, vessel.latitude],
      zoom: Math.max(map.getZoom(), 8),
      duration: 650,
    });
  }, [mapReady, selectedVesselId, vessels]);

  useImperativeHandle(forwardedRef, () => ({
    zoomIn() {
      mapRef.current?.zoomIn({ duration: 300 });
    },
    zoomOut() {
      mapRef.current?.zoomOut({ duration: 300 });
    },
    fitWorld() {
      const map = mapRef.current;
      if (!map) return;
      map.fitBounds([[-179, -78], [179, 78]], { padding: chartPadding(expanded), duration: 800 });
    },
    fitPorts() {
      const map = mapRef.current;
      if (map) fitPositions(map, portPositions(), expanded, 7);
    },
    fitVessels() {
      const map = mapRef.current;
      if (map) fitPositions(map, vesselPositions(vesselsRef.current), expanded);
    },
    centerOnVessel(vesselId: string) {
      const map = mapRef.current;
      const vessel = vesselsRef.current.find((row) => row.id === vesselId);
      if (!map || !vessel || !validCoordinates(vessel)) return;
      map.easeTo({ center: [vessel.longitude, vessel.latitude], zoom: Math.max(map.getZoom(), 8), duration: 650 });
    },
  }), [expanded]);

  return (
    <div className={`tx97-chart-host tx97-state-${chartStatus.state}`}>
      <div ref={containerRef} className="tx97-chart-canvas" aria-label="Wärtsilä TX-97 vector chart with AIS vessel overlays" />
      {chartStatus.state !== "ready" && (
        <div className="tx97-chart-state" role="status" aria-live="polite">
          <span className="tx97-chart-state-kicker">Wärtsilä TX-97</span>
          <strong>{chartStatus.label}</strong>
          <p>{chartStatus.detail}</p>
          <small>No raster or OpenStreetMap fallback is used.</small>
        </div>
      )}
      <div className={`tx97-chart-badge ${chartStatus.state}`}>
        <span />
        {chartStatus.label}
      </div>
      <div className="tx97-chart-warning">Decision support only · not for navigation</div>
    </div>
  );
});

export default Tx97ChartMap;
