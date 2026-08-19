import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { RewardTrendPoint, Vessel } from "@/data/chmarlData";
import { fallbackDashboardData, loadSampleDashboardData, type DashboardData, type DashboardDataSource } from "@/data/loadSampleDashboardData";
import { exportDashboardSnapshot, exportEcoFairServerReport, exportOperationalReport, exportVesselCsv } from "@/export/dashboardExports";
import AnalysisRail, { type AnalysisRailFocus } from "./AnalysisRail";
import CommandWorkspace, { type CommandWorkspaceFocus } from "./CommandWorkspace";
import ConstraintChart from "./charts/ConstraintChart";
import PortUtilizationChart from "./charts/PortUtilizationChart";
import RewardTrend from "./charts/RewardTrend";
import VesselSpeedProfile from "./charts/VesselSpeedProfile";
import ChmarlActionPlan from "./insights/ChmarlActionPlan";
import ChmarlConstraintLedger from "./insights/ChmarlConstraintLedger";
import ChmarlDecisionTimeline from "./insights/ChmarlDecisionTimeline";
import ChmarlFairnessPanel from "./insights/ChmarlFairnessPanel";
import ChmarlRewardComponents from "./insights/ChmarlRewardComponents";
import FleetOperationalSummary from "./insights/FleetOperationalSummary";
import MarineWeatherOverview from "./insights/MarineWeatherOverview";
import PortCoverageMatrix from "./insights/PortCoverageMatrix";
import PortEventFeed from "./insights/PortEventFeed";
import PortQueueBoard from "./insights/PortQueueBoard";
import VesselRiskRegister from "./insights/VesselRiskRegister";
import WeatherRiskMatrix from "./insights/WeatherRiskMatrix";
import OperationsRail, { type OperationsRailFocus } from "./OperationsRail";
import OperationalWatchlist from "./OperationalWatchlist";
import PortalHeader from "./PortalHeader";
import PortOpsSetup from "./PortOpsSetup";
import ReadinessStrip from "./ReadinessStrip";
import ShipScene from "./ShipScene";
import VesselTable from "./VesselTable";

export type ProfessionalFocusPanel =
  | "reward"
  | "constraints"
  | "speed"
  | "scene"
  | "ports"
  | "watchlist"
  | "vessels"
  | "chmarl-components"
  | "chmarl-constraints"
  | "chmarl-decisions"
  | "chmarl-actions"
  | "chmarl-fairness"
  | "weather"
  | "weather-risk"
  | "fleet"
  | "vessel-risk"
  | "port-events"
  | "port-queue"
  | "port-coverage";

type LoadStatus = "loading" | "refreshing" | DashboardDataSource;

const allowScenarioSimulation = import.meta.env.VITE_ALLOW_SAMPLE_DATA === "true";

function isExternalSource(source: DashboardDataSource) {
  return source === "aisstream"
    || source === "datalastic"
    || source === "pocketworld"
    || source === "pocketworld-last-known"
    || source === "ais-multi-provider"
    || source === "aisstream-waiting"
    || source === "upstream"
    || source === "remote";
}

function sourceLabel(source: DashboardDataSource) {
  if (source === "aisstream") return "AISStream live AIS";
  if (source === "datalastic") return "Datalastic live AIS";
  if (source === "pocketworld") return "Public regional live AIS";
  if (source === "pocketworld-last-known") return "Public regional AIS · last known";
  if (source === "ais-multi-provider") return "Multi-provider live AIS";
  if (source === "aisstream-waiting") return "AIS waiting";
  if (source === "upstream") return "Upstream API";
  if (source === "remote") return "Remote proxy";
  if (source === "local-json") return "Local fixtures";
  if (source === "none") return "No vessel feed";
  return "Backend unavailable";
}

function statusLabel(status: LoadStatus) {
  if (status === "loading") return "Loading inputs";
  if (status === "refreshing") return "Refreshing inputs";
  return sourceLabel(status);
}

function sourceRefreshMs(source: DashboardDataSource) {
  return isExternalSource(source) ? 5_000 : source === "local-json" ? 30_000 : 15_000;
}

function shiftRewardTrend(data: RewardTrendPoint[], offset: number, slope: number): RewardTrendPoint[] {
  return data.map(([time, value], index) => [time, Number((value + offset + index * slope).toFixed(3))]);
}

function scenarioVessels(vessels: Vessel[], scenarioId: string) {
  if (scenarioId === "congestion") return vessels.map((vessel, index) => ({ ...vessel, status: index < 2 ? ("Watch" as const) : vessel.status }));
  if (scenarioId === "disruption") return vessels.map((vessel, index) => ({ ...vessel, status: index === 2 ? ("Constrained" as const) : vessel.status }));
  if (scenarioId === "emissions-aware") return vessels.map((vessel) => ({ ...vessel, speed: "11.0 kn" }));
  return vessels;
}

