import type { Metric } from "@/data/chmarlData";

export type MetricCardProps = {
  metric: Metric;
};

function numericValue(metric: Metric) {
  const parsed = Number.parseFloat(metric.value.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function metricTone(metric: Metric) {
  const label = metric.label.toLowerCase();
  const trend = metric.trend.toLowerCase();
  const value = numericValue(metric);

  if (metric.value === "n/a" || trend.includes("waiting") || trend.includes("missing")) return "missing";
  if (label.includes("reward") && value !== undefined) return value < 0.45 ? "warn" : "good";
  if (label.includes("feasibility") && value !== undefined) return value < 75 ? "warn" : "good";
  if (label.includes("port") && trend.includes("demo")) return "warn";
  if (label.includes("sea") && value !== undefined) return value >= 2.5 ? "warn" : "good";
  if (label.includes("wind") && value !== undefined) return value >= 12 ? "warn" : "good";
  return "info";
}

export default function MetricCard({ metric }: MetricCardProps) {
  return (
    <article className={`metric-card metric-card-${metricTone(metric)}`}>
      <div className="metric-label">{metric.label}</div>
      <div className="metric-value">{metric.value}</div>
      <div className="metric-trend">{metric.trend}</div>
    </article>
  );
}
