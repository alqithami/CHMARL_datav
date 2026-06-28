import { createServer } from "node:http";
import WebSocket from "ws";

const PORT = Number(process.env.PORT ?? 8787);
const UPSTREAM_URL = process.env.UPSTREAM_VESSEL_DATA_URL;
const UPSTREAM_TOKEN = process.env.UPSTREAM_VESSEL_DATA_TOKEN;
const AISSTREAM_API_KEY = process.env.AISSTREAM_API_KEY;
const AISSTREAM_URL = process.env.AISSTREAM_URL ?? "wss://stream.aisstream.io/v0/stream";
const AISSTREAM_BBOX = process.env.AISSTREAM_BBOX ?? "11,32;31,56";
const AISSTREAM_MAX_VESSELS = Number(process.env.AISSTREAM_MAX_VESSELS ?? 250);
const AISSTREAM_FILTER_TYPES = (process.env.AISSTREAM_FILTER_TYPES ?? "PositionReport,StandardClassBPositionReport,ExtendedClassBPositionReport")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

const aisCache = new Map();
const aisState = {
  enabled: Boolean(AISSTREAM_API_KEY),
  connected: false,
  lastMessageAt: null,
  lastError: null,
  reconnectAttempt: 0,
  boundingBoxes: [],
};

const fallbackVessels = [
  {
    id: "MMSI-538214",
    name: "Al Riyadh Trader",
    route: "Jeddah → Suez",
    cargo: "Containers",
    eta: "04:20 UTC",
    speed: "14.8 kn",
    status: "Nominal",
    latitude: 21.45,
    longitude: 39.12,
    courseDeg: 322,
  },
  {
    id: "MMSI-636719",
    name: "Red Sea Pearl",
    route: "Yanbu → Aqaba",
    cargo: "Energy products",
    eta: "11:10 UTC",
    speed: "10.1 kn",
    status: "Constrained",
    latitude: 24.05,
    longitude: 37.88,
    courseDeg: 7,
  },
];

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-headers": "content-type, authorization",
  });
  response.end(JSON.stringify(payload));
}

function normalizeStatus(value) {
  const text = String(value ?? "").toLowerCase();
  if (text.includes("constraint") || text.includes("restricted") || text.includes("alert")) return "Constrained";
  if (text.includes("watch") || text.includes("warning") || text.includes("delay")) return "Watch";
  return "Nominal";
}

function numberToSpeed(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? `${parsed.toFixed(1)} kn` : "TBD";
}

function optionalNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function extractRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === "object") {
    if (Array.isArray(payload.vessels)) return payload.vessels;
    if (Array.isArray(payload.data)) return payload.data;
    if (Array.isArray(payload.items)) return payload.items;
  }
  return [];
}

function normalizeTrail(points) {
  if (!Array.isArray(points)) return undefined;
  const trail = points
    .map((point) => {
      const latitude = optionalNumber(point.latitude ?? point.lat);
      const longitude = optionalNumber(point.longitude ?? point.lon ?? point.lng);
      if (latitude === undefined || longitude === undefined) return null;
      return { latitude, longitude, timestamp: point.timestamp };
    })
    .filter(Boolean);
  return trail.length > 1 ? trail : undefined;
}

