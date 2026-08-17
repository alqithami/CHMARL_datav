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
  `const DEFAULT_PAGE_SIZE = 10_000;
const DEFAULT_MAX_PAGES = 10;
const PROVIDER_MAX_PAGE_SIZE = 50_000;`,
  `const DEFAULT_PAGE_SIZE = 5_000;
const DEFAULT_MAX_PAGES = 10;
const PROVIDER_MAX_PAGE_SIZE = 5_000;`,
  "PocketWorld provider page-size limits",
);
provider = replaceOnce(
  provider,
  `function buildPageUrl(baseUrl, snapshotId, cursor, limit) {`,
  `function cursorForNextPage(metadata, accumulatedRows, snapshotId) {
  if (metadata.nextCursor !== null && metadata.nextCursor !== undefined && String(metadata.nextCursor).trim()) {
    return metadata.nextCursor;
  }
  if (
    snapshotId !== null
    && snapshotId !== undefined
    && String(snapshotId).trim()
    && metadata.truncated
    && metadata.totalAvailable > accumulatedRows
  ) {
    return accumulatedRows;
  }
  return null;
}

function buildPageUrl(baseUrl, snapshotId, cursor, limit) {`,
  "PocketWorld inferred cursor helper",
);
provider = replaceOnce(
  provider,
  `        let metadata = pageMetadata(firstPayload);
        const snapshotId = metadata.snapshotId;
        let nextCursor = metadata.nextCursor;
        let totalAvailable = metadata.totalAvailable;
        const rawRows = [...responseRows(firstPayload)];`,
  `        let metadata = pageMetadata(firstPayload);
        const snapshotId = metadata.snapshotId;
        let totalAvailable = metadata.totalAvailable;
        const rawRows = [...responseRows(firstPayload)];
        let nextCursor = cursorForNextPage(metadata, rawRows.length, snapshotId);`,
  "PocketWorld initial cursor selection",
);
provider = replaceOnce(
  provider,
  `            const pagePayload = await fetchPage(requestUrl);
            payloads.push(pagePayload);
            rawRows.push(...responseRows(pagePayload));
            metadata = pageMetadata(pagePayload);
            nextCursor = metadata.nextCursor;
            totalAvailable = Math.max(totalAvailable, metadata.totalAvailable);`,
  `            const pagePayload = await fetchPage(requestUrl);
            payloads.push(pagePayload);
            rawRows.push(...responseRows(pagePayload));
            metadata = pageMetadata(pagePayload);
            totalAvailable = Math.max(totalAvailable, metadata.totalAvailable);
            nextCursor = cursorForNextPage(
              { ...metadata, totalAvailable },
              rawRows.length,
              snapshotId,
            );`,
  "PocketWorld subsequent cursor selection",
);
write(providerPath, provider);

const smokePath = "scripts/smoke-public-live-ais-fallback.mjs";
let smoke = read(smokePath);
smoke = replaceOnce(
  smoke,
  `      count: 2,
      next_cursor: 2,
      truncated: true,`,
  `      count: 2,
      next_cursor: null,
      truncated: true,`,
  "first inferred cursor fixture",
);
smoke = replaceOnce(
  smoke,
  `      count: 2,
      next_cursor: 4,
      truncated: true,`,
  `      count: 2,
      next_cursor: null,
      truncated: true,`,
  "second inferred cursor fixture",
);
smoke = replaceOnce(
  smoke,
  `  assert(cursorRequests[1]?.cursor === "2" && cursorRequests[2]?.cursor === "4", "PocketWorld cursors were not traversed in order");`,
  `  assert(cursorRequests[1]?.cursor === "2" && cursorRequests[2]?.cursor === "4", "PocketWorld did not infer cursor offsets from snapshot metadata");`,
  "inferred cursor smoke assertion",
);
write(smokePath, smoke);

const contractPath = "scripts/check-runtime-contract.mjs";
let contract = read(contractPath);
contract = replaceOnce(
  contract,
  `assertIncludes(pocketWorldProvider, "DEFAULT_PAGE_SIZE = 10_000", "PocketWorld page size is not bounded");
assertIncludes(pocketWorldProvider, "maxVessels = 50_000", "PocketWorld provider capacity remains below the API maximum");`,
  `assertIncludes(pocketWorldProvider, "DEFAULT_PAGE_SIZE = 5_000", "PocketWorld page size does not match the provider contract");
assertIncludes(pocketWorldProvider, "PROVIDER_MAX_PAGE_SIZE = 5_000", "PocketWorld requests can exceed the provider page limit");
assertIncludes(pocketWorldProvider, "cursorForNextPage", "PocketWorld does not infer an offset cursor when a truncated snapshot omits next_cursor");
assertIncludes(pocketWorldProvider, "metadata.totalAvailable > accumulatedRows", "PocketWorld inferred pagination does not check remaining rows");
assertIncludes(pocketWorldProvider, "maxVessels = 50_000", "PocketWorld aggregate provider capacity remains below the portal target");`,
  "PocketWorld pagination runtime contract",
);
write(contractPath, contract);

const docsPath = "docs/LEAFLET_MARITIME_MAP.md";
let docs = read(docsPath);
docs = replaceOnce(
  docs,
  "The PocketWorld adapter explicitly requests the largest bounded first page, then follows the provider's stable `snapshot_id` and `cursor` pagination until the current snapshot is complete or the 50,000-row safety ceiling is reached. The backend therefore no longer accepts a provider-default 5,000-row page as a complete fleet when `total_available` is larger.",
  "The PocketWorld adapter requests the provider's maximum 5,000-row page. PocketWorld can mark a snapshot as truncated and provide `snapshot_id` plus `total_available` while omitting `next_cursor`; in that case the adapter derives the next offset from the number of accumulated rows and continues with the same snapshot ID. Pagination stops only when the current snapshot is complete or the 50,000-row aggregate safety ceiling is reached.",
  "PocketWorld snapshot offset documentation",
);
write(docsPath, docs);

for (const path of [
  "scripts/apply-pocketworld-snapshot-offset.mjs",
  ".github/workflows/apply-pocketworld-snapshot-offset.yml",
]) {
  if (existsSync(path)) {
    rmSync(path);
    console.log(`removed ${path}`);
  }
}

console.log("PocketWorld snapshot offset pagination patch applied.");
