import { useMemo } from "react";
import type { ChmarlExperimentStep, ChmarlReward } from "@/types/chmarl";
import Chart from "../Chart";

export type ChmarlRewardComponentsProps = {
  steps: ChmarlExperimentStep[];
  compact?: boolean;
};

const componentOrder: ChmarlReward["component"][] = ["global", "throughput", "safety", "fairness", "delay", "emissions", "fuel", "constraint_penalty"];

function latestStep(steps: ChmarlExperimentStep[]) {
  return steps.at(-1);
}

function rewardMap(step?: ChmarlExperimentStep) {
  const rewards = new Map<string, number>();
  for (const reward of step?.rewards ?? []) {
    if (Number.isFinite(reward.value)) rewards.set(reward.component, reward.value);
  }
  return rewards;
}

function componentRows(step?: ChmarlExperimentStep) {
  const rewards = rewardMap(step);
  return componentOrder
    .filter((component) => rewards.has(component))
    .map((component) => ({ component, value: rewards.get(component) ?? 0 }));
}

function rewardLabelFormatter(params: unknown) {
  const value = typeof params === "object" && params !== null && "value" in params
    ? (params as { value?: unknown }).value
    : undefined;
  const numericValue = Array.isArray(value) ? Number(value[0]) : Number(value);
  return Number.isFinite(numericValue) ? numericValue.toFixed(3) : "";
}

export default function ChmarlRewardComponents({ steps, compact = false }: ChmarlRewardComponentsProps) {
  const latest = latestStep(steps);
  const rows = useMemo(() => componentRows(latest), [latest]);
  const global = rows.find((row) => row.component === "global")?.value;
  const state = latest?.state ?? {};

  const option = useMemo(
    () => ({
      grid: { left: 16, right: 14, top: 16, bottom: 22, containLabel: true },
      tooltip: {
        trigger: "axis" as const,
        backgroundColor: "rgba(3,13,24,0.92)",
        borderColor: "rgba(101,228,203,0.28)",
        textStyle: { color: "#e6f7ff" },
      },
      graphic: rows.length === 0
        ? {
            type: "text" as const,
            left: "center",
            top: "middle",
            style: {
              text: "Waiting for CH-MARL reward components",
              fill: "rgba(230,247,255,0.62)",
              fontSize: 12,
              fontWeight: 700,
            },
          }
        : undefined,
      xAxis: {
        type: "category" as const,
        data: rows.map((row) => row.component.replace("constraint_", "constraint ")),
        axisLabel: { color: "rgba(230,247,255,0.58)", interval: 0, rotate: compact ? 25 : 0 },
        axisLine: { lineStyle: { color: "rgba(255,255,255,0.10)" } },
        axisTick: { show: false },
      },
      yAxis: {
        type: "value" as const,
        min: -1,
        max: 1,
        axisLabel: { color: "rgba(230,247,255,0.56)" },
        splitLine: { lineStyle: { color: "rgba(255,255,255,0.08)" } },
      },
      series: [
        {
          name: "Reward component",
          type: "bar" as const,
          barWidth: compact ? 12 : 18,
          data: rows.map((row) => row.value),
          itemStyle: { borderRadius: [6, 6, 0, 0], color: "#65e4cb" },
          label: { show: !compact && rows.length > 0, position: "top" as const, color: "#dffcff", formatter: rewardLabelFormatter },
        },
      ],
    }),
    [compact, rows]
  );

  return (
    <div className="chmarl-reward-panel insight-panel-content">
      <div className="insight-panel-summary">
        <span>Global reward</span>
        <strong>{global === undefined ? "n/a" : global.toFixed(3)}</strong>
        <small>{String(state.rewardFormula ?? "online CH-MARL reward components")}</small>
      </div>
      <Chart option={option} className="insight-chart" />
    </div>
  );
}
