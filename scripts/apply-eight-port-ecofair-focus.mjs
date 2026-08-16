import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";

function read(path) {
  return readFileSync(path, "utf8");
}

function write(path, content) {
  writeFileSync(path, content.endsWith("\n") ? content : `${content}\n`);
  console.log(`updated ${path}`);
}

function replaceOnce(content, before, after, label) {
  const first = content.indexOf(before);
  if (first === -1) throw new Error(`Could not find ${label}`);
  if (content.indexOf(before, first + before.length) !== -1) throw new Error(`Found ${label} more than once`);
  return content.slice(0, first) + after + content.slice(first + before.length);
}

function updateRuntime() {
  const path = "server/vessel-feed-proxy/runtime-v3.mjs";
  let content = read(path);

  content = replaceOnce(
    content,
    '  { id: "Dammam", latitude: 26.4318, longitude: 50.1015 },\n  { id: "Jebel Ali", latitude: 25.0114, longitude: 55.0611 },',
    '  { id: "Dammam", latitude: 26.4318, longitude: 50.1015 },\n  { id: "Jubail Commercial Port", latitude: 27.0333, longitude: 49.6667 },\n  { id: "Jebel Ali", latitude: 25.0114, longitude: 55.0611 },',
    "Jubail operational port",
  );

  content = replaceOnce(
    content,
    '];\n\nconst WEATHER_POINTS = [',
    '];\n\nconst PRIMARY_PORT_IDS = new Set(["Jeddah", "King Abdullah Port"]);\nconst PRIMARY_PORT_REFERENCE_POINTS = PORT_REFERENCE_POINTS.filter((port) => PRIMARY_PORT_IDS.has(port.id));\nconst PRIMARY_PORT_BBOX = "20.70,38.35;22.95,39.85";\n\nconst WEATHER_POINTS = [',
    "primary port constants",
  );

  content = replaceOnce(
    content,
    '  { locationId: "dammam", name: "Dammam", latitude: 26.4318, longitude: 50.1015 },\n  { locationId: "jebel-ali", name: "Jebel Ali", latitude: 25.0114, longitude: 55.0611 },',
    '  { locationId: "dammam", name: "Dammam", latitude: 26.4318, longitude: 50.1015 },\n  { locationId: "jubail", name: "Jubail Commercial Port", latitude: 27.0333, longitude: 49.6667 },\n  { locationId: "jebel-ali", name: "Jebel Ali", latitude: 25.0114, longitude: 55.0611 },',
    "Jubail weather point",
  );

  content = replaceOnce(
    content,
    `const AISSTREAM_RECOVERY_PROFILES = [
  { id: "world-unfiltered", description: "worldwide, all AIS message types", boxes: TRACKING_BOXES, filters: AISSTREAM_FILTER_TYPES },
  { id: "world-position-only", description: "worldwide, position-bearing messages", boxes: TRACKING_BOXES, filters: AISSTREAM_POSITION_FILTER_TYPES },
  { id: "red-sea-gulf-position-only", description: "Red Sea and Gulf, position-bearing messages", boxes: parseBoundingBoxes(REGIONAL_AIS_BBOX), filters: AISSTREAM_POSITION_FILTER_TYPES },
  { id: "port-approaches-position-only", description: "monitored port approaches, position-bearing messages", boxes: OPERATIONAL_BOXES, filters: AISSTREAM_POSITION_FILTER_TYPES },
];`,
    `const AISSTREAM_RECOVERY_PROFILES = [
  { id: "world-unfiltered", description: "worldwide, all AIS message types", boxes: TRACKING_BOXES, filters: AISSTREAM_FILTER_TYPES },
  { id: "primary-ports-position-only", description: "Jeddah Islamic Port and King Abdullah Port approaches", boxes: parseBoundingBoxes(PRIMARY_PORT_BBOX), filters: AISSTREAM_POSITION_FILTER_TYPES },
  { id: "portfolio-position-only", description: "eight monitored port approaches, position-bearing messages", boxes: OPERATIONAL_BOXES, filters: AISSTREAM_POSITION_FILTER_TYPES },
  { id: "red-sea-gulf-position-only", description: "Red Sea and Gulf, position-bearing messages", boxes: parseBoundingBoxes(REGIONAL_AIS_BBOX), filters: AISSTREAM_POSITION_FILTER_TYPES },
  { id: "world-position-only", description: "worldwide, position-bearing messages", boxes: TRACKING_BOXES, filters: AISSTREAM_POSITION_FILTER_TYPES },
];`,
    "AIS recovery profile order",
  );

  content = replaceOnce(
    content,
    `  trackingRows: 0,
  operationalRows: 0,
  operationalRadiusNm: ECOFAIR_OPERATIONAL_RADIUS_NM,`,
    `  trackingRows: 0,
  primaryOperationalRows: 0,
  portfolioOperationalRows: 0,
  operationalRows: 0,
  operationalRadiusNm: ECOFAIR_OPERATIONAL_RADIUS_NM,`,
    "primary and portfolio counters",
  );

  content = replaceOnce(
    content,
    `function operationalVessels(vessels) {
  return vessels.filter((vessel) => {
    const nearest = nearestOperationalPort(vessel);
    return nearest && nearest.distanceNm <= ECOFAIR_OPERATIONAL_RADIUS_NM;
  });
}`,
    `function vesselsNearPorts(vessels, ports) {
  return vessels.filter((vessel) => {
    if (!validCoordinates(vessel?.latitude, vessel?.longitude)) return false;
    return ports.some((port) => haversineNm(vessel, port) <= ECOFAIR_OPERATIONAL_RADIUS_NM);
  });
}

function operationalVessels(vessels) {
  return vesselsNearPorts(vessels, PORT_REFERENCE_POINTS);
}

function primaryOperationalVessels(vessels) {
  return vesselsNearPorts(vessels, PRIMARY_PORT_REFERENCE_POINTS);
}`,
    "operational scope functions",
  );

  content = replaceOnce(
    content,
    `    const tracking = [...merged.values()].filter((row) => validCoordinates(row.latitude, row.longitude));
    const operational = operationalVessels(tracking);
    const activeProviders = [`,
    `    const tracking = [...merged.values()].filter((row) => validCoordinates(row.latitude, row.longitude));
    const operational = operationalVessels(tracking);
    const primaryOperational = primaryOperationalVessels(tracking);
    const activeProviders = [`,
    "primary scope calculation",
  );

  content = replaceOnce(
    content,
    `      trackingRows: tracking.length,
      operationalRows: operational.length,
      lastLoadedAt: new Date().toISOString(),`,
    `      trackingRows: tracking.length,
      primaryOperationalRows: primaryOperational.length,
      portfolioOperationalRows: operational.length,
      operationalRows: operational.length,
      lastLoadedAt: new Date().toISOString(),`,
    "primary scope counters assignment",
  );

  content = replaceOnce(
    content,
    `    lastCombinedVessels = tracking;
    lastOperationalVessels = operational;
    return { tracking, operational };
  } catch (error) {`,
    `    lastCombinedVessels = tracking;
    lastOperationalVessels = operational;
    lastPrimaryOperationalVessels = primaryOperational;
    return { tracking, operational, primaryOperational };
  } catch (error) {`,
    "combined scope success result",
  );

  content = replaceOnce(
    content,
    `    return { tracking: lastCombinedVessels, operational: lastOperationalVessels };
  }
}`,
    `    return {
      tracking: lastCombinedVessels,
      operational: lastOperationalVessels,
      primaryOperational: lastPrimaryOperationalVessels,
    };
  }
}`,
    "combined scope fallback result",
  );

  content = replaceOnce(
    content,
    `let lastCombinedVessels = [];
let lastOperationalVessels = [];
let lastWeatherPayload = null;`,
    `let lastCombinedVessels = [];
let lastOperationalVessels = [];
let lastPrimaryOperationalVessels = [];
let lastWeatherPayload = null;`,
    "primary scope cache",
  );

  content = replaceOnce(
    content,
    `function recordOnlineStep(trackingCount, operationalCount) {
  const step = ecofair.buildStep(chmarlOnlineHistory.length + 1);
  Object.assign(step.state, {
    trackingVessels: trackingCount,
    operationalVessels: operationalCount,
    outOfScopeVessels: Math.max(0, trackingCount - operationalCount),
    operationalRadiusNm: ECOFAIR_OPERATIONAL_RADIUS_NM,
    measurementScope: "monitored-port approaches only",
  });`,
    `function recordOnlineStep(trackingCount, operationalCount, primaryOperationalCount) {
  const step = ecofair.buildStep(chmarlOnlineHistory.length + 1);
  Object.assign(step.state, {
    trackingVessels: trackingCount,
    operationalVessels: operationalCount,
    portfolioOperationalVessels: operationalCount,
    primaryOperationalVessels: primaryOperationalCount,
    outOfScopeVessels: Math.max(0, trackingCount - operationalCount),
    operationalRadiusNm: ECOFAIR_OPERATIONAL_RADIUS_NM,
    monitoredPorts: PORT_REFERENCE_POINTS.map((port) => port.id),
    primaryPorts: PRIMARY_PORT_REFERENCE_POINTS.map((port) => port.id),
    measurementScope: "eight monitored port approaches; Jeddah and King Abdullah highlighted",
  });`,
    "online step port scopes",
  );

  content = replaceOnce(
    content,
    `    const { tracking, operational } = await loadCombinedVessels();
    ecofair.update(operational);
    if (CHMARL_RUNTIME_ENABLED && (operational.length > 0 || ecofair.summary().trackedVessels > 0)) recordOnlineStep(tracking.length, operational.length);`,
    `    const { tracking, operational, primaryOperational } = await loadCombinedVessels();
    ecofair.update(operational);
    if (CHMARL_RUNTIME_ENABLED && (operational.length > 0 || ecofair.summary().trackedVessels > 0)) {
      recordOnlineStep(tracking.length, operational.length, primaryOperational.length);
    }`,
    "EcoFair background scope",
  );

  content = replaceOnce(
    content,
    `    operationalScope: { radiusNm: ECOFAIR_OPERATIONAL_RADIUS_NM, rows: vesselInputState.operationalRows, ports: PORT_REFERENCE_POINTS.map((port) => port.id) },`,
    `    operationalScope: {
      radiusNm: ECOFAIR_OPERATIONAL_RADIUS_NM,
      rows: vesselInputState.operationalRows,
      portfolioRows: vesselInputState.portfolioOperationalRows,
      primaryRows: vesselInputState.primaryOperationalRows,
      ports: PORT_REFERENCE_POINTS.map((port) => port.id),
      primaryPorts: PRIMARY_PORT_REFERENCE_POINTS.map((port) => port.id),
    },`,
    "health operational scope",
  );

  content = replaceOnce(
    content,
    `  if (path === "/api/vessels" || path === "/api/vessels/operations") {
    const { tracking, operational } = await loadCombinedVessels();
    const scope = path === "/api/vessels/operations" || url.searchParams.get("scope") === "operational" ? "operational" : "tracking";
    const vessels = scope === "operational" ? operational : tracking;
    return sendJson(response, 200, {
      vessels,
      source: sourceForTracking(),
      scope,
      counts: { tracking: tracking.length, operational: operational.length },`,
    `  if (path === "/api/vessels" || path === "/api/vessels/operations") {
    const { tracking, operational, primaryOperational } = await loadCombinedVessels();
    const requestedScope = url.searchParams.get("scope");
    const scope = path === "/api/vessels/operations" || requestedScope === "operational"
      ? "operational"
      : requestedScope === "primary"
        ? "primary"
        : "tracking";
    const vessels = scope === "operational" ? operational : scope === "primary" ? primaryOperational : tracking;
    return sendJson(response, 200, {
      vessels,
      source: sourceForTracking(),
      scope,
      counts: {
        tracking: tracking.length,
        operational: operational.length,
        portfolioOperational: operational.length,
        primaryOperational: primaryOperational.length,
      },`,
    "vessel API scope selection",
  );

  content = content.replaceAll(
    '"/api/vessels?scope=operational"',
    '"/api/vessels?scope=operational", "/api/vessels?scope=primary"',
  );

  write(path, content);
}

