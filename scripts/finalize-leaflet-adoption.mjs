import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";

const scenePath = "src/components/LeafletShipScene.tsx";
let scene = readFileSync(scenePath, "utf8");

const portReplacements = [
  [", latitude: 21.4858, longitude: 39.1925, lat: 21.4858, lon: 39.1925", ", lat: 21.4858, lon: 39.1925"],
  [", latitude: 22.3924, longitude: 39.0953, lat: 22.3924, lon: 39.0953", ", lat: 22.3924, lon: 39.0953"],
  [", latitude: 24.0866, longitude: 38.0637, lat: 24.0866, lon: 38.0637", ", lat: 24.0866, lon: 38.0637"],
  [", latitude: 16.8917, longitude: 42.5511, lat: 16.8917, lon: 42.5511", ", lat: 16.8917, lon: 42.5511"],
  [", latitude: 26.4318, longitude: 50.1015, lat: 26.4318, lon: 50.1015", ", lat: 26.4318, lon: 50.1015"],
  [", latitude: 27.0333, longitude: 49.6667, lat: 27.0333, lon: 49.6667", ", lat: 27.0333, lon: 49.6667"],
  [", latitude: 25.0114, longitude: 55.0611, lat: 25.0114, lon: 55.0611", ", lat: 25.0114, lon: 55.0611"],
  [", latitude: 29.9668, longitude: 32.5498, lat: 29.9668, lon: 32.5498", ", lat: 29.9668, lon: 32.5498"],
];
for (const [before, after] of portReplacements) {
  if (!scene.includes(before)) throw new Error(`Missing Leaflet port initializer: ${before}`);
  scene = scene.replace(before, after);
}

const paneInsertion = `    const seamarks = L.tileLayer(SEAMARK_TILE_URL, {`;
const paneReplacement = `    const seamarkPane = map.createPane("seamarkPane");
    seamarkPane.style.zIndex = "250";
    seamarkPane.style.pointerEvents = "none";

    const seamarks = L.tileLayer(SEAMARK_TILE_URL, {`;
if (!scene.includes(paneInsertion)) throw new Error("Missing seamark tile-layer insertion point");
scene = scene.replace(paneInsertion, paneReplacement);
scene = scene.replace('      pane: "overlayPane",', '      pane: "seamarkPane",');

writeFileSync(scenePath, scene);
console.log("Finalized Leaflet scene source.");

for (const path of [
  "scripts/finalize-leaflet-adoption.mjs",
  ".github/workflows/finalize-leaflet-adoption.yml",
]) {
  if (existsSync(path)) {
    rmSync(path);
    console.log(`Removed one-time file: ${path}`);
  }
}
