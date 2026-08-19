import { useEffect, useId, useRef, type CSSProperties } from "react";
import {
  init,
  use as useECharts,
  type ECharts,
  type EChartsCoreOption,
} from "echarts/core";
import { BarChart, LineChart } from "echarts/charts";
import {
  AxisPointerComponent,
  GraphicComponent,
  GridComponent,
  TooltipComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

useECharts([
  BarChart,
  LineChart,
  AxisPointerComponent,
  GraphicComponent,
  GridComponent,
  TooltipComponent,
  CanvasRenderer,
]);

export type ChartProps = {
  option: EChartsCoreOption;
  ariaLabel: string;
  summary: string;
  className?: string;
};

const visuallyHiddenStyle: CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
  border: 0,
};

export default function Chart({
  option,
  ariaLabel,
  summary,
  className = "chart-box",
}: ChartProps) {
  const chartRef = useRef<HTMLDivElement | null>(null);
  const chartInstanceRef = useRef<ECharts | null>(null);
  const summaryId = useId();

  useEffect(() => {
    const element = chartRef.current;
    if (!element) return;

    const chart = init(element, undefined, { renderer: "canvas" });
    chartInstanceRef.current = chart;
    let resizeFrame = 0;

    const resize = () => {
      window.cancelAnimationFrame(resizeFrame);
      resizeFrame = window.requestAnimationFrame(() => chart.resize());
    };
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    window.addEventListener("resize", resize);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", resize);
      window.cancelAnimationFrame(resizeFrame);
      chart.dispose();
      chartInstanceRef.current = null;
    };
  }, []);

  useEffect(() => {
    const chart = chartInstanceRef.current;
    if (!chart) return;

    chart.setOption(option, { notMerge: true, lazyUpdate: true });
    chart.resize();
  }, [option]);

  return (
    <>
      <div
        ref={chartRef}
        className={className}
        role="img"
        aria-label={ariaLabel}
        aria-describedby={summaryId}
      />
      <span id={summaryId} style={visuallyHiddenStyle}>
        {summary}
      </span>
    </>
  );
}