function updateEcofair() {
  const path = "server/vessel-feed-proxy/ecofair.mjs";
  let content = read(path);
  content = replaceOnce(
    content,
    `  Dammam: 20,
  "Jebel Ali": 28,`,
    `  Dammam: 20,
  "Jubail Commercial Port": 12,
  "Jebel Ali": 28,`,
    "Jubail EcoFair capacity",
  );
  write(path, content);
}

function updateVesselDisplay() {
  const path = "src/providers/vesselDisplayStabilizer.ts";
  let content = read(path);
  content = replaceOnce(content, "const gridDegrees = 5;", "const gridDegrees = 180;", "global display grid");
  content = replaceOnce(content, "const maxPerGridCell = 8;", "const maxPerGridCell = 20_000;", "global grid capacity");
  content = replaceOnce(content, "const maxDisplayRows = 6_500;", "const maxDisplayRows = 20_000;", "global display capacity");
  write(path, content);
}

function updatePortCoverage() {
  const path = "src/utils/portCoverage.ts";
  let content = read(path);
  content = replaceOnce(
    content,
    '  { id: "Dammam", shortId: "DAM", area: "Saudi", latitude: 26.4318, longitude: 50.1015 },\n  { id: "Jebel Ali", shortId: "JEA", area: "Regional", latitude: 25.0114, longitude: 55.0611 },',
    '  { id: "Dammam", shortId: "DAM", area: "Saudi", latitude: 26.4318, longitude: 50.1015 },\n  { id: "Jubail Commercial Port", shortId: "JUB", area: "Saudi", latitude: 27.0333, longitude: 49.6667 },\n  { id: "Jebel Ali", shortId: "JEA", area: "Regional", latitude: 25.0114, longitude: 55.0611 },',
    "Jubail frontend port coverage",
  );
  content = replaceOnce(
    content,
    `];

function hasPosition`,
    `];

export const primaryMonitoredPortIds = new Set(["Jeddah", "King Abdullah Port"]);

function hasPosition`,
    "primary monitored port ids",
  );
  write(path, content);
}

