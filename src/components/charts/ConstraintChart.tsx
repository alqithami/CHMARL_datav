import { useMemo } from "react";
import Chart from "../Chart";

export type ConstraintChartProps = {
  data: { name: string; value: number }[];
};

export default function ConstraintChart({ data }: ConstraintChartProps) {
  const option = useMemo(
    () => ({
      grid: { left: 12, right: 18, top: 16, bottom: 6, containLabel: true },
      graphic: data.length === 0
        ? {
            type: "text" as const,
            left: "center",
            top: "middle",
            style: {
              text: "No vessel-derived constraints available",
              fill: "rgba(230,247,255,0.62)",
              fontSize: 13,
              fontWeight: 700,
            },
          }
        : undefined,
      xAxis: {
        type: "value" as const,
        max: 100,
        axisLabel: { color: "rgba(230,247,255,0.56)" },
        splitLine: { lineStyle: { color: "rgba(255,255,255,0.08)" } },
      },
      yAxis: {
        type: "category" as const,
        data: data.map((item) => item.name),
        axisLabel: { color: "rgba(230,247,255,0.72)" },
        axisTick: { show: false },
        axisLine: { show: false },
      },
      series: [
        {
          type: "bar" as const,
          data: data.map((item) => item.value),
          barWidth: 12,
          itemStyle: {
            borderRadius: 999,
            color: "#65e4cb",
          },
          label: {
            show: data.length > 0,
            position: "right" as const,
            color: "#dffcff",
            formatter: "{c}%",
          },
        },
      ],
    }),
    [data]
  );

  return <Chart option={option} />;
}
