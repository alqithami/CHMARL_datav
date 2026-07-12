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

function trackingStatus(data: DashboardData): QualityItem {
  const coverage = coordinateCoverage(data);
  const stale = staleRows(data);
  const trails = data.vessels.filter((vessel) => vessel.trail && vessel.trail.length > 1).length;
  const trackingRows = data.vesselScope?.trackingRows ?? data.vessels.length;
  const reportedRows = data.vesselScope?.reportedRows ?? trackingRows;
  const freshRows = data.vesselScope?.freshRows ?? trackingRows;
  const heldRows = data.vesselScope?.heldRows ?? 0;
  const operationalRows = data.vesselScope?.operationalRows ?? 0;
  const radius = data.vesselScope?.operationalRadiusNm ?? 120;
  const continuity = heldRows > 0 ? `${heldRows} held through temporary API gaps` : "no rows currently held";

  if (data.source === "aisstream") {
    return {
      label: "Vessel tracking",
      value: `${trackingRows} retained rows`,
      detail: `${reportedRows} current API · ${freshRows} refreshed · ${continuity} · ${operationalRows} within ${radius} nm port scope · ${coverage}% positioned · ${trails} trails · ${stale} stale`,
      tone: trackingRows > 0 && stale < trackingRows ? "good" : "warn",
    };
  }
  if (data.source === "aisstream-waiting") {
    return {
      label: "Vessel tracking",
      value: trackingRows > 0 ? `${trackingRows} retained rows` : "Waiting for AIS",
      detail: trackingRows > 0
        ? `The latest API snapshot is empty, so ${trackingRows} recent vessel rows remain visible during the retention window.`
        : "The backend websocket remains connected independently of the browser and is waiting for usable position messages.",
      tone: "warn",
    };
  }
  if (data.source === "upstream" || data.source === "remote") {
    return {
      label: "Vessel tracking",
      value: `${trackingRows} retained rows`,
      detail: `${reportedRows} current provider · ${continuity} · ${operationalRows} in port calculation scope · ${coverage}% positioned · ${stale} stale`,
      tone: trackingRows > 0 ? "good" : "warn",
    };
  }
  if (data.source === "local-json") {
    return { label: "Vessel tracking", value: "Sample data", detail: "local fixture vessel rows are enabled", tone: "warn" };
  }
  return { label: "Vessel tracking", value: "Missing", detail: "no AIS, upstream, or fixed vessel rows are available", tone: "missing" };
}

function chmarlStatus(data: DashboardData): QualityItem {
  const reward = latestReward(data);
  const latestStep = data.chmarlSteps.at(-1);
  const operationalRows = data.vesselScope?.operationalRows ?? 0;
  const radius = data.vesselScope?.operationalRadiusNm ?? 120;
  if (data.chmarlSource === "runtime" && reward !== undefined) {
    return {
      label: "EcoFair-CH-MARL",
      value: reward.toFixed(3),
      detail: `${operationalRows} port-scope vessels · ${data.chmarlSteps.length} steps · ${latestStep?.actions?.length ?? 0} actions · ${latestStep?.constraints?.length ?? 0} constraints`,
      tone: reward < 0.45 ? "warn" : "good",
    };
  }
  if (data.chmarlSource === "runtime") {
    return {
      label: "EcoFair-CH-MARL",
      value: "Waiting for port scope",
      detail: `runtime is active but needs vessels within ${radius} nm of monitored ports before scoring`,
      tone: "warn",
    };
  }
  if (data.chmarlSource === "local-json") {
    return { label: "EcoFair-CH-MARL", value: "Sample", detail: "demo episode is enabled", tone: "warn" };
  }
  return { label: "EcoFair-CH-MARL", value: "Inactive", detail: "needs port-scope vessel rows or an external experiment feed", tone: "missing" };
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
      value: nonZero ? "Operational signal" : "No active pressure",
      detail: `${data.portEvents.length} events · ${data.portQueueStatus.length} queue rows · ${data.portUtilization.length} utilization rows`,
      tone: nonZero ? "good" : "info",
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
    detail: enabled ? "fixture data may appear in the UI" : "production mode; no bundled UI fixtures",
    tone: enabled ? "warn" : "info",
  };
}

function readinessHeadline(data: DashboardData) {
  const tracking = data.vesselScope?.trackingRows ?? data.vessels.length;
  const reported = data.vesselScope?.reportedRows ?? tracking;
  const held = data.vesselScope?.heldRows ?? 0;
  const operational = data.vesselScope?.operationalRows ?? 0;
  const continuity = held > 0 ? ` · ${held} retained between updates` : "";
  if (data.source === "aisstream-waiting") return tracking > 0 ? `${tracking} recent vessels retained while AIS waits` : "Continuous AIS connection · waiting for positions";
  if (data.source === "aisstream" && operational > 0) return `${tracking} stable display · ${reported} current API · ${operational} port calculations${continuity}`;
  if (data.source === "aisstream") return `${tracking} stable display · ${reported} current API · waiting for monitored-port vessels${continuity}`;
  if (data.source === "upstream" || data.source === "remote") return `${tracking} stable display · ${reported} current provider · ${operational} port calculations${continuity}`;
  if (data.source === "local-json") return "Sample-data validation mode";
  return "No live vessel observations";
}

function summaryText(items: QualityItem[], updatedAt: string) {
  const ready = items.filter((item) => item.tone === "good" || item.tone === "info").length;
  const watch = items.filter((item) => item.tone === "warn").length;
  const missing = items.filter((item) => item.tone === "missing").length;
  return `${ready} ready · ${watch} watch · ${missing} missing · refreshed ${updatedAt}`;
}

export default function DataQualityPanel({ data, updatedAt }: DataQualityPanelProps) {
  const items = [trackingStatus(data), chmarlStatus(data), portStatus(data), weatherStatus(data), sampleStatus()];
  return (
    <section className="data-quality-panel provider-quality-matrix" aria-label="Live data input readiness">
      <div className="data-quality-summary">
        <span>Live input readiness</span>
        <strong>{readinessHeadline(data)}</strong>
        <small>{summaryText(items, updatedAt)}</small>
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