function updatePortCoverageMatrix() {
  const path = "src/components/insights/PortCoverageMatrix.tsx";
  let content = read(path);
  content = replaceOnce(
    content,
    'import { summarizePortCoverage } from "@/utils/portCoverage";',
    'import { primaryMonitoredPortIds, summarizePortCoverage } from "@/utils/portCoverage";',
    "primary coverage import",
  );
  content = replaceOnce(
    content,
    `    () => [...summary.rows].sort((a, b) => {
      if (a.port.area !== b.port.area) return a.port.area === "Saudi" ? -1 : 1;
      return b.count - a.count || a.port.id.localeCompare(b.port.id);
    }),`,
    `    () => [...summary.rows].sort((a, b) => {
      const aPrimary = primaryMonitoredPortIds.has(a.port.id);
      const bPrimary = primaryMonitoredPortIds.has(b.port.id);
      if (aPrimary !== bPrimary) return aPrimary ? -1 : 1;
      if (a.port.area !== b.port.area) return a.port.area === "Saudi" ? -1 : 1;
      return b.count - a.count || a.port.id.localeCompare(b.port.id);
    }),`,
    "primary coverage sorting",
  );
  content = replaceOnce(
    content,
    `  const activeSaudiPorts = summary.rows.filter((row) => row.port.area === "Saudi" && row.count > 0).length;
  const saudiPorts = summary.rows.filter((row) => row.port.area === "Saudi").length;`,
    `  const activeSaudiPorts = summary.rows.filter((row) => row.port.area === "Saudi" && row.count > 0).length;
  const saudiPorts = summary.rows.filter((row) => row.port.area === "Saudi").length;
  const primaryRows = summary.rows
    .filter((row) => primaryMonitoredPortIds.has(row.port.id))
    .reduce((sum, row) => sum + row.count, 0);`,
    "primary coverage total",
  );
  content = replaceOnce(
    content,
    `        <span>Saudi AIS coverage</span>
        <strong>{summary.saudiNearPort}/{summary.totalRows}</strong>
        <small>{activeSaudiPorts}/{saudiPorts} Saudi ports active · {summary.offshore} offshore · {summary.missingPosition} missing position</small>`,
    `        <span>Eight-port AIS coverage</span>
        <strong>{summary.saudiNearPort + summary.regionalNearPort}/{summary.totalRows}</strong>
        <small>Jeddah + KAP: {primaryRows} · {activeSaudiPorts}/{saudiPorts} Saudi ports active · {summary.offshore} outside scope</small>`,
    "eight-port coverage summary",
  );
  write(path, content);
}

