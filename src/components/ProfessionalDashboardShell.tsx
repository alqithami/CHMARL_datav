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

type FocusContent = {
  panel: ProfessionalFocusPanel;
  title: string;
  description: string;
  content: ReactNode;
};

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

function FocusModal({
  panel,
  title,
  description,
  children,
  onClose,
}: {
  panel: ProfessionalFocusPanel;
  title: string;
  description: string;
  children: ReactNode;
  onClose: () => void;
}) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  return (
    <div
      className={`focus-backdrop portal-focus-backdrop focus-${panel}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby={`focus-title-${panel}`}
      aria-describedby={`focus-description-${panel}`}
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}>
      <section className={`focus-panel portal-focus-panel portal-focus-${panel}`} data-focus-panel={panel}>
        <header className="focus-header portal-focus-header">
          <div>
            <span>Operational detail</span>
            <h2 id={`focus-title-${panel}`}>{title}</h2>
            <p id={`focus-description-${panel}`}>{description}</p>
          </div>
          <button type="button" onClick={onClose}><span aria-hidden="true">×</span> Close</button>
        </header>
        <div className="focus-content portal-focus-content">{children}</div>
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

  const focusContent = useMemo<FocusContent | null>(() => {
    if (focusPanel === "reward") return { panel: focusPanel, title: "CH-MARL Reward Trend", description: "Online reward trajectory and recent score behavior. Missing values remain explicit when no valid model state exists.", content: <RewardTrend data={data.rewardTrend} /> };
    if (focusPanel === "speed") return { panel: focusPanel, title: "Vessel Speed Profile", description: "Distribution of reported AIS speed over ground across the current tracked cohort.", content: <VesselSpeedProfile vessels={data.vessels} /> };
    if (focusPanel === "constraints") return { panel: focusPanel, title: "Operational Constraint Pressure", description: "Current pressure signals for capacity, safety, fuel, ETA, emissions, and fairness constraints.", content: <ConstraintChart data={data.constraintPressure} /> };
    if (focusPanel === "scene") return { panel: focusPanel, title: "Maritime Operations Map", description: "Expanded interactive map with vessel search, port zones, events, trails, and seamarks.", content: <ShipScene vessels={data.vessels} portEvents={data.portEvents} expanded /> };
    if (focusPanel === "ports") return { panel: focusPanel, title: portPanelTitle, description: "Connected port queue, berth utilization, and provider-readiness information.", content: portPanelContent };
    if (focusPanel === "watchlist") return { panel: focusPanel, title: "Operational Watchlist", description: "Prioritized exceptions, provider conditions, and recommended operator actions.", content: <OperationalWatchlist data={data} scenarioId={selectedScenarioId} /> };
    if (focusPanel === "vessels") return { panel: focusPanel, title: "Vessel State Table", description: "Searchable and sortable vessel state with provenance, position, speed, route, and freshness context.", content: <VesselTable vessels={data.vessels} /> };
    if (focusPanel === "chmarl-components") return { panel: focusPanel, title: "CH-MARL Reward Components", description: "Component-level contribution to the latest available EcoFair-CH-MARL reward state.", content: <ChmarlRewardComponents steps={data.chmarlSteps} /> };
    if (focusPanel === "chmarl-actions") return { panel: focusPanel, title: "CH-MARL Agent Action Plan", description: "Latest hierarchical actions and affected operational targets.", content: <ChmarlActionPlan steps={data.chmarlSteps} /> };
    if (focusPanel === "chmarl-fairness") return { panel: focusPanel, title: "CH-MARL Fairness Metrics", description: "Available fuel-equity and service-fairness measures across the operational scope.", content: <ChmarlFairnessPanel steps={data.chmarlSteps} /> };
    if (focusPanel === "chmarl-constraints") return { panel: focusPanel, title: "CH-MARL Constraint Shield", description: "Constraint values, limits, satisfaction state, and severity for the latest model step.", content: <ChmarlConstraintLedger steps={data.chmarlSteps} /> };
    if (focusPanel === "chmarl-decisions") return { panel: focusPanel, title: "CH-MARL Decision Trace", description: "Chronological hierarchical decisions and their recorded rationale.", content: <ChmarlDecisionTimeline steps={data.chmarlSteps} limit={24} /> };
    if (focusPanel === "weather") return { panel: focusPanel, title: "Marine Weather Coverage", description: "Available marine and fallback weather observations across monitored locations.", content: <MarineWeatherOverview points={data.weatherPoints} /> };
    if (focusPanel === "weather-risk") return { panel: focusPanel, title: "Weather Risk Matrix", description: "Weather observations classified by wave, wind, and sea-state risk thresholds.", content: <WeatherRiskMatrix points={data.weatherPoints} /> };
    if (focusPanel === "fleet") return { panel: focusPanel, title: "Fleet Operational Summary", description: "Fleet state, movement, position, trail, and freshness summary for the current AIS cohort.", content: <FleetOperationalSummary vessels={data.vessels} /> };
    if (focusPanel === "vessel-risk") return { panel: focusPanel, title: "Vessel Risk Register", description: "Tracked vessel exceptions, missing state, freshness, and constraint indicators.", content: <VesselRiskRegister vessels={data.vessels} /> };
    if (focusPanel === "port-events") return { panel: focusPanel, title: "Port Event Feed", description: "Filterable operational event feed for arrivals, anchorage, berth, service, and departure activity.", content: <PortEventFeed events={data.portEvents} source={data.portOpsSource} /> };
    if (focusPanel === "port-queue") return { panel: focusPanel, title: "Port Queue / Berth Board", description: "Queue length, waiting vessels, berth utilization, and pressure state by connected port row.", content: <PortQueueBoard rows={data.portQueueStatus} source={data.portOpsSource} /> };
    if (focusPanel === "port-coverage") return { panel: focusPanel, title: "Eight-Port AIS Coverage", description: "Current vessel coverage within the configured operational radius of the eight monitored ports.", content: <PortCoverageMatrix vessels={data.vessels} /> };
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

      {focusContent && (
        <FocusModal
          panel={focusContent.panel}
          title={focusContent.title}
          description={focusContent.description}
          onClose={() => setFocusPanel(null)}>
          {focusContent.content}
        </FocusModal>
      )}
    </main>
  );
}
