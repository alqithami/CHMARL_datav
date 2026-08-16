import { Buffer } from "node:buffer";

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_CACHE_SECONDS = 300;
const STATUS_PATH = "/api/charts/tx97/status";
const STYLE_PATH = "/api/charts/tx97/style.json";
const API_PREFIX = "/api/charts/tx97/";

function booleanValue(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

function splitCsv(value) {
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeStyleUrl(value, allowInsecureHttp) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const url = new URL(text);
  const secure = url.protocol === "https:";
  const localHttp = allowInsecureHttp
    && url.protocol === "http:"
    && ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
  if (!secure && !localHttp) {
    throw new Error("TX-97 style URL must use HTTPS.");
  }
  url.hash = "";
  return url;
}

function encodeRemoteUrl(value) {
  return Buffer.from(String(value), "utf8").toString("base64url");
}

function decodeRemoteUrl(value) {
  return Buffer.from(String(value), "base64url").toString("utf8");
}

function contentTypeForPath(pathname) {
  if (pathname.endsWith(".json")) return "application/json; charset=utf-8";
  if (pathname.endsWith(".pbf") || pathname.endsWith(".mvt")) return "application/x-protobuf";
  if (pathname.endsWith(".png")) return "image/png";
  if (pathname.endsWith(".jpg") || pathname.endsWith(".jpeg")) return "image/jpeg";
  if (pathname.endsWith(".webp")) return "image/webp";
  return "application/octet-stream";
}

function sendJson(response, statusCode, payload, cacheControl = "no-store") {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": cacheControl,
    "x-content-type-options": "nosniff",
  });
  response.end(body);
}

function sendBuffer(response, requestMethod, statusCode, body, headers) {
  response.writeHead(statusCode, {
    "content-type": headers.contentType,
    "cache-control": headers.cacheControl,
    "x-content-type-options": "nosniff",
    ...(headers.etag ? { etag: headers.etag } : {}),
    ...(headers.lastModified ? { "last-modified": headers.lastModified } : {}),
  });
  if (requestMethod === "HEAD") {
    response.end();
    return;
  }
  response.end(body);
}

function absoluteHttpUrl(value, baseUrl) {
  if (typeof value !== "string" || !value.trim()) return null;
  let url;
  try {
    url = new URL(value, baseUrl);
  } catch {
    return null;
  }
  if (!["http:", "https:"].includes(url.protocol)) return null;
  url.hash = "";
  return url;
}

function replaceTileTemplate(template, z, x, y) {
  const numericZ = Number(z);
  const numericX = Number(x);
  const numericY = Number(y);
  if (![numericZ, numericX, numericY].every(Number.isInteger)) {
    throw new Error("Invalid vector tile coordinates.");
  }
  const invertedY = 2 ** numericZ - numericY - 1;
  let quadkey = "";
  for (let level = numericZ; level > 0; level -= 1) {
    let digit = 0;
    const mask = 1 << (level - 1);
    if ((numericX & mask) !== 0) digit += 1;
    if ((numericY & mask) !== 0) digit += 2;
    quadkey += digit;
  }
  return template
    .replaceAll("{z}", String(numericZ))
    .replace(/%7Bz%7D/gi, String(numericZ))
    .replaceAll("{x}", String(numericX))
    .replace(/%7Bx%7D/gi, String(numericX))
    .replaceAll("{y}", String(numericY))
    .replace(/%7By%7D/gi, String(numericY))
    .replaceAll("{-y}", String(invertedY))
    .replace(/%7B-y%7D/gi, String(invertedY))
    .replaceAll("{quadkey}", quadkey)
    .replace(/%7Bquadkey%7D/gi, quadkey)
    .replaceAll("{ratio}", "")
    .replace(/%7Bratio%7D/gi, "");
}

function replaceGlyphTemplate(template, fontstack, range) {
  const normalizedFontstack = encodeURIComponent(decodeURIComponent(fontstack));
  const normalizedRange = encodeURIComponent(decodeURIComponent(range));
  return template
    .replaceAll("{fontstack}", normalizedFontstack)
    .replace(/%7Bfontstack%7D/gi, normalizedFontstack)
    .replaceAll("{range}", normalizedRange)
    .replace(/%7Brange%7D/gi, normalizedRange);
}