function updateShipScene() {
  const path = "src/components/ShipScene.tsx";
  let content = read(path);
  content = replaceOnce(
    content,
    `const PORTS_CENTER: GeoPoint = { lat: 23.2, lon: 43.5 };
const WORLD_CENTER: GeoPoint = { lat: 18, lon: 5 };
const DEFAULT_ZOOM = 5;`,
    `const PRIMARY_PORTS_CENTER: GeoPoint = { lat: 21.94, lon: 39.14 };
const PORTS_CENTER: GeoPoint = { lat: 23.2, lon: 43.5 };
const WORLD_CENTER: GeoPoint = { lat: 18, lon: 5 };
const DEFAULT_ZOOM = 5;
const PRIMARY_PORTS_ZOOM = 7;
const PRIMARY_PORT_FOCUS_RADIUS_NM = 120;`,
    "primary map center",
  );
  content = replaceOnce(
    content,
    '  Dammam: { lat: 26.4318, lon: 50.1015 },\n  "Jebel Ali": { lat: 25.0114, lon: 55.0611 },',
    '  Dammam: { lat: 26.4318, lon: 50.1015 },\n  "Jubail Commercial Port": { lat: 27.0333, lon: 49.6667 },\n  "Jebel Ali": { lat: 25.0114, lon: 55.0611 },',
    "Jubail map marker",
  );
  content = replaceOnce(
    content,
    `function wrappedLongitudeDelta(longitude: number, centerLongitude: number) {
  return normalizeLongitude(longitude - centerLongitude);
}
`,
    `function wrappedLongitudeDelta(longitude: number, centerLongitude: number) {
  return normalizeLongitude(longitude - centerLongitude);
}

function distanceNm(a: GeoPoint, b: GeoPoint) {
  const radiusNm = 3440.065;
  const radians = (value: number) => (value * Math.PI) / 180;
  const dLat = radians(b.lat - a.lat);
  const dLon = radians(b.lon - a.lon);
  const lat1 = radians(a.lat);
  const lat2 = radians(b.lat);
  const haversine = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * radiusNm * Math.asin(Math.min(1, Math.sqrt(haversine)));
}
`,
    "map distance helper",
  );
  content = replaceOnce(
    content,
    `function zoomForVessels(vessels: Vessel[]) {`,
    `function primaryFocusVessels(vessels: Vessel[]) {
  const primaryPorts = [portGeo.Jeddah, portGeo["King Abdullah Port"]];
  return vessels.filter(hasCoordinates).filter((vessel) => (
    primaryPorts.some((port) => distanceNm({ lat: vessel.latitude, lon: vessel.longitude }, port) <= PRIMARY_PORT_FOCUS_RADIUS_NM)
  ));
}

function zoomForVessels(vessels: Vessel[]) {`,
    "primary vessel selector",
  );
  content = replaceOnce(
    content,
    `  const [mapZoom, setMapZoom] = useState(DEFAULT_ZOOM);
  const [manualCenter, setManualCenter] = useState<GeoPoint>(PORTS_CENTER);`,
    `  const [mapZoom, setMapZoom] = useState(PRIMARY_PORTS_ZOOM);
  const [manualCenter, setManualCenter] = useState<GeoPoint>(PRIMARY_PORTS_CENTER);`,
    "primary initial viewport",
  );
  content = replaceOnce(
    content,
    `  useEffect(() => {
    if (hasAutoFittedVessels.current || !vessels || vessels.length === 0) return;
    const center = centerOfVessels(vessels);
    if (!center) return;
    setManualCenter(center);
    setMapZoom(zoomForVessels(vessels));
    setSelectedShipId("");
    setHoveredShipId("");
    hasAutoFittedVessels.current = true;
  }, [vessels]);`,
    `  useEffect(() => {
    if (hasAutoFittedVessels.current || !vessels || vessels.length === 0) return;
    const primary = primaryFocusVessels(vessels);
    if (primary.length === 0) return;
    const center = centerOfVessels(primary);
    if (!center) return;
    setManualCenter(center);
    setMapZoom(zoomForVessels(primary));
    setSelectedShipId("");
    setHoveredShipId("");
    hasAutoFittedVessels.current = true;
  }, [vessels]);`,
    "primary-only automatic map fit",
  );
  content = replaceOnce(
    content,
    `  const showPortsOverview = () => {`,
    `  const showPrimaryPorts = () => {
    setSelectedShipId("");
    setHoveredShipId("");
    setManualCenter(PRIMARY_PORTS_CENTER);
    setMapZoom(PRIMARY_PORTS_ZOOM);
  };

  const showPortsOverview = () => {`,
    "primary ports control",
  );
  content = replaceOnce(
    content,
    `        <button type="button" onClick={showWorldOverview}>World view</button>
        <button type="button" onClick={showPortsOverview}>Ports overview</button>`,
    `        <button type="button" onClick={showPrimaryPorts}>Jeddah + KAP</button>
        <button type="button" onClick={showPortsOverview}>8 ports</button>
        <button type="button" onClick={showWorldOverview}>World AIS</button>`,
    "map scope controls",
  );
  write(path, content);
}

