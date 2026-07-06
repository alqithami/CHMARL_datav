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
      label: "Vessel observations",
      value: `${data.vessels.length} live rows`,
      detail: `${coverage}% positioned · ${trails} trails · ${stale} stale`,
      tone: data.vessels.length > 0 && stale === 0 ? "good" : "warn",
    };
  }
  if (data.source === "aisstream-waiting") {
    return {
      label: "Vessel observations",
      value: "No regional rows",
      detail: "AIS socket is connected, but no usable position rows have arrived for the active region.",
      tone: "warn",
    };
  }
  if (data.source === "upstream" || data.source === "remote") {
    return {
      label: "Vessel observations",
      value: `${data.vessels.length} provider rows`,
      detail: `${coverage}% positioned · ${stale} stale`,
      tone: data.vessels.length > 0 ? "good" : "warn",
    };
  }
  if (data.source === "local-json") {
    return { label: "Vessel observations", value: "Sample data", detail: "local fixture vessel rows are enabled", tone: "warn" };
  }
  return { label: "Vessel observations", value: "Missing", detail: "no live AIS or provider vessel rows are available", tone: "missing" };
}

function chmarlStatus(data: DashboardData): QualityItem {
  const reward = latestReward(data);
  const latestStep = data.chmarlSteps.at(-1);
  if (data.chmarlSource === "runtime" && reward !== undefined) {
    return {
      label: "CH-MARL / EcoFair",
      value: reward.toFixed(3),
      detail: `${data.chmarlSteps.length} steps · ${latestStep?.actions?.length ?? 0} actions · ${latestStep?.constraints?.length ?? 0} constraints`,
      tone: reward < 0.45 ? "warn" : "good",
    };
  }
  if (data.chmarlSource === "runtime") {
    return {
      label: "CH-MARL / EcoFair",
      value: "Blocked",
      detail: "runtime is enabled but cannot score until vessel observations arrive",
      tone: "warn",
    };
  }
  if (data.chmarlSource === "local-json") {
    return { label: "CH-MARL / EcoFair", value: "Sample", detail: "demo episode is enabled", tone: "warn" };
  }
  return { label: "CH-MARL / EcoFair", value: "Inactive", detail: "needs vessel rows or an external runtime experiment feed", tone: "missing" };
}

function hasNonZeroPortSignal(data: DashboardData) {
  const utilization = data.portUtilization.some((row) => row.value > 0);
  const queue = data.portQueueStatus.some((row) => (row.queueLength ?? 0) > 0 || (row.waitingVessels ?? 0) > 0 || (row.utilizationPct ?? 0) > 0);
  return data.portEvents.length > 0 || utilization || queue;
}

function portStatus(data: DashboardData): QualityItem {
  if (data.portOpsSource === "runtime") {
    const nonZero = hasNonZeroPortSignal(data);
    return {
      label: "Port operations",
      value: nonZero ? "Runtime" : "Zero signal",
      detail: `${data.portEvents.length} events · ${data.portQueueStatus.length} queue rows · ${data.portUtilization.length} utilization rows`,
      tone: nonZero ? "good" : "warn",
    };
  }
  if (data.portOpsSource === "demo") {
    return { label: "Port operations", value: "Demo", detail: `${data.portEvents.length} events · ${data.portQueueStatus.length} queue rows; connect PORT_EVENTS_URL`, tone: "warn" };
  }
  if (data.portOpsSource === "local-json") {
    return { label: "Port operations", value: "Sample", detail: "local port fixture is enabled", tone: "warn" };
  }
  return { label: "Port operations", value: "Required", detail: "connect berth, queue, and utilization provider data", tone: "missing" };
}

function weatherStatus(data: DashboardData): QualityItem {
  const coverage = weatherCoverage(data);
  if (data.weatherSource === "open-meteo") {
    return { label: "Marine weather", value: `${data.weatherPoints.length} points`, detail: `${coverage.marine} marine · ${coverage.fallback} fallback · Open-Meteo`, tone: data.weatherPoints.length > 0 ? "good" : "warn" };
  }
  if (data.weatherSource === "runtime") {
    return { label: "Marine weather", value: `${data.weatherPoints.length} points`, detail: `${coverage.marine} marine from runtime provider`, tone: data.weatherPoints.length > 0 ? "good" : "warn" };
  }
  return { label: "Marine weather", value: "Missing", detail: "backend weather feed unavailable", tone: "missing" };
}

function sampleStatus(): QualityItem {
  const enabled = sampleDataEnabled || sampleChmarlEnabled;
  return {
    label: "Fixture data",
    value: enabled ? "Enabled" : "Off",
    detail: enabled ? "fixture data may appear in the UI" : "production mode; no bundled fixtures",
    tone: enabled ? "warn" : "info",
  };
}

function readinessHeadline(data: DashboardData) {
  const reward = latestReward(data);
  if (data.source === "aisstream-waiting") return "AIS connected · no regional observations";
  if (data.source === "aisstream" && reward !== undefined) return "Live CH-MARL scoring active";
  if (data.source === "aisstream") return "Live vessel rows · CH-MARL warming";
  if (data.source === "upstream" || data.source === "remote") return "Provider vessel feed active";
  if (data.source === "local-json") return "Sample-data validation mode";
  return "No live vessel observations";
}

function summaryText(items: QualityItem[], mode: string, updatedAt: string) {
  const ready = items.filter((item) => item.tone === "good" || item.tone === "info").length;
  const watch = items.filter((item) => item.tone === "warn").length;
  const missing = items.filter((item) => item.tone === "missing").length;
  return `${ready} ready · ${watch} blocked/watch · ${missing} missing · mode ${mode} · refreshed ${updatedAt}`;
}

export default function DataQualityPanel({ data, mode, updatedAt }: DataQualityPanelProps) {
  const items = [vesselStatus(data), chmarlStatus(data), portStatus(data), weatherStatus(data), sampleStatus()];

  return (
    <section className="data-quality-panel provider-quality-matrix" aria-label="Live data input readiness">
      <div className="data-quality-summary">
        <span>Live input readiness</span>
        <strong>{readinessHeadline(data)}</strong>
        <small>{summaryText(items, mode, updatedAt)}</small>
      </div>
      <div className="data-quality-items">
        {items.map((item) => (
          <article key={item.label} className={`data-quality-item ${item.tone}`} title={item.detail}>
            <span>{item.label}</span>
            <strong>{item.value}</strong>
            <small>{item.detail}</small>
          </article>
        ))}
      </div>
    </section>
  );
}
