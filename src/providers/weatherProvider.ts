export type MarineWeatherPoint = {
  locationId: string;
  name: string;
  latitude: number;
  longitude: number;
  timestamp?: string;
  waveHeightM?: number;
  wavePeriodS?: number;
  waveDirectionDeg?: number;
  currentVelocityMs?: number;
  currentDirectionDeg?: number;
  seaSurfaceTemperatureC?: number;
};

export type MarineWeatherFeed = {
  source: "open-meteo" | "runtime" | "none";
  updatedAt: string;
  points: MarineWeatherPoint[];
};

function endpointUrl() {
  return import.meta.env.VITE_WEATHER_URL?.trim() || "/api/weather";
}

export async function loadMarineWeather(): Promise<MarineWeatherFeed | null> {
  const response = await fetch(endpointUrl(), { headers: { Accept: "application/json" } });
  if (!response.ok) return null;
  const payload = await response.json() as MarineWeatherFeed;
  if (!Array.isArray(payload.points) || payload.points.length === 0) return null;
  return {
    source: payload.source ?? "runtime",
    updatedAt: payload.updatedAt ?? new Date().toISOString(),
    points: payload.points,
  };
}
