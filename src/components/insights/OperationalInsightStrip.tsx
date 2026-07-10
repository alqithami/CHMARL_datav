import { useMemo, useState } from "react";
import type { DashboardData } from "@/data/loadSampleDashboardData";
import { summarizePortCoverage } from "@/utils/portCoverage";

export type InsightFocusPanel =
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

const insightModes = [
  { id: "overview", label: "Overview" },
  { id: "chmarl", label: "CH-MARL" },
  { id: "operations", label: "Operations" },
  { id: "risk", label: "Risk" },
] as const;

type InsightMode = typeof insightModes[number]["id"];
type SummaryTone = "good" | "warning" | "critical" | "info" | "missing";

type SummaryCard = {
  title: string;
  value: string;
  detail: string;
  tone: SummaryTone;
  focus: InsightFocusPanel;
};

export type OperationalInsightStripProps = {
  data: DashboardData;
  onFocus: (panel: InsightFocusPanel) => void;
};

function speedKnots(speed: string) {
  const parsed = Number.parseFloat(speed.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function movingVessels(data: DashboardData) {
  return data.vessels.filter((vessel) => (speedKnots(vessel.speed) ?? 0) > 0.5).length;
}

function queueUtilization(row: DashboardData["portQueueStatus"][number]) {
  if (typeof row.utilizationPct === "number" && Number.isFinite(row.utilizationPct)) return row.utilizationPct;
  if (typeof row.queueLength === "number" && Number.isFinite(row.queueLength)) return Math.min(100, row.queueLength * 12);
  if (typeof row.waitingVessels === "number" && Number.isFinite(row.waitingVessels)) return Math.min(100, row.waitingVessels * 10);
  return 0;
}

function queueTone(value: number): SummaryTone {
  if (value >= 90) return "critical";
  if (value >= 75) return "warning";
  return "good";
}

function rewardTone(value: number | undefined): SummaryTone {
  if (value === undefined) return "missing";
  if (value < -10) return "critical";
  if (value < 0) return "warning";
  return "good";
}

function weatherTone(maxWave: number | undefined, maxWind: number | undefined): SummaryTone {
  if (maxWave === undefined && maxWind === undefined) return "missing";
  if ((maxWave ?? 0) >= 2.5 || (maxWind ?? 0) >= 18) return "critical";
  if ((maxWave ?? 0) >= 1.5 || (maxWind ?? 0) >= 10) return "warning";
  return "good";
}

function maxNumber(values: Array<number | undefined>) {
  const finite = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return finite.length > 0 ? Math.max(...finite) : undefined;
}

function fmt(value: number | undefined, suffix = "") {
  return value === undefined ? "n/a" : `${value.toFixed(1)}${suffix}`;
}

function cardsForMode(data: DashboardData, mode: InsightMode): SummaryCard[] {
  const latestStep = data.chmarlSteps.at(-1);
  const reward = data.rewardTrend.at(-1)?.[1];
  const violatedConstraints = latestStep?.constraints?.filter((constraint) => !constraint.satisfied).length ?? 0;
  const queueRows = [...data.portQueueStatus].sort((a, b) => queueUtilization(b) - queueUtilization(a));
  const busiestQueue = queueRows[0];
  const queueValue = busiestQueue ? queueUtilization(busiestQueue) : undefined;
  const maxWave = maxNumber(data.weatherPoints.map((point) => point.waveHeightM));
  const maxWind = maxNumber(data.weatherPoints.map((point) => point.windSpeedMs));
  const watchVessels = data.vessels.filter((vessel) => vessel.status === "Watch").length;
  const constrainedVessels = data.vessels.filter((vessel) => vessel.status === "Constrained").length;
  const positioned = data.vessels.filter((vessel) => Number.isFinite(vessel.latitude) && Number.isFinite(vessel.longitude)).length;
  const moving = movingVessels(data);
  const vesselRisk = watchVessels + constrainedVessels + Math.max(0, data.vessels.length - positioned);
  const weatherRisk = data.weatherPoints.filter((point) => (point.waveHeightM ?? 0) >= 1.5 || (point.windSpeedMs ?? 0) >= 10).length;
  const portCoverage = summarizePortCoverage(data.vessels);
  const activeSaudiPorts = portCoverage.rows.filter((row) => row.port.area === "Saudi" && row.count > 0).length;
  const totalSaudiPorts = portCoverage.rows.filter((row) => row.port.area === "Saudi").length;
  const trackingRows = data.vesselScope?.trackingRows ?? data.vessels.length;
  const operationalRows = data.vesselScope?.operationalRows ?? portCoverage.saudiNearPort + portCoverage.regionalNearPort;
  const radius = data.vesselScope?.operationalRadiusNm ?? 120;

  const overview: SummaryCard[] = [
    {
      title: "EcoFair-CH-MARL reward",
      value: reward === undefined ? "n/a" : reward.toFixed(3),
      detail: `${operationalRows} port-scope vessels · ${data.chmarlSteps.length} steps · ${violatedConstraints} active constraints`,
      tone: rewardTone(reward),
      focus: "chmarl-components",
    },
    {
      title: "Global vessel tracking",
      value: String(trackingRows),
      detail: `${operationalRows} within ${radius} nm of monitored ports · ${moving} moving`,
      tone: trackingRows > 0 ? "good" : data.source === "aisstream-waiting" ? "warning" : "missing",
      focus: "fleet",
    },
    {
      title: "Monitored-port pressure",
      value: queueValue === undefined ? `${operationalRows} vessels` : `${Math.round(queueValue)}%`,
      detail: busiestQueue ? `${busiestQueue.portId} · queue ${busiestQueue.queueLength ?? busiestQueue.waitingVessels ?? "n/a"}` : `${activeSaudiPorts}/${totalSaudiPorts} Saudi ports currently have nearby rows`,
      tone: queueValue === undefined ? (operationalRows > 0 ? "info" : "missing") : queueTone(queueValue),
      focus: "port-queue",
    },
    {
      title: "Weather window",
      value: data.weatherPoints.length === 0 ? "n/a" : `${data.weatherPoints.length} pts`,
      detail: `max wave ${fmt(maxWave, "m")} · max wind ${fmt(maxWind, "m/s")}`,
      tone: weatherTone(maxWave, maxWind),
      focus: "weather",
    },
  ];

  if (mode === "chmarl") return [
    overview[0],
    { title: "Agent actions", value: String(latestStep?.actions?.length ?? 0), detail: `${operationalRows} port-scope vessels provide the calculation state`, tone: latestStep ? "info" : "missing", focus: "chmarl-actions" },
    { title: "Fairness", value: String(latestStep?.fairness?.length ?? 0), detail: "fuel-equity metrics use port-scope vessels only", tone: latestStep ? "info" : "missing", focus: "chmarl-fairness" },
    { title: "Constraint shield", value: violatedConstraints === 0 ? "Nominal" : `${violatedConstraints} active`, detail: `${latestStep?.constraints?.length ?? 0} port-operation constraints evaluated`, tone: violatedConstraints > 0 ? "warning" : latestStep ? "good" : "missing", focus: "chmarl-constraints" },
  ];

  if (mode === "operations") return [
    overview[1],
    { title: "Port calculation scope", value: String(operationalRows), detail: `within ${radius} nm of ${portCoverage.rows.length} monitored ports`, tone: operationalRows > 0 ? "good" : "missing", focus: "port-coverage" },
    { title: "Port events", value: String(data.portEvents.length), detail: data.portOpsSource === "demo" ? "demo feed" : data.portOpsSource, tone: data.portEvents.length > 0 ? "info" : "missing", focus: "port-events" },
    overview[2],
  ];

  if (mode === "risk") return [
    { title: "Tracking feed quality", value: String(vesselRisk), detail: `${watchVessels} watch · ${constrainedVessels} constrained · ${trackingRows - positioned} missing positions`, tone: vesselRisk > 0 ? "warning" : trackingRows > 0 ? "good" : "missing", focus: "vessel-risk" },
    { title: "Saudi port coverage gap", value: String(Math.max(0, totalSaudiPorts - activeSaudiPorts)), detail: `${activeSaudiPorts}/${totalSaudiPorts} Saudi ports active`, tone: trackingRows === 0 ? "missing" : activeSaudiPorts === totalSaudiPorts ? "good" : "warning", focus: "port-coverage" },
    { title: "Weather risk", value: String(weatherRisk), detail: `${data.weatherPoints.length} weather points evaluated`, tone: weatherRisk > 0 ? "warning" : data.weatherPoints.length > 0 ? "good" : "missing", focus: "weather-risk" },
    { title: "Constraint risk", value: String(violatedConstraints), detail: `${latestStep?.constraints?.length ?? 0} port-scope constraints`, tone: violatedConstraints > 0 ? "warning" : latestStep ? "good" : "missing", focus: "chmarl-constraints" },
  ];

  return overview;
}

export default function OperationalInsightStrip({ data, onFocus }: OperationalInsightStripProps) {
  const [mode, setMode] = useState<InsightMode>("overview");
  const activeMode = insightModes.find((item) => item.id === mode) ?? insightModes[0];
  const cards = useMemo(() => cardsForMode(data, mode), [data, mode]);

  return (
    <section className="command-summary-strip" aria-label="Operational command summary">
      <header className="command-summary-header">
        <div><span>Command summary</span><strong>{activeMode.label}</strong></div>
        <div className="command-summary-tabs" role="tablist" aria-label="Operational summary mode">
          {insightModes.map((item) => (
            <button key={item.id} type="button" role="tab" aria-selected={mode === item.id} className={mode === item.id ? "active" : ""} onClick={() => setMode(item.id)}>{item.label}</button>
          ))}
        </div>
      </header>
      <div className="command-summary-cards">
        {cards.map((card) => (
          <button key={card.title} type="button" className={`command-summary-card ${card.tone}`} onClick={() => onFocus(card.focus)} title="Open detailed panel">
            <span>{card.title}</span><strong>{card.value}</strong><small>{card.detail}</small>
          </button>
        ))}
      </div>
    </section>
  );
}
