import type { DashboardData } from "@/data/loadSampleDashboardData";
import VesselSpeedProfile from "./charts/VesselSpeedProfile";

export type AnalysisRailFocus = "reward" | "constraints" | "speed" | "port-queue";

export type AnalysisRailProps = {
  data: DashboardData;
  onFocus: (panel: AnalysisRailFocus) => void;
};

function queueSignal(data: DashboardData) {
  const queueRows = data.portQueueStatus.map((row) => ({
    portId: row.portId,
    value: typeof row.utilizationPct === "number"
      ? row.utilizationPct
      : typeof row.queueLength === "number"
        ? Math.min(100, row.queueLength * 12)
        : typeof row.waitingVessels === "number"
          ? Math.min(100, row.waitingVessels * 10)
          : 0,
    queue: row.queueLength ?? row.waitingVessels ?? 0,
  }));
  const utilizationRows = data.portUtilization.map((row) => ({ portId: row.name, value: row.value, queue: 0 }));
  return [...queueRows, ...utilizationRows].sort((a, b) => b.value - a.value)[0];
}

function sparklinePath(values: number[]) {
  if (values.length < 2) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(0.0001, max - min);
  return values.map((value, index) => {
    const x = (index / (values.length - 1)) * 100;
    const y = 32 - ((value - min) / span) * 28;
    return `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
  }).join(" ");
}

function MiniSparkline({ values }: { values: number[] }) {
  const path = sparklinePath(values);
  return (
    <svg className="analysis-sparkline" viewBox="0 0 100 36" preserveAspectRatio="none" aria-hidden="true">
      <path className="analysis-sparkline-grid" d="M0 30H100" />
      {path ? <path className="analysis-sparkline-line" d={path} /> : <path className="analysis-sparkline-empty" d="M0 30H100" />}
    </svg>
  );
}

function RailCard({
  label,
  value,
  detail,
  tone,
  onClick,
  children,
}: {
  label: string;
  value: string;
  detail: string;
  tone: "good" | "warning" | "critical" | "missing" | "info";
  onClick: () => void;
  children?: React.ReactNode;
}) {
  return (
    <button type="button" className={`analysis-rail-card ${tone}`} onClick={onClick} title="Open detailed panel">
      <span className="analysis-rail-card-label">{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
      {children}
    </button>
  );
}

export default function AnalysisRail({ data, onFocus }: AnalysisRailProps) {
  const trackingRows = data.vesselScope?.trackingRows ?? data.vessels.length;
  const operationalRows = data.vesselScope?.operationalRows ?? 0;
  const reward = data.rewardTrend.at(-1)?.[1];
  const rewardValues = data.rewardTrend.map(([, value]) => value);
  const constrained = data.vessels.filter((vessel) => vessel.status === "Constrained").length;
  const watch = data.vessels.filter((vessel) => vessel.status === "Watch").length;
  const feasibility = trackingRows === 0 ? undefined : Math.max(0, ((trackingRows - constrained) / trackingRows) * 100);
  const pressure = queueSignal(data);
  const pressureValue = pressure?.value ?? 0;
  const radius = data.vesselScope?.operationalRadiusNm ?? 120;

  return (
    <aside className="portal-analysis-rail" aria-label="CH-MARL analysis rail">
      <header className="portal-rail-heading">
        <div><span>CH-MARL overview</span><strong>Analysis rail</strong></div>
        <button type="button" onClick={() => onFocus("reward")} aria-label="Open CH-MARL reward details">i</button>
      </header>

      <div className="analysis-rail-metrics">
        <RailCard
          label="Reward index"
          value={reward === undefined ? "N/A" : reward.toFixed(3)}
          detail={reward === undefined ? "No online CH-MARL state" : `${data.chmarlSteps.length} online steps`}
          tone={reward === undefined ? "missing" : reward < 0 ? "warning" : "good"}
          onClick={() => onFocus("reward")}>
          <MiniSparkline values={rewardValues} />
        </RailCard>

        <RailCard
          label="Feasibility score"
          value={feasibility === undefined ? "N/A" : `${feasibility.toFixed(1)}%`}
          detail={trackingRows === 0 ? "Waiting for vessel rows" : `${constrained} constrained · ${watch} watch`}
          tone={feasibility === undefined ? "missing" : constrained > 0 ? "warning" : "good"}
          onClick={() => onFocus("constraints")}>
          <div className="analysis-progress" aria-hidden="true"><span style={{ width: `${feasibility ?? 0}%` }} /></div>
        </RailCard>

        <RailCard
          label="Monitored-port pressure"
          value={pressure ? `${Math.round(pressureValue)}%` : `${operationalRows} vessels`}
          detail={pressure ? `${pressure.portId} · queue ${pressure.queue}` : `${operationalRows} within ${radius} nm`}
          tone={pressureValue >= 90 ? "critical" : pressureValue >= 75 ? "warning" : operationalRows > 0 ? "info" : "missing"}
          onClick={() => onFocus("port-queue")}>
          <div className="analysis-progress pressure" aria-hidden="true"><span style={{ width: `${Math.min(100, pressureValue)}%` }} /></div>
        </RailCard>
      </div>

      <section className="analysis-speed-card">
        <header>
          <div><span>Vessel speed profile</span><small>Current AIS speed distribution</small></div>
          <button type="button" onClick={() => onFocus("speed")}>Expand</button>
        </header>
        <div className="analysis-speed-content"><VesselSpeedProfile vessels={data.vessels} /></div>
      </section>
    </aside>
  );
}
