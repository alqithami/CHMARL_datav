import type { MarineWeatherPoint } from "@/providers/weatherProvider";

export type MarineWeatherOverviewProps = {
  points: MarineWeatherPoint[];
  compact?: boolean;
};

function format(value: number | undefined, suffix: string, digits = 1) {
  return typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(digits)}${suffix}` : "n/a";
}

function providerLabel(point: MarineWeatherPoint) {
  if (point.provider?.includes("forecast")) return "forecast fallback";
  if (point.provider?.includes("marine")) return "marine";
  if (point.waveHeightM !== undefined) return "marine";
  return "weather";
}

export default function MarineWeatherOverview({ points, compact = false }: MarineWeatherOverviewProps) {
  const marinePoints = points.filter((point) => point.waveHeightM !== undefined).length;
  const forecastPoints = points.filter((point) => point.windSpeedMs !== undefined || point.airTemperatureC !== undefined).length;
  const maxWave = points
    .map((point) => point.waveHeightM)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
    .sort((a, b) => b - a)[0];

  return (
    <div className="marine-weather-panel insight-panel-content">
      <div className="insight-panel-summary">
        <span>Weather coverage</span>
        <strong>{points.length}</strong>
        <small>{marinePoints} marine · {forecastPoints} forecast fallback · max wave {format(maxWave, "m")}</small>
      </div>
      <div className={compact ? "weather-point-grid compact" : "weather-point-grid"}>
        {points.length === 0 ? (
          <p className="insight-empty-state">Waiting for backend weather points.</p>
        ) : points.map((point) => (
          <article key={point.locationId} className="weather-point-card">
            <div>
              <strong>{point.name}</strong>
              <span>{providerLabel(point)}</span>
            </div>
            <dl>
              <div><dt>Wave</dt><dd>{format(point.waveHeightM, "m")}</dd></div>
              <div><dt>Wind</dt><dd>{format(point.windSpeedMs, "m/s")}</dd></div>
              <div><dt>Sea</dt><dd>{format(point.seaSurfaceTemperatureC, "°C")}</dd></div>
              <div><dt>Air</dt><dd>{format(point.airTemperatureC, "°C")}</dd></div>
            </dl>
          </article>
        ))}
      </div>
    </div>
  );
}
