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

const dashboardEntry = read("src/components/DashboardShell.tsx");
const dashboard = read("src/components/ProfessionalDashboardShell.tsx");
const portalHeader = read("src/components/PortalHeader.tsx");
const readinessStrip = read("src/components/ReadinessStrip.tsx");
const analysisRail = read("src/components/AnalysisRail.tsx");
const operationsRail = read("src/components/OperationsRail.tsx");
const commandWorkspace = read("src/components/CommandWorkspace.tsx");
const vesselRegistryPanel = read("src/components/VesselRegistryPanel.tsx");
const vesselRegistryCss = read("src/vesselRegistry.css");
const themeToggle = read("src/components/ThemeToggle.tsx");
const app = read("src/App.tsx");
const sceneEntry = read("src/components/ShipScene.tsx");
const leafletScene = read("src/components/LeafletShipScene.tsx");
const sharedChart = read("src/components/Chart.tsx");
const constraintChart = read("src/components/charts/ConstraintChart.tsx");
const portUtilizationChart = read("src/components/charts/PortUtilizationChart.tsx");
const rewardTrend = read("src/components/charts/RewardTrend.tsx");
const speedProfile = read("src/components/charts/VesselSpeedProfile.tsx");
const speedProfileCss = read("src/vesselSpeedProfile.css");
const main = read("src/main.tsx");
const packageJson = read("package.json");
const viteConfig = read("vite.config.ts");
const artifactVerifier = read("scripts/verify-build-artifacts.mjs");
const stabilizer = read("src/providers/vesselDisplayStabilizer.ts");
const coverage = read("src/utils/portCoverage.ts");
const coverageMatrix = read("src/components/insights/PortCoverageMatrix.tsx");
const visualRefresh = read("src/mawaniVisualRefresh.css");
const lightMode = read("src/mawaniLightMode.css");
const portalVision = read("src/portalVision.css");
const lightPaletteDocument = read("docs/LIGHT_MODE_COLOR_PALETTE.md");
const portalArchitecture = read("docs/PORTAL_INTERFACE_ARCHITECTURE.md");

assertIncludes(dashboardEntry, 'export { default } from "./ProfessionalDashboardShell"', "the production entry does not use the professional portal shell");
for (const source of ["datalastic", "pocketworld", "pocketworld-last-known", "ais-multi-provider"]) {
  assertIncludes(dashboard, `source === "${source}"`, `${source} is not recognized as a live external source`);
}
assertIncludes(dashboard, 'if (source === "pocketworld") return "Public regional live AIS"', "PocketWorld is mislabeled as unavailable");
assertIncludes(dashboard, 'if (source === "pocketworld-last-known") return "Public regional AIS · last known"', "last-known AIS is mislabeled as unavailable");
assertIncludes(dashboard, 'if (source === "datalastic") return "Datalastic live AIS"', "Datalastic is mislabeled as unavailable");
assertIncludes(dashboard, 'if (source === "ais-multi-provider") return "Multi-provider live AIS"', "multi-provider AIS is mislabeled as unavailable");
assertIncludes(dashboard, "<PortalHeader", "the professional application header is absent");
assertIncludes(dashboard, "<ReadinessStrip", "the compact readiness strip is absent");
assertIncludes(dashboard, "<AnalysisRail", "the persistent analysis rail is absent");
assertIncludes(dashboard, "<OperationsRail", "the self-contained operations rail is absent");
assertIncludes(dashboard, "<CommandWorkspace", "the lower command workspace is absent");
assertIncludes(dashboard, 'className="portal-command-stage"', "the map-first command stage is absent");
assertNotIncludes(dashboard, "Design tokens", "design tokens are visible in the production portal shell");

assertIncludes(portalHeader, "Operational Vessel Intelligence Dashboard", "the exact approved dashboard title is missing");
assertIncludes(portalHeader, "AIS-informed maritime logistics and port intelligence", "the product subtitle is missing");
assertIncludes(portalHeader, "<ThemeToggle inline />", "the theme control is not integrated into the header");
assertIncludes(portalHeader, "Refresh", "the header refresh action is absent");
assertIncludes(portalHeader, "Export", "the header export action is absent");
assertIncludes(themeToggle, "inline?: boolean", "the theme toggle does not support the header layout");
assertNotIncludes(app, "ThemeToggle", "a duplicate floating theme toggle remains mounted");