function updateAisSmoke() {
  const path = "scripts/smoke-ais-live.mjs";
  let content = read(path);
  content = replaceOnce(
    content,
    '  assert(JSON.stringify(recovered?.BoundingBoxes) === JSON.stringify([[[-90, -180], [90, 180]]]), "Recovery profile unexpectedly blocked global coverage");',
    '  assert(JSON.stringify(recovered?.BoundingBoxes) === JSON.stringify([[[20.70, 38.35], [22.95, 39.85]]]), "First recovery profile did not prioritize Jeddah and King Abdullah Port");',
    "AIS recovery bounding-box assertion",
  );
  content = replaceOnce(
    content,
    '  assert(vessels.counts?.operational === 1, "Recovered AIS row was not derived into monitored-port scope");',
    '  assert(vessels.counts?.operational === 1, "Recovered AIS row was not derived into monitored-port scope");\n  assert(vessels.counts?.primaryOperational === 1, "Recovered AIS row was not counted in the primary-port scope");',
    "AIS primary scope count",
  );
  content = replaceOnce(
    content,
    '  assert(vessels.health?.activeProfile === "world-position-only", "Unexpected recovery profile: " + vessels.health?.activeProfile);\n  assert(vessels.health?.lastSuccessfulProfile === "world-position-only", "Successful recovery profile was not recorded");',
    '  assert(vessels.health?.activeProfile === "primary-ports-position-only", "Unexpected recovery profile: " + vessels.health?.activeProfile);\n  assert(vessels.health?.lastSuccessfulProfile === "primary-ports-position-only", "Successful primary-port recovery profile was not recorded");',
    "AIS primary recovery profile",
  );
  content = replaceOnce(
    content,
    `  const readiness = await fetch(baseUrl + "/health/ready");`,
    `  const primaryScope = await fetch(baseUrl + "/api/vessels?scope=primary").then((response) => response.json());
  assert(primaryScope.scope === "primary" && primaryScope.vessels.length === 1, "Primary-port API scope did not return the recovered vessel");

  const readiness = await fetch(baseUrl + "/health/ready");`,
    "primary scope API smoke",
  );
  write(path, content);
}

