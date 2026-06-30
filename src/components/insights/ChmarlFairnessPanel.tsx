import type { ChmarlExperimentStep, ChmarlFairnessMetric } from "@/types/chmarl";

export type ChmarlFairnessPanelProps = {
  steps: ChmarlExperimentStep[];
  compact?: boolean;
};

function latestFairness(steps: ChmarlExperimentStep[]): ChmarlFairnessMetric[] {
  return steps.at(-1)?.fairness ?? [];
}

function tone(value: number) {
  if (value >= 0.8) return "nominal";
  if (value >= 0.6) return "warning";
  return "alert";
}

function percentage(value: number) {
  return Math.max(0, Math.min(100, value * 100));
}

export default function ChmarlFairnessPanel({ steps, compact = false }: ChmarlFairnessPanelProps) {
  const rows = latestFairness(steps);
  const average = rows.length === 0 ? undefined : rows.reduce((sum, row) => sum + row.value, 0) / rows.length;

  return (
    <div className="chmarl-fairness-panel insight-panel-content">
      <div className="insight-panel-summary">
        <span>Fairness metrics</span>
        <strong>{average === undefined ? "n/a" : average.toFixed(3)}</strong>
        <small>{rows.length} live fairness metric rows</small>
      </div>
      <div className={compact ? "fairness-list compact" : "fairness-list"}>
        {rows.length === 0 ? (
          <p className="insight-empty-state">Waiting for CH-MARL fairness metrics.</p>
        ) : rows.map((row) => (
          <article key={row.metricId} className="fairness-row">
            <div>
              <strong>{row.name}</strong>
              <small>grouped by {row.groupBy}</small>
            </div>
            <span className={`ship-status ${tone(row.value)}`}>{row.value.toFixed(3)}</span>
            <div className="constraint-meter" aria-label={`${row.name} value`}><span style={{ width: `${percentage(row.value)}%` }} /></div>
          </article>
        ))}
      </div>
    </div>
  );
}
