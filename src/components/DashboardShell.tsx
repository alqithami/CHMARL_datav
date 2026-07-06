import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Metric, RewardTrendPoint, Vessel } from "@/data/chmarlData";
import { fallbackDashboardData, loadSampleDashboardData, type ChmarlDataSource, type DashboardData, type DashboardDataSource } from "@/data/loadSampleDashboardData";
import { exportDashboardSnapshot, exportEcoFairServerReport, exportOperationalReport, exportVesselCsv } from "@/export/dashboardExports";
import { scenarioCatalog } from "@/scenarios/scenarioCatalog";
import ConstraintChart from "./charts/ConstraintChart";
import DataQualityPanel from "./DataQualityPanel";
import MetricCard from "./MetricCard";
import OperationalWatchlist from "./OperationalWatchlist";
import PanelCard from "./PanelCard";
import PortOpsSetup from "./PortOpsSetup";
import PortUtilizationChart from "./charts/PortUtilizationChart";
import RewardTrend from "./charts/RewardTrend";
import ShipScene from "./ShipScene";
import VesselSpeedProfile from "./charts/VesselSpeedProfile";
import VesselTable from "./VesselTable";
import ChmarlActionPlan from "./insights/ChmarlActionPlan";
import ChmarlConstraintLedger from "./insights/ChmarlConstraintLedger";
import ChmarlDecisionTimeline from "./insights/ChmarlDecisionTimeline";
import ChmarlFairnessPanel from "./insights/ChmarlFairnessPanel";
import ChmarlRewardComponents from "./insights/ChmarlRewardComponents";
import FleetOperationalSummary from "./insights/FleetOperationalSummary";
import MarineWeatherOverview from "./insights/MarineWeatherOverview";
import OperationalInsightStrip, { type InsightFocusPanel } from "./insights/OperationalInsightStrip";
import PortCoverageMatrix from "./insights/PortCoverageMatrix";
import PortEventFeed from "./insights/PortEventFeed";
import PortQueueBoard from "./insights/PortQueueBoard";
import VesselRiskRegister from "./insights/VesselRiskRegister";
import WeatherRiskMatrix from "./insights/WeatherRiskMatrix";

type FocusPanel = "reward" | "constraints" | "scene" | "ports" | "watchlist" | "vessels" | InsightFocusPanel;
type LoadStatus = "loading" | "refreshing" | DashboardDataSource;

const allowScenarioSimulation = import.meta.env.VITE_ALLOW_SAMPLE_DATA === "true";

function shiftRewardTrend(data: RewardTrendPoint[], offset: number, slope: number): RewardTrendPoint[] {
  return data.map(([time, value], index) => [time, Number(Math.max(0.5, value + offset + index * slope).toFixed(3))]);
}

