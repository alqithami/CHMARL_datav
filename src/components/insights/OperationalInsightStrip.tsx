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

export type OperationalInsightStripProps = {
  data: DashboardData;
  onFocus: (panel: InsightFocusPanel) => void;
};

export default function OperationalInsightStrip({ data, onFocus }: OperationalInsightStripProps) {
  const latestStep = data.chmarlSteps.at(-1);
  const latestReward = data.rewardTrend.at(-1)?.[1];
  const violatedConstraints = latestStep?.constraints?.filter((constraint) => !constraint.satisfied).length ?? 0;
  const actionCount = latestStep?.actions?.length ?? 0;
  const fairnessCount = latestStep?.fairness?.length ?? 0;
  const weatherRiskCount = data.weatherPoints.filter((point) => (point.waveHeightM ?? 0) >= 1.5 || (point.windSpeedMs ?? 0) >= 10).length;
  const riskVessels = data.vessels.filter((vessel) => vessel.status !== "Nominal" || !Number.isFinite(vessel.latitude) || !Number.isFinite(vessel.longitude)).length;

  return (
    <section className="insight-grid" aria-label="Operational intelligence panels">
      <PanelCard title="CH-MARL Components" tag={latestReward === undefined ? "waiting" : latestReward.toFixed(3)} onFocus={() => onFocus("chmarl-components")}>
        <ChmarlRewardComponents steps={data.chmarlSteps} compact />
      </PanelCard>
      <PanelCard title="Agent Actions" tag={`${actionCount} actions`} onFocus={() => onFocus("chmarl-actions")}>
        <ChmarlActionPlan steps={data.chmarlSteps} compact />
      </PanelCard>
      <PanelCard title="Fairness" tag={`${fairnessCount} metrics`} onFocus={() => onFocus("chmarl-fairness")}>
        <ChmarlFairnessPanel steps={data.chmarlSteps} compact />
      </PanelCard>
      <PanelCard title="Constraint Shield" tag={violatedConstraints === 0 ? "nominal" : `${violatedConstraints} active`} onFocus={() => onFocus("chmarl-constraints")}>
        <ChmarlConstraintLedger steps={data.chmarlSteps} compact />
      </PanelCard>
      <PanelCard title="Decision Trace" tag={`${data.timelineEvents.length} events`} onFocus={() => onFocus("chmarl-decisions")}>
        <ChmarlDecisionTimeline steps={data.chmarlSteps} limit={4} />
      </PanelCard>
      <PanelCard title="Queue / Berth Board" tag={`${data.portQueueStatus.length} rows`} onFocus={() => onFocus("port-queue")}>
        <PortQueueBoard rows={data.portQueueStatus} source={data.portOpsSource} compact />
      </PanelCard>
      <PanelCard title="Marine Weather" tag={`${data.weatherPoints.length} points`} onFocus={() => onFocus("weather")}>
        <MarineWeatherOverview points={data.weatherPoints} compact />
      </PanelCard>
      <PanelCard title="Weather Risk" tag={`${weatherRiskCount} watches`} onFocus={() => onFocus("weather-risk")}>
        <WeatherRiskMatrix points={data.weatherPoints} compact />
      </PanelCard>
      <PanelCard title="Fleet Data Quality" tag={`${data.vessels.length} vessels`} onFocus={() => onFocus("fleet")}>
        <FleetOperationalSummary vessels={data.vessels} compact />
      </PanelCard>
      <PanelCard title="Vessel Risk" tag={`${riskVessels} flagged`} onFocus={() => onFocus("vessel-risk")}>
        <VesselRiskRegister vessels={data.vessels} compact />
      </PanelCard>
      <PanelCard title="Port Event Feed" tag={data.portOpsSource} onFocus={() => onFocus("port-events")}>
        <PortEventFeed events={data.portEvents} source={data.portOpsSource} compact />
      </PanelCard>
    </section>
  );
}
