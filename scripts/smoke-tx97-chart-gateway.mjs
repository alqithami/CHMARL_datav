import { createServer } from "node:http";
import { createTx97ChartGateway } from "../server/vessel-feed-proxy/tx97-chart-gateway.mjs";

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Could not allocate a test port."));
        return;
      }
      resolve(address.port);
    });
  });
}

function close(server) {
  return new Promise((resolve) => server.close(() => resolve()));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const upstreamRequests = [];
let upstreamBase = "";
const upstream = createServer((request, response) => {
  upstreamRequests.push(request.url ?? "");
  const url = new URL(request.url ?? "/", upstreamBase || "http://127.0.0.1");
  if (url.pathname === "/style.json") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({
      version: 8,
      name: "TX-97 mock style",
      sprite: `${upstreamBase}/sprite/chart`,
      glyphs: `${upstreamBase}/fonts/{fontstack}/{range}.pbf`,
      sources: {
        tx97: {
          type: "vector",
          tiles: [`${upstreamBase}/tiles/{z}/{x}/{y}.pbf`],
          minzoom: 0,
          maxzoom: 14,
        },
        notices: {
          type: "geojson",
          data: `${upstreamBase}/notices.geojson`,
        },
      },
      layers: [{
        id: "depth-area",
        type: "fill",
        source: "tx97",
        "source-layer": "depth",
        paint: { "fill-color": "#0b3550" },
      }],
    }));
    return;
  }
  if (url.pathname === "/notices.geojson") {
    response.writeHead(200, { "content-type": "application/geo+json" });
    response.end(JSON.stringify({
      type: "FeatureCollection",
      features: [],
    }));
    return;
  }
  if (url.pathname === "/tiles/4/9/7.pbf") {
    response.writeHead(200, { "content-type": "application/x-protobuf" });
    response.end(Buffer.from([1, 2, 3, 4]));
    return;
  }
  if (url.pathname === "/fonts/Noto%20Sans/0-255.pbf") {
    response.writeHead(200, { "content-type": "application/x-protobuf" });
    response.end(Buffer.from([5, 6, 7]));
    return;
  }
  if (url.pathname === "/sprite/chart.json") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end("{}");
    return;
  }
  response.writeHead(404, { "content-type": "application/json" });
  response.end(JSON.stringify({ error: "not found", path: url.pathname }));
});

const upstreamPort = await listen(upstream);
upstreamBase = `http://127.0.0.1:${upstreamPort}`;

const gateway = createTx97ChartGateway({
  enabled: true,
  styleUrl: `${upstreamBase}/style.json`,
  publicDisplayAuthorized: true,
  allowInsecureHttp: true,
  allowedOrigins: [upstreamBase],
  cacheSeconds: 30,
});

const app = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  const handled = await gateway.handle(request, response, url);
  if (!handled) {
    response.writeHead(404);
    response.end();
  }
});
const appPort = await listen(app);
const baseUrl = `http://127.0.0.1:${appPort}`;

try {
  const statusResponse = await fetch(`${baseUrl}/api/charts/tx97/status`);
  const status = await statusResponse.json();
  assert(statusResponse.status === 200, "TX-97 status endpoint failed");
  assert(status.ready === true, "TX-97 gateway did not report ready");
  assert(status.publicDisplayAuthorized === true, "TX-97 display authorization was lost");

  const styleResponse = await fetch(`${baseUrl}/api/charts/tx97/style.json`);
  const style = await styleResponse.json();
  assert(styleResponse.status === 200, "TX-97 style endpoint failed");
  assert(style.name === "TX-97 mock style", "TX-97 style body changed unexpectedly");
  assert(style.sprite.startsWith("/api/charts/tx97/sprite/"), "sprite URL was not proxied");
  assert(style.glyphs.startsWith("/api/charts/tx97/glyph/"), "glyph URL was not proxied");
  assert(style.sources.tx97.tiles[0].startsWith("/api/charts/tx97/tile/"), "tile URL was not proxied");
  assert(style.sources.notices.data.startsWith("/api/charts/tx97/resource/"), "GeoJSON URL was not proxied");
  assert(!JSON.stringify(style).includes(upstreamBase), "upstream chart URL leaked to the browser");

  const tileUrl = style.sources.tx97.tiles[0]
    .replace("{z}", "4")
    .replace("{x}", "9")
    .replace("{y}", "7");
  const tileResponse = await fetch(`${baseUrl}${tileUrl}`);
  const tile = Buffer.from(await tileResponse.arrayBuffer());
  assert(tileResponse.status === 200, "TX-97 tile proxy failed");
  assert(tile.equals(Buffer.from([1, 2, 3, 4])), "TX-97 tile bytes changed");

  const noticeResponse = await fetch(`${baseUrl}${style.sources.notices.data}`);
  const notices = await noticeResponse.json();
  assert(noticeResponse.status === 200, "TX-97 GeoJSON proxy failed");
  assert(notices.type === "FeatureCollection", "TX-97 GeoJSON body changed");

  const glyphUrl = style.glyphs
    .replace("{fontstack}", "Noto%20Sans")
    .replace("{range}", "0-255");
  const glyphResponse = await fetch(`${baseUrl}${glyphUrl}`);
  assert(glyphResponse.status === 200, "TX-97 glyph proxy failed");

  const spriteResponse = await fetch(`${baseUrl}${style.sprite}.json`);
  assert(spriteResponse.status === 200, "TX-97 sprite proxy failed");

  const blocked = createTx97ChartGateway({
    enabled: true,
    styleUrl: `${upstreamBase}/style.json`,
    publicDisplayAuthorized: false,
    allowInsecureHttp: true,
    allowedOrigins: [upstreamBase],
  });
  assert(blocked.status().ready === false, "unapproved public chart display was not blocked");
  assert(
    blocked.status().reason.includes("TX-97_PUBLIC_DISPLAY_AUTHORIZED"),
    "blocked TX-97 status did not explain the authorization requirement",
  );

  assert(
    upstreamRequests.includes("/tiles/4/9/7.pbf"),
    "gateway did not request the expected vector tile coordinates",
  );
  console.log("TX-97 chart gateway smoke test passed.");
} finally {
  await close(app);
  await close(upstream);
}
