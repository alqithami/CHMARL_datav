import { readFileSync } from "node:fs";

function read(path) {
  return readFileSync(path, "utf8");
}

function assertIncludes(content, text, label) {
  if (!content.includes(text)) throw new Error(`Live vessel UI contract failed: ${label}`);
}

const dashboard = read("src/components/DashboardShell.tsx");
const scene = read("src/components/ShipScene.tsx");
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
assertIncludes(scene, "hasAutoFittedVessels", "the map does not remember its initial live-vessel fit");
assertIncludes(scene, "centerOfVessels(primary)", "the initial map view is not centered on primary-port vessels");
assertIncludes(scene, "zoomForVessels(primary)", "the initial map view is not focused on primary-port vessels");
assertIncludes(scene, "PRIMARY_PORTS_CENTER", "the primary-port map center is absent");
assertIncludes(scene, ">Jeddah + KAP<", "the primary-port map control is absent");
assertIncludes(scene, ">8 ports<", "the portfolio map control is absent");
assertIncludes(scene, '"Jubail Commercial Port"', "Jubail map marker is absent");
assertIncludes(stabilizer, "const maxPerGridCell = 20_000", "the frontend still thins the global AIS cohort");
assertIncludes(stabilizer, "const maxDisplayRows = 20_000", "the frontend display cap is below the global AIS target");
assertIncludes(coverage, 'id: "Jubail Commercial Port"', "Jubail is missing from frontend port coverage");
assertIncludes(coverageMatrix, "Jeddah + KAP:", "primary-port coverage is not surfaced");

console.log("Live vessel UI contract verified.");
