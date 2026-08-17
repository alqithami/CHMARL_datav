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

const providerPath = "server/vessel-feed-proxy/pocketworld-live-ais.mjs";
let provider = read(providerPath);
provider = replaceOnce(
  provider,
  `const DEFAULT_PAGE_SIZE = 5_000;
const DEFAULT_MAX_PAGES = 10;
const PROVIDER_MAX_PAGE_SIZE = 5_000;`,
  `const DEFAULT_PAGE_SIZE = 5_000;
const DEFAULT_MAX_PAGES = 10;
const PROVIDER_MAX_PAGE_SIZE = 5_000;
const PROVIDER_MAX_VESSELS = 50_000;`,
  "PocketWorld provider limit constants",
);
provider = replaceOnce(
  provider,
  `  const vesselLimit = Math.min(PROVIDER_MAX_PAGE_SIZE, Math.max(1, Number(maxVessels) || 50_000));
  const paginationPageSize = Math.min(PROVIDER_MAX_PAGE_SIZE, Math.max(1, Number(pageSize) || DEFAULT_PAGE_SIZE));`,
  `  const vesselLimit = Math.min(PROVIDER_MAX_VESSELS, Math.max(1, Number(maxVessels) || PROVIDER_MAX_VESSELS));
  const paginationPageSize = Math.min(PROVIDER_MAX_PAGE_SIZE, Math.max(1, Number(pageSize) || DEFAULT_PAGE_SIZE));`,
  "PocketWorld aggregate and page limits",
);
write(providerPath, provider);

const contractPath = "scripts/check-runtime-contract.mjs";
let contract = read(contractPath);
contract = replaceOnce(
  contract,
  `assertIncludes(pocketWorldProvider, "PROVIDER_MAX_PAGE_SIZE = 5_000", "PocketWorld requests can exceed the provider page limit");
assertIncludes(pocketWorldProvider, "cursorForNextPage", "PocketWorld does not infer an offset cursor when a truncated snapshot omits next_cursor");`,
  `assertIncludes(pocketWorldProvider, "PROVIDER_MAX_PAGE_SIZE = 5_000", "PocketWorld requests can exceed the provider page limit");
assertIncludes(pocketWorldProvider, "PROVIDER_MAX_VESSELS = 50_000", "PocketWorld aggregate fleet limit is below the portal target");
assertIncludes(pocketWorldProvider, "Math.min(PROVIDER_MAX_VESSELS", "PocketWorld aggregate capacity is still capped by the per-request page size");
assertIncludes(pocketWorldProvider, "cursorForNextPage", "PocketWorld does not infer an offset cursor when a truncated snapshot omits next_cursor");`,
  "PocketWorld separate-limit contract assertions",
);
write(contractPath, contract);

const docsPath = "docs/LEAFLET_MARITIME_MAP.md";
let docs = read(docsPath);
docs = replaceOnce(
  docs,
  "The PocketWorld adapter requests the provider's maximum 5,000-row page. PocketWorld can mark a snapshot as truncated and provide `snapshot_id` plus `total_available` while omitting `next_cursor`; in that case the adapter derives the next offset from the number of accumulated rows and continues with the same snapshot ID. Pagination stops only when the current snapshot is complete or the 50,000-row aggregate safety ceiling is reached.",
  "The PocketWorld adapter separates the provider's 5,000-row per-request limit from the portal's 50,000-row aggregate fleet capacity. PocketWorld can mark a snapshot as truncated and provide `snapshot_id` plus `total_available` while omitting `next_cursor`; in that case the adapter derives the next offset from the number of accumulated rows and continues with the same snapshot ID. Pagination stops only when the current snapshot is complete or the aggregate safety ceiling is reached.",
  "PocketWorld separate-limit documentation",
);
write(docsPath, docs);

for (const path of [
  "scripts/apply-pocketworld-limit-separation.mjs",
  ".github/workflows/apply-pocketworld-limit-separation.yml",
]) {
  if (existsSync(path)) {
    rmSync(path);
    console.log(`removed ${path}`);
  }
}

console.log("PocketWorld page and aggregate limits separated.");
