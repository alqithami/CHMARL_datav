import { useMemo } from "react";
import Chart from "../Chart";

export type PortUtilizationChartProps = {
  data: { name: string; value: number }[];
};

export default function PortUtilizationChart({ data }: PortUtilizationChartProps) {
  const option = useMemo(
    () => ({
      tooltip: {
        trigger: "item" as const,
        backgroundColor: "rgba(3,13,24,0.9)",
        borderColor: "rgba(141,220,255,0.3)",
        textStyle: { color: "#e6f7ff" },
      },
      series: [
        {
          type: "pie",
          radius: ["48%", "72%"],
          center: ["50%", "52%"],
          avoidLabelOverlap: true,
          label: { color: "rgba(230,247,255,0.76)", formatter: "{b}\n{c}%" },
          labelLine: { lineStyle: { color: "rgba(230,247,255,0.28)" } },
          data,
          itemStyle: {
            borderRadius: 8,
            borderColor: "#04111f",
            borderWidth: 2,
          },
        },
      ],
      color: ["#65e4cb", "#8ddcff", "#ffd780", "#ff9c9c", "#b99cff"],
    }),
    [data]
  );

  return <Chart option={option} />;
}
