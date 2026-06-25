import { constraintPressure, metrics, portUtilization, rewardTrend, timelineEvents, vessels } from "@/data/chmarlData";
import ConstraintChart from "./charts/ConstraintChart";
import DecisionTimeline from "./DecisionTimeline";
import MetricCard from "./MetricCard";
import PanelCard from "./PanelCard";
import PortUtilizationChart from "./charts/PortUtilizationChart";
import RewardTrend from "./charts/RewardTrend";
import ShipScene from "./ShipScene";
import VesselTable from "./VesselTable";

export default function DashboardShell() {
  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <div className="brand-kicker">CH-MARL Maritime Logistics</div>
          <h1 className="brand-title">Constrained Hierarchical MARL DataV Platform</h1>
          <p className="brand-subtitle">
            A command-center interface for ship transportation, AIS-informed traffic, port operations, and policy evaluation.
          </p>
        </div>
        <div className="scenario-bar" aria-label="Scenario controls">
          <span className="pill active">Real-time mock stream</span>
          <span className="pill">Congestion-aware</span>
          <span className="pill">Emissions shield</span>
        </div>
      </header>

      <section className="metrics-grid" aria-label="CH-MARL performance metrics">
        {metrics.map((metric) => (
          <MetricCard key={metric.label} metric={metric} />
        ))}
      </section>

      <section className="dashboard-grid">
        <div className="left-stack">
          <PanelCard title="Policy Reward Trend" tag="episode">
            <RewardTrend data={rewardTrend} />
          </PanelCard>
          <PanelCard title="Constraint Pressure" tag="shield">
            <ConstraintChart data={constraintPressure} />
          </PanelCard>
        </div>

        <PanelCard title="Maritime Operations Scene" tag="3D map" className="scene-panel">
          <ShipScene />
        </PanelCard>

        <div className="right-stack">
          <PanelCard title="Port Utilization" tag="capacity">
            <PortUtilizationChart data={portUtilization} />
          </PanelCard>
          <PanelCard title="Decision Timeline" tag="hierarchy">
            <DecisionTimeline events={timelineEvents} />
          </PanelCard>
        </div>

        <PanelCard title="Live Vessel State Table" tag="AIS-ready">
          <VesselTable vessels={vessels} />
        </PanelCard>
      </section>
    </main>
  );
}