function statusReason({ enabled, styleUrl, publicDisplayAuthorized, configurationError }) {
  if (!enabled) return "TX-97 chart integration is disabled.";
  if (configurationError) return configurationError;
  if (!styleUrl) return "TX97_STYLE_URL is not configured.";
  if (!publicDisplayAuthorized) {
    return "TX97_PUBLIC_DISPLAY_AUTHORIZED is false; licensed chart content is blocked from this public portal.";
  }
  return null;
}

export function createTx97ChartGateway(options = {}) {
  const env = options.env ?? process.env;
  const allowInsecureHttp = options.allowInsecureHttp
    ?? booleanValue(env.TX97_ALLOW_INSECURE_HTTP, false);
  let styleUrl = null;
  let configurationError = null;
  try {
    styleUrl = normalizeStyleUrl(options.styleUrl ?? env.TX97_STYLE_URL, allowInsecureHttp);
  } catch (error) {
    configurationError = error instanceof Error ? error.message : String(error);
  }

  const enabled = options.enabled
    ?? booleanValue(env.TX97_CHARTS_ENABLED, Boolean(styleUrl));
  const publicDisplayAuthorized = options.publicDisplayAuthorized
    ?? booleanValue(env.TX97_PUBLIC_DISPLAY_AUTHORIZED, false);
  const timeoutMs = boundedInteger(
    options.timeoutMs ?? env.TX97_REQUEST_TIMEOUT_MS,
    DEFAULT_TIMEOUT_MS,
    1_000,
    120_000,
  );
  const cacheSeconds = boundedInteger(
    options.cacheSeconds ?? env.TX97_CACHE_SECONDS,
    DEFAULT_CACHE_SECONDS,
    0,
    86_400,
  );
  const bearerToken = String(options.bearerToken ?? env.TX97_BEARER_TOKEN ?? "").trim();
  const apiKey = String(options.apiKey ?? env.TX97_API_KEY ?? "").trim();
  const apiKeyHeader = String(options.apiKeyHeader ?? env.TX97_API_KEY_HEADER ?? "x-api-key").trim();
  const chartCollection = String(
    options.chartCollection ?? env.TX97_CHART_COLLECTION ?? "licensed TX-97 collection",
  ).trim();

  const allowedOrigins = new Set();
  if (styleUrl) allowedOrigins.add(styleUrl.origin);
  for (const originValue of options.allowedOrigins ?? splitCsv(env.TX97_ALLOWED_ORIGINS)) {
    try {
      const originUrl = new URL(originValue);
      allowedOrigins.add(originUrl.origin);
    } catch {
      configurationError = configurationError
        ?? `Invalid TX97_ALLOWED_ORIGINS entry: ${originValue}`;
    }
  }

  const runtime = {
    requests: 0,
    successfulResponses: 0,
    lastSuccessAt: null,
    lastErrorAt: null,
    lastError: null,
  };

  function status() {
    const reason = statusReason({
      enabled,
      styleUrl,
      publicDisplayAuthorized,
      configurationError,
    });
    return {
      provider: "Wärtsilä TX-97",
      format: "TX-97 vector charts via an authorized MapLibre-compatible chart service",
      chartCollection,
      enabled,
      configured: Boolean(styleUrl) && !configurationError,
      publicDisplayAuthorized,
      ready: reason === null,
      styleOrigin: styleUrl?.origin ?? null,
      allowedOrigins: [...allowedOrigins].sort(),
      credentialMode: bearerToken ? "bearer" : apiKey ? "api-key" : "upstream-managed",
      notForNavigation: true,
      reason,
      runtime: { ...runtime },
    };
  }

  function assertRemoteAllowed(remoteValue) {
    const remoteUrl = new URL(remoteValue);
    const secure = remoteUrl.protocol === "https:";
    const localHttp = allowInsecureHttp
      && remoteUrl.protocol === "http:"
      && ["127.0.0.1", "localhost", "::1"].includes(remoteUrl.hostname);
    if (!secure && !localHttp) throw new Error("Blocked non-HTTPS TX-97 chart resource.");
    if (!allowedOrigins.has(remoteUrl.origin)) {
      throw new Error(`Blocked TX-97 chart origin: ${remoteUrl.origin}`);
    }
    remoteUrl.hash = "";
    return remoteUrl;
  }

  function remoteHeaders(accept) {
    return {
      accept,
      "user-agent": "CHMARL-TX97-Chart-Gateway/1.0",
      ...(bearerToken ? { authorization: `Bearer ${bearerToken}` } : {}),
      ...(apiKey ? { [apiKeyHeader]: apiKey } : {}),
    };
  }

  function proxyResourceUrl(remoteUrl) {
    return `${API_PREFIX}resource/${encodeRemoteUrl(remoteUrl.toString())}`;
  }

  function proxyTileUrl(remoteUrl) {
    return `${API_PREFIX}tile/${encodeRemoteUrl(remoteUrl.toString())}/{z}/{x}/{y}`;
  }

  function proxyGlyphUrl(remoteUrl) {
    return `${API_PREFIX}glyph/${encodeRemoteUrl(remoteUrl.toString())}/{fontstack}/{range}`;
  }

  function proxySpriteUrl(remoteUrl) {
    return `${API_PREFIX}sprite/${encodeRemoteUrl(remoteUrl.toString())}`;
  }

  function rewriteChartDocument(value, baseUrl) {
    if (Array.isArray(value)) {
      return value.map((entry) => rewriteChartDocument(entry, baseUrl));
    }
    if (!value || typeof value !== "object") return value;

    const rewritten = {};
    for (const [key, entry] of Object.entries(value)) {
      if (key === "sprite" && typeof entry === "string") {
        const remote = absoluteHttpUrl(entry, baseUrl);
        rewritten[key] = remote ? proxySpriteUrl(assertRemoteAllowed(remote)) : entry;
        continue;
      }
      if (key === "glyphs" && typeof entry === "string") {
        const remote = absoluteHttpUrl(entry, baseUrl);
        rewritten[key] = remote ? proxyGlyphUrl(assertRemoteAllowed(remote)) : entry;
        continue;
      }
      if (key === "tiles" && Array.isArray(entry)) {
        rewritten[key] = entry.map((tile) => {
          const remote = absoluteHttpUrl(tile, baseUrl);
          return remote ? proxyTileUrl(assertRemoteAllowed(remote)) : tile;
        });
        continue;
      }
      if ((key === "url" || key === "data") && typeof entry === "string") {
        const remote = absoluteHttpUrl(entry, baseUrl);
        rewritten[key] = remote ? proxyResourceUrl(assertRemoteAllowed(remote)) : entry;
        continue;
      }
      rewritten[key] = rewriteChartDocument(entry, baseUrl);
    }
    return rewritten;
  }

  async function fetchRemote(remoteUrl, accept) {
    runtime.requests += 1;
    const response = await fetch(remoteUrl, {
      method: "GET",
      headers: remoteHeaders(accept),
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
    });
    const finalUrl = assertRemoteAllowed(response.url || remoteUrl.toString());
    if (!response.ok) {
      throw new Error(`TX-97 upstream returned HTTP ${response.status} for ${finalUrl.pathname}`);
    }
    const body = Buffer.from(await response.arrayBuffer());
    runtime.successfulResponses += 1;
    runtime.lastSuccessAt = new Date().toISOString();
    runtime.lastError = null;
    return {
      body,
      finalUrl,
      contentType: response.headers.get("content-type") || contentTypeForPath(finalUrl.pathname),
      etag: response.headers.get("etag"),
      lastModified: response.headers.get("last-modified"),
    };
  }

  async function sendRemote(request, response, remoteUrl, accept, rewriteJson = false) {
    const result = await fetchRemote(assertRemoteAllowed(remoteUrl), accept);
    let body = result.body;
    let contentType = result.contentType;
    if (rewriteJson || contentType.toLowerCase().includes("json")) {
      const parsed = JSON.parse(body.toString("utf8"));
      body = Buffer.from(JSON.stringify(rewriteChartDocument(parsed, result.finalUrl)), "utf8");
      contentType = "application/json; charset=utf-8";
    }
    sendBuffer(response, request.method, 200, body, {
      contentType,
      cacheControl: `private, max-age=${cacheSeconds}`,
      etag: result.etag,
      lastModified: result.lastModified,
    });
  }

  async function handle(request, response, url) {
    const path = url.pathname;
    if (path === STATUS_PATH) {
      sendJson(response, 200, status());
      return true;
    }
    if (!path.startsWith(API_PREFIX)) return false;

    if (!["GET", "HEAD"].includes(request.method ?? "GET")) {
      sendJson(response, 405, { error: "TX-97 chart gateway supports GET and HEAD only." });
      return true;
    }

    const currentStatus = status();
    if (!currentStatus.enabled) {
      sendJson(response, 503, { error: currentStatus.reason, tx97: currentStatus });
      return true;
    }
    if (!currentStatus.configured) {
      sendJson(response, 503, { error: currentStatus.reason, tx97: currentStatus });
      return true;
    }
    if (!currentStatus.publicDisplayAuthorized) {
      sendJson(response, 403, { error: currentStatus.reason, tx97: currentStatus });
      return true;
    }

    try {
      if (path === STYLE_PATH) {
        await sendRemote(
          request,
          response,
          styleUrl,
          "application/json",
          true,
        );
        return true;
      }

      const resourceMatch = path.match(/^\/api\/charts\/tx97\/resource\/([A-Za-z0-9_-]+)$/);
      if (resourceMatch) {
        const remote = decodeRemoteUrl(resourceMatch[1]);
        await sendRemote(
          request,
          response,
          remote,
          "application/json,application/x-protobuf,image/*,*/*",
          false,
        );
        return true;
      }

      const tileMatch = path.match(
        /^\/api\/charts\/tx97\/tile\/([A-Za-z0-9_-]+)\/(\d+)\/(\d+)\/(\d+)$/,
      );
      if (tileMatch) {
        const template = decodeRemoteUrl(tileMatch[1]);
        const remote = replaceTileTemplate(
          template,
          Number(tileMatch[2]),
          Number(tileMatch[3]),
          Number(tileMatch[4]),
        );
        await sendRemote(
          request,
          response,
          remote,
          "application/x-protobuf,application/vnd.mapbox-vector-tile,*/*",
          false,
        );
        return true;
      }

      const glyphMatch = path.match(
        /^\/api\/charts\/tx97\/glyph\/([A-Za-z0-9_-]+)\/([^/]+)\/([^/]+)$/,
      );
      if (glyphMatch) {
        const template = decodeRemoteUrl(glyphMatch[1]);
        const remote = replaceGlyphTemplate(template, glyphMatch[2], glyphMatch[3]);
        await sendRemote(request, response, remote, "application/x-protobuf,*/*", false);
        return true;
      }

      const spriteMatch = path.match(
        /^\/api\/charts\/tx97\/sprite\/([A-Za-z0-9_-]+)(@2x)?\.(json|png)$/,
      );
      if (spriteMatch) {
        const base = decodeRemoteUrl(spriteMatch[1]);
        const suffix = `${spriteMatch[2] ?? ""}.${spriteMatch[3]}`;
        await sendRemote(
          request,
          response,
          `${base}${suffix}`,
          spriteMatch[3] === "json" ? "application/json" : "image/png",
          spriteMatch[3] === "json",
        );
        return true;
      }

      sendJson(response, 404, {
        error: "TX-97 chart resource route not found.",
        availableEndpoints: [STATUS_PATH, STYLE_PATH],
      });
      return true;
    } catch (error) {
      runtime.lastErrorAt = new Date().toISOString();
      runtime.lastError = error instanceof Error ? error.message : String(error);
      sendJson(response, 502, {
        error: "TX-97 chart gateway request failed.",
        detail: runtime.lastError,
        tx97: status(),
      });
      return true;
    }
  }

  return { handle, status };
}
