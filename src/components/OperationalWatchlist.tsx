import type { DashboardData, DashboardDataSource } from "@/data/loadSampleDashboardData";
import type { MarineWeatherPoint } from "@/providers/weatherProvider";
import type { PortQueueStatus } from "@/providers/portOperationsProvider";

export type OperationalWatchlistProps = {
  data: DashboardData;
  scenarioId: string;
};

type WatchItem = {
  severity: "critical" | "warning" | "normal";
  title: string;
  detail: string;
};

function isExternalSource(source: DashboardDataSource) {
  return source === "aisstream" || source === "aisstream-waiting" || source === "upstream" || source === "remote";
}

function queueUtilization(row: PortQueueStatus) {
  if (typeof row.utilizationPct === "number" && Number.isFinite(row.utilizationPct)) return row.utilizationPct;
  if (typeof row.queueLength === "number" && Number.isFinite(row.queueLength)) return Math.min(100, row.queueLength * 12);
  if (typeof row.waitingVessels === "number" && Number.isFinite(row.waitingVessels)) return Math.min(100, row.waitingVessels * 10);
  return 0;
}

function weatherRisk(point: MarineWeatherPoint) {
  let score = 0;
  const reasons: string[] = [];
  if (typeof point.waveHeightM === "number") {
    if (point.waveHeightM >= 2.5) { score += 45; reasons.push(`${point.waveHeightM.toFixed(1)}m waves`); }
    else if (point.waveHeightM >= 1.5) { score += 25; reasons.push(`${point.waveHeightM.toFixed(1)}m waves`); }
  }
  if (typeof point.windSpeedMs === "number") {
    if (point.windSpeedMs >= 18) { score += 40; reasons.push(`${point.windSpeedMs.toFixed(1)}m/s wind`); }
    else if (point.windSpeedMs >= 10) { score += 20; reasons.push(`${point.windSpeedMs.toFixed(1)}m/s wind`); }
  }
  if (typeof point.seaSurfaceTemperatureC === "number" && point.seaSurfaceTemperatureC >= 34) {
    score += 10;
    reasons.push(`${point.seaSurfaceTemperatureC.toFixed(1)}°C sea`);
  }
  return { point, score, reasons };
}

function latestReward(data: DashboardData, component: string) {
  const rewards = data.chmarlSteps.at(-1)?.rewards ?? [];
  return rewards.find((reward) => reward.component === component)?.value;
}

function latestDecision(data: DashboardData) {
  const decisions = data.chmarlSteps.at(-1)?.hierarchyDecisions ?? [];
  return decisions.at(-1);
}

function latestAction(data: DashboardData) {
  const actions = data.chmarlSteps.at(-1)?.actions ?? [];
  return actions.at(-1);
}