function writeEightPortSmoke() {
  write("scripts/smoke-eight-port-ecofair-focus.mjs", `import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { WebSocketServer } from "ws";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function availablePort() {
  return new Promise((resolve, reject) => {
    const server = createNetServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("Could not allocate a test port"));
      const port = address.port;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function fetchJsonUntil(url, predicate) {
  let last;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      const response = await fetch(url);
      const json = await response.json();
      last = { response, json };
      if (predicate(response, json)) return last;
    } catch (error) {
      last = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(\`Timed out waiting for \${url}: \${last instanceof Error ? last.message : JSON.stringify(last?.json)}\`);
}

const runtimeDir = mkdtempSync(join(tmpdir(), "chmarl-eight-port-focus-"));
const weatherFile = join(runtimeDir, "weather.json");
writeFileSync(weatherFile, JSON.stringify({ points: [] }));
const backendPort = await availablePort();
const websocketPort = await availablePort();
const publicAisPort = await availablePort();
const output = [];

const websocketServer = new WebSocketServer({ host: "127.0.0.1", port: websocketPort });
websocketServer.on("connection", (socket) => socket.on("message", () => {}));

const publicAisServer = createHttpServer((request, response) => {
  if (request.url !== "/api/ships") {
    response.writeHead(404).end();
    return;
  }
  const observedAt = new Date().toISOString();
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify({
    connected: true,
    sources: ["test-live-ais"],
    working_sources: ["test-live-ais"],
    coverage: { scope: "test-multi-region", worldwide_ready: false },
    ships: [
      { mmsi: 111111111, name: "JEDDAH LIVE TEST", lat: 21.49, lng: 39.19, sog: 0.2, nav_status: 5, source: "test-live-ais", observed_at: observedAt },
      { mmsi: 222222222, name: "KAP LIVE TEST", lat: 22.39, lng: 39.10, sog: 8.0, nav_status: 0, source: "test-live-ais", observed_at: observedAt },
      { mmsi: 333333333, name: "GLOBAL LIVE TEST", lat: 60.10, lng: 24.90, sog: 6.0, nav_status: 0, source: "test-live-ais", observed_at: observedAt },
    ],
  }));
});
await new Promise((resolve) => publicAisServer.listen(publicAisPort, "127.0.0.1", resolve));

const env = {
  ...process.env,
  NODE_ENV: "test",
  PORT: String(backendPort),
  STATIC_DIR: "dist",
  RUNTIME_DATA_DIR: runtimeDir,
  AISSTREAM_API_KEY: "test-key",
  AISSTREAM_URL: \`ws://127.0.0.1:\${websocketPort}\`,
  AISSTREAM_HEARTBEAT_MS: "500",
  AISSTREAM_FIRST_FRAME_TIMEOUT_MS: "700",
  AISSTREAM_SILENCE_TIMEOUT_MS: "5000",
  AISSTREAM_CACHE_ENABLED: "false",
  DATALASTIC_AIS_ENABLED: "false",
  POCKETWORLD_AIS_ENABLED: "true",
  POCKETWORLD_API_URL: \`http://127.0.0.1:\${publicAisPort}/api/ships\`,
  POCKETWORLD_ACTIVATION_DELAY_MS: "250",
  POCKETWORLD_POLL_INTERVAL_MS: "5000",
  POCKETWORLD_TIMEOUT_MS: "1000",
  POCKETWORLD_MAX_AGE_MS: "3600000",
  CHMARL_RUNTIME_ENABLED: "true",
  ECOFAIR_TICK_MS: "1000",
  CHMARL_HISTORY_MIN_INTERVAL_MS: "1000",
  WEATHER_FILE_ENABLED: "true",
  WEATHER_FILE: weatherFile,
};

const child = spawn(process.execPath, ["server/vessel-feed-proxy/index.mjs"], { env, stdio: ["ignore", "pipe", "pipe"] });
child.stdout.on("data", (chunk) => output.push(chunk.toString()));
child.stderr.on("data", (chunk) => output.push(chunk.toString()));

try {
  const baseUrl = \`http://127.0.0.1:\${backendPort}\`;
  const { json: tracking } = await fetchJsonUntil(\`${baseUrl}/api/vessels\`, (_response, json) => json?.counts?.tracking === 3);
  assert(tracking.vessels.length === 3, "Global tracking cohort was reduced");
  assert(tracking.counts.operational === 2, "Eight-port operational scope should contain the two primary-port rows");
  assert(tracking.counts.primaryOperational === 2, "Primary-port count should contain Jeddah and KAP rows");
  assert(tracking.inputs.portfolioOperationalRows === 2, "Portfolio scope counter was not exposed");

  const primary = await fetch(\`${baseUrl}/api/vessels?scope=primary\`).then((response) => response.json());
  assert(primary.scope === "primary", "Primary scope label is missing");
  assert(primary.vessels.length === 2, "Primary scope did not isolate Jeddah and KAP rows");

  const health = await fetch(\`${baseUrl}/health\`).then((response) => response.json());
  assert(health.operationalScope.ports.length === 8, "The operational portfolio does not contain eight ports");
  assert(health.operationalScope.ports.includes("Jubail Commercial Port"), "Jubail is missing from the eight-port portfolio");
  assert(health.operationalScope.primaryRows === 2, "Health did not expose primary-port rows");

  const { json: episode } = await fetchJsonUntil(\`${baseUrl}/api/chmarl/episode\`, (response, json) => response.status === 200 && json?.steps?.length > 0);
  const latest = episode.steps.at(-1);
  assert(latest.state.trackingVessels === 3, "CH-MARL step did not retain the full tracking count");
  assert(latest.state.portfolioOperationalVessels === 2, "CH-MARL step did not use the eight-port operational fleet");
  assert(latest.state.primaryOperationalVessels === 2, "CH-MARL step did not expose the Jeddah/KAP focus");

  console.log("Eight-port EcoFair focus smoke test passed.");
} catch (error) {
  throw new Error(\`${error instanceof Error ? error.message : String(error)}\\n\\nRuntime output:\\n\${output.join("").slice(-12000)}\`);
} finally {
  child.kill("SIGTERM");
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 2000);
    child.once("exit", () => { clearTimeout(timer); resolve(); });
  });
  await new Promise((resolve) => websocketServer.close(resolve));
  await new Promise((resolve) => publicAisServer.close(resolve));
  rmSync(runtimeDir, { recursive: true, force: true });
}
`);
}

