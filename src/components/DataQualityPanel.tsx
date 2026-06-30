import type { DashboardData } from "@/data/loadSampleDashboardData";

export type DataQualityPanelProps = {
  data: DashboardData;
  mode: string;
  updatedAt: string;
};

type QualityTone = "good" | "warn" | "missing" | "info";

type QualityItem = {
  label: string;
  value: string;
  detail: string;
  tone: QualityTone;
};

const sampleDataEnabled = import.meta.env.VITE_ALLOW_SAMPLE_DATA === "true";
const sampleChmarlEnabled = import.meta.env.VITE_ALLOW_SAMPLE_CHMARL === "true";

function staleRows(data: DashboardData) {
  return data.vessels.filter((vessel) => {
    if (!vessel.timestamp) return false;
    const timestamp = Date.parse(vessel.timestamp);
    return Number.isFinite(timestamp) && Date.now() - timestamp > 30 * 60 * 1000;
  }).length;
}

function coordinateCoverage(data: DashboardData) {
  if (data.vessels.length === 0) return 0;
  const positioned = data.vessels.filter((vessel) => Number.isFinite(vessel.latitude) && Number.isFinite(vessel.longitude)).length;
  return Math.round((positioned / data.vessels.length) * 100);
}

function latestReward(data: DashboardData) {
  return data.rewardTrend.at(-1)?.[1];
}

function weatherCoverage(data: DashboardData) {
  const marine = data.weatherPoints.filter((point) => point.waveHeightM !== undefined).length;
  const fallback = data.weatherPoints.filter((point) => point.windSpeedMs !== undefined || point.airTemperatureC !== undefined).length;
  return { marine, fallback };
}

function vesselStatus(data: DashboardData): QualityItem {
  const coverage = coordinateCoverage(data);
  const stale = staleRows(data);
  const trails = data.vessels.filter((vessel) => vessel.trail && vessel.trail.length > 1).length;

  if (data.source === "aisstream") {
    return {
      label: "AIS",
      value: "live",
      detail: `${data.vessels.length} rows · ${coverage}% positioned · ${trails} trails · ${stale} stale`,
      tone: data.vessels.length > 0 && stale === 0 ? "good" : data.vessels.length > 0 ? "warn" : "missing",
    };
  }
  if (data.source === "aisstream-waiting") {
    return { label: "AIS", value: "waiting", detail: "socket connected; waiting for positions in monitored boxes", tone: "warn" };
  }
  if (data.source === "upstream" || data.source === "remote") {
    return { label: "Vessels", value: "provider", detail: `${data.vessels.length} rows · ${coverage}% positioned`, tone: data.vessels.length > 0 ? "good" : "warn" };
  }
  if (data.source === "local-json") {
    return { label: "Vessels", value: "sample", detail: "local fixture data is enabled", tone: "warn" };
  }
  return { label: "Vessels", value: "missing", detail: "no live AIS/provider rows available", tone: "missing" };
}

function chmarlStatus(data: DashboardData): QualityItem {
  const reward = latestReward(data);
  const latestStep = data.chmarlSteps.at(-1);
  if (data.chmarlSource === "runtime") {
    return {
      label: "CH-MARL",
      value: reward === undefined ? "online" : reward.toFixed(3),
      detail: `${data.chmarlSteps.length} steps · ${latestStep?.actions?.length ?? 0} actions · ${latestStep?.constraints?.length ?? 0} constraints`,
      tone: reward !== undefined && reward < 0.45 ? "warn" : "good",
    };
  }
  if (data.chmarlSource === "local-json") {
    return { label: "CH-MARL", value: "sample", detail: "demo episode is enabled", tone: "warn" };
  }
  return { label: "CH-MARL", value: "inactive", detail: "requires live AIS rows or a runtime experiment feed", tone: "missing" };
}

function portStatus(data: DashboardData): QualityItem {
  if (data.portOpsSource === "runtime") {
    return { label: "Port ops", value: "provider", detail: `${data.portEvents.length} events · ${data.portQueueStatus.length} queue rows · ${data.portUtilization.length} utilization`, tone: "good" };
  }
  if (data.portOpsSource === "demo") {
    return {
      label: "Port ops",
      value: "demo",
      detail: `${data.portEvents.length} events · ${data.portQueueStatus.length} queue rows; replace with PORT_EVENTS_URL`,
      tone: "warn",
    };
  }
  if (data.portOpsSource === "local-json") {
    return { label: "Port ops", value: "sample", detail: "local port fixture is enabled", tone: "warn" };
  }
  return { label: "Port ops", value: "required", detail: "connect PORT_EVENTS_URL for berth/queue/utilization", tone: "missing" };
}

function weatherStatus(data: DashboardData): QualityItem {
  const coverage = weatherCoverage(data);
  if (data.weatherSource === "open-meteo") {
    return {
      label: "Weather",
      value: "Open-Meteo",
      detail: `${data.weatherPoints.length} points · ${coverage.marine} marine · ${coverage.fallback} fallback`,
      tone: data.weatherPoints.length > 0 ? "good" : "warn",
    };
  }
  if (data.weatherSource === "runtime") {
    return { label: "Weather", value: "provider", detail: `${data.weatherPoints.length} points · ${coverage.marine} marine`, tone: data.weatherPoints.length > 0 ? "good" : "warn" };
  }
  return { label: "Weather", value: "missing", detail: "backend weather feed unavailable", tone: "missing" };
}

function sampleStatus(): QualityItem {
  const enabled = sampleDataEnabled || sampleChmarlEnabled;
  return {
    label: "Samples",
    value: enabled ? "enabled" : "disabled",
    detail: enabled ? "fixture data may appear in the UI" : "production mode: no bundled fixtures",
    tone: enabled ? "warn" : "info",
  };
}

function overallTone(items: QualityItem[]): QualityTone {
  if (items.some((item) => item.tone === "missing")) return "missing";
  if (items.some((item) => item.tone === "warn")) return "warn";
  return "good";
}

function summaryText(items: QualityItem[]) {
  const ready = items.filter((item) => item.tone === "good" || item.tone === "info").length;
  const warning = items.filter((item) => item.tone === "warn").length;
  const missing = items.filter((item) => item.tone === "missing").length;
  return `${ready} ready · ${warning} watch · ${missing} missing`;
}

export default function DataQualityPanel({ data, mode, updatedAt }: DataQualityPanelProps) {
  const items = [vesselStatus(data), chmarlStatus(data), portStatus(data), weatherStatus(data), sampleStatus()];
  const tone = overallTone(items);

  return (
    <details className={`data-quality-panel compact-provider-panel ${tone}`} aria-label="Data quality and provider readiness">
      <summary className="data-quality-summary">
        <span>Provider quality</span>
        <strong>{mode}</strong>
        <small>{summaryText(items)} · updated {updatedAt}</small>
      </summary>
      <div className="data-quality-items">
        {items.map((item) => (
          <article key={item.label} className={`data-quality-item ${item.tone}`}>
            <span>{item.label}</span>
            <strong>{item.value}</strong>
            <small>{item.detail}</small>
          </article>
        ))}
      </div>
    </details>
  );
}
