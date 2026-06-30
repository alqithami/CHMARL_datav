import { backendApiCandidates } from "./backendUrl";

export type MarineWeatherPoint = {
  locationId: string;
  name: string;
  latitude: number;
  longitude: number;
  provider?: "open-meteo-marine" | "open-meteo-forecast" | string;
  timestamp?: string;
  waveHeightM?: number;
  wavePeriodS?: number;
  waveDirectionDeg?: number;
  currentVelocityMs?: number;
  currentDirectionDeg?: number;
  seaSurfaceTemperatureC?: number;
  airTemperatureC?: number;
  windSpeedMs?: number;
  windDirectionDeg?: number;
};

export type MarineWeatherFeed = {
  source: "open-meteo" | "runtime" | "none";
  updatedAt: string;
  points: MarineWeatherPoint[];
};

const WEATHER_CACHE_MS = Number(import.meta.env.VITE_WEATHER_CACHE_MS ?? 10 * 60 * 1000);
const WEATHER_TIMEOUT_MS = Number(import.meta.env.VITE_WEATHER_TIMEOUT_MS ?? 3_000);

let cachedWeather: { loadedAt: number; feed: MarineWeatherFeed } | null = null;
let inFlightWeather: Promise<MarineWeatherFeed | null> | null = null;

function endpointUrl() {
  return import.meta.env.VITE_WEATHER_URL?.trim() || "/api/weather";
}

function validFeed(payload: MarineWeatherFeed): MarineWeatherFeed | null {
  if (!Array.isArray(payload.points) || payload.points.length === 0) return null;
  return {
    source: payload.source ?? "runtime",
    updatedAt: payload.updatedAt ?? new Date().toISOString(),
    points: payload.points,
  };
}

async function fetchWithTimeout(url: string) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), WEATHER_TIMEOUT_MS);

  try {
    return await fetch(url, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
  } finally {
    window.clearTimeout(timeout);
  }
}

async function fetchWeather(): Promise<MarineWeatherFeed | null> {
  for (const url of backendApiCandidates(endpointUrl())) {
    try {
      const response = await fetchWithTimeout(url);
      if (!response.ok) continue;
      const payload = await response.json() as MarineWeatherFeed;
      const feed = validFeed(payload);
      if (feed) {
        cachedWeather = { loadedAt: Date.now(), feed };
        return feed;
      }
    } catch {
      // Try the next backend candidate.
    }
  }

  return null;
}

export async function loadMarineWeather(): Promise<MarineWeatherFeed | null> {
  if (cachedWeather && Date.now() - cachedWeather.loadedAt < WEATHER_CACHE_MS) return cachedWeather.feed;

  if (!inFlightWeather) {
    inFlightWeather = fetchWeather().finally(() => {
      inFlightWeather = null;
    });
  }

  return inFlightWeather.catch(() => cachedWeather?.feed ?? null);
}