for (const label of ["Live input readiness", "Vessel tracking / AIS", "EcoFair-CH-MARL", "Port operations"]) {
  assertIncludes(readinessStrip, label, `readiness card is absent: ${label}`);
}
assertIncludes(analysisRail, "Reward index", "the analysis rail reward index is absent");
assertIncludes(analysisRail, "Feasibility score", "the analysis rail feasibility score is absent");
assertIncludes(analysisRail, "Monitored-port pressure", "the analysis rail port pressure is absent");
assertIncludes(analysisRail, "Vessel speed profile", "the compact speed profile is absent from the analysis rail");
assertIncludes(operationsRail, "Selected vessel", "persistent selected-vessel context is absent");
assertIncludes(operationsRail, "Tracked vessels", "the compact tracked-vessel list is absent");
assertIncludes(operationsRail, "Operational watchlist", "the operational watchlist is absent");
assertIncludes(operationsRail, "Port events", "the compact port-event feed is absent");
assertIncludes(commandWorkspace, "Command summary", "the lower command summary is absent");
assertIncludes(commandWorkspace, "Known vessels", "the permanent registry is absent from command metrics");
assertIncludes(vesselRegistryPanel, "Persistent identity, movement, and source audit", "the operator registry workspace is absent");
assertIncludes(vesselRegistryPanel, "/api/registry/vessels", "the registry workspace does not query permanent records");
assertIncludes(vesselRegistryPanel, "/api/registry/conflicts", "the registry workspace does not expose identity conflicts");
assertIncludes(vesselRegistryPanel, "/track?limit=2000", "the registry workspace does not retrieve movement history");
assertIncludes(vesselRegistryPanel, "/observations?limit=200", "the registry workspace does not retrieve source audit observations");
assertIncludes(vesselRegistryPanel, "Export page", "the registry workspace cannot export the current result page");
assertIncludes(vesselRegistryPanel, "Previous", "the registry workspace lacks pagination");
assertIncludes(vesselRegistryPanel, "Movement", "the registry workspace lacks a movement detail view");
assertIncludes(vesselRegistryPanel, "Sources", "the registry workspace lacks a provider-source detail view");
assertIncludes(vesselRegistryCss, ".vessel-registry-workspace", "the registry workspace layout is absent");
assertIncludes(vesselRegistryCss, ".vessel-registry-pagination", "the registry pagination layout is absent");
assertIncludes(vesselRegistryCss, ".vessel-track-figure", "the retained movement trace is not styled");
assertIncludes(vesselRegistryCss, ".vessel-source-timeline", "the provider source timeline is not styled");
assertIncludes(commandWorkspace, "Port coverage matrix", "the port coverage workspace is absent");
assertIncludes(commandWorkspace, "Vessel &amp; event preview", "the vessel and event preview is absent");
assertNotIncludes(commandWorkspace, "Design tokens", "design tokens are visible in the command workspace");

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

assertIncludes(sharedChart, 'from "echarts/core"', "the shared chart still imports the complete ECharts distribution");
assertIncludes(sharedChart, 'from "echarts/charts"', "tree-shakable ECharts chart modules are not registered");
assertIncludes(sharedChart, 'from "echarts/components"', "tree-shakable ECharts components are not registered");
assertIncludes(sharedChart, 'from "echarts/renderers"', "the ECharts Canvas renderer is not registered explicitly");
assertIncludes(sharedChart, "BarChart", "the used bar-chart module is not registered");
assertIncludes(sharedChart, "LineChart", "the used line-chart module is not registered");
assertIncludes(sharedChart, "role=\"img\"", "chart canvases do not expose an accessible image role");
assertIncludes(sharedChart, "aria-describedby={summaryId}", "chart summaries are not connected to the rendered chart");
assertIncludes(sharedChart, "window.requestAnimationFrame", "chart resize work is not coalesced");
assertNotIncludes(sharedChart, 'import * as echarts from "echarts"', "the full ECharts runtime import returned");
for (const [source, label] of [
  [constraintChart, "constraint pressure"],
  [portUtilizationChart, "port utilization"],
  [rewardTrend, "reward trend"],
]) {
  assertIncludes(source, "ariaLabel=", `${label} chart lacks an accessible name`);
  assertIncludes(source, "summary={summary}", `${label} chart lacks a textual data summary`);
}

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
assertIncludes(main, 'import "./portalVision.css"', "the professional portal vision is absent");
assertIncludes(main, 'import "./vesselRegistry.css"', "the vessel registry styles are not loaded");
assertIncludes(packageJson, '"leaflet": "1.9.4"', "Leaflet is not pinned to the stable release");
assertIncludes(packageJson, '"@types/leaflet"', "Leaflet TypeScript definitions are absent");
assertIncludes(viteConfig, "manualChunks: vendorChunk", "Vite does not use reachability-based vendor chunking");
assertIncludes(viteConfig, 'return "vendor-leaflet"', "Leaflet is not isolated as an active map dependency");
assertIncludes(viteConfig, 'return "vendor-charts"', "the modular chart runtime is not isolated");
assertNotIncludes(viteConfig, '"vendor-three"', "the unused Three.js stack is still forced into production");
assertNotIncludes(viteConfig, '"vendor-echarts"', "the retired full ECharts bundle is still forced into production");
assertIncludes(artifactVerifier, "MAX_PRODUCTION_JS_CHUNK_BYTES", "production JavaScript chunks have no enforced budget");
assertIncludes(artifactVerifier, "/vendor-three-/i", "the artifact gate does not reject a reintroduced Three.js bundle");
assertIncludes(artifactVerifier, "/vendor-echarts-/i", "the artifact gate does not reject the retired full ECharts bundle");
assertIncludes(stabilizer, "countLimited: false", "the frontend does not expose an unbounded display policy");
assertIncludes(stabilizer, "discardedByLocation: 0", "the frontend does not expose zero geographic discards");
assertIncludes(stabilizer, "latitude >= -90", "the frontend does not accept the complete latitude range");
assertNotIncludes(stabilizer, "maxDisplayRows", "the frontend still contains a hard vessel display ceiling");
assertNotIncludes(stabilizer, "inMiddleEastOperationalCorridor", "the frontend still applies region-specific retention or prioritization");
assertIncludes(coverage, 'id: "Jubail Commercial Port"', "Jubail is missing from frontend port coverage");
assertIncludes(coverageMatrix, "Jeddah + KAP:", "primary-port coverage is not surfaced");