function normalizeVessel(row) {
  const name = row.name ?? row.vesselName ?? row.shipName ?? "Unknown Vessel";
  const id = row.id ?? row.vesselId ?? (row.mmsi ? `MMSI-${row.mmsi}` : row.imo ?? name);
  const origin = row.originPort ?? row.origin ?? "Unknown";
  const destination = row.destinationPort ?? row.destination ?? row.dest ?? "Unknown";
  const speedValue = row.speed ?? row.speedKnots ?? row.sog;

  return {
    id: String(id),
    name: String(name),
    route: row.route ?? `${origin} → ${destination}`,
    cargo: String(row.cargo ?? row.cargoClass ?? row.vesselType ?? row.shipType ?? "Unspecified"),
    eta: String(row.eta ?? row.ETA ?? "TBD"),
    speed: typeof speedValue === "string" && speedValue.includes("kn") ? speedValue : numberToSpeed(speedValue),
    status: normalizeStatus(row.status ?? row.navStatus),
    latitude: optionalNumber(row.latitude ?? row.lat),
    longitude: optionalNumber(row.longitude ?? row.lon ?? row.lng),
    headingDeg: optionalNumber(row.headingDeg ?? row.heading),
    courseDeg: optionalNumber(row.courseDeg ?? row.cog),
    timestamp: row.timestamp,
    trail: normalizeTrail(row.trail ?? row.history ?? row.track),
  };
}

function parseBoundingBoxes(value) {
  return value
    .split("|")
    .map((box) => {
      const corners = box.split(";").map((corner) => corner.split(",").map((item) => Number(item.trim())));
      if (corners.length !== 2 || corners.some((corner) => corner.length !== 2 || corner.some((number) => !Number.isFinite(number)))) {
        throw new Error(`Invalid AISSTREAM_BBOX segment: ${box}`);
      }
      return corners;
    });
}

function safeParseBoundingBoxes() {
  try {
    return parseBoundingBoxes(AISSTREAM_BBOX);
  } catch (error) {
    aisState.lastError = error instanceof Error ? error.message : String(error);
    return [];
  }
}

function getMessageBody(message) {
  if (!message || typeof message !== "object") return {};
  const messageType = message.MessageType;
  const body = message.Message?.[messageType] ?? message.Message?.PositionReport ?? message.Message?.StandardClassBPositionReport ?? message.Message?.ExtendedClassBPositionReport;
  return body && typeof body === "object" ? body : {};
}

function normalizeAisStreamMessage(raw) {
  const metadata = raw.MetaData ?? raw.Metadata ?? {};
  const body = getMessageBody(raw);
  const mmsi = metadata.MMSI ?? body.UserID;
  const latitude = optionalNumber(metadata.latitude ?? metadata.Latitude ?? body.Latitude);
  const longitude = optionalNumber(metadata.longitude ?? metadata.Longitude ?? body.Longitude);
  if (!mmsi || latitude === undefined || longitude === undefined) return null;

  const shipName = metadata.ShipName ?? metadata.ShipNameAis ?? body.Name;
  const sog = optionalNumber(body.Sog ?? metadata.Sog ?? metadata.SOG);
  const cog = optionalNumber(body.Cog ?? metadata.Cog ?? metadata.COG);
  const heading = optionalNumber(body.TrueHeading ?? body.Heading ?? metadata.TrueHeading);
  const timestamp = metadata.time_utc ?? metadata.TimeUtc ?? metadata.timestamp ?? new Date().toISOString();

  return {
    id: `MMSI-${mmsi}`,
    mmsi: String(mmsi),
    name: shipName ? String(shipName).trim() : `MMSI ${mmsi}`,
    route: "AIS position → live track",
    cargo: raw.MessageType ?? "AIS vessel",
    eta: "Live AIS",
    speed: sog === undefined ? "TBD" : `${sog.toFixed(1)} kn`,
    status: "Nominal",
    latitude,
    longitude,
    headingDeg: heading,
    courseDeg: cog,
    timestamp,
  };
}

function mergeAisVessel(update) {
  const existing = aisCache.get(update.id);
  const priorTrail = existing?.trail ?? [];
  const nextTrail = [...priorTrail, { latitude: update.latitude, longitude: update.longitude, timestamp: update.timestamp }].slice(-12);
  aisCache.set(update.id, {
    ...existing,
    ...update,
    trail: nextTrail.length > 1 ? nextTrail : undefined,
  });

  if (aisCache.size > AISSTREAM_MAX_VESSELS) {
    const oldestKey = [...aisCache.entries()].sort((a, b) => String(a[1].timestamp ?? "").localeCompare(String(b[1].timestamp ?? "")))[0]?.[0];
    if (oldestKey) aisCache.delete(oldestKey);
  }
}