function updateContractsAndPackage() {
  const packagePath = "package.json";
  const packageJson = JSON.parse(read(packagePath));
  packageJson.scripts["verify:runtime"] = `${packageJson.scripts["verify:runtime"]} && node scripts/smoke-eight-port-ecofair-focus.mjs`;
  write(packagePath, JSON.stringify(packageJson, null, 2));

  const runtimeContractPath = "scripts/check-runtime-contract.mjs";
  let runtimeContract = read(runtimeContractPath);
  runtimeContract = replaceOnce(
    runtimeContract,
    `assertIncludes(runtime, "deriveOperational: OPERATIONAL_PRIORITY_ENABLED", "single-stream operational derivation is absent");`,
    `assertIncludes(runtime, "deriveOperational: OPERATIONAL_PRIORITY_ENABLED", "single-stream operational derivation is absent");
assertIncludes(runtime, 'id: "Jubail Commercial Port"', "Jubail is missing from the eight-port portfolio");
assertIncludes(runtime, "PRIMARY_PORT_REFERENCE_POINTS", "Jeddah and King Abdullah focus is absent");
assertIncludes(runtime, 'id: "primary-ports-position-only"', "AIS recovery does not prioritize the primary ports");
assertIncludes(runtime, "primaryOperationalVessels", "primary operational scope is absent");
assertIncludes(runtime, 'requestedScope === "primary"', "primary vessel API scope is absent");`,
    "eight-port runtime assertions",
  );
  runtimeContract = replaceOnce(
    runtimeContract,
    `assertIncludes(packageJson, "scripts/smoke-public-live-ais-fallback.mjs", "public live AIS fallback smoke test is not part of verification");`,
    `assertIncludes(packageJson, "scripts/smoke-public-live-ais-fallback.mjs", "public live AIS fallback smoke test is not part of verification");
assertIncludes(packageJson, "scripts/smoke-eight-port-ecofair-focus.mjs", "eight-port EcoFair smoke test is not part of verification");`,
    "eight-port smoke contract",
  );
  write(runtimeContractPath, runtimeContract);

  const uiContractPath = "scripts/check-live-ui-contract.mjs";
  let uiContract = read(uiContractPath);
  uiContract = replaceOnce(
    uiContract,
    `const dashboard = read("src/components/DashboardShell.tsx");
const scene = read("src/components/ShipScene.tsx");`,
    `const dashboard = read("src/components/DashboardShell.tsx");
const scene = read("src/components/ShipScene.tsx");
const stabilizer = read("src/providers/vesselDisplayStabilizer.ts");
const coverage = read("src/utils/portCoverage.ts");
const coverageMatrix = read("src/components/insights/PortCoverageMatrix.tsx");`,
    "UI contract source files",
  );
  uiContract = replaceOnce(
    uiContract,
    `assertIncludes(scene, "zoomForVessels(vessels)", "the initial map view is not zoomed to live vessel coverage");`,
    `assertIncludes(scene, "zoomForVessels(primary)", "the initial map view is not focused on primary-port vessels");
assertIncludes(scene, "PRIMARY_PORTS_CENTER", "the primary-port map center is absent");
assertIncludes(scene, ">Jeddah + KAP<", "the primary-port map control is absent");
assertIncludes(scene, ">8 ports<", "the portfolio map control is absent");
assertIncludes(scene, '"Jubail Commercial Port"', "Jubail map marker is absent");
assertIncludes(stabilizer, "const maxPerGridCell = 20_000", "the frontend still thins the global AIS cohort");
assertIncludes(stabilizer, "const maxDisplayRows = 20_000", "the frontend display cap is below the global AIS target");
assertIncludes(coverage, 'id: "Jubail Commercial Port"', "Jubail is missing from frontend port coverage");
assertIncludes(coverageMatrix, "Jeddah + KAP:", "primary-port coverage is not surfaced");`,
    "eight-port UI assertions",
  );
  write(uiContractPath, uiContract);
}

