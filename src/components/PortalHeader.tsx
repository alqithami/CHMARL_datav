import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { DashboardData } from "@/data/loadSampleDashboardData";
import { scenarioCatalog } from "@/scenarios/scenarioCatalog";
import ThemeToggle from "./ThemeToggle";

export type PortalHeaderProps = {
  data: DashboardData;
  providerLabel: string;
  lastUpdated: string;
  selectedScenarioId: string;
  onScenarioChange: (scenarioId: string) => void;
  onRefresh: () => void;
  onExportSnapshot: () => void;
  onExportVessels: () => void;
  onExportOperations: () => void;
  onExportEcoFair: () => void;
};

function HeaderIcon({ children }: { children: ReactNode }) {
  return <span className="portal-header-icon" aria-hidden="true">{children}</span>;
}

function BrandMark() {
  return (
    <svg className="portal-brand-mark" viewBox="0 0 48 48" role="img" aria-label="Maritime operations mark">
      <path d="M24 5v11" />
      <path d="M18 10h12" />
      <path d="M12 20h24l-3 12H15l-3-12Z" />
      <path d="M8 34c4 0 4 3 8 3s4-3 8-3 4 3 8 3 4-3 8-3" />
      <path d="M10 40c3 0 4 2 7 2s4-2 7-2 4 2 7 2 4-2 7-2" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20 11a8 8 0 1 0-2.3 5.7" />
      <path d="M20 5v6h-6" />
    </svg>
  );
}

function ExportIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M5 20h14" />
    </svg>
  );
}

function utcClock(date: Date) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

function utcDate(date: Date) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

export default function PortalHeader({
  data,
  providerLabel,
  lastUpdated,
  selectedScenarioId,
  onScenarioChange,
  onRefresh,
  onExportSnapshot,
  onExportVessels,
  onExportOperations,
  onExportEcoFair,
}: PortalHeaderProps) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const trackingRows = data.vesselScope?.trackingRows ?? data.vessels.length;
  const dataReady = trackingRows > 0;
  const liveTone = dataReady ? "ready" : data.source === "aisstream-waiting" ? "watch" : "missing";
  const scenarioLabel = useMemo(
    () => scenarioCatalog.find((scenario) => scenario.scenarioId === selectedScenarioId)?.label ?? "Baseline",
    [selectedScenarioId],
  );

  return (
    <header className="portal-vision-header">
      <div className="portal-vision-brand">
        <BrandMark />
        <div>
          <span className="portal-vision-kicker">CH-MARL Maritime Logistics</span>
          <h1>Operational Vessel Intelligence Dashboard</h1>
          <p>AIS-informed maritime logistics and port intelligence</p>
        </div>
      </div>

      <div className="portal-live-context" aria-label="Current system time and data state">
        <span className={`portal-live-badge ${liveTone}`}><i />{dataReady ? "LIVE" : "MONITOR"}</span>
        <time dateTime={now.toISOString()}>{utcClock(now)} UTC</time>
        <span className="portal-date">{utcDate(now)}</span>
        <span className="portal-provider-summary" title={`Latest dashboard refresh: ${lastUpdated}`}>{providerLabel}</span>
      </div>

      <div className="portal-header-actions">
        <label className="portal-mode-control" title="Operational scenario mode">
          <span>Mode</span>
          <select value={selectedScenarioId} onChange={(event) => onScenarioChange(event.target.value)} aria-label="Operational scenario mode">
            {scenarioCatalog.map((scenario) => <option key={scenario.scenarioId} value={scenario.scenarioId}>{scenario.label}</option>)}
          </select>
          <small>{scenarioLabel}</small>
        </label>
        <ThemeToggle inline />
        <button type="button" className="portal-icon-button" onClick={onRefresh} title="Refresh all connected data">
          <HeaderIcon><RefreshIcon /></HeaderIcon><span>Refresh</span>
        </button>
        <details className="portal-export-menu">
          <summary>
            <HeaderIcon><ExportIcon /></HeaderIcon><span>Export</span>
          </summary>
          <div className="portal-export-menu-panel">
            <button type="button" onClick={onExportSnapshot}>Dashboard snapshot</button>
            <button type="button" onClick={onExportVessels}>Vessel CSV</button>
            <button type="button" onClick={onExportOperations}>Operational report</button>
            <button type="button" onClick={onExportEcoFair}>EcoFair live report</button>
          </div>
        </details>
      </div>
    </header>
  );
}
