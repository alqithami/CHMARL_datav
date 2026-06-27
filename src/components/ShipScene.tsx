import { useEffect, useMemo, useState } from "react";
import { ports, routes, vessels as fallbackVessels, type Vessel } from "@/data/chmarlData";
import { loadRemoteDashboardVessels } from "@/providers/dashboardDataProvider";

type Port = (typeof ports)[number];

type ShipSceneProps = {
  vessels?: Vessel[];
};

type ShipMarker = {
  vessel: Vessel;
  left: number;
  top: number;
  heading: number;
  tone: "cyan" | "yellow" | "red" | "blue";
};

const shipPositions = [
  { left: 21, top: 60, heading: -8, tone: "yellow" as const },
  { left: 30, top: 36, heading: 18, tone: "cyan" as const },
  { left: 70, top: 42, heading: -35, tone: "red" as const },
  { left: 18, top: 78, heading: 12, tone: "blue" as const },
  { left: 75, top: 58, heading: -8, tone: "yellow" as const },
];

function mapPosition(position: [number, number, number]) {
  const [x, , z] = position;
  return {
    left: ((x + 7) / 14) * 100,
    top: ((5.8 - z) / 11.6) * 100,
  };
}

function routeColor(risk: string) {
  if (risk === "high") return "#ff7474";
  if (risk === "medium") return "#ffd780";
  return "#65e4cb";
}

function statusClass(status: Vessel["status"]) {
  if (status === "Constrained") return "alert";
  if (status === "Watch") return "warning";
  return "nominal";
}

export default function ShipScene({ vessels = fallbackVessels }: ShipSceneProps) {
  const portMap = useMemo(() => new Map<string, Port>(ports.map((port) => [port.name, port])), []);
  const [remoteVessels, setRemoteVessels] = useState<Vessel[] | null>(null);

  useEffect(() => {
    let active = true;
    loadRemoteDashboardVessels()
      .then((result) => {
        if (!active || !result) return;
        setRemoteVessels(result.vessels);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const sceneVessels = remoteVessels ?? (vessels.length > 0 ? vessels : fallbackVessels);
  const shipMarkers = useMemo<ShipMarker[]>(
    () =>
      sceneVessels.map((vessel, index) => ({
        vessel,
        ...shipPositions[index % shipPositions.length],
      })),
    [sceneVessels]
  );
  const [selectedShipId, setSelectedShipId] = useState("");
  const selectedShip = selectedShipId ? shipMarkers.find((ship) => ship.vessel.id === selectedShipId) : undefined;

  const mapStyle = selectedShip
    ? {
        transformOrigin: `${selectedShip.left}% ${selectedShip.top}%`,
      }
    : undefined;

  return (
    <div className="scene-container static-map-container">
      <div
        className={selectedShip ? "regional-map is-inspecting" : "regional-map"}
        style={mapStyle}
        aria-label="CH-MARL maritime regional inspection map">
        <svg className="regional-map-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
          <defs>
            <linearGradient id="seaGradient" x1="0" x2="1" y1="0" y2="1">
              <stop offset="0%" stopColor="rgba(15,80,106,0.45)" />
              <stop offset="55%" stopColor="rgba(7,36,58,0.72)" />
              <stop offset="100%" stopColor="rgba(2,10,20,0.95)" />
            </linearGradient>
            <linearGradient id="landGradient" x1="0" x2="1" y1="0" y2="1">
              <stop offset="0%" stopColor="rgba(78,111,96,0.52)" />
              <stop offset="100%" stopColor="rgba(28,61,62,0.72)" />
            </linearGradient>
          </defs>

          <rect x="0" y="0" width="100" height="100" fill="url(#seaGradient)" />
          <path className="map-landmass" d="M0 100 L0 0 L22 0 C19 15 18 27 22 39 C27 53 27 71 19 100 Z" />
          <path className="map-landmass" d="M100 0 L100 100 L80 100 C84 82 86 65 83 50 C80 35 79 18 84 0 Z" />
          <path className="map-landmass-secondary" d="M42 28 C48 25 55 26 60 31 C66 38 65 48 57 54 C50 59 42 57 37 50 C32 43 34 33 42 28 Z" />
          <text x="12" y="88" className="map-region-label">Red Sea</text>
          <text x="69" y="29" className="map-region-label">Arabian Gulf</text>
          <text x="41" y="63" className="map-region-label subdued">Arabian Peninsula</text>

          {routes.map((route) => {
            const from = portMap.get(route.from);
            const to = portMap.get(route.to);
            if (!from || !to) return null;

            const start = mapPosition(from.position);
            const end = mapPosition(to.position);
            const midX = (start.left + end.left) / 2;
            const midY = Math.min(start.top, end.top) - 9;

            return (
              <path
                key={`${route.from}-${route.to}`}
                d={`M ${start.left} ${start.top} Q ${midX} ${midY} ${end.left} ${end.top}`}
                stroke={routeColor(route.risk)}
                strokeWidth="0.85"
                strokeDasharray="2.5 1.8"
                fill="none"
                opacity="0.88"
              />
            );
          })}
        </svg>

        {ports.map((port) => {
          const point = mapPosition(port.position);
          return (
            <div
              key={port.name}
              className="html-port-marker"
              style={{ left: `${point.left}%`, top: `${point.top}%` }}>
              <span className="html-port-dot" />
              <span className="html-port-name">{port.name}</span>
            </div>
          );
        })}

        {shipMarkers.map((ship) => (
          <button
            key={ship.vessel.id}
            type="button"
            aria-label={`Inspect ${ship.vessel.name}`}
            title={`Inspect ${ship.vessel.name}`}
            className={`ship-figurine ${ship.tone} ${ship.vessel.id === selectedShipId ? "selected" : ""}`}
            style={{
              left: `${ship.left}%`,
              top: `${ship.top}%`,
              transform: `translate(-50%, -50%) rotate(${ship.heading}deg)`,
            }}
            onClick={() => setSelectedShipId(ship.vessel.id)}>
            <span />
          </button>
        ))}
      </div>

      {selectedShip && (
        <aside className="ship-inspector-card">
          <div className="ship-inspector-header">
            <div>
              <span className="ship-inspector-kicker">Selected vessel</span>
              <h3>{selectedShip.vessel.name}</h3>
            </div>
            <span className={`ship-status ${statusClass(selectedShip.vessel.status)}`}>{selectedShip.vessel.status}</span>
          </div>
          <dl>
            <div><dt>ID</dt><dd>{selectedShip.vessel.id}</dd></div>
            <div><dt>Route</dt><dd>{selectedShip.vessel.route}</dd></div>
            <div><dt>Cargo</dt><dd>{selectedShip.vessel.cargo}</dd></div>
            <div><dt>ETA</dt><dd>{selectedShip.vessel.eta}</dd></div>
            <div><dt>Speed</dt><dd>{selectedShip.vessel.speed}</dd></div>
          </dl>
          <button type="button" onClick={() => setSelectedShipId("")}>Reset overview</button>
        </aside>
      )}

      <div className="scene-overlay compact">
        <div className="overlay-box">
          <strong>Inspect vessels</strong>
          Select a ship marker to focus the map and show vessel properties.
        </div>
        <div className="overlay-box">
          <strong>Policy context</strong>
          Routes and panels change with each CH-MARL scenario.
        </div>
      </div>
    </div>
  );
}
