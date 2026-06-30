import { useState, type ReactNode } from "react";
import type { DashboardData } from "@/data/loadSampleDashboardData";
import PanelCard from "../PanelCard";
import ChmarlActionPlan from "./ChmarlActionPlan";
import ChmarlConstraintLedger from "./ChmarlConstraintLedger";
import ChmarlDecisionTimeline from "./ChmarlDecisionTimeline";
import ChmarlFairnessPanel from "./ChmarlFairnessPanel";
import ChmarlRewardComponents from "./ChmarlRewardComponents";
import FleetOperationalSummary from "./FleetOperationalSummary";
import MarineWeatherOverview from "./MarineWeatherOverview";
import PortEventFeed from "./PortEventFeed";
import PortQueueBoard from "./PortQueueBoard";
import VesselRiskRegister from "./VesselRiskRegister";
import WeatherRiskMatrix from "./WeatherRiskMatrix";

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
  | "port-queue";

const insightModes = [
  { id: "overview", label: "Overview", description: "Core CH-MARL, fleet, weather, and port status." },
  { id: "chmarl", label: "CH-MARL", description: "Reward, actions, fairness, constraints, and decisions." },
  { id: "operations", label: "Operations", description: "Queue, berth, port events, weather, and fleet data quality." },
  { id: "risk", label: "Risk", description: "Vessel, weather, and constraint pressure views." },
] as const;

type InsightMode = typeof insightModes[number]["id"];

type InsightCard = {
  title: string;
  tag: string;
  focus: InsightFocusPanel;
  content: ReactNode;
};

export type OperationalInsightStripProps = {
  data: DashboardData;
  onFocus: (panel: InsightFocusPanel) => void;
};

function visibleCardsFor(mode: InsightMode): InsightFocusPanel[] {
  if (mode === "chmarl") return ["chmarl-components", "chmarl-actions", "chmarl-fairness", "chmarl-constraints", "chmarl-decisions"];
  if (mode === "operations") return ["port-queue", "port-events", "weather", "fleet"];
  if (mode === "risk") return ["vessel-risk", "weather-risk", "chmarl-constraints", "port-queue"];
  return ["chmarl-components", "chmarl-constraints", "weather", "fleet", "port-events"];
}

export default function OperationalInsightStrip({ data, onFocus }: OperationalInsightStripProps) {
  const [mode, setMode] = useState<InsightMode>("overview");
  const latestStep = data.chmarlSteps.at(-1);
  const latestReward = data.rewardTrend.at(-1)?.[1];
  const violatedConstraints = latestStep?.constraints?.filter((constraint) => !constraint.satisfied).length ?? 0;
  const actionCount = latestStep?.actions?.length ?? 0;
  const fairnessCount = latestStep?.fairness?.length ?? 0;
  const weatherRiskCount = data.weatherPoints.filter((point) => (point.waveHeightM ?? 0) >= 1.5 || (point.windSpeedMs ?? 0) >= 10).length;
  const riskVessels = data.vessels.filter((vessel) => vessel.status !== "Nominal" || !Number.isFinite(vessel.latitude) || !Number.isFinite(vessel.longitude)).length;
  const activeMode = insightModes.find((item) => item.id === mode) ?? insightModes[0];

  const cardLibrary: Record<InsightFocusPanel, InsightCard> = {
    "chmarl-components": {
      title: "CH-MARL Components",
      tag: latestReward === undefined ? "waiting" : latestReward.toFixed(3),
      focus: "chmarl-components",
      content: <ChmarlRewardComponents steps={data.chmarlSteps} compact />,
    },
    "chmarl-actions": {
      title: "Agent Actions",
      tag: `${actionCount} actions`,
      focus: "chmarl-actions",
      content: <ChmarlActionPlan steps={data.chmarlSteps} compact />,
    },
    "chmarl-fairness": {
      title: "Fairness",
      tag: `${fairnessCount} metrics`,
      focus: "chmarl-fairness",
      content: <ChmarlFairnessPanel steps={data.chmarlSteps} compact />,
    },
    "chmarl-constraints": {
      title: "Constraint Shield",
      tag: violatedConstraints === 0 ? "nominal" : `${violatedConstraints} active`,
      focus: "chmarl-constraints",
      content: <ChmarlConstraintLedger steps={data.chmarlSteps} compact />,
    },
    "chmarl-decisions": {
      title: "Decision Trace",
      tag: `${data.timelineEvents.length} events`,
      focus: "chmarl-decisions",
      content: <ChmarlDecisionTimeline steps={data.chmarlSteps} limit={4} />,
    },
    "port-queue": {
      title: "Queue / Berth Board",
      tag: `${data.portQueueStatus.length} rows`,
      focus: "port-queue",
      content: <PortQueueBoard rows={data.portQueueStatus} source={data.portOpsSource} compact />,
    },
    "port-events": {
      title: "Port Event Feed",
      tag: data.portOpsSource,
      focus: "port-events",
      content: <PortEventFeed events={data.portEvents} source={data.portOpsSource} compact />,
    },
    weather: {
      title: "Marine Weather",
      tag: `${data.weatherPoints.length} points`,
      focus: "weather",
      content: <MarineWeatherOverview points={data.weatherPoints} compact />,
    },
    "weather-risk": {
      title: "Weather Risk",
      tag: `${weatherRiskCount} watches`,
      focus: "weather-risk",
      content: <WeatherRiskMatrix points={data.weatherPoints} compact />,
    },
    fleet: {
      title: "Fleet Data Quality",
      tag: `${data.vessels.length} vessels`,
      focus: "fleet",
      content: <FleetOperationalSummary vessels={data.vessels} compact />,
    },
    "vessel-risk": {
      title: "Vessel Risk",
      tag: `${riskVessels} flagged`,
      focus: "vessel-risk",
      content: <VesselRiskRegister vessels={data.vessels} compact />,
    },
  };

  const visibleCards = visibleCardsFor(mode).map((key) => cardLibrary[key]);

  return (
    <section className="insight-section" aria-label="Operational intelligence panels">
      <header className="insight-toolbar">
        <div>
          <span className="insight-kicker">Operational insight deck</span>
          <strong>{activeMode.label}</strong>
          <small>{activeMode.description}</small>
        </div>
        <div className="insight-mode-tabs" role="tablist" aria-label="Operational insight mode">
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
      <div className="insight-grid">
        {visibleCards.map((card) => (
          <PanelCard key={card.focus} title={card.title} tag={card.tag} onFocus={() => onFocus(card.focus)}>
            {card.content}
          </PanelCard>
        ))}
      </div>
    </section>
  );
}
