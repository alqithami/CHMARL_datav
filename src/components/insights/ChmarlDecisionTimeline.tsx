import type { ChmarlExperimentStep } from "@/types/chmarl";

export type ChmarlDecisionTimelineProps = {
  steps: ChmarlExperimentStep[];
  limit?: number;
};

function timelineRows(steps: ChmarlExperimentStep[], limit: number) {
  return steps
    .flatMap((step) => (step.hierarchyDecisions ?? []).map((decision) => ({ step, decision })))
    .slice(-limit)
    .reverse();
}

export default function ChmarlDecisionTimeline({ steps, limit = 8 }: ChmarlDecisionTimelineProps) {
  const rows = timelineRows(steps, limit);

  return (
    <div className="chmarl-decision-panel insight-panel-content">
      <div className="insight-panel-summary">
        <span>Decision trace</span>
        <strong>{rows.length}</strong>
        <small>latest hierarchy decisions from online CH-MARL</small>
      </div>
      <div className="decision-timeline-list">
        {rows.length === 0 ? (
          <p className="insight-empty-state">Waiting for CH-MARL hierarchy decisions.</p>
        ) : rows.map(({ step, decision }) => (
          <article key={`${step.step}-${decision.decisionId}`} className="decision-timeline-card">
            <span>{step.timestamp ?? `E${step.episode}:S${step.step}`}</span>
            <strong>{decision.level}: {decision.decisionLabel}</strong>
            <p>{decision.rationale ?? "No rationale supplied."}</p>
          </article>
        ))}
      </div>
    </div>
  );
}
