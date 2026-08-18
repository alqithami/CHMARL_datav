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
const speedProfile = read("src/components/charts/VesselSpeedProfile.tsx");
const speedProfileCss = read("src/vesselSpeedProfile.css");
const main = read("src/main.tsx");
const packageJson = read("package.json");
const stabilizer = read("src/providers/vesselDisplayStabilizer.ts");
const coverage = read("src/utils/portCoverage.ts");
const coverageMatrix = read("src/components/insights/PortCoverageMatrix.tsx");
const visualRefresh = read("src/mawaniVisualRefresh.css");
const lightMode = read("src/mawaniLightMode.css");
const lightPaletteDocument = read("docs/LIGHT_MODE_COLOR_PALETTE.md");

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

assertIncludes(speedProfile, "compactBandDefinitions", "the minimized speed distribution is absent");
assertIncludes(speedProfile, "expandedBandDefinitions", "the detailed speed distribution is absent");
assertIncludes(speedProfile, "Average SOG", "the compact speed summary is absent");
assertIncludes(speedProfile, "90th percentile", "the expanded speed statistics are absent");
assertIncludes(speedProfile, "speed-profile-compact", "compact and expanded speed layouts are not separated");
assertIncludes(speedProfile, "speed-profile-expanded", "the expanded speed layout is absent");
assertNotIncludes(speedProfile, 'from "../Chart"', "the narrow speed profile still depends on a clipped ECharts canvas");
assertIncludes(speedProfileCss, ".panel-card:has(.vessel-speed-profile) .panel-tag", "the narrow panel does not protect the Expand action");
assertIncludes(speedProfileCss, ".focus-panel:has(.vessel-speed-profile)", "the speed-profile modal is not constrained to the viewport");
assertIncludes(speedProfileCss, "grid-template-columns: repeat(2, minmax(0, 1fr))", "the expanded speed bands do not use the available width");
assertIncludes(speedProfileCss, "calc(100dvh - 24px)", "the expanded speed profile can exceed the viewport trim");

assertIncludes(main, 'import "leaflet/dist/leaflet.css"', "Leaflet base styles are not loaded");
assertIncludes(main, 'import "./leafletMap.css"', "Leaflet application styles are not loaded");
assertIncludes(main, 'import "./mawaniVisualRefresh.css"', "the final MAWANI visual refresh layer is not loaded");
assertIncludes(main, 'import "./vesselSpeedProfile.css"', "the compact speed-profile styles are not loaded");
assertIncludes(main, 'import "./mawaniLightMode.css"', "the final light-mode contrast layer is not loaded");
assertIncludes(packageJson, '"leaflet": "1.9.4"', "Leaflet is not pinned to the stable release");
assertIncludes(packageJson, '"@types/leaflet"', "Leaflet TypeScript definitions are absent");
assertIncludes(stabilizer, "const maxPerGridCell = 50_000", "the frontend still thins a complete PocketWorld fleet");
assertIncludes(stabilizer, "const maxDisplayRows = 50_000", "the frontend display cap is below the provider maximum");
assertIncludes(coverage, 'id: "Jubail Commercial Port"', "Jubail is missing from frontend port coverage");
assertIncludes(coverageMatrix, "Jeddah + KAP:", "primary-port coverage is not surfaced");

assertIncludes(visualRefresh, "--mawani-aqua-50: #00dbe7", "the approved aqua brand accent is absent");
assertIncludes(visualRefresh, "--mawani-success: #24a148", "the fixed success colour is absent");
assertIncludes(visualRefresh, "--mawani-warning: #ff6800", "the fixed warning colour is absent");
assertIncludes(visualRefresh, "--mawani-error: #da1e28", "the fixed error colour is absent");
assertIncludes(visualRefresh, 'grid-template-columns: 230px minmax(680px, 1fr) 300px', "the map-first desktop hierarchy is absent");
assertIncludes(visualRefresh, ".scene-panel.executive-map-panel", "the primary map panel styling is absent");
assertIncludes(visualRefresh, ".provider-quality-matrix .data-quality-items", "the compact readiness matrix is absent");
assertIncludes(visualRefresh, ".metrics-grid.executive-kpis", "the refreshed KPI hierarchy is absent");
assertIncludes(visualRefresh, ":root[data-theme=\"light\"]", "the refreshed light theme is absent");
assertIncludes(visualRefresh, "@media (prefers-reduced-motion: reduce)", "reduced-motion support is absent");
assertNotIncludes(visualRefresh, "linear-gradient(", "the final visual refresh uses decorative gradients");

assertIncludes(lightMode, '--mawani-text-primary: #10272c', "the light theme does not define a strong primary text color");
assertIncludes(lightMode, '--mawani-text-secondary: #36555c', "the light theme does not define a readable secondary text color");
assertIncludes(lightMode, '--mawani-text-helper: #5c747a', "the light theme helper color is too weak or absent");
assertIncludes(lightMode, '--mawani-aqua-50: #006f79', "the light-mode aqua accent is absent");
assertIncludes(lightMode, '--mawani-success: #19783a', "the light-mode success color is absent");
assertIncludes(lightMode, '--mawani-warning: #9c5200', "the light-mode warning color is absent");
assertIncludes(lightMode, '--mawani-error: #b4232d', "the light-mode error color is absent");
assertIncludes(lightMode, ".expanded-map-rail", "the expanded Leaflet rail is not covered by the light theme");
assertIncludes(lightMode, ".rail-search-tools label", "light-mode filter labels are not protected");
assertIncludes(lightMode, ".tile-vessel-list-items button span", "light-mode vessel names are not protected");
assertIncludes(lightMode, ".focus-header h2", "light-mode focus titles are not protected");
assertIncludes(lightMode, "@media (prefers-contrast: more)", "the light theme does not support increased-contrast preference");
assertNotIncludes(lightMode, "linear-gradient(", "the light-mode enhancement uses decorative gradients");

assertIncludes(lightPaletteDocument, "#10272C", "the palette document omits primary text");
assertIncludes(lightPaletteDocument, "#006F79", "the palette document omits the light aqua accent");
assertIncludes(lightPaletteDocument, "Expanded-map vessel rows", "the palette document does not cover the reported light-mode problem");

console.log("Leaflet live vessel UI, speed profile, MAWANI design, and light-mode contrast contracts verified.");