function buildWatchItems(data: DashboardData, scenarioId: string): WatchItem[] {
  const constrained = data.vessels.filter((vessel) => vessel.status === "Constrained");
  const watch = data.vessels.filter((vessel) => vessel.status === "Watch");
  const highConstraint = [...data.constraintPressure].sort((a, b) => b.value - a.value)[0];
  const highPort = [...data.portUtilization].sort((a, b) => b.value - a.value)[0];
  const highQueue = [...data.portQueueStatus].sort((a, b) => queueUtilization(b) - queueUtilization(a))[0];
  const highestWeather = data.weatherPoints.map(weatherRisk).sort((a, b) => b.score - a.score)[0];
  const recentEvent = data.portEvents.at(-1);
  const decision = latestDecision(data);
  const action = latestAction(data);
  const external = isExternalSource(data.source);
  const items: WatchItem[] = [];

  if (data.source === "aisstream-waiting") {
    items.push({
      severity: "warning",
      title: "Waiting for AIS positions",
      detail: "The AIS socket is connected, but no vessel positions have been cached for the selected bounding box yet.",
    });
  }

  if (constrained.length > 0) {
    items.push({
      severity: "critical",
      title: `${constrained.length} constrained vessel${constrained.length > 1 ? "s" : ""}`,
      detail: constrained.slice(0, 2).map((vessel) => vessel.name).join(", "),
    });
  }

  if (watch.length > 0) {
    items.push({
      severity: "warning",
      title: `${watch.length} vessel${watch.length > 1 ? "s" : ""} under watch`,
      detail: watch.slice(0, 2).map((vessel) => vessel.name).join(", "),
    });
  }

  if (highConstraint) {
    items.push({
      severity: highConstraint.value >= 80 ? "critical" : highConstraint.value >= 60 ? "warning" : "normal",
      title: `Data/constraint signal: ${highConstraint.name}`,
      detail: `${highConstraint.value}% under ${scenarioId}`,
    });
  }

  if (highQueue) {
    const value = queueUtilization(highQueue);
    items.push({
      severity: value >= 90 ? "critical" : value >= 75 ? "warning" : "normal",
      title: `Queue/berth pressure: ${highQueue.portId}`,
      detail: `${Math.round(value)}% utilization · queue ${highQueue.queueLength ?? highQueue.waitingVessels ?? "n/a"}`,
    });
  } else if (highPort) {
    items.push({
      severity: external ? (highPort.value >= 8 ? "warning" : "normal") : highPort.value >= 90 ? "critical" : highPort.value >= 75 ? "warning" : "normal",
      title: external ? `Nearest-port cluster: ${highPort.name}` : `Port load: ${highPort.name}`,
      detail: external ? `${highPort.value} vessel${highPort.value === 1 ? "" : "s"} within port radius` : `${highPort.value}% utilization`,
    });
  }

  if (highestWeather && highestWeather.score > 0) {
    items.push({
      severity: highestWeather.score >= 60 ? "critical" : "warning",
      title: `Weather watch: ${highestWeather.point.name}`,
      detail: highestWeather.reasons.join(" · ") || highestWeather.point.provider || "weather watch",
    });
  }

  if (decision) {
    items.push({
      severity: "normal",
      title: `CH-MARL decision: ${decision.level}`,
      detail: decision.decisionLabel,
    });
  } else if (action) {
    items.push({
      severity: "normal",
      title: `CH-MARL action: ${action.agentType}`,
      detail: `${action.actionType.replace(/_/g, " ")} · ${String(action.actionValue)}`,
    });
  }

  if (recentEvent) {
    items.push({
      severity: "normal",
      title: `Latest port event: ${recentEvent.eventType.replace(/_/g, " ")}`,
      detail: `${recentEvent.portId} · ${recentEvent.timestamp}`,
    });
  }

  if (items.length === 0) {
    items.push({
      severity: "normal",
      title: external ? "Live feed has no operational exceptions" : "No operational exceptions",
      detail: external ? "Current external vessel rows show no constrained vessels, stale positions, or port clusters." : "Current feed has no constrained vessels or high-pressure ports.",
    });
  }

  return items.slice(0, 8);
}

function recommendedAction(data: DashboardData) {
  const constrained = data.vessels.filter((vessel) => vessel.status === "Constrained");
  const watch = data.vessels.filter((vessel) => vessel.status === "Watch");
  const highQueue = [...data.portQueueStatus].sort((a, b) => queueUtilization(b) - queueUtilization(a))[0];
  const highPort = [...data.portUtilization].sort((a, b) => b.value - a.value)[0];
  const reward = latestReward(data, "global");
  const external = isExternalSource(data.source);

  if (data.source === "aisstream-waiting") {
    return "Keep the AIS socket running, verify the bounding box, and wait for cached vessels before interpreting operational metrics.";
  }

  if (constrained.length > 0) {
    return "Prioritize constraint-shield review and reroute or hold affected vessels before changing fleet-wide policy.";
  }

  if (highQueue && queueUtilization(highQueue) >= 85) {
    return `Review queue and berth allocation at ${highQueue.portId}; CH-MARL should rebalance arrivals or trigger capacity actions.`;
  }

  if (reward !== undefined && reward < 0.45) {
    return "Reward index is low. Review throughput, data quality, fairness, and congestion components before accepting the current policy.";
  }

  if (external && highPort && highPort.value >= 8) {
    return `Review live vessel clustering near ${highPort.name}; this is a proximity signal, not confirmed berth utilization.`;
  }

  if (!external && highPort && highPort.value >= 85) {
    return `Reduce arrivals into ${highPort.name}, rebalance berth allocation, and monitor queue growth.`;
  }

  if (watch.length > 0) {
    return "Keep current policy active, monitor watch vessels, and refresh the vessel feed before committing major route changes.";
  }

  return external
    ? "Current live vessel feed is stable. Continue monitoring position freshness, CH-MARL reward components, queue pressure, and weather risk."
    : "Current operations are stable. Continue monitoring reward, utilization, and event cadence.";
}

export default function OperationalWatchlist({ data, scenarioId }: OperationalWatchlistProps) {
  const items = buildWatchItems(data, scenarioId);

  return (
    <div className="watchlist-panel">
      <div className="watchlist-recommendation">
        <span>Recommended action</span>
        <strong>{recommendedAction(data)}</strong>
      </div>
      <div className="watchlist-items">
        {items.map((item) => (
          <article key={item.title + item.detail} className={`watchlist-item ${item.severity}`}>
            <span>{item.severity}</span>
            <strong>{item.title}</strong>
            <small>{item.detail}</small>
          </article>
        ))}
      </div>
    </div>
  );
}
