import type { Vessel } from "@/data/chmarlData";

export type FleetOperationalSummaryProps = {
  vessels: Vessel[];
  compact?: boolean;
};

function speedKnots(vessel: Vessel) {
  const parsed = Number.parseFloat(vessel.speed.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function hasPosition(vessel: Vessel) {
  return Number.isFinite(vessel.latitude) && Number.isFinite(vessel.longitude);
}

function stale(vessel: Vessel) {
  if (!vessel.timestamp) return false;
  const timestamp = Date.parse(vessel.timestamp);
  return Number.isFinite(timestamp) && Date.now() - timestamp > 30 * 60 * 1000;
}

export default function FleetOperationalSummary({ vessels, compact = false }: FleetOperationalSummaryProps) {
  const positioned = vessels.filter(hasPosition).length;
  const moving = vessels.filter((vessel) => (speedKnots(vessel) ?? 0) > 0.5).length;
  const constrained = vessels.filter((vessel) => vessel.status === "Constrained").length;
  const watch = vessels.filter((vessel) => vessel.status === "Watch").length;
  const staleRows = vessels.filter(stale).length;
  const withTrail = vessels.filter((vessel) => vessel.trail && vessel.trail.length > 1).length;
  const dataQuality = vessels.length === 0 ? 0 : Math.round((positioned / vessels.length) * 100);

  const cards = [
    { label: "Positioned", value: `${positioned}/${vessels.length}`, detail: `${dataQuality}% coordinate coverage` },
    { label: "Moving", value: String(moving), detail: "SOG above 0.5 kn" },
    { label: "Watch", value: String(watch), detail: "warning status rows" },
    { label: "Constrained", value: String(constrained), detail: "active constraint rows" },
    { label: "Trails", value: String(withTrail), detail: "vessels with movement history" },
    { label: "Stale", value: String(staleRows), detail: "older than 30 min" },
  ];

  return (
    <div className="fleet-summary-panel insight-panel-content">
      <div className="insight-panel-summary">
        <span>Fleet state</span>
        <strong>{vessels.length}</strong>
        <small>{moving} moving · {positioned} positioned · {withTrail} tracked with trails</small>
      </div>
      <div className={compact ? "fleet-summary-grid compact" : "fleet-summary-grid"}>
        {cards.map((card) => (
          <article key={card.label}>
            <span>{card.label}</span>
            <strong>{card.value}</strong>
            <small>{card.detail}</small>
          </article>
        ))}
      </div>
    </div>
  );
}
