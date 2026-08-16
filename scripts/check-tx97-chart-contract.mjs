import { existsSync, readFileSync } from "node:fs";

function read(path) {
  if (!existsSync(path)) throw new Error(`TX-97 chart contract failed: missing ${path}`);
  return readFileSync(path, "utf8");
}

function assertIncludes(content, text, label) {
  if (!content.includes(text)) throw new Error(`TX-97 chart contract failed: ${label}`);
}

function assertNotIncludes(content, text, label) {
  if (content.includes(text)) throw new Error(`TX-97 chart contract failed: ${label}`);
}

const scene = read("src/components/ShipScene.tsx");
const chart = read("src/components/Tx97ChartMap.tsx");
const gateway = read("server/vessel-feed-proxy/tx97-chart-gateway.mjs");
const runtime = read("server/vessel-feed-proxy/runtime-v3.mjs");
const main = read("src/main.tsx");
const packageJson = read("package.json");
const render = read("render.yaml");
const envExample = read(".env.example");

assertIncludes(scene, 'from "./Tx97ChartMap"', "ShipScene does not use the TX-97 vector renderer");
assertIncludes(scene, "Wärtsilä TX-97 vector charts", "TX-97 chart attribution is absent");
assertNotIncludes(scene, "tile.openstreetmap.org", "OpenStreetMap raster tiles remain in ShipScene");
assertNotIncludes(scene, "buildTileGrid", "the fixed raster tile grid remains enabled");
assertIncludes(chart, 'from "maplibre-gl"', "MapLibre vector rendering is not integrated");
assertIncludes(chart, 'const TX97_STYLE_URL = "/api/charts/tx97/style.json"', "frontend does not use the same-origin TX-97 style gateway");
assertIncludes(chart, "No raster or OpenStreetMap fallback is used", "explicit no-fallback state is absent");
assertIncludes(chart, "cluster: true", "AIS vessel clustering is absent from the vector chart");
assertIncludes(chart, "vesselTrailCollection", "AIS trails are absent from the vector chart");
assertIncludes(chart, "Decision support only · not for navigation", "navigation limitation is absent");
assertIncludes(gateway, "TX97_PUBLIC_DISPLAY_AUTHORIZED", "licensed public-display gate is absent");
assertIncludes(gateway, "TX97_ALLOWED_ORIGINS", "remote chart origin allowlist is absent");
assertIncludes(gateway, "TX97_BEARER_TOKEN", "server-side bearer credential support is absent");
assertIncludes(gateway, "Blocked TX-97 chart origin", "chart proxy does not reject unapproved origins");
assertIncludes(runtime, "createTx97ChartGateway", "TX-97 gateway is not mounted in the runtime");
assertIncludes(runtime, 'path.startsWith("/api/charts/tx97")', "TX-97 runtime routes are absent");
assertIncludes(main, 'import "maplibre-gl/dist/maplibre-gl.css"', "MapLibre base styles are not loaded");
assertIncludes(main, 'import "./tx97Chart.css"', "TX-97 application styles are not loaded");
assertIncludes(packageJson, '"maplibre-gl"', "MapLibre dependency is absent");
assertIncludes(packageJson, "smoke-tx97-chart-gateway.mjs", "TX-97 gateway smoke test is not in verification");
assertIncludes(render, "TX97_STYLE_URL", "Render does not declare the licensed chart style URL");
assertIncludes(render, "TX97_PUBLIC_DISPLAY_AUTHORIZED", "Render does not declare the chart-display authorization gate");
assertIncludes(envExample, "TX97_ALLOWED_ORIGINS", "environment template omits the chart-origin allowlist");

console.log("TX-97 vector-chart contract verified.");
