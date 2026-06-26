import { useMemo } from "react";
import Chart from "../Chart";

export type RewardTrendProps = {
  data: (string | number)[][];
};

export default function RewardTrend({ data }: RewardTrendProps) {
  const option = useMemo(
    () => ({
      grid: { left: 12, right: 16, top: 20, bottom: 18, containLabel: true },
      tooltip: {
        trigger: "axis" as const,
        backgroundColor: "rgba(3,13,24,0.9)",
        borderColor: "rgba(101,228,203,0.35)",
        textStyle: { color: "#e6f7ff" },
      },
      xAxis: {
        type: "category" as const,
        data: data.map((item) => item[0]),
        boundaryGap: false,
        axisLabel: { color: "rgba(230,247,255,0.56)" },
        axisLine: { lineStyle: { color: "rgba(255,255,255,0.1)" } },
        axisTick: { show: false },
      },
      yAxis: {
        type: "value" as const,
        min: 0.5,
        max: 0.95,
        axisLabel: { color: "rgba(230,247,255,0.56)" },
        splitLine: { lineStyle: { color: "rgba(255,255,255,0.08)" } },
      },
      series: [
        {
          name: "Reward index",
          type: "line" as const,
          smooth: true,
          showSymbol: false,
          lineStyle: { width: 4, color: "#65e4cb" },
          areaStyle: { color: "rgba(101,228,203,0.14)" },
          data: data.map((item) => item[1]),
        },
      ],
    }),
    [data]
  );

  return <Chart option={option} />;
}
