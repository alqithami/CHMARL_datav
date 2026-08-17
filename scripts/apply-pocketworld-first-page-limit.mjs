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
  "        const payloads = [];\n        const firstPayload = await fetchPage(state.url);\n",
  "        const payloads = [];\n        const firstRequestLimit = Math.min(paginationPageSize, vesselLimit);\n        const firstPayload = await fetchPage(buildPageUrl(state.url, null, null, firstRequestLimit));\n",
  "PocketWorld first-page request",
);
provider = replaceOnce(
  provider,
  `        const expectedRows = totalAvailable > 0 ? Math.min(totalAvailable, vesselLimit) : null;
        const cursorExhausted = nextCursor === null || nextCursor === undefined || !String(nextCursor).trim();
        const reachedExpectedRows = expectedRows !== null && rawRows.length >= expectedRows;
        const localLimitTruncates = totalAvailable > vesselLimit;
        const fetchComplete = !paginationError
          && !localLimitTruncates
          && (cursorExhausted || reachedExpectedRows);
`,
  `        const expectedRows = totalAvailable > 0 ? Math.min(totalAvailable, vesselLimit) : null;
        const cursorExhausted = nextCursor === null || nextCursor === undefined || !String(nextCursor).trim();
        const reachedExpectedRows = expectedRows !== null && rawRows.length >= expectedRows;
        const localLimitTruncates = totalAvailable > vesselLimit;
        const providerOmittedCursor = expectedRows !== null && rawRows.length < expectedRows && cursorExhausted;
        if (!paginationError && providerOmittedCursor) {
          paginationError = \`PocketWorld reported \${expectedRows} available rows but returned \${rawRows.length} without next_cursor\`;
        }
        const fetchComplete = !paginationError
          && !localLimitTruncates
          && (reachedExpectedRows || (expectedRows === null && cursorExhausted));
`,
  "PocketWorld completeness decision",
);
write(providerPath, provider);

const smokePath = "scripts/smoke-public-live-ais-fallback.mjs";
let smoke = read(smokePath);
smoke = replaceOnce(
  smoke,
  `  assert(cursorRequests[0]?.cursor === null, "The initial PocketWorld request unexpectedly used a cursor");
  assert(cursorRequests[1]?.cursor === "2" && cursorRequests[2]?.cursor === "4", "PocketWorld cursors were not traversed in order");
`,
  `  assert(cursorRequests[0]?.cursor === null, "The initial PocketWorld request unexpectedly used a cursor");
  assert(cursorRequests[0]?.limit === "100", "The initial PocketWorld request did not ask for the full local capacity");
  assert(cursorRequests[1]?.cursor === "2" && cursorRequests[2]?.cursor === "4", "PocketWorld cursors were not traversed in order");
`,
  "first-page limit smoke assertion",
);
write(smokePath, smoke);

const eightPortSmokePath = "scripts/smoke-eight-port-ecofair-focus.mjs";
let eightPortSmoke = read(eightPortSmokePath);
eightPortSmoke = replaceOnce(
  eightPortSmoke,
  `const publicAisServer = createHttpServer((request, response) => {
  if (request.url !== "/api/ships") {
    response.writeHead(404).end();
    return;
  }
`,
  `const publicAisServer = createHttpServer((request, response) => {
  const requestUrl = new URL(request.url ?? "/", \`http://127.0.0.1:\${publicAisPort}\`);
  if (requestUrl.pathname !== "/api/ships") {
    response.writeHead(404).end();
    return;
  }
`,
  "eight-port PocketWorld request-path fixture",
);
write(eightPortSmokePath, eightPortSmoke);

const continuitySmokePath = "scripts/smoke-public-live-ais-continuity.mjs";
let continuitySmoke = read(continuitySmokePath);
continuitySmoke = replaceOnce(
  continuitySmoke,
  `const mirrorServer = createHttpServer((request, response) => {
  if (request.url !== "/api/ships") {
    response.writeHead(404).end();
    return;
  }
`,
  `const mirrorServer = createHttpServer((request, response) => {
  const requestUrl = new URL(request.url ?? "/", \`http://127.0.0.1:\${mirrorPort}\`);
  if (requestUrl.pathname !== "/api/ships") {
    response.writeHead(404).end();
    return;
  }
`,
  "continuity PocketWorld request-path fixture",
);
write(continuitySmokePath, continuitySmoke);

const contractPath = "scripts/check-runtime-contract.mjs";
let contract = read(contractPath);
contract = replaceOnce(
  contract,
  `assertIncludes(pocketWorldProvider, "next_cursor", "PocketWorld cursor traversal is absent");
assertIncludes(pocketWorldProvider, "pagesFetched", "PocketWorld pagination diagnostics are absent");
`,
  `assertIncludes(pocketWorldProvider, "next_cursor", "PocketWorld cursor traversal is absent");
assertIncludes(pocketWorldProvider, "firstRequestLimit", "PocketWorld first request does not advertise its full page capacity");
assertIncludes(pocketWorldProvider, "providerOmittedCursor", "PocketWorld cannot detect a provider-side truncated response without a cursor");
assertIncludes(pocketWorldProvider, "pagesFetched", "PocketWorld pagination diagnostics are absent");
`,
  "PocketWorld first-page contract assertions",
);
write(contractPath, contract);

const docsPath = "docs/LEAFLET_MARITIME_MAP.md";
let docs = read(docsPath);
docs = replaceOnce(
  docs,
  "The PocketWorld adapter follows the provider's stable `snapshot_id` and `cursor` pagination until the current snapshot is complete or the 50,000-row safety ceiling is reached. The backend therefore no longer stops at the first 5,000 rows.",
  "The PocketWorld adapter explicitly requests the largest bounded first page, then follows the provider's stable `snapshot_id` and `cursor` pagination until the current snapshot is complete or the 50,000-row safety ceiling is reached. The backend therefore no longer accepts a provider-default 5,000-row page as a complete fleet when `total_available` is larger.",
  "complete-fleet documentation",
);
write(docsPath, docs);

for (const path of [
  "scripts/apply-pocketworld-first-page-limit.mjs",
  ".github/workflows/apply-pocketworld-first-page-limit.yml",
]) {
  if (existsSync(path)) {
    rmSync(path);
    console.log(`removed ${path}`);
  }
}

console.log("PocketWorld first-page capacity patch applied.");
