import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Metric, RewardTrendPoint } from "@/data/chmarlData";
import { fallbackDashboardData, loadSampleDashboardData, type DashboardData, type DashboardDataSource } from "@/data/loadSampleDashboardData";
import { exportDashboardSnapshot, exportPaperReport, exportVesselCsv } from "@/export/dashboardExports";
import { scenarioCatalog } from "@/scenarios/scenarioCatalog";
import ConstraintChart from "./charts/ConstraintChart";
import DecisionTimeline from "./DecisionTimeline";
import MetricCard from "./MetricCard";
import PanelCard from "./PanelCard";
import PortUtilizationChart from "./charts/PortUtilizationChart";
import RewardTrend from "./charts/RewardTrend";
import ShipScene from "./ShipScene";
import VesselTable from "./VesselTable";

const scenarioMetrics: Record<string, Metric[]> = {
  baseline: [
    { label: "Active vessels", value: "128", trend: "simulated regional fleet" },
    { label: "Port calls", value: "42", trend: "scheduled next 24h" },
    { label: "Constraint score", value: "96.4%", trend: "safe policy feasible" },
    { label: "Reward index", value: "0.740", trend: "local episode sample" },
    { label: "Avg ETA error", value: "18m", trend: "after replanning" },
    { label: "CO₂ intensity", value: "7.8", trend: "kg / t-nm" },
  ],
  congestion: [
    { label: "Active vessels", value: "174", trend: "+46 surge vessels" },
    { label: "Port calls", value: "67", trend: "berth pressure high" },
    { label: "Constraint score", value: "88.1%", trend: "capacity binding" },
    { label: "Reward index", value: "0.691", trend: "recovery mode" },
    { label: "Avg ETA error", value: "41m", trend: "queue delay" },
    { label: "CO₂ intensity", value: "8.9", trend: "kg / t-nm" },
  ],
  disruption: [
    { label: "Active vessels", value: "119", trend: "8 rerouted" },
    { label: "Port calls", value: "35", trend: "reduced window" },
    { label: "Constraint score", value: "91.7%", trend: "shield active" },
    { label: "Reward index", value: "0.656", trend: "safety-first policy" },
    { label: "Avg ETA error", value: "54m", trend: "route disruption" },
    { label: "CO₂ intensity", value: "9.4", trend: "kg / t-nm" },
  ],
  "emissions-aware": [
    { label: "Active vessels", value: "126", trend: "slow steaming" },
    { label: "Port calls", value: "40", trend: "balanced arrivals" },
    { label: "Constraint score", value: "97.2%", trend: "emissions feasible" },
    { label: "Reward index", value: "0.762", trend: "fuel trade-off" },
    { label: "Avg ETA error", value: "24m", trend: "+6m slow speed" },
    { label: "CO₂ intensity", value: "6.3", trend: "kg / t-nm" },
  ],
  "fairness-aware": [
    { label: "Active vessels", value: "132", trend: "priority rebalance" },
    { label: "Port calls", value: "44", trend: "balanced service" },
    { label: "Constraint score", value: "95.8%", trend: "fairness shield" },
    { label: "Reward index", value: "0.826", trend: "lower service gap" },
    { label: "Avg ETA error", value: "22m", trend: "variance reduced" },
    { label: "CO₂ intensity", value: "7.6", trend: "kg / t-nm" },
  ],
};

type FocusPanel = "reward" | "constraints" | "scene" | "ports" | "timeline" | "vessels";
type LoadStatus = "loading" | "refreshing" | DashboardDataSource;

function shiftRewardTrend(data: RewardTrendPoint[], offset: number, slope: number): RewardTrendPoint[] {
  return data.map(([time, value], index) => [time, Number(Math.max(0.5, value + offset + index * slope).toFixed(3))]);
}

function scenarioMetricsFor(base: DashboardData, scenarioId: string): Metric[] {
  const baseMetrics = scenarioMetrics[scenarioId] ?? scenarioMetrics.baseline;
  return baseMetrics.map((metric) =>
    metric.label === "Active vessels"
      ? {
          ...metric,
          value: String(base.vessels.length),
          trend: base.source === "remote" ? "remote vessel feed" : metric.trend,
        }
      : metric
  );
}