assertIncludes(visualRefresh, "--mawani-aqua-50: #00dbe7", "the approved aqua brand accent is absent");
assertIncludes(visualRefresh, "--mawani-success: #24a148", "the fixed success colour is absent");
assertIncludes(visualRefresh, "--mawani-warning: #ff6800", "the fixed warning colour is absent");
assertIncludes(visualRefresh, "--mawani-error: #da1e28", "the fixed error colour is absent");
assertNotIncludes(visualRefresh, "linear-gradient(", "the final visual refresh uses decorative gradients");

assertIncludes(lightMode, '--mawani-text-primary: #10272c', "the light theme does not define a strong primary text color");
assertIncludes(lightMode, '--mawani-text-secondary: #36555c', "the light theme does not define a readable secondary text color");
assertIncludes(lightMode, '--mawani-text-helper: #5c747a', "the light theme helper color is too weak or absent");
assertIncludes(lightMode, "@media (prefers-contrast: more)", "the light theme does not support increased-contrast preference");
assertNotIncludes(lightMode, "linear-gradient(", "the light-mode enhancement uses decorative gradients");

assertIncludes(portalVision, 'grid-template-columns: 220px minmax(620px, 1fr) 320px', "the professional three-column map-first layout is absent");
assertIncludes(portalVision, ".portal-readiness-strip", "the four-card readiness layout is absent");
assertIncludes(portalVision, ".portal-analysis-rail", "the analysis rail styling is absent");
assertIncludes(portalVision, ".portal-operations-rail", "the operations rail styling is absent");
assertIncludes(portalVision, ".portal-command-workspace", "the command workspace styling is absent");
assertIncludes(portalVision, ":root[data-theme=\"light\"]", "the professional layout lacks light-theme parity");
assertIncludes(portalVision, "@media (prefers-reduced-motion: reduce)", "the professional layout lacks reduced-motion support");
assertNotIncludes(portalVision, "linear-gradient(", "the professional portal uses decorative gradients");
assertNotIncludes(portalVision, "Design tokens", "design tokens are rendered by the professional CSS layer");

assertIncludes(lightPaletteDocument, "#10272C", "the palette document omits primary text");
assertIncludes(lightPaletteDocument, "#006F79", "the palette document omits the light aqua accent");
assertIncludes(portalArchitecture, "Operational Vessel Intelligence Dashboard", "the interface architecture omits the approved title");
assertIncludes(portalArchitecture, "Design-system tokens", "the interface architecture does not document the hidden-token boundary");
assertIncludes(portalArchitecture, "Map-first command stage", "the interface architecture does not document the map-first hierarchy");

console.log("Professional map-first portal, Leaflet UI, accessible modular charts, speed profile, MAWANI design, and light-mode contracts verified.");