function scenarioData(base: DashboardData, scenarioId: string): DashboardData {
  if (!allowScenarioSimulation || scenarioId === "baseline" || isExternalSource(base.source)) return base;
  if (scenarioId === "congestion") return {
    ...base,
    vessels: scenarioVessels(base.vessels, scenarioId),
    rewardTrend: shiftRewardTrend(base.rewardTrend, -0.04, 0.002),
    constraintPressure: base.constraintPressure.map((item) => ({ ...item, value: Math.min(100, item.value + 18) })),
  };
  if (scenarioId === "disruption") return {
    ...base,
    vessels: scenarioVessels(base.vessels, scenarioId),
    rewardTrend: shiftRewardTrend(base.rewardTrend, -0.04, -0.006),
    constraintPressure: base.constraintPressure.map((item) => ({ ...item, value: item.name === "Channel safety" ? 93 : Math.min(100, item.value + 7) })),
  };
  if (scenarioId === "emissions-aware") return {
    ...base,
    vessels: scenarioVessels(base.vessels, scenarioId),
    rewardTrend: shiftRewardTrend(base.rewardTrend, -0.02, 0.004),
    constraintPressure: base.constraintPressure.map((item) => ({ ...item, value: item.name === "Emissions cap" ? 35 : Math.max(30, item.value - 8) })),
  };
  if (scenarioId === "fairness-aware") return {
    ...base,
    rewardTrend: shiftRewardTrend(base.rewardTrend, -0.03, 0.003),
    constraintPressure: [...base.constraintPressure.slice(0, 4), { name: "Fairness gap", value: 31 }],
  };
  return base;
}

function FocusModal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="focus-backdrop" role="dialog" aria-modal="true" aria-label={title}>
      <section className="focus-panel portal-focus-panel">
        <header className="focus-header"><h2>{title}</h2><button type="button" onClick={onClose}>Close</button></header>
        <div className="focus-content">{children}</div>
      </section>
    </div>
  );
}

