import type { ChmarlConstraint, ChmarlExperimentStep } from "@/types/chmarl";

export type ChmarlConstraintLedgerProps = {
  steps: ChmarlExperimentStep[];
  compact?: boolean;
};

function latestConstraints(steps: ChmarlExperimentStep[]) {
  return steps.at(-1)?.constraints ?? [];
}

function severityClass(severity: ChmarlConstraint["severity"]) {
  if (severity === "high") return "alert";
  if (severity === "medium") return "warning";
  return "nominal";
}

function percent(value: number, limit: number) {
  if (limit === 0) return value > 0 ? 100 : 0;
  return Math.max(0, Math.min(100, (value / limit) * 100));
}

export default function ChmarlConstraintLedger({ steps, compact = false }: ChmarlConstraintLedgerProps) {
  const rows = latestConstraints(steps);
  const violated = rows.filter((row) => !row.satisfied).length;

  return (
    <div className="constraint-ledger insight-panel-content">
      <div className="insight-panel-summary">
        <span>Constraint shield</span>
        <strong>{rows.length === 0 ? "n/a" : violated === 0 ? "nominal" : `${violated} active`}</strong>
        <small>{rows.length} live constraints from latest CH-MARL step</small>
      </div>
      <div className={compact ? "constraint-ledger-list compact" : "constraint-ledger-list"}>
        {rows.length === 0 ? (
          <p className="insight-empty-state">Waiting for online CH-MARL constraints.</p>
        ) : rows.map((constraint) => {
          const pressure = percent(constraint.value, constraint.limit);
          return (
            <article key={constraint.constraintId} className="constraint-ledger-row">
              <div>
                <strong>{constraint.name}</strong>
                <small>{constraint.value} / {constraint.limit}</small>
              </div>
              <span className={`ship-status ${severityClass(constraint.severity)}`}>{constraint.satisfied ? "ok" : constraint.severity}</span>
              <div className="constraint-meter" aria-label={`${constraint.name} pressure`}><span style={{ width: `${pressure}%` }} /></div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