function getScenarioDashboardData(base: DashboardData, scenarioId: string): DashboardData {
  const metrics = scenarioMetricsFor(base, scenarioId);

  if (scenarioId === "congestion") {
    return {
      ...base,
      metrics,
      vessels: base.vessels.map((vessel, index) => ({ ...vessel, status: index < 2 ? ("Watch" as const) : vessel.status })),
      rewardTrend: shiftRewardTrend(base.rewardTrend, -0.04, 0.002),
      constraintPressure: base.constraintPressure.map((item) => ({ ...item, value: Math.min(100, item.value + 18) })),
      portUtilization: [
        { name: "Jeddah", value: 96 },
        { name: "Dammam", value: 84 },
        { name: "Yanbu", value: 79 },
        { name: "Jizan", value: 63 },
        { name: "KAEC", value: 71 },
      ],
      timelineEvents: [
        { time: "T+00:03", title: "Congestion-aware policy selected", body: "Port agents rebalance arrivals under increased berth pressure." },
        ...base.timelineEvents,
      ],
    };
  }

  if (scenarioId === "disruption") {
    return {
      ...base,
      metrics,
      vessels: base.vessels.map((vessel, index) => ({ ...vessel, status: index === 2 ? ("Constrained" as const) : vessel.status })),
      rewardTrend: shiftRewardTrend(base.rewardTrend, -0.04, -0.006),
      constraintPressure: base.constraintPressure.map((item) => ({ ...item, value: item.name === "Channel safety" ? 93 : Math.min(100, item.value + 7) })),
      portUtilization: [
        { name: "Jeddah", value: 66 },
        { name: "Dammam", value: 74 },
        { name: "Yanbu", value: 69 },
        { name: "Jizan", value: 53 },
        { name: "KAEC", value: 62 },
      ],
      timelineEvents: [
        { time: "T+00:01", title: "Route disruption detected", body: "A high-risk corridor segment was marked unavailable for routing." },
        ...base.timelineEvents,
      ],
    };
  }

  if (scenarioId === "emissions-aware") {
    return {
      ...base,
      metrics,
      vessels: base.vessels.map((vessel) => ({ ...vessel, speed: "11.0 kn" })),
      rewardTrend: shiftRewardTrend(base.rewardTrend, -0.02, 0.004),
      constraintPressure: base.constraintPressure.map((item) => ({ ...item, value: item.name === "Emissions cap" ? 35 : Math.max(30, item.value - 8) })),
      timelineEvents: [
        { time: "T+00:04", title: "Emissions shield enabled", body: "Vessel speeds are reduced to keep fuel and emissions constraints feasible." },
        ...base.timelineEvents,
      ],
    };
  }

  if (scenarioId === "fairness-aware") {
    return {
      ...base,
      metrics,
      rewardTrend: shiftRewardTrend(base.rewardTrend, -0.03, 0.003),
      constraintPressure: [...base.constraintPressure.slice(0, 4), { name: "Fairness gap", value: 31 }],
      portUtilization: [
        { name: "Jeddah", value: 78 },
        { name: "Dammam", value: 74 },
        { name: "Yanbu", value: 68 },
        { name: "Jizan", value: 59 },
        { name: "KAEC", value: 66 },
      ],
      timelineEvents: [
        { time: "T+00:05", title: "Fairness-aware policy selected", body: "Service variance is reduced across vessels, ports, and cargo classes." },
        ...base.timelineEvents,
      ],
    };
  }

  return { ...base, metrics };
}

function sourceLabel(source: DashboardDataSource) {
  if (source === "remote") return "Remote proxy";
  if (source === "local-json") return "Local fixtures";
  return "Bundled fallback";
}

function statusLabel(status: LoadStatus) {
  if (status === "loading") return "Loading";
  if (status === "refreshing") return "Refreshing";
  return sourceLabel(status);
}

function FocusModal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return (
    <div className="focus-backdrop" role="dialog" aria-modal="true" aria-label={title}>
      <section className="focus-panel">
        <header className="focus-header">
          <h2>{title}</h2>
          <button type="button" onClick={onClose}>Close</button>
        </header>
        <div className="focus-content">{children}</div>
      </section>
    </div>
  );
}

