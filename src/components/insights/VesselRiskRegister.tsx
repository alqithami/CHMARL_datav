import type { Vessel } from "@/data/chmarlData";

export type VesselRiskRegisterProps = {
  vessels: Vessel[];
  compact?: boolean;
};

type RiskRow = {
  vessel: Vessel;
  score: number;
  reasons: string[];
};

function speedKnots(vessel: Vessel) {
  const parsed = Number.parseFloat(vessel.speed.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function isStale(vessel: Vessel) {
  if (!vessel.timestamp) return false;
  const timestamp = Date.parse(vessel.timestamp);
  return Number.isFinite(timestamp) && Date.now() - timestamp > 30 * 60 * 1000;
}

function riskFor(vessel: Vessel): RiskRow {
  const reasons: string[] = [];
  let score = 0;
  if (!Number.isFinite(vessel.latitude) || !Number.isFinite(vessel.longitude)) { score += 40; reasons.push("missing position"); }
  if (isStale(vessel)) { score += 25; reasons.push("stale AIS"); }
  const speed = speedKnots(vessel);
  if (speed !== undefined && speed <= 0.5) { score += 15; reasons.push("stationary"); }
  if (vessel.status === "Watch") { score += 20; reasons.push("watch"); }
  if (vessel.status === "Constrained") { score += 45; reasons.push("constrained"); }
  if (vessel.trail && vessel.trail.length > 1) score -= 5;
  return { vessel, score: Math.max(0, score), reasons };
}

function tone(score: number) {
  if (score >= 60) return "alert";
  if (score >= 25) return "warning";
  return "nominal";
}

export default function VesselRiskRegister({ vessels, compact = false }: VesselRiskRegisterProps) {
  const rows = vessels.map(riskFor).filter((row) => row.score > 0).sort((a, b) => b.score - a.score).slice(0, compact ? 5 : 14);
  const highRisk = rows.filter((row) => row.score >= 60).length;

  return (
    <div className="vessel-risk-register insight-panel-content">
      <div className="insight-panel-summary">
        <span>Vessel risk register</span>
        <strong>{rows.length}</strong>
        <small>{highRisk} high risk · scored from AIS quality, speed, and status</small>
      </div>
      <div className={compact ? "vessel-risk-list compact" : "vessel-risk-list"}>
        {rows.length === 0 ? (
          <p className="insight-empty-state">No current vessel risk rows detected.</p>
        ) : rows.map(({ vessel, score, reasons }) => (
          <article key={vessel.id} className="vessel-risk-row">
            <div>
              <strong>{vessel.name}</strong>
              <small>{reasons.join(" · ") || "nominal"}</small>
            </div>
            <span className={`ship-status ${tone(score)}`}>{score}</span>
          </article>
        ))}
      </div>
    </div>
  );
}
