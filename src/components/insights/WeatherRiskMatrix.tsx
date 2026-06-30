import type { MarineWeatherPoint } from "@/providers/weatherProvider";

export type WeatherRiskMatrixProps = {
  points: MarineWeatherPoint[];
  compact?: boolean;
};

function riskScore(point: MarineWeatherPoint) {
  let score = 0;
  const reasons: string[] = [];
  if (typeof point.waveHeightM === "number") {
    if (point.waveHeightM >= 2.5) { score += 45; reasons.push("high waves"); }
    else if (point.waveHeightM >= 1.5) { score += 25; reasons.push("moderate waves"); }
  }
  if (typeof point.windSpeedMs === "number") {
    if (point.windSpeedMs >= 18) { score += 40; reasons.push("strong wind"); }
    else if (point.windSpeedMs >= 10) { score += 20; reasons.push("wind watch"); }
  }
  if (typeof point.seaSurfaceTemperatureC === "number" && point.seaSurfaceTemperatureC >= 34) { score += 10; reasons.push("high sea temp"); }
  return { point, score, reasons };
}

function tone(score: number) {
  if (score >= 60) return "alert";
  if (score >= 25) return "warning";
  return "nominal";
}

export default function WeatherRiskMatrix({ points, compact = false }: WeatherRiskMatrixProps) {
  const rows = points.map(riskScore).sort((a, b) => b.score - a.score).slice(0, compact ? 5 : points.length);
  const watches = rows.filter((row) => row.score >= 25).length;

  return (
    <div className="weather-risk-matrix insight-panel-content">
      <div className="insight-panel-summary">
        <span>Weather risk</span>
        <strong>{watches}</strong>
        <small>wave, wind, and temperature watch rows</small>
      </div>
      <div className={compact ? "weather-risk-list compact" : "weather-risk-list"}>
        {rows.length === 0 ? (
          <p className="insight-empty-state">Waiting for weather points.</p>
        ) : rows.map(({ point, score, reasons }) => (
          <article key={point.locationId} className="weather-risk-row">
            <div>
              <strong>{point.name}</strong>
              <small>{reasons.join(" · ") || point.provider || "nominal weather"}</small>
            </div>
            <span className={`ship-status ${tone(score)}`}>{score}</span>
          </article>
        ))}
      </div>
    </div>
  );
}
