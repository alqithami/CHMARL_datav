import { readFileSync } from "node:fs";

function read(path) {
  return readFileSync(path, "utf8");
}

function assertIncludes(content, text, label) {
  if (!content.includes(text)) throw new Error(`Live vessel UI contract failed: ${label}`);
}

const dashboard = read("src/components/DashboardShell.tsx");
const scene = read("src/components/ShipScene.tsx");

for (const source of ["datalastic", "pocketworld", "ais-multi-provider"]) {
  assertIncludes(dashboard, `source === "${source}"`, `${source} is not recognized as a live external source`);
}
assertIncludes(dashboard, 'if (source === "pocketworld") return "Public regional live AIS"', "PocketWorld is mislabeled as unavailable");
assertIncludes(dashboard, 'if (source === "datalastic") return "Datalastic live AIS"', "Datalastic is mislabeled as unavailable");
assertIncludes(dashboard, 'if (source === "ais-multi-provider") return "Multi-provider live AIS"', "multi-provider AIS is mislabeled as unavailable");
assertIncludes(scene, "hasAutoFittedVessels", "the map does not remember its initial live-vessel fit");
assertIncludes(scene, "centerOfVessels(vessels)", "the initial map view is not centered on live vessels");
assertIncludes(scene, "zoomForVessels(vessels)", "the initial map view is not zoomed to live vessel coverage");

console.log("Live vessel UI contract verified.");