function writeDocumentation() {
  write("docs/EIGHT_PORT_ECOFAIR_SCOPE.md", `# Eight-port EcoFair operational scope

The portal retains the complete genuine AIS cohort returned by the backend, up to 20,000 vessels. It no longer spatially samples the global cohort down to a small representative set.

## Operational portfolio

EcoFair-CH-MARL calculations remain strictly geofenced to real AIS observations within the configured operational radius of these eight ports:

1. Jeddah Islamic Port (runtime id: Jeddah)
2. King Abdullah Port
3. Yanbu
4. Jizan
5. Dammam
6. Jubail Commercial Port
7. Jebel Ali
8. Suez

Jeddah Islamic Port and King Abdullah Port are the primary focus. The default map view stays on those two ports and automatically fits only when genuine AIS rows appear in their primary scope. The full global cohort remains available through the World AIS and Fit vessels controls.

## Calculation boundary

Global vessels outside the eight-port radius remain visible for tracking but are excluded from EcoFair fuel, emissions, fairness, reward, queue, berth-utilization, and constraint calculations. No manual, sample, fixed, or synthetic vessel is used to activate the model.

The API exposes three vessel scopes:

- /api/vessels — complete tracking cohort
- /api/vessels?scope=operational — eight-port operational cohort
- /api/vessels?scope=primary — Jeddah and King Abdullah Port cohort

EcoFair starts producing online CH-MARL steps only after at least one genuine AIS row enters the eight-port operational scope. Keeping more global vessels improves observability but cannot substitute for actual port-area AIS coverage.
`);
}

function removeBootstrapFiles() {
  for (const path of [
    "scripts/apply-eight-port-ecofair-focus.mjs",
    ".github/workflows/apply-eight-port-ecofair-focus.yml",
  ]) {
    if (existsSync(path)) {
      rmSync(path);
      console.log(`removed ${path}`);
    }
  }
}

updateRuntime();
updateEcofair();
updateVesselDisplay();
updatePortCoverage();
updatePortCoverageMatrix();
updateShipScene();
updateAisSmoke();
writeEightPortSmoke();
updateContractsAndPackage();
writeDocumentation();
removeBootstrapFiles();
console.log("Eight-port EcoFair focus patch applied.");
