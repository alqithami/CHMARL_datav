import { useMemo } from "react";
import type { Vessel } from "@/data/chmarlData";
import Chart from "../Chart";

export type VesselSpeedProfileProps = {
  vessels: Vessel[];
};

function parseSpeedKnots(speed: string) {
  const parsed = Number.parseFloat(speed.replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function buildBuckets(vessels: Vessel[]) {
  const buckets = [
    { name: "Stationary", value: 0 },
    { name: "Slow", value: 0 },
    { name: "Transit", value: 0 },
    { name: "Fast", value: 0 },
    { name: "Unknown", value: 0 },
  ];

  for (const vessel of vessels) {
    const speed = parseSpeedKnots(vessel.speed);
    if (speed === undefined) buckets[4].value += 1;
    else if (speed <= 0.5) buckets[0].value += 1;
    else if (speed < 5) buckets[1].value += 1;
    else if (speed <= 15) buckets[2].value += 1;
    else buckets[3].value += 1;
  }

  return buckets;
}

export default function VesselSpeedProfile({ vessels }: VesselSpeedProfileProps) {
  const buckets = useMemo(() => buildBuckets(vessels), [vessels]);
  const hasData = vessels.length > 0;

  const option = useMemo(
    () => ({
      grid: { left: 16, right: 20, top: 18, bottom: 18, containLabel: true },
      tooltip: {
        trigger: "axis" as const,
        backgroundColor: "rgba(3,13,24,0.9)",
        borderColor: "rgba(141,220,255,0.28)",
        textStyle: { color: "#e6f7ff" },
      },
      graphic: !hasData
        ? {
            type: "text" as const,
            left: "center",
            top: "middle",
            style: {
              text: "Waiting for live vessel rows",
              fill: "rgba(230,247,255,0.62)",
              fontSize: 13,
              fontWeight: 700,
            },
          }
        : undefined,
      xAxis: {
        type: "category" as const,
        data: buckets.map((item) => item.name),
        axisLabel: { color: "rgba(230,247,255,0.62)", interval: 0 },
        axisTick: { show: false },
        axisLine: { lineStyle: { color: "rgba(255,255,255,0.10)" } },
      },
      yAxis: {
        type: "value" as const,
        minInterval: 1,
        axisLabel: { color: "rgba(230,247,255,0.56)" },
        splitLine: { lineStyle: { color: "rgba(255,255,255,0.08)" } },
      },
      series: [
        {
          name: "Vessels",
          type: "bar" as const,
          data: buckets.map((item) => item.value),
          barWidth: 18,
          itemStyle: {
            borderRadius: [8, 8, 0, 0],
            color: "#8ddcff",
          },
          label: {
            show: hasData,
            position: "top" as const,
            color: "#dffcff",
          },
        },
      ],
    }),
    [buckets, hasData]
  );

  return <Chart option={option} />;
}
