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
  source: "open-meteo" | "runtime";
  updatedAt: string;
  points: MarineWeatherPoint[];
};

const defaultWeatherPoints = [
  { locationId: "suez", name: "Suez", latitude: 29.9668, longitude: 32.5498 },
  { locationId: "jeddah", name: "Jeddah", latitude: 21.4858, longitude: 39.1925 },
  { locationId: "yanbu", name: "Yanbu", latitude: 24.0866, longitude: 38.0637 },
  { locationId: "jizan", name: "Jizan", latitude: 16.8917, longitude: 42.5511 },
  { locationId: "dammam", name: "Dammam", latitude: 26.4318, longitude: 50.1015 },
  { locationId: "jebel-ali", name: "Jebel Ali", latitude: 25.0114, longitude: 55.0611 },
];

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function nearestHourIndex(times: unknown[]) {
  const now = Date.now();
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (let index = 0; index < times.length; index += 1) {
    const value = times[index];
    if (typeof value !== "string") continue;
    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp)) continue;
    const distance = Math.abs(timestamp - now);
    if (distance < bestDistance) {
      bestIndex = index;
      bestDistance = distance;
    }
  }

  return bestIndex;
}

function valueAt(payload: Record<string, unknown>, key: string, index: number) {
  const values = payload[key];
  return Array.isArray(values) ? numberValue(values[index]) : undefined;
}

async function loadOpenMeteoPoint(point: (typeof defaultWeatherPoints)[number]): Promise<MarineWeatherPoint | null> {
  const params = new URLSearchParams({
    latitude: String(point.latitude),
    longitude: String(point.longitude),
    hourly: "wave_height,wave_period,wave_direction,ocean_current_velocity,ocean_current_direction,sea_surface_temperature",
    forecast_days: "1",
    timezone: "UTC",
  });

  const response = await fetch(`https://marine-api.open-meteo.com/v1/marine?${params.toString()}`);
  if (!response.ok) return null;

  const payload = await response.json() as { hourly?: Record<string, unknown> };
  const hourly = payload.hourly;
  if (!hourly || !Array.isArray(hourly.time)) return null;

  const index = nearestHourIndex(hourly.time);
  const timestamp = typeof hourly.time[index] === "string" ? hourly.time[index] : undefined;

  return {
    ...point,
    timestamp,
    waveHeightM: valueAt(hourly, "wave_height", index),
    wavePeriodS: valueAt(hourly, "wave_period", index),
    waveDirectionDeg: valueAt(hourly, "wave_direction", index),
    currentVelocityMs: valueAt(hourly, "ocean_current_velocity", index),
    currentDirectionDeg: valueAt(hourly, "ocean_current_direction", index),
    seaSurfaceTemperatureC: valueAt(hourly, "sea_surface_temperature", index),
  };
}

async function loadRuntimeWeather(): Promise<MarineWeatherFeed | null> {
  const endpoint = import.meta.env.VITE_WEATHER_URL?.trim();
  if (!endpoint) return null;

  const response = await fetch(endpoint, { headers: { Accept: "application/json" } });
  if (!response.ok) return null;
  const payload = await response.json() as Partial<MarineWeatherFeed>;
  if (!Array.isArray(payload.points) || payload.points.length === 0) return null;

  return {
    source: "runtime",
    updatedAt: payload.updatedAt ?? new Date().toISOString(),
    points: payload.points,
  };
}

export async function loadMarineWeather(): Promise<MarineWeatherFeed | null> {
  const runtime = await loadRuntimeWeather().catch(() => null);
  if (runtime) return runtime;

  const settled = await Promise.allSettled(defaultWeatherPoints.map(loadOpenMeteoPoint));
  const points = settled
    .map((result) => result.status === "fulfilled" ? result.value : null)
    .filter((point): point is MarineWeatherPoint => point !== null);

  if (points.length === 0) return null;

  return {
    source: "open-meteo",
    updatedAt: new Date().toISOString(),
    points,
  };
}
