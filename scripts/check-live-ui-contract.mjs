import { readFileSync } from "node:fs";

function read(path) {
  return readFileSync(path, "utf8");
}

function assertIncludes(content, text, label) {
  if (!content.includes(text)) throw new Error(`Live vessel UI contract failed: ${label}`);
}

function assertNotIncludes(content, text, label) {
  if (content.includes(text)) throw new Error(`Live vessel UI contract failed: ${label}`);
}

const dashboard = read("src/components/DashboardShell.tsx");
const sceneEntry = read("src/components/ShipScene.tsx");
const leafletScene = read("src/components/LeafletShipScene.tsx");
const main = read("src/main.tsx");
const packageJson = read("package.json");
const stabilizer = read("src/providers/vesselDisplayStabilizer.ts");
const coverage = read("src/utils/portCoverage.ts");
const coverageMatrix = read("src/components/insights/PortCoverageMatrix.tsx");

for (const source of ["datalastic", "pocketworld", "pocketworld-last-known", "ais-multi-provider"]) {
  assertIncludes(dashboard, `source === "${source}"`, `${source} is not recognized as a live external source`);
}
assertIncludes(dashboard, 'if (source === "pocketworld") return "Public regional live AIS"', "PocketWorld is mislabeled as unavailable");
assertIncludes(dashboard, 'if (source === "pocketworld-last-known") return "Public regional AIS · last known"', "last-known AIS is mislabeled as unavailable");
assertIncludes(dashboard, 'if (source === "datalastic") return "Datalastic live AIS"', "Datalastic is mislabeled as unavailable");
assertIncludes(dashboard, 'if (source === "ais-multi-provider") return "Multi-provider live AIS"', "multi-provider AIS is mislabeled as unavailable");

assertIncludes(sceneEntry, 'export { default } from "./LeafletShipScene"', "ShipScene does not use the Leaflet renderer");
assertIncludes(leafletScene, 'import * as L from "leaflet"', "Leaflet is not imported");
assertIncludes(leafletScene, "preferCanvas: true", "AIS vector paths are not configured for Canvas rendering");
assertIncludes(leafletScene, "worldCopyJump: true", "world wrapping is not enabled");
assertIncludes(leafletScene, "L.tileLayer(BASE_TILE_URL", "the configurable base tile layer is absent");
assertIncludes(leafletScene, "L.tileLayer(SEAMARK_TILE_URL", "the maritime seamark overlay is absent");
assertIncludes(leafletScene, "L.circleMarker([vessel.latitude, vessel.longitude]", "AIS vessels are not rendered as Leaflet vector markers");
assertIncludes(leafletScene, "OPERATIONAL_RADIUS_METERS", "the eight-port operational zones are absent");
assertIncludes(leafletScene, "L.polyline(", "AIS trail rendering is absent");
assertIncludes(leafletScene, "map.fitBounds", "interactive fit-to-bounds behavior is absent");
assertIncludes(leafletScene, "hasAutoFittedPrimaryRef", "the primary-port auto-fit boundary is absent");
assertIncludes(leafletScene, ">Jeddah + KAP<", "the primary-port map control is absent");
assertIncludes(leafletScene, ">8 ports<", "the portfolio map control is absent");
assertIncludes(leafletScene, ">World AIS<", "the world AIS map control is absent");
assertIncludes(leafletScene, ">Seamarks<", "the seamark layer control is absent");
assertIncludes(leafletScene, 'label: "Jubail Commercial Port"', "Jubail map marker is absent");
assertIncludes(leafletScene, "const RAIL_ROW_LIMIT = 500", "the expanded rail does not protect DOM performance");
assertIncludes(leafletScene, "all {visibleVessels.length} remain on the map", "rail truncation is not distinguished from map coverage");
assertNotIncludes(leafletScene, "fallbackVessels", "the map can still inject sample vessels");
assertNotIncludes(leafletScene, "buildTileGrid", "the old handcrafted map projection remains active");

assertIncludes(main, 'import "leaflet/dist/leaflet.css"', "Leaflet base styles are not loaded");
assertIncludes(main, 'import "./leafletMap.css"', "Leaflet application styles are not loaded");
assertIncludes(packageJson, '"leaflet": "1.9.4"', "Leaflet is not pinned to the stable release");
assertIncludes(packageJson, '"@types/leaflet"', "Leaflet TypeScript definitions are absent");
assertIncludes(stabilizer, "const maxPerGridCell = 50_000", "the frontend still thins a complete PocketWorld fleet");
assertIncludes(stabilizer, "const maxDisplayRows = 50_000", "the frontend display cap is below the provider maximum");
assertIncludes(coverage, 'id: "Jubail Commercial Port"', "Jubail is missing from frontend port coverage");
assertIncludes(coverageMatrix, "Jeddah + KAP:", "primary-port coverage is not surfaced");

console.log("Leaflet live vessel UI contract verified.");