function parseSpeedKnots(speed: string) {
  const parsed = Number.parseFloat(speed.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function averageSpeed(vessels: Vessel[]) {
  const speeds = vessels.map((vessel) => parseSpeedKnots(vessel.speed)).filter((value): value is number => value !== undefined);
  if (speeds.length === 0) return undefined;
  return speeds.reduce((sum, value) => sum + value, 0) / speeds.length;
}

function countStatus(vessels: Vessel[], status: Vessel["status"]) {
  return vessels.filter((vessel) => vessel.status === status).length;
}

function isExternalSource(source: DashboardDataSource) {
  return source === "aisstream" || source === "aisstream-waiting" || source === "upstream" || source === "remote";
}

function sourceLabel(source: DashboardDataSource) {
  if (source === "aisstream") return "Live AIS";
  if (source === "aisstream-waiting") return "AIS waiting";
  if (source === "upstream") return "Upstream API";
  if (source === "remote") return "Remote proxy";
  if (source === "local-json") return "Local fixtures";
  if (source === "none") return "No vessel feed";
  return "Backend unavailable";
}

function chmarlSourceLabel(source: ChmarlDataSource) {
  if (source === "runtime") return "Online CH-MARL";
  if (source === "local-json") return "CH-MARL fixture";
  return "No CH-MARL state";
}

function portOpsSourceLabel(source: DashboardData["portOpsSource"]) {
  if (source === "runtime") return "Runtime port ops";
  if (source === "demo") return "Kpler-like demo events";
  if (source === "local-json") return "Port fixture";
  return "Port feed required";
}

function weatherSourceLabel(source: DashboardData["weatherSource"]) {
  if (source === "open-meteo") return "Open-Meteo marine";
  if (source === "runtime") return "Runtime weather";
  return "No weather feed";
}

function statusLabel(status: LoadStatus) {
  if (status === "loading") return "Loading";
  if (status === "refreshing") return "Refreshing";
  return sourceLabel(status);
}

function sourceRefreshMs(source: DashboardDataSource) {
  if (source === "aisstream" || source === "aisstream-waiting") return 5_000;
  if (source === "upstream" || source === "remote") return 15_000;
  return 30_000;
}

function portEventsTrend(data: DashboardData) {
  if (data.portOpsSource === "runtime") return "runtime berth/queue feed";
  if (data.portOpsSource === "demo") return "Kpler-like demo event shape";
  if (data.portOpsSource === "local-json") return "normalized operations feed";
  return "connect PORT_EVENTS_URL";
}

function maxWaveHeight(data: DashboardData) {
  const waveHeights = data.weatherPoints
    .map((point) => point.waveHeightM)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (waveHeights.length === 0) return undefined;
  return Math.max(...waveHeights);
}

function maxWindSpeed(data: DashboardData) {
  const winds = data.weatherPoints
    .map((point) => point.windSpeedMs)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (winds.length === 0) return undefined;
  return Math.max(...winds);
}

function buildOperationalMetrics(data: DashboardData): Metric[] {
  const vesselCount = data.vessels.length;
  const watchCount = countStatus(data.vessels, "Watch");
  const constrainedCount = countStatus(data.vessels, "Constrained");
  const trackCount = data.vessels.filter((vessel) => vessel.trail && vessel.trail.length > 1).length;
  const latestReward = data.rewardTrend.at(-1)?.[1];
  const speed = averageSpeed(data.vessels);
  const feasibleRatio = vesselCount === 0 ? 1 : Math.max(0, (vesselCount - constrainedCount) / vesselCount);
  const external = isExternalSource(data.source);
  const seaState = maxWaveHeight(data);
  const windState = maxWindSpeed(data);

  return [
    { label: "Tracked vessels", value: String(vesselCount), trend: sourceLabel(data.source) },
    {
      label: "Reward index",
      value: latestReward === undefined ? "n/a" : latestReward.toFixed(3),
      trend: chmarlSourceLabel(data.chmarlSource),
    },
    {
      label: "Feasibility score",
      value: vesselCount === 0 ? "n/a" : `${(feasibleRatio * 100).toFixed(1)}%`,
      trend: vesselCount === 0 ? "waiting for vessel rows" : `${constrainedCount} constrained / ${watchCount} watch`,
    },
    {
      label: external ? "Avg AIS SOG" : "Avg vessel speed",
      value: speed === undefined ? "n/a" : `${speed.toFixed(1)} kn`,
      trend: external ? "from AIS rows with valid SOG" : "from current vessel state rows",
    },
    { label: "Port events", value: String(data.portEvents.length), trend: portEventsTrend(data) },
    seaState !== undefined
      ? { label: "Sea state", value: `${seaState.toFixed(1)} m`, trend: `${weatherSourceLabel(data.weatherSource)} wave height` }
      : windState !== undefined
        ? { label: "Wind state", value: `${windState.toFixed(1)} m/s`, trend: `${weatherSourceLabel(data.weatherSource)} forecast fallback` }
        : { label: "Movement tracks", value: String(trackCount), trend: "vessels with trail history" },
  ];
}

function withOperationalMetrics(data: DashboardData): DashboardData {
  return { ...data, metrics: buildOperationalMetrics(data) };
}

function scenarioPortUtilization(base: DashboardData, fallbackValues: { name: string; value: number }[]) {
  if (base.portOpsSource === "runtime" || base.portOpsSource === "demo") return base.portUtilization;
  if (isExternalSource(base.source)) return [];
  return fallbackValues;
}

function scenarioVessels(base: DashboardData, scenarioId: string) {
  if (isExternalSource(base.source)) return base.vessels;
  if (scenarioId === "congestion") return base.vessels.map((vessel, index) => ({ ...vessel, status: index < 2 ? ("Watch" as const) : vessel.status }));
  if (scenarioId === "disruption") return base.vessels.map((vessel, index) => ({ ...vessel, status: index === 2 ? ("Constrained" as const) : vessel.status }));
  if (scenarioId === "emissions-aware") return base.vessels.map((vessel) => ({ ...vessel, speed: "11.0 kn" }));
  return base.vessels;
}

function getScenarioDashboardData(base: DashboardData, scenarioId: string): DashboardData {
  if (!allowScenarioSimulation || scenarioId === "baseline") return withOperationalMetrics(base);

  if (scenarioId === "congestion") {
    return withOperationalMetrics({
      ...base,
      vessels: scenarioVessels(base, scenarioId),
      rewardTrend: shiftRewardTrend(base.rewardTrend, -0.04, 0.002),
      constraintPressure: base.constraintPressure.map((item) => ({ ...item, value: Math.min(100, item.value + 18) })),
      portUtilization: scenarioPortUtilization(base, [
        { name: "Jeddah", value: 96 },
        { name: "Dammam", value: 84 },
        { name: "Yanbu", value: 79 },
        { name: "Jizan", value: 63 },
        { name: "KAEC", value: 71 },
      ]),
      timelineEvents: [
        { time: "T+00:03", title: "Congestion-aware sample mode", body: "Sample-only scenario transform. Live/production mode does not fabricate values." },
        ...base.timelineEvents,
      ],
    });
  }

  if (scenarioId === "disruption") {
    return withOperationalMetrics({
      ...base,
      vessels: scenarioVessels(base, scenarioId),
      rewardTrend: shiftRewardTrend(base.rewardTrend, -0.04, -0.006),
      constraintPressure: base.constraintPressure.map((item) => ({ ...item, value: item.name === "Channel safety" ? 93 : Math.min(100, item.value + 7) })),
      portUtilization: scenarioPortUtilization(base, [
        { name: "Jeddah", value: 66 },
        { name: "Dammam", value: 74 },
        { name: "Yanbu", value: 69 },
        { name: "Jizan", value: 53 },
        { name: "KAEC", value: 62 },
      ]),
      timelineEvents: [
        { time: "T+00:01", title: "Disruption-response sample mode", body: "Sample-only scenario transform. Live/production mode does not fabricate values." },
        ...base.timelineEvents,
      ],
    });
  }

  if (scenarioId === "emissions-aware") {
    return withOperationalMetrics({
      ...base,
      vessels: scenarioVessels(base, scenarioId),
      rewardTrend: shiftRewardTrend(base.rewardTrend, -0.02, 0.004),
      constraintPressure: base.constraintPressure.map((item) => ({ ...item, value: item.name === "Emissions cap" ? 35 : Math.max(30, item.value - 8) })),
      timelineEvents: [
        { time: "T+00:04", title: "Emissions-aware sample mode", body: "Sample-only scenario transform. Live/production mode does not fabricate values." },
        ...base.timelineEvents,
      ],
    });
  }

  if (scenarioId === "fairness-aware") {
    return withOperationalMetrics({
      ...base,
      vessels: scenarioVessels(base, scenarioId),
      rewardTrend: shiftRewardTrend(base.rewardTrend, -0.03, 0.003),
      constraintPressure: [...base.constraintPressure.slice(0, 4), { name: "Fairness gap", value: 31 }],
      portUtilization: scenarioPortUtilization(base, [
        { name: "Jeddah", value: 78 },
        { name: "Dammam", value: 74 },
        { name: "Yanbu", value: 68 },
        { name: "Jizan", value: 59 },
        { name: "KAEC", value: 66 },
      ]),
      timelineEvents: [
        { time: "T+00:05", title: "Fairness-aware sample mode", body: "Sample-only scenario transform. Live/production mode does not fabricate values." },
        ...base.timelineEvents,
      ],
    });
  }

  return withOperationalMetrics(base);
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
  const refreshInFlight = useRef(false);
  const refreshIntervalMs = sourceRefreshMs(baseData.source);

  const refreshData = useCallback((status: LoadStatus = "refreshing") => {
    if (refreshInFlight.current) return Promise.resolve();
    refreshInFlight.current = true;
    if (status === "loading") setDataSourceStatus("loading");

    return loadSampleDashboardData()
      .then((data) => {
        setBaseData(data);
        setDataSourceStatus(data.source);
        setLastUpdated(new Date().toLocaleTimeString());
      })
      .catch((error: unknown) => {
        console.error("Failed to load dashboard data. Falling back to safe empty state.", error);
        setBaseData(fallbackDashboardData);
        setDataSourceStatus("fallback");
        setLastUpdated(new Date().toLocaleTimeString());
      })
      .finally(() => {
        refreshInFlight.current = false;
      });
  }, []);

  useEffect(() => {
    let active = true;
    refreshData("loading");
    const interval = window.setInterval(() => {
      if (active) refreshData("refreshing");
    }, refreshIntervalMs);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [refreshData, refreshIntervalMs]);

  const dashboardData = useMemo(() => getScenarioDashboardData(baseData, selectedScenarioId), [baseData, selectedScenarioId]);
  const liveDataActive = isExternalSource(dashboardData.source);
  const portOpsActive = dashboardData.portOpsSource === "runtime" || dashboardData.portOpsSource === "demo";
  const portOpsDemoActive = dashboardData.portOpsSource === "demo";
  const chmarlRuntimeActive = dashboardData.chmarlSource === "runtime" && dashboardData.rewardTrend.length > 0;
  const providerState = statusLabel(dataSourceStatus);
  const portPanelTitle = portOpsActive ? portOpsDemoActive ? "Kpler-like Port Call Events" : "Port Queue / Berth Utilization" : "Port Operations Setup";
  const portPanelTag = portOpsActive ? portOpsDemoActive ? "demo events" : "berth/queue" : "provider required";
  const primaryPanelTitle = chmarlRuntimeActive || !liveDataActive ? "CH-MARL Reward Trend" : "Vessel Speed Profile";
  const primaryPanelTag = chmarlRuntimeActive ? "online" : liveDataActive ? sourceLabel(dashboardData.source) : selectedScenarioId;
  const portPanelContent = portOpsActive
    ? <PortUtilizationChart data={dashboardData.portUtilization} />
    : <PortOpsSetup />;

  const focusContent = (() => {
    if (focusPanel === "reward") return { title: primaryPanelTitle, content: chmarlRuntimeActive || !liveDataActive ? <RewardTrend data={dashboardData.rewardTrend} /> : <VesselSpeedProfile vessels={dashboardData.vessels} /> };
    if (focusPanel === "constraints") return { title: "Operational Constraint Pressure", content: <ConstraintChart data={dashboardData.constraintPressure} /> };
    if (focusPanel === "scene") return { title: "Maritime Operations Map", content: <ShipScene vessels={dashboardData.vessels} portEvents={dashboardData.portEvents} expanded /> };
    if (focusPanel === "ports") return { title: portPanelTitle, content: portPanelContent };
    if (focusPanel === "watchlist") return { title: "Operational Watchlist", content: <OperationalWatchlist data={dashboardData} scenarioId={selectedScenarioId} /> };
    if (focusPanel === "vessels") return { title: "Vessel State Table", content: <VesselTable vessels={dashboardData.vessels} /> };
    if (focusPanel === "chmarl-components") return { title: "CH-MARL Reward Components", content: <ChmarlRewardComponents steps={dashboardData.chmarlSteps} /> };
    if (focusPanel === "chmarl-actions") return { title: "CH-MARL Agent Action Plan", content: <ChmarlActionPlan steps={dashboardData.chmarlSteps} /> };
    if (focusPanel === "chmarl-fairness") return { title: "CH-MARL Fairness Metrics", content: <ChmarlFairnessPanel steps={dashboardData.chmarlSteps} /> };
    if (focusPanel === "chmarl-constraints") return { title: "CH-MARL Constraint Shield", content: <ChmarlConstraintLedger steps={dashboardData.chmarlSteps} /> };
    if (focusPanel === "chmarl-decisions") return { title: "CH-MARL Decision Trace", content: <ChmarlDecisionTimeline steps={dashboardData.chmarlSteps} limit={24} /> };
    if (focusPanel === "weather") return { title: "Marine Weather Coverage", content: <MarineWeatherOverview points={dashboardData.weatherPoints} /> };
    if (focusPanel === "weather-risk") return { title: "Weather Risk Matrix", content: <WeatherRiskMatrix points={dashboardData.weatherPoints} /> };
    if (focusPanel === "fleet") return { title: "Fleet Operational Summary", content: <FleetOperationalSummary vessels={dashboardData.vessels} /> };
    if (focusPanel === "vessel-risk") return { title: "Vessel Risk Register", content: <VesselRiskRegister vessels={dashboardData.vessels} /> };
    if (focusPanel === "port-events") return { title: "Port Event Feed", content: <PortEventFeed events={dashboardData.portEvents} source={dashboardData.portOpsSource} /> };
    if (focusPanel === "port-queue") return { title: "Port Queue / Berth Board", content: <PortQueueBoard rows={dashboardData.portQueueStatus} source={dashboardData.portOpsSource} /> };
    if (focusPanel === "port-coverage") return { title: "Saudi AIS Port Coverage", content: <PortCoverageMatrix vessels={dashboardData.vessels} /> };
    return null;
  })();

  return (
    <main className="app-shell executive-shell">
      <header className="topbar">
        <div>
          <div className="brand-kicker">CH-MARL Maritime Logistics</div>
          <h1 className="brand-title">Operational Vessel Intelligence Dashboard</h1>
          <p className="brand-subtitle">Map-first view for vessel state, CH-MARL reward, queue pressure, and operational action.</p>
        </div>
        <div className="scenario-bar" aria-label="Scenario controls">
          <div className="status-control-group" aria-label="Data status controls">
            <span className="pill data-pill">Data: {providerState}</span>
            <span className="pill data-pill">CH-MARL: {chmarlSourceLabel(dashboardData.chmarlSource)}</span>
            <span className="pill data-pill">Port ops: {portOpsSourceLabel(dashboardData.portOpsSource)}</span>
            <span className="pill data-pill">Weather: {weatherSourceLabel(dashboardData.weatherSource)}</span>
            <span className="pill data-pill">Mode: {selectedScenarioId}</span>
            <span className="pill data-pill">Updated: {lastUpdated}</span>
            <button type="button" className="pill" onClick={() => refreshData("refreshing")}>Refresh</button>
          </div>
          <div className="scenario-buttons" aria-label="Scenario selection">
            {scenarioCatalog.map((scenario) => (
              <button
                key={scenario.scenarioId}
                type="button"
                className={scenario.scenarioId === selectedScenarioId ? "pill active" : "pill"}
                title={!allowScenarioSimulation ? "Mode selection is retained; production values come only from real AIS, weather, port, and online CH-MARL feeds." : scenario.description}
                onClick={() => setSelectedScenarioId(scenario.scenarioId)}>
                {scenario.label}
              </button>
            ))}
          </div>
          <details className="actions-menu">
            <summary>Exports</summary>
            <div className="actions-menu-panel">
              <button type="button" onClick={() => exportDashboardSnapshot(dashboardData, selectedScenarioId)}>Snapshot JSON</button>
              <button type="button" onClick={() => exportVesselCsv(dashboardData, selectedScenarioId)}>Vessel CSV</button>
              <button type="button" onClick={() => exportOperationalReport(dashboardData, selectedScenarioId)}>Ops Report</button>
              <button
                type="button"
                onClick={() => {
                  exportEcoFairServerReport().catch(() => {
                    window.alert("EcoFair server report is unavailable. Check that the backend proxy is running and reachable at /api/report.");
                  });
                }}>
                EcoFair Report (live)
              </button>
            </div>
          </details>
        </div>
      </header>

      <DataQualityPanel data={dashboardData} mode={selectedScenarioId} updatedAt={lastUpdated} />

      <section className="metrics-grid executive-kpis" aria-label="Operational performance metrics">
        {dashboardData.metrics.slice(0, 4).map((metric) => <MetricCard key={metric.label} metric={metric} />)}
      </section>

      <OperationalInsightStrip data={dashboardData} onFocus={setFocusPanel} />

      <section className="dashboard-grid" aria-label="Executive maritime command view">
        <div className="left-stack">
          <PanelCard title={primaryPanelTitle} tag={primaryPanelTag} onFocus={() => setFocusPanel("reward")}>
            {chmarlRuntimeActive || !liveDataActive ? <RewardTrend data={dashboardData.rewardTrend} /> : <VesselSpeedProfile vessels={dashboardData.vessels} />}
          </PanelCard>
          <PanelCard title="Operational Constraint Pressure" tag="constraints" onFocus={() => setFocusPanel("constraints")}>
            <ConstraintChart data={dashboardData.constraintPressure} />
          </PanelCard>
        </div>

        <PanelCard title="Maritime Operations Map" tag="primary view" className="scene-panel executive-map-panel" onFocus={() => setFocusPanel("scene")}> 
          <ShipScene vessels={dashboardData.vessels} portEvents={dashboardData.portEvents} />
        </PanelCard>

        <div className="right-stack">
          <PanelCard title={portPanelTitle} tag={portPanelTag} onFocus={() => setFocusPanel("ports")}>
            {portPanelContent}
          </PanelCard>
          <PanelCard title="Operational Watchlist" tag="actions" onFocus={() => setFocusPanel("watchlist")}>
            <OperationalWatchlist data={dashboardData} scenarioId={selectedScenarioId} />
          </PanelCard>
        </div>

        <PanelCard title="Vessel State Table" tag="feed" onFocus={() => setFocusPanel("vessels")}>
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
