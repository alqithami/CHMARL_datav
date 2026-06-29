import { useMemo } from "react";
import Chart from "../Chart";

export type PortUtilizationChartProps = {
  data: { name: string; value: number }[];
};

export default function PortUtilizationChart({ data }: PortUtilizationChartProps) {
  const option = useMemo(
    () => ({
      tooltip: { trigger: "item" as const },
      graphic: data.length === 0 ? {
        type: "text" as const,
        left: "center",
        top: "middle",
        style: { text: "Port feed not connected", fill: "rgba(230,247,255,0.62)", fontSize: 13, fontWeight: 700 },
      } : undefined,
      series: data.length === 0 ? [] : [
        {
          type: "pie" as const,
          radius: ["48%", "72%"],
          center: ["50%", "52%"],
          label: { show: true, formatter: "{b}\n{c}" },
          data,
        },
      ],
    }),
    [data]
  );

  return <Chart option={option} />;
}
