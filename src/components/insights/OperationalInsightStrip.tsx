import type { DashboardData } from "@/data/loadSampleDashboardData";
import PanelCard from "../PanelCard";
import ChmarlConstraintLedger from "./ChmarlConstraintLedger";
import ChmarlDecisionTimeline from "./ChmarlDecisionTimeline";
import ChmarlRewardComponents from "./ChmarlRewardComponents";
import FleetOperationalSummary from "./FleetOperationalSummary";
import MarineWeatherOverview from "./MarineWeatherOverview";
import PortEventFeed from "./PortEventFeed";

export type InsightFocusPanel = "chmarl-components" | "chmarl-constraints" | "chmarl-decisions" | "weather" | "fleet" | "port-events";

export type OperationalInsightStripProps = {
  data: DashboardData;
  onFocus: (panel: InsightFocusPanel) => void;
};

export default function OperationalInsightStrip({ data, onFocus }: OperationalInsightStripProps) {
  const latestReward = data.rewardTrend.at(-1)?.[1];
  const violatedConstraints = data.chmarlSteps.at(-1)?.constraints?.filter((constraint) => !constraint.satisfied).length ?? 0;

  return (
    <section className="insight-grid" aria-label="Operational intelligence panels">
      <PanelCard title="CH-MARL Components" tag={latestReward === undefined ? "waiting" : latestReward.toFixed(3)} onFocus={() => onFocus("chmarl-components")}>
        <ChmarlRewardComponents steps={data.chmarlSteps} compact />
      </PanelCard>
      <PanelCard title="Constraint Shield" tag={violatedConstraints === 0 ? "nominal" : `${violatedConstraints} active`} onFocus={() => onFocus("chmarl-constraints")}>
        <ChmarlConstraintLedger steps={data.chmarlSteps} compact />
      </PanelCard>
      <PanelCard title="Decision Trace" tag={`${data.timelineEvents.length} events`} onFocus={() => onFocus("chmarl-decisions")}>
        <ChmarlDecisionTimeline steps={data.chmarlSteps} limit={4} />
      </PanelCard>
      <PanelCard title="Marine Weather" tag={`${data.weatherPoints.length} points`} onFocus={() => onFocus("weather")}>
        <MarineWeatherOverview points={data.weatherPoints} compact />
      </PanelCard>
      <PanelCard title="Fleet Data Quality" tag={`${data.vessels.length} vessels`} onFocus={() => onFocus("fleet")}>
        <FleetOperationalSummary vessels={data.vessels} compact />
      </PanelCard>
      <PanelCard title="Port Event Feed" tag={data.portOpsSource} onFocus={() => onFocus("port-events")}>
        <PortEventFeed events={data.portEvents} source={data.portOpsSource} compact />
      </PanelCard>
    </section>
  );
}