export default function DashboardShell() {
  const [selectedScenarioId, setSelectedScenarioId] = useState("baseline");
  const [baseData, setBaseData] = useState<DashboardData>(fallbackDashboardData);
  const [dataSourceStatus, setDataSourceStatus] = useState<LoadStatus>("loading");
  const [lastUpdated, setLastUpdated] = useState("not loaded");
  const [focusPanel, setFocusPanel] = useState<FocusPanel | null>(null);

  const refreshData = useCallback((status: LoadStatus = "refreshing") => {
    setDataSourceStatus(status);
    return loadSampleDashboardData()
      .then((data) => {
        setBaseData(data);
        setDataSourceStatus(data.source);
        setLastUpdated(new Date().toLocaleTimeString());
      })
      .catch((error: unknown) => {
        console.error("Failed to load dashboard data. Falling back to bundled data.", error);
        setBaseData(fallbackDashboardData);
        setDataSourceStatus("fallback");
        setLastUpdated(new Date().toLocaleTimeString());
      });
  }, []);

  useEffect(() => {
    let active = true;
    const load = () => {
      refreshData(active ? "loading" : "refreshing");
    };

    load();
    const interval = window.setInterval(() => {
      if (active) refreshData("refreshing");
    }, 30_000);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [refreshData]);

  const dashboardData = useMemo(() => getScenarioDashboardData(baseData, selectedScenarioId), [baseData, selectedScenarioId]);
  const trailCount = dashboardData.vessels.filter((vessel) => vessel.trail && vessel.trail.length > 1).length;
  const eventCount = dashboardData.portEvents.length;
  const providerState = statusLabel(dataSourceStatus);

  const focusContent = (() => {
    if (focusPanel === "reward") return { title: "Policy Reward Trend", content: <RewardTrend data={dashboardData.rewardTrend} /> };
    if (focusPanel === "constraints") return { title: "Constraint Pressure", content: <ConstraintChart data={dashboardData.constraintPressure} /> };
    if (focusPanel === "scene") return { title: "Maritime Operations Scene", content: <ShipScene vessels={dashboardData.vessels} portEvents={dashboardData.portEvents} /> };
    if (focusPanel === "ports") return { title: "Port Utilization", content: <PortUtilizationChart data={dashboardData.portUtilization} /> };
    if (focusPanel === "timeline") return { title: "Decision Timeline", content: <DecisionTimeline events={dashboardData.timelineEvents} /> };
    if (focusPanel === "vessels") return { title: "Sample Vessel State Table", content: <VesselTable vessels={dashboardData.vessels} /> };
    return null;
  })();

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <div className="brand-kicker">CH-MARL Maritime Logistics</div>
          <h1 className="brand-title">Constrained Hierarchical MARL DataV Platform</h1>
          <p className="brand-subtitle">
            Synthetic regional operations view for policy comparison before live vessel, port, and experiment-log connections.
          </p>
        </div>
        <div className="scenario-bar" aria-label="Scenario controls">
          <span className="pill data-pill">Data: {dataSourceStatus}</span>
          <span className="pill data-pill">Updated: {lastUpdated}</span>
          <button type="button" className="pill" onClick={() => refreshData("refreshing")}>Refresh</button>
          <button type="button" className="pill" onClick={() => exportDashboardSnapshot(dashboardData, selectedScenarioId)}>Export JSON</button>
          <button type="button" className="pill" onClick={() => exportVesselCsv(dashboardData, selectedScenarioId)}>Export CSV</button>
          <button type="button" className="pill" onClick={() => exportPaperReport(dashboardData, selectedScenarioId)}>Export Report</button>
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

      <section className="data-health-grid" aria-label="Provider and data health">
        <div className="data-health-card primary">
          <span>Provider state</span>
          <strong>{providerState}</strong>
          <small>{baseData.source === "remote" ? "VITE_VESSEL_DATA_URL active" : "Using non-remote data path"}</small>
        </div>
        <div className="data-health-card">
          <span>Vessels</span>
          <strong>{dashboardData.vessels.length}</strong>
          <small>{trailCount} with movement trails</small>
        </div>
        <div className="data-health-card">
          <span>Port events</span>
          <strong>{eventCount}</strong>
          <small>Mapped to known ports</small>
        </div>
        <div className="data-health-card">
          <span>Refresh cadence</span>
          <strong>30s</strong>
          <small>Manual refresh available</small>
        </div>
        <div className="data-health-card">
          <span>Scenario</span>
          <strong>{selectedScenarioId}</strong>
          <small>UI policy transform active</small>
        </div>
      </section>

      <section className="metrics-grid" aria-label="CH-MARL performance metrics">
        {dashboardData.metrics.map((metric) => (
          <MetricCard key={metric.label} metric={metric} />
        ))}
      </section>

      <section className="dashboard-grid">
        <div className="left-stack">
          <PanelCard title="Policy Reward Trend" tag={selectedScenarioId} onFocus={() => setFocusPanel("reward")}>
            <RewardTrend data={dashboardData.rewardTrend} />
          </PanelCard>
          <PanelCard title="Constraint Pressure" tag="shield" onFocus={() => setFocusPanel("constraints")}>
            <ConstraintChart data={dashboardData.constraintPressure} />
          </PanelCard>
        </div>

        <PanelCard title="Maritime Operations Scene" tag="static map" className="scene-panel" onFocus={() => setFocusPanel("scene")}>
          <ShipScene vessels={dashboardData.vessels} portEvents={dashboardData.portEvents} />
        </PanelCard>

        <div className="right-stack">
          <PanelCard title="Port Utilization" tag="capacity" onFocus={() => setFocusPanel("ports")}>
            <PortUtilizationChart data={dashboardData.portUtilization} />
          </PanelCard>
          <PanelCard title="Decision Timeline" tag="hierarchy" onFocus={() => setFocusPanel("timeline")}>
            <DecisionTimeline events={dashboardData.timelineEvents} />
          </PanelCard>
        </div>

        <PanelCard title="Sample Vessel State Table" tag="fixture" onFocus={() => setFocusPanel("vessels")}>
          <VesselTable vessels={dashboardData.vessels} />
        </PanelCard>
      </section>

      {focusContent && (
        <FocusModal title={focusContent.title} onClose={() => setFocusPanel(null)}>
          {focusContent.content}
        </FocusModal>
      )}
    </main>
  );
}
