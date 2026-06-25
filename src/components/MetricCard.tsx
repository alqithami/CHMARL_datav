import type { Metric } from "@/data/chmarlData";

export type MetricCardProps = {
  metric: Metric;
};

export default function MetricCard({ metric }: MetricCardProps) {
  return (
    <article className="metric-card">
      <div className="metric-label">{metric.label}</div>
      <div className="metric-value">{metric.value}</div>
      <div className="metric-trend">{metric.trend}</div>
    </article>
  );
}
