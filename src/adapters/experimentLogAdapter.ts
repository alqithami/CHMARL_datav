import type { TimelineEvent } from "@/data/chmarlData";
import type { ChmarlConstraint, ChmarlExperimentStep, ChmarlReward } from "@/types/chmarl";

function rewardValue(rewards: ChmarlReward[] = [], component = "global") {
  const match = rewards.find((reward) => reward.component === component);
  if (match) return match.value;
  return rewards.filter((reward) => reward.value > 0).reduce((sum, reward) => sum + reward.value, 0);
}

function constraintPressure(constraint: ChmarlConstraint) {
  if (constraint.limit === 0) return constraint.satisfied ? 0 : 100;
  return Math.min(100, Math.max(0, (constraint.value / constraint.limit) * 100));
}

export function normalizeExperimentStep(step: ChmarlExperimentStep): ChmarlExperimentStep {
  return {
    ...step,
    actions: step.actions ?? [],
    rewards: step.rewards ?? [],
    constraints: step.constraints ?? [],
    hierarchyDecisions: step.hierarchyDecisions ?? [],
    timestamp: step.timestamp ?? new Date().toISOString(),
  };
}

export function experimentStepsToRewardTrend(steps: ChmarlExperimentStep[]) {
  return steps.map((step) => [
    `E${step.episode}:S${step.step}`,
    Number(rewardValue(step.rewards ?? []).toFixed(3)),
  ]);
}

export function experimentStepsToConstraintPressure(steps: ChmarlExperimentStep[]) {
  const pressureByName = new Map<string, { total: number; count: number }>();

  steps.forEach((step) => {
    (step.constraints ?? []).forEach((constraint) => {
      const current = pressureByName.get(constraint.name) ?? { total: 0, count: 0 };
      current.total += constraintPressure(constraint);
      current.count += 1;
      pressureByName.set(constraint.name, current);
    });
  });

  return Array.from(pressureByName.entries()).map(([name, value]) => ({
    name,
    value: Number((value.total / Math.max(value.count, 1)).toFixed(1)),
  }));
}

export function experimentStepsToTimelineEvents(steps: ChmarlExperimentStep[]): TimelineEvent[] {
  return steps.flatMap((step) =>
    (step.hierarchyDecisions ?? []).map((decision) => ({
      time: step.timestamp ?? `E${step.episode}:S${step.step}`,
      title: `${decision.level}: ${decision.decisionLabel}`,
      body: decision.rationale ?? `Affected agents: ${decision.affectedAgents?.join(", ") ?? "none"}`,
    }))
  );
}
