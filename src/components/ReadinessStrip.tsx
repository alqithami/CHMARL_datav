import type { DashboardData } from "@/data/loadSampleDashboardData";

export type ReadinessStripProps = {
  data: DashboardData;
  providerLabel: string;
  updatedAt: string;
};

type ReadinessTone = "good" | "warning" | "critical" | "missing" | "info";

type ReadinessItem = {
  id: string;
  label: string;
  value: string;
  detail: string;
  tone: ReadinessTone;
  icon: "input" | "ais" | "chmarl" | "port";
};

function staleRows(data: DashboardData) {
  return data.vessels.filter((vessel) => {
    const timestamp = Date.parse(String(vessel.timestamp ?? ""));
    return Number.isFinite(timestamp) && Date.now() - timestamp > 30 * 60 * 1_000;
  }).length;
}

function hasPortSignal(data: DashboardData) {
  return data.portEvents.length > 0
    || data.portQueueStatus.some((row) => (row.queueLength ?? 0) > 0 || (row.waitingVessels ?? 0) > 0 || (row.utilizationPct ?? 0) > 0)
    || data.portUtilization.some((row) => row.value > 0);
}

function Icon({ type }: { type: ReadinessItem["icon"] }) {
  if (type === "input") return (
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9a11 11 0 0 1 16 0" /><path d="M7 12a7 7 0 0 1 10 0" /><path d="M10 15a3 3 0 0 1 4 0" /><circle cx="12" cy="19" r="1" /></svg>
  );
  if (type === "ais") return (
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v16" /><path d="m9 20 3-5 3 5" /><path d="M7.5 8.5a6 6 0 0 0 0 7" /><path d="M16.5 8.5a6 6 0 0 1 0 7" /><path d="M4.5 6a10 10 0 0 0 0 12" /><path d="M19.5 6a10 10 0 0 1 0 12" /></svg>
  );
  if (type === "chmarl") return (
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 20 6v6c0 5-3.2 8-8 9-4.8-1-8-4-8-9V6l8-3Z" /><path d="m8.5 12 2.2 2.2 4.8-5" /></svg>
  );
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h16" /><path d="M6 20V9h5v11" /><path d="M11 20V5h3v15" /><path d="M14 8h4v12" /><path d="m14 5 5 3" /><path d="M8 13h1M8 16h1M16 12h1M16 15h1" /></svg>
  );
}

export default function ReadinessStrip({ data, providerLabel, updatedAt }: ReadinessStripProps) {
  const tracking = data.vesselScope?.trackingRows ?? data.vessels.length;
  const knownVessels = data.registry?.knownVessels ?? tracking;
  const reported = data.vesselScope?.reportedRows ?? tracking;
  const fresh = data.vesselScope?.freshRows ?? tracking;
  const operational = data.vesselScope?.operationalRows ?? 0;
  const radius = data.vesselScope?.operationalRadiusNm ?? 120;
  const stale = staleRows(data);
  const reward = data.rewardTrend.at(-1)?.[1];
  const portSignal = hasPortSignal(data);
  const positioned = data.vessels.filter((vessel) => Number.isFinite(vessel.latitude) && Number.isFinite(vessel.longitude)).length;
  const positionedPct = tracking === 0 ? 0 : Math.round((positioned / tracking) * 100);

  const items: ReadinessItem[] = [
    {
      id: "input",
      label: "Live input readiness",
      value: knownVessels > 0 ? `${knownVessels.toLocaleString()} known · ${tracking.toLocaleString()} current` : "No vessel records",
      detail: `${providerLabel} · ${fresh.toLocaleString()} fresh · ${positionedPct}% positioned · ${data.registry?.lastKnown?.toLocaleString() ?? 0} last known · refreshed ${updatedAt}`,
      tone: tracking > 0 && stale === 0 ? "good" : tracking > 0 ? "warning" : "missing",
      icon: "input",
    },
    {
      id: "tracking",
      label: "Vessel tracking / AIS",
      value: data.source === "aisstream-waiting" ? "Provider connected but silent" : tracking > 0 ? "Tracking active" : "Tracking unavailable",
      detail: `${reported.toLocaleString()} current API · ${stale.toLocaleString()} last-known · ${operational.toLocaleString()} within ${radius} NM`,
      tone: data.source === "aisstream-waiting" ? "warning" : tracking > 0 ? "good" : "missing",
      icon: "ais",
    },
    {
      id: "chmarl",
      label: "EcoFair-CH-MARL",
      value: reward === undefined ? operational > 0 ? "Waiting for online state" : "Inactive" : reward.toFixed(3),
      detail: `${operational.toLocaleString()} port-scope vessels · ${data.chmarlSteps.length} steps · ${data.chmarlSteps.at(-1)?.constraints?.length ?? 0} constraints`,
      tone: reward === undefined ? operational > 0 ? "warning" : "missing" : reward < 0 ? "warning" : "good",
      icon: "chmarl",
    },
    {
      id: "ports",
      label: "Port operations",
      value: data.portOpsSource === "none" ? "Provider required" : portSignal ? "Operational activity" : "No active pressure",
      detail: `${data.portEvents.length} events · ${data.portQueueStatus.length} queue rows · ${data.portUtilization.length} utilization rows`,
      tone: data.portOpsSource === "none" ? "missing" : portSignal ? "good" : "info",
      icon: "port",
    },
  ];

  return (
    <section className="portal-readiness-strip" aria-label="Live system readiness">
      {items.map((item) => (
        <article key={item.id} className={`portal-readiness-card ${item.tone}`}>
          <span className="portal-readiness-icon"><Icon type={item.icon} /></span>
          <div><span>{item.label}</span><strong>{item.value}</strong><small>{item.detail}</small></div>
          <i className="portal-readiness-state" aria-hidden="true" />
        </article>
      ))}
    </section>
  );
}