function startAisStream() {
  if (!AISSTREAM_API_KEY) return;

  const boundingBoxes = safeParseBoundingBoxes();
  aisState.boundingBoxes = boundingBoxes;
  if (boundingBoxes.length === 0) return;

  const socket = new WebSocket(AISSTREAM_URL);
  aisState.lastError = null;

  socket.on("open", () => {
    aisState.connected = true;
    aisState.reconnectAttempt = 0;
    socket.send(JSON.stringify({
      APIKey: AISSTREAM_API_KEY,
      BoundingBoxes: boundingBoxes,
      FilterMessageTypes: AISSTREAM_FILTER_TYPES,
    }));
    console.log(`AISStream connected with ${boundingBoxes.length} bounding box(es).`);
  });

  socket.on("message", (data) => {
    try {
      const raw = JSON.parse(data.toString());
      if (raw.error) {
        aisState.lastError = raw.error;
        return;
      }
      const vessel = normalizeAisStreamMessage(raw);
      if (!vessel) return;
      aisState.lastMessageAt = new Date().toISOString();
      mergeAisVessel(vessel);
    } catch (error) {
      aisState.lastError = error instanceof Error ? error.message : String(error);
    }
  });

  socket.on("close", () => {
    aisState.connected = false;
    const delay = Math.min(30_000, 2_000 * 2 ** aisState.reconnectAttempt);
    aisState.reconnectAttempt += 1;
    setTimeout(startAisStream, delay);
  });

  socket.on("error", (error) => {
    aisState.connected = false;
    aisState.lastError = error.message;
  });
}

async function loadVessels() {
  const liveAisVessels = [...aisCache.values()];
  if (liveAisVessels.length > 0) return { vessels: liveAisVessels, source: "aisstream" };

  if (!UPSTREAM_URL) return { vessels: fallbackVessels, source: AISSTREAM_API_KEY ? "aisstream-waiting" : "fallback" };

  const headers = { accept: "application/json" };
  if (UPSTREAM_TOKEN) headers.authorization = `Bearer ${UPSTREAM_TOKEN}`;

  const response = await fetch(UPSTREAM_URL, { headers });
  if (!response.ok) {
    throw new Error(`Upstream request failed: ${response.status} ${response.statusText}`);
  }

  const payload = await response.json();
  const rows = extractRows(payload);
  return { vessels: rows.map(normalizeVessel), source: "upstream" };
}

startAisStream();

createServer(async (request, response) => {
  if (request.method === "OPTIONS") {
    sendJson(response, 204, {});
    return;
  }

  if (request.url === "/health") {
    sendJson(response, 200, {
      ok: true,
      upstreamConfigured: Boolean(UPSTREAM_URL),
      aisstream: {
        enabled: aisState.enabled,
        connected: aisState.connected,
        cachedVessels: aisCache.size,
        lastMessageAt: aisState.lastMessageAt,
        lastError: aisState.lastError,
        boundingBoxes: aisState.boundingBoxes,
      },
    });
    return;
  }

  if (request.url !== "/api/vessels") {
    sendJson(response, 404, { error: "Not found" });
    return;
  }

  try {
    const result = await loadVessels();
    sendJson(response, 200, { vessels: result.vessels, source: result.source, health: aisState });
  } catch (error) {
    sendJson(response, 502, {
      error: "Failed to load vessel feed",
      detail: error instanceof Error ? error.message : String(error),
      vessels: fallbackVessels,
      health: aisState,
    });
  }
}).listen(PORT, () => {
  console.log(`Vessel feed proxy listening at http://localhost:${PORT}/api/vessels`);
  if (AISSTREAM_API_KEY) console.log("AISStream live mode enabled.");
});
