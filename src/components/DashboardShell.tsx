import { useMemo, useState } from "react";
import { constraintPressure, metrics, portUtilization, rewardTrend, timelineEvents, vessels } from "@/data/chmarlData";
import { scenarioCatalog } from "@/scenarios/scenarioCatalog";
import ConstraintChart from "./charts/ConstraintChart";
import DecisionTimeline from "./DecisionTimeline";
import MetricCard from "./MetricCard";
import PanelCard from "./PanelCard";
import PortUtilizationChart from "./charts/PortUtilizationChart";
import RewardTrend from "./charts/RewardTrend";
import ShipScene from "./ShipScene";
import VesselTable from "./VesselTable";

function getScenarioDashboardData(scenarioId: string) {
  if (scenarioId === "congestion") {
    return {
      metrics: metrics.map((metric) =>
        metric.label === "Active vessels" ? { ...metric, value: "174", trend: "+46 under surge" } : metric
      ),
      vessels: vessels.map((vessel, index) => ({ ...vessel, status: index < 2 ? "Watch" : vessel.status })),
      rewardTrend: rewardTrend.map(([time, value], index) => [time, Number((value - 0.04 + index * 0.002).toFixed(3))]),
      constraintPressure: constraintPressure.map((item) => ({ ...item, value: Math.min(100, item.value + 18) })),
      portUtilization: portUtilization.map((item) => ({ ...item, value: Math.min(100, item.value + 12) })),
      timelineEvents: [
        { time: "T+00:03", title: "Congestion-aware policy selected", body: "Port agents rebalance arrivals under increased berth pressure." },
        ...timelineEvents,
      ],
    };
  }

  if (scenarioId === "disruption") {
    return {
      metrics: metrics.map((metric) =>
        metric.label === "Avg ETA error" ? { ...metric, value: "54m", trend: "route disruption" } : metric
      ),
      vessels: vessels.map((vessel, index) => ({ ...vessel, status: index === 2 ? "Constrained" : vessel.status })),
      rewardTrend: rewardTrend.map(([time, value], index) => [time, Number(Math.max(0.55, value - 0.04 - index * 0.006).toFixed(3))]),
      constraintPressure: constraintPressure.map((item) => ({ ...item, value: item.name === "Channel safety" ? 93 : Math.min(100, item.value + 7) })),
      portUtilization: portUtilization.map((item) => ({ ...item, value: Math.max(30, item.value - 8) })),
      timelineEvents: [
        { time: "T+00:01", title: "Route disruption detected", body: "A high-risk corridor segment was marked unavailable for routing." },
        ...timelineEvents,
      ],
    };
  }

  if (scenarioId === "emissions-aware") {
    return {
      metrics: metrics.map((metric) =>
        metric.label === "CO₂ intensity" ? { ...metric, value: "6.3", trend: "kg / t-nm" } : metric
      ),
      vessels: vessels.map((vessel) => ({ ...vessel, speed: "11.0 kn" })),
      rewardTrend: rewardTrend.map(([time, value], index) => [time, Number((value - 0.02 + index * 0.004).toFixed(3))]),
      constraintPressure: constraintPressure.map((item) => ({ ...item, value: item.name === "Emissions cap" ? 35 : Math.max(30, item.value - 8) })),
      portUtilization,
      timelineEvents: [
        { time: "T+00:04", title: "Emissions shield enabled", body: "Vessel speeds are reduced to keep fuel and emissions constraints feasible." },
        ...timelineEvents,
      ],
    };
  }

  if (scenarioId === "fairness-aware") {
    return {
      metrics: metrics.map((metric) =>
        metric.label === "Reward index" ? { ...metric, value: "0.826", trend: "balanced allocation" } : metric
      ),
      vessels,
      rewardTrend: rewardTrend.map(([time, value], index) => [time, Number((value - 0.03 + index * 0.003).toFixed(3))]),
      constraintPressure: [...constraintPressure.slice(0, 4), { name: "Fairness gap", value: 31 }],
      portUtilization: portUtilization.map((item) => ({ ...item, value: Math.round((item.value + 65) / 2) })),
      timelineEvents: [
        { time: "T+00:05", title: "Fairness-aware policy selected", body: "Service variance is reduced across vessels, ports, and cargo classes." },
        ...timelineEvents,
      ],
    };
  }

  return { metrics, vessels, rewardTrend, constraintPressure, portUtilization, timelineEvents };
}

export default function DashboardShell() {
  const [selectedScenarioId, setSelectedScenarioId] = useState("baseline");
  const dashboardData = useMemo(() => getScenarioDashboardData(selectedScenarioId), [selectedScenarioId]);

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
          {scenarioCatalog.map((scenario) => (
            <button
              key={scenario.scenarioId}
              type="button"
              className={scenario.scenarioId === selectedScenarioId ? "pill active" : "pill"}
              title={scenario.description}
              onClick={() => setSelectedScenarioId(scenario.scenarioId)}>
              {scenario.label}
            </button>
          ))}
        </div>
      </header>

      <section className="metrics-grid" aria-label="CH-MARL performance metrics">
        {dashboardData.metrics.map((metric) => (
          <MetricCard key={metric.label} metric={metric} />
        ))}
      </section>

      <section className="dashboard-grid">
        <div className="left-stack">
          <PanelCard title="Policy Reward Trend" tag={selectedScenarioId}>
            <RewardTrend data={dashboardData.rewardTrend} />
          </PanelCard>
          <PanelCard title="Constraint Pressure" tag="shield">
            <ConstraintChart data={dashboardData.constraintPressure} />
          </PanelCard>
        </div>

        <PanelCard title="Maritime Operations Scene" tag="3D map" className="scene-panel">
          <ShipScene />
        </PanelCard>

        <div className="right-stack">
          <PanelCard title="Port Utilization" tag="capacity">
            <PortUtilizationChart data={dashboardData.portUtilization} />
          </PanelCard>
          <PanelCard title="Decision Timeline" tag="hierarchy">
            <DecisionTimeline events={dashboardData.timelineEvents} />
          </PanelCard>
        </div>

        <PanelCard title="Live Vessel State Table" tag="AIS-ready">
          <VesselTable vessels={dashboardData.vessels} />
        </PanelCard>
      </section>
    </main>
  );
}
