import type { ChmarlAction, ChmarlExperimentStep } from "@/types/chmarl";

export type ChmarlActionPlanProps = {
  steps: ChmarlExperimentStep[];
  compact?: boolean;
};

function latestActions(steps: ChmarlExperimentStep[]): ChmarlAction[] {
  return steps.at(-1)?.actions ?? [];
}

function actionValueText(value: ChmarlAction["actionValue"]) {
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function agentTone(agentType: string) {
  if (agentType.includes("shield")) return "alert";
  if (agentType.includes("port") || agentType.includes("berth")) return "warning";
  return "nominal";
}

export default function ChmarlActionPlan({ steps, compact = false }: ChmarlActionPlanProps) {
  const actions = latestActions(steps);

  return (
    <div className="chmarl-action-plan insight-panel-content">
      <div className="insight-panel-summary">
        <span>Agent action plan</span>
        <strong>{actions.length}</strong>
        <small>latest online CH-MARL agent actions</small>
      </div>
      <div className={compact ? "action-plan-list compact" : "action-plan-list"}>
        {actions.length === 0 ? (
          <p className="insight-empty-state">Waiting for CH-MARL agent actions from the runtime policy.</p>
        ) : actions.map((action) => (
          <article key={`${action.agentId}-${action.actionType}-${action.targetId ?? "target"}`} className="action-plan-row">
            <div>
              <strong>{action.actionType.replace(/_/g, " ")}</strong>
              <small>{action.agentId}{action.targetId ? ` → ${action.targetId}` : ""}</small>
            </div>
            <span className={`ship-status ${agentTone(action.agentType)}`}>{action.agentType}</span>
            <p>{actionValueText(action.actionValue)}</p>
          </article>
        ))}
      </div>
    </div>
  );
}
