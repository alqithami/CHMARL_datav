import { createServer } from "node:http";

const PORT = Number(process.env.PORT ?? 8787);
const UPSTREAM_URL = process.env.UPSTREAM_VESSEL_DATA_URL;
const UPSTREAM_TOKEN = process.env.UPSTREAM_VESSEL_DATA_TOKEN;

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

function normalizeVessel(row) {
  const name = row.name ?? row.vesselName ?? row.shipName ?? "Unknown Vessel";
  const id = row.id ?? row.vesselId ?? (row.mmsi ? `MMSI-${row.mmsi}` : row.imo ?? name);
  const origin = row.originPort ?? row.origin ?? "Unknown";
  const destination = row.destinationPort ?? row.destination ?? row.dest ?? "Unknown";
  const speedValue = row.speed ?? row.speedKnots ?? row.sog;

  return {
    id: String(id),
    name: String(name),
    route: `${origin} → ${destination}`,
    cargo: String(row.cargo ?? row.cargoClass ?? row.vesselType ?? row.shipType ?? "Unspecified"),
    eta: String(row.eta ?? row.ETA ?? "TBD"),
    speed: typeof speedValue === "string" && speedValue.includes("kn") ? speedValue : numberToSpeed(speedValue),
    status: normalizeStatus(row.status ?? row.navStatus),
    latitude: optionalNumber(row.latitude ?? row.lat),
    longitude: optionalNumber(row.longitude ?? row.lon ?? row.lng),
    headingDeg: optionalNumber(row.headingDeg ?? row.heading),
    courseDeg: optionalNumber(row.courseDeg ?? row.cog),
  };
}

async function loadVessels() {
  if (!UPSTREAM_URL) return fallbackVessels;

  const headers = { accept: "application/json" };
  if (UPSTREAM_TOKEN) headers.authorization = `Bearer ${UPSTREAM_TOKEN}`;

  const response = await fetch(UPSTREAM_URL, { headers });
  if (!response.ok) {
    throw new Error(`Upstream request failed: ${response.status} ${response.statusText}`);
  }

  const payload = await response.json();
  const rows = extractRows(payload);
  return rows.map(normalizeVessel);
}

createServer(async (request, response) => {
  if (request.method === "OPTIONS") {
    sendJson(response, 204, {});
    return;
  }

  if (request.url === "/health") {
    sendJson(response, 200, { ok: true });
    return;
  }

  if (request.url !== "/api/vessels") {
    sendJson(response, 404, { error: "Not found" });
    return;
  }

  try {
    const vessels = await loadVessels();
    sendJson(response, 200, { vessels, source: UPSTREAM_URL ? "upstream" : "fallback" });
  } catch (error) {
    sendJson(response, 502, {
      error: "Failed to load vessel feed",
      detail: error instanceof Error ? error.message : String(error),
      vessels: fallbackVessels,
    });
  }
}).listen(PORT, () => {
  console.log(`Vessel feed proxy listening at http://localhost:${PORT}/api/vessels`);
});
