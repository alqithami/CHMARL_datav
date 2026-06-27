import { useMemo } from "react";
import { ports, routes } from "@/data/chmarlData";

type Port = (typeof ports)[number];

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

export default function ShipScene() {
  const portMap = useMemo(() => new Map<string, Port>(ports.map((port) => [port.name, port])), []);

  return (
    <div className="scene-container static-map-container">
      <div className="regional-map" aria-label="CH-MARL maritime regional schematic map">
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

          <path
            className="map-landmass"
            d="M0 100 L0 0 L22 0 C19 15 18 27 22 39 C27 53 27 71 19 100 Z"
          />
          <path
            className="map-landmass"
            d="M100 0 L100 100 L80 100 C84 82 86 65 83 50 C80 35 79 18 84 0 Z"
          />
          <path
            className="map-landmass-secondary"
            d="M42 28 C48 25 55 26 60 31 C66 38 65 48 57 54 C50 59 42 57 37 50 C32 43 34 33 42 28 Z"
          />

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
                strokeWidth="0.9"
                strokeDasharray="3 2"
                fill="none"
                opacity="0.95"
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

        <div className="html-vessel vessel-one" title="Sample vessel" />
        <div className="html-vessel vessel-two" title="Sample vessel" />
        <div className="html-vessel vessel-three" title="Sample vessel" />
      </div>

      <div className="scene-overlay compact">
        <div className="overlay-box">
          <strong>Static regional view</strong>
          Synthetic corridors and ports for comparing CH-MARL policy scenarios.
        </div>
        <div className="overlay-box">
          <strong>Fixture driven</strong>
          Panels use local AIS-like, port-event, and episode sample files.
        </div>
      </div>
    </div>
  );
}