export default function ProfessionalDashboardShell() {
  const [selectedScenarioId, setSelectedScenarioId] = useState("baseline");
  const [baseData, setBaseData] = useState<DashboardData>(fallbackDashboardData);
  const [dataSourceStatus, setDataSourceStatus] = useState<LoadStatus>("loading");
  const [lastUpdated, setLastUpdated] = useState("not loaded");
  const [focusPanel, setFocusPanel] = useState<ProfessionalFocusPanel | null>(null);
  const [selectedVesselId, setSelectedVesselId] = useState("");
  const refreshInFlight = useRef(false);
  const refreshIntervalMs = sourceRefreshMs(baseData.source);

  const refreshData = useCallback((status: LoadStatus = "refreshing") => {
    if (refreshInFlight.current) return Promise.resolve();
    refreshInFlight.current = true;
    setDataSourceStatus(status);
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
    refreshData("loading");
    const interval = window.setInterval(() => refreshData("refreshing"), refreshIntervalMs);
    return () => window.clearInterval(interval);
  }, [refreshData, refreshIntervalMs]);

  const data = useMemo(() => scenarioData(baseData, selectedScenarioId), [baseData, selectedScenarioId]);
  const providerLabel = statusLabel(dataSourceStatus);
  const trackingRows = data.vesselScope?.trackingRows ?? data.vessels.length;
  const operationalRows = data.vesselScope?.operationalRows ?? 0;
  const portOpsActive = data.portOpsSource === "runtime" || data.portOpsSource === "demo";
  const portPanelTitle = portOpsActive ? "Port Queue / Berth Utilization" : "Port Operations Setup";
  const portPanelContent = portOpsActive ? <PortUtilizationChart data={data.portUtilization} /> : <PortOpsSetup />;

  useEffect(() => {
    if (selectedVesselId && !data.vessels.some((vessel) => vessel.id === selectedVesselId)) setSelectedVesselId("");
  }, [data.vessels, selectedVesselId]);

  const focusContent = useMemo(() => {
    if (focusPanel === "reward") return { title: "CH-MARL Reward Trend", content: <RewardTrend data={data.rewardTrend} /> };
    if (focusPanel === "speed") return { title: "Vessel Speed Profile", content: <VesselSpeedProfile vessels={data.vessels} /> };
    if (focusPanel === "constraints") return { title: "Operational Constraint Pressure", content: <ConstraintChart data={data.constraintPressure} /> };
    if (focusPanel === "scene") return { title: "Maritime Operations Map", content: <ShipScene vessels={data.vessels} portEvents={data.portEvents} expanded /> };
    if (focusPanel === "ports") return { title: portPanelTitle, content: portPanelContent };
    if (focusPanel === "watchlist") return { title: "Operational Watchlist", content: <OperationalWatchlist data={data} scenarioId={selectedScenarioId} /> };
    if (focusPanel === "vessels") return { title: "Vessel State Table", content: <VesselTable vessels={data.vessels} /> };
    if (focusPanel === "chmarl-components") return { title: "CH-MARL Reward Components", content: <ChmarlRewardComponents steps={data.chmarlSteps} /> };
    if (focusPanel === "chmarl-actions") return { title: "CH-MARL Agent Action Plan", content: <ChmarlActionPlan steps={data.chmarlSteps} /> };
    if (focusPanel === "chmarl-fairness") return { title: "CH-MARL Fairness Metrics", content: <ChmarlFairnessPanel steps={data.chmarlSteps} /> };
    if (focusPanel === "chmarl-constraints") return { title: "CH-MARL Constraint Shield", content: <ChmarlConstraintLedger steps={data.chmarlSteps} /> };
    if (focusPanel === "chmarl-decisions") return { title: "CH-MARL Decision Trace", content: <ChmarlDecisionTimeline steps={data.chmarlSteps} limit={24} /> };
    if (focusPanel === "weather") return { title: "Marine Weather Coverage", content: <MarineWeatherOverview points={data.weatherPoints} /> };
    if (focusPanel === "weather-risk") return { title: "Weather Risk Matrix", content: <WeatherRiskMatrix points={data.weatherPoints} /> };
    if (focusPanel === "fleet") return { title: "Fleet Operational Summary", content: <FleetOperationalSummary vessels={data.vessels} /> };
    if (focusPanel === "vessel-risk") return { title: "Vessel Risk Register", content: <VesselRiskRegister vessels={data.vessels} /> };
    if (focusPanel === "port-events") return { title: "Port Event Feed", content: <PortEventFeed events={data.portEvents} source={data.portOpsSource} /> };
    if (focusPanel === "port-queue") return { title: "Port Queue / Berth Board", content: <PortQueueBoard rows={data.portQueueStatus} source={data.portOpsSource} /> };
    if (focusPanel === "port-coverage") return { title: "Eight-Port AIS Coverage", content: <PortCoverageMatrix vessels={data.vessels} /> };
    return null;
  }, [data, focusPanel, portPanelContent, portPanelTitle, selectedScenarioId]);

  const openFocus = useCallback((panel: AnalysisRailFocus | OperationsRailFocus | CommandWorkspaceFocus | ProfessionalFocusPanel) => {
    setFocusPanel(panel as ProfessionalFocusPanel);
  }, []);

  const exportEcoFair = useCallback(() => {
    exportEcoFairServerReport().catch(() => {
      window.alert("EcoFair server report is unavailable. Check that the backend proxy is running and reachable at /api/report.");
    });
  }, []);

  return (
    <main className="app-shell portal-vision-shell">
      <PortalHeader
        data={data}
        providerLabel={providerLabel}
        lastUpdated={lastUpdated}
        selectedScenarioId={selectedScenarioId}
        onScenarioChange={setSelectedScenarioId}
        onRefresh={() => refreshData("refreshing")}
        onExportSnapshot={() => exportDashboardSnapshot(data, selectedScenarioId)}
        onExportVessels={() => exportVesselCsv(data, selectedScenarioId)}
        onExportOperations={() => exportOperationalReport(data, selectedScenarioId)}
        onExportEcoFair={exportEcoFair}
      />

      <ReadinessStrip data={data} providerLabel={providerLabel} updatedAt={lastUpdated} />

      <section className="portal-command-stage" aria-label="Map-first maritime command view">
        <AnalysisRail data={data} onFocus={openFocus} />

        <section className="portal-map-stage">
          <header className="portal-map-heading">
            <div><span>Maritime operations map</span><strong>{trackingRows.toLocaleString()} tracked · {operationalRows.toLocaleString()} port-scope</strong></div>
            <button type="button" onClick={() => setFocusPanel("scene")}>Expand map</button>
          </header>
          <div className="portal-map-body"><ShipScene vessels={data.vessels} portEvents={data.portEvents} /></div>
        </section>

        <OperationsRail
          data={data}
          selectedVesselId={selectedVesselId}
          onSelectVessel={setSelectedVesselId}
          onFocus={openFocus}
        />
      </section>

      <CommandWorkspace data={data} onFocus={openFocus} />

      {focusContent && <FocusModal title={focusContent.title} onClose={() => setFocusPanel(null)}>{focusContent.content}</FocusModal>}
    </main>
  );
}
