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
  if (value < 0.45) return "critical";
  if (value < 0.65) return "warning";
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
  const suezRows = portCoverage.rows.find((row) => row.port.id === "Suez")?.count ?? 0;

  const overview: SummaryCard[] = [
    {
      title: "CH-MARL reward",
      value: reward === undefined ? "n/a" : reward.toFixed(3),
      detail: `${data.chmarlSteps.length} steps · ${latestStep?.actions?.length ?? 0} actions · ${violatedConstraints} constraints`,
      tone: rewardTone(reward),
      focus: "chmarl-components",
    },
    {
      title: "Saudi AIS coverage",
      value: `${portCoverage.saudiNearPort}/${data.vessels.length}`,
      detail: `${activeSaudiPorts}/${totalSaudiPorts} Saudi ports active · Suez ${suezRows}`,
      tone: data.vessels.length === 0 ? "missing" : portCoverage.saudiNearPort === 0 ? "warning" : "good",
      focus: "port-coverage",
    },
    {
      title: "Queue pressure",
      value: queueValue === undefined ? "n/a" : `${Math.round(queueValue)}%`,
      detail: busiestQueue ? `${busiestQueue.portId} · queue ${busiestQueue.queueLength ?? busiestQueue.waitingVessels ?? "n/a"}` : "No queue feed rows",
      tone: queueValue === undefined ? "missing" : queueTone(queueValue),
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
    { title: "Agent actions", value: String(latestStep?.actions?.length ?? 0), detail: "latest runtime policy actions", tone: latestStep ? "info" : "missing", focus: "chmarl-actions" },
    { title: "Fairness", value: String(latestStep?.fairness?.length ?? 0), detail: "fairness metrics from current step", tone: latestStep ? "info" : "missing", focus: "chmarl-fairness" },
    { title: "Constraint shield", value: violatedConstraints === 0 ? "Nominal" : `${violatedConstraints} active`, detail: `${latestStep?.constraints?.length ?? 0} constraints evaluated`, tone: violatedConstraints > 0 ? "warning" : latestStep ? "good" : "missing", focus: "chmarl-constraints" },
  ];

  if (mode === "operations") return [
    overview[1],
    overview[2],
    { title: "Port events", value: String(data.portEvents.length), detail: data.portOpsSource === "demo" ? "Kpler-like demo feed" : data.portOpsSource, tone: data.portEvents.length > 0 ? "info" : "missing", focus: "port-events" },
    { title: "Fleet state", value: String(data.vessels.length), detail: `${moving} moving · ${positioned} positioned · ${watchVessels} watch`, tone: data.vessels.length === 0 ? "missing" : constrainedVessels > 0 ? "critical" : watchVessels > 0 ? "warning" : "good", focus: "fleet" },
  ];

  if (mode === "risk") return [
    { title: "Vessel risk", value: String(vesselRisk), detail: `${watchVessels} watch · ${constrainedVessels} constrained`, tone: vesselRisk > 0 ? "warning" : data.vessels.length > 0 ? "good" : "missing", focus: "vessel-risk" },
    { title: "Saudi AIS gap", value: String(Math.max(0, totalSaudiPorts - activeSaudiPorts)), detail: `${activeSaudiPorts}/${totalSaudiPorts} Saudi ports active`, tone: data.vessels.length === 0 ? "missing" : activeSaudiPorts === totalSaudiPorts ? "good" : "warning", focus: "port-coverage" },
    { title: "Weather risk", value: String(weatherRisk), detail: `${data.weatherPoints.length} weather points evaluated`, tone: weatherRisk > 0 ? "warning" : data.weatherPoints.length > 0 ? "good" : "missing", focus: "weather-risk" },
    { title: "Constraint risk", value: violatedConstraints === 0 ? "0" : String(violatedConstraints), detail: `${latestStep?.constraints?.length ?? 0} CH-MARL constraints`, tone: violatedConstraints > 0 ? "warning" : latestStep ? "good" : "missing", focus: "chmarl-constraints" },
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
        <div>
          <span>Command summary</span>
          <strong>{activeMode.label}</strong>
        </div>
        <div className="command-summary-tabs" role="tablist" aria-label="Operational summary mode">
          {insightModes.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={mode === item.id}
              className={mode === item.id ? "active" : ""}
              onClick={() => setMode(item.id)}>
              {item.label}
            </button>
          ))}
        </div>
      </header>
      <div className="command-summary-cards">
        {cards.map((card) => (
          <button key={card.title} type="button" className={`command-summary-card ${card.tone}`} onClick={() => onFocus(card.focus)} title="Open detailed panel">
            <span>{card.title}</span>
            <strong>{card.value}</strong>
            <small>{card.detail}</small>
          </button>
        ))}
      </div>
    </section>
  );
}
