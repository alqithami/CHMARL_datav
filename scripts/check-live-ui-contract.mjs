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
const scene = read("src/components/ShipScene.tsx");
const tx97 = read("src/components/Tx97ChartMap.tsx");

for (const source of ["datalastic", "pocketworld", "ais-multi-provider"]) {
  assertIncludes(dashboard, `source === "${source}"`, `${source} is not recognized as a live external source`);
}
assertIncludes(dashboard, 'if (source === "pocketworld") return "Public regional live AIS"', "PocketWorld is mislabeled as unavailable");
assertIncludes(dashboard, 'if (source === "datalastic") return "Datalastic live AIS"', "Datalastic is mislabeled as unavailable");
assertIncludes(dashboard, 'if (source === "ais-multi-provider") return "Multi-provider live AIS"', "multi-provider AIS is mislabeled as unavailable");
assertIncludes(scene, "Tx97ChartMap", "the live vessel scene does not use the TX-97 vector chart");
assertIncludes(tx97, "autoFittedRef", "the TX-97 map does not remember its initial live-vessel fit");
assertIncludes(tx97, "fitPositions(map, vesselPositions(vessels), expanded)", "the TX-97 map does not fit the first live-vessel cohort");
assertIncludes(tx97, "vesselCollection(vessels)", "live AIS rows are not supplied to the TX-97 overlay");
assertNotIncludes(scene, "tile.openstreetmap.org", "the live vessel scene still loads OpenStreetMap raster tiles");

console.log("Live vessel UI contract verified.");
