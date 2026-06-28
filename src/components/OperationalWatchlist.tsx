import type { DashboardData } from "@/data/loadSampleDashboardData";

export type OperationalWatchlistProps = {
  data: DashboardData;
  scenarioId: string;
};

type WatchItem = {
  severity: "critical" | "warning" | "normal";
  title: string;
  detail: string;
};

function buildWatchItems(data: DashboardData, scenarioId: string): WatchItem[] {
  const constrained = data.vessels.filter((vessel) => vessel.status === "Constrained");
  const watch = data.vessels.filter((vessel) => vessel.status === "Watch");
  const highConstraint = [...data.constraintPressure].sort((a, b) => b.value - a.value)[0];
  const highPort = [...data.portUtilization].sort((a, b) => b.value - a.value)[0];
  const recentEvent = data.portEvents.at(-1);
  const items: WatchItem[] = [];

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
      title: `Constraint: ${highConstraint.name}`,
      detail: `${highConstraint.value}% pressure under ${scenarioId}`,
    });
  }

  if (highPort) {
    items.push({
      severity: highPort.value >= 90 ? "critical" : highPort.value >= 75 ? "warning" : "normal",
      title: `Port load: ${highPort.name}`,
      detail: `${highPort.value}% utilization`,
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
      title: "No operational exceptions",
      detail: "Current feed has no constrained vessels or high-pressure ports.",
    });
  }

  return items;
}

function recommendedAction(data: DashboardData) {
  const constrained = data.vessels.filter((vessel) => vessel.status === "Constrained");
  const watch = data.vessels.filter((vessel) => vessel.status === "Watch");
  const highPort = [...data.portUtilization].sort((a, b) => b.value - a.value)[0];

  if (constrained.length > 0) {
    return "Prioritize constraint-shield review and reroute or hold affected vessels before changing fleet-wide policy.";
  }

  if (highPort && highPort.value >= 85) {
    return `Reduce arrivals into ${highPort.name}, rebalance berth allocation, and monitor queue growth.`;
  }

  if (watch.length > 0) {
    return "Keep current policy active, monitor watch vessels, and refresh the vessel feed before committing major route changes.";
  }

  return "Current operations are stable. Continue monitoring reward, utilization, and event cadence.";
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
