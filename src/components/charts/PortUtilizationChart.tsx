import { useMemo } from "react";
import Chart from "../Chart";

export type PortUtilizationChartProps = {
  data: { name: string; value: number }[];
};

function sortedData(data: { name: string; value: number }[]) {
  return [...data].sort((a, b) => b.value - a.value).slice(0, 10);
}

function pressureLabel(value: number) {
  if (value >= 90) return "critical";
  if (value >= 75) return "watch";
  return "normal";
}

export default function PortUtilizationChart({ data }: PortUtilizationChartProps) {
  const rows = useMemo(() => sortedData(data), [data]);
  const option = useMemo(
    () => ({
      grid: { left: 94, right: 28, top: 16, bottom: 26, containLabel: false },
      tooltip: {
        trigger: "axis" as const,
        axisPointer: { type: "shadow" as const },
        formatter: (items: unknown) => {
          const item = Array.isArray(items) ? items[0] as { name: string; value: number } : items as { name: string; value: number };
          return `${item.name}<br/>Utilization: ${item.value}%<br/>State: ${pressureLabel(Number(item.value))}`;
        },
      },
      graphic: rows.length === 0 ? {
        type: "text" as const,
        left: "center",
        top: "middle",
        style: { text: "Port feed not connected", fill: "rgba(230,247,255,0.62)", fontSize: 13, fontWeight: 700 },
      } : undefined,
      xAxis: {
        type: "value" as const,
        min: 0,
        max: 100,
        axisLabel: { color: "rgba(230,247,255,0.56)", formatter: "{value}%" },
        splitLine: { lineStyle: { color: "rgba(255,255,255,0.08)" } },
      },
      yAxis: {
        type: "category" as const,
        inverse: true,
        data: rows.map((row) => row.name),
        axisLabel: { color: "rgba(230,247,255,0.68)", fontWeight: 700, width: 86, overflow: "truncate" as const },
        axisTick: { show: false },
        axisLine: { show: false },
      },
      series: rows.length === 0 ? [] : [
        {
          type: "bar" as const,
          name: "Utilization",
          data: rows.map((row) => row.value),
          barWidth: 12,
          itemStyle: { borderRadius: [0, 7, 7, 0], color: "#65e4cb" },
          label: { show: true, position: "right" as const, color: "#dffcff", formatter: "{c}%" },
        },
      ],
    }),
    [rows]
  );

  return <Chart option={option} />;
}
