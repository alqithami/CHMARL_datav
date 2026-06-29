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

function vesselStatus(data: DashboardData): QualityItem {
  if (data.source === "aisstream") {
    return { label: "AIS", value: "live", detail: `${data.vessels.length} current vessel rows`, tone: data.vessels.length > 0 ? "good" : "warn" };
  }
  if (data.source === "aisstream-waiting") {
    return { label: "AIS", value: "waiting", detail: "socket connected; waiting for positions in monitored boxes", tone: "warn" };
  }
  if (data.source === "upstream" || data.source === "remote") {
    return { label: "Vessels", value: "provider", detail: `${data.vessels.length} rows from backend provider`, tone: data.vessels.length > 0 ? "good" : "warn" };
  }
  if (data.source === "local-json") {
    return { label: "Vessels", value: "sample", detail: "local fixture data is enabled", tone: "warn" };
  }
  return { label: "Vessels", value: "missing", detail: "no live AIS/provider rows available", tone: "missing" };
}

function chmarlStatus(data: DashboardData): QualityItem {
  if (data.chmarlSource === "runtime") {
    return { label: "CH-MARL", value: "online inference", detail: data.chmarlExperimentId ?? "derived from active operational feeds", tone: "good" };
  }
  if (data.chmarlSource === "local-json") {
    return { label: "CH-MARL", value: "sample", detail: "demo episode is enabled", tone: "warn" };
  }
  return { label: "CH-MARL", value: "inactive", detail: "requires live AIS rows or a runtime experiment feed", tone: "missing" };
}

function portStatus(data: DashboardData): QualityItem {
  if (data.portOpsSource === "runtime") {
    return { label: "Port ops", value: "provider", detail: `${data.portEvents.length} events · ${data.portUtilization.length} utilization rows`, tone: "good" };
  }
  if (data.portOpsSource === "demo") {
    return {
      label: "Port ops",
      value: "Kpler-like demo",
      detail: `${data.portEvents.length} demo events; replace with PORT_EVENTS_URL after provider access`,
      tone: "warn",
    };
  }
  if (data.portOpsSource === "local-json") {
    return { label: "Port ops", value: "sample", detail: "local port fixture is enabled", tone: "warn" };
  }
  return { label: "Port ops", value: "required", detail: "connect PORT_EVENTS_URL for berth/queue/utilization", tone: "missing" };
}

function weatherStatus(data: DashboardData): QualityItem {
  if (data.weatherSource === "open-meteo") {
    return { label: "Weather", value: "backend Open-Meteo", detail: `${data.weatherPoints.length} marine points`, tone: data.weatherPoints.length > 0 ? "good" : "warn" };
  }
  if (data.weatherSource === "runtime") {
    return { label: "Weather", value: "provider", detail: `${data.weatherPoints.length} marine points`, tone: data.weatherPoints.length > 0 ? "good" : "warn" };
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

export default function DataQualityPanel({ data, mode, updatedAt }: DataQualityPanelProps) {
  const items = [vesselStatus(data), chmarlStatus(data), portStatus(data), weatherStatus(data), sampleStatus()];

  return (
    <section className="data-quality-panel" aria-label="Data quality and provider readiness">
      <div className="data-quality-summary">
        <span>Provider quality</span>
        <strong>{mode}</strong>
        <small>Updated {updatedAt}</small>
      </div>
      <div className="data-quality-items">
        {items.map((item) => (
          <article key={item.label} className={`data-quality-item ${item.tone}`}>
            <span>{item.label}</span>
            <strong>{item.value}</strong>
            <small>{item.detail}</small>
          </article>
        ))}
      </div>
    </section>
  );
}
