export type AisStreamHealth = {
  enabled: boolean;
  connected: boolean;
  lastMessageAt: string | null;
  lastError: string | null;
  reconnectAttempt: number;
  boundingBoxes: number[][][];
  messageCount: number;
  cachedVessels: number;
  cacheLimit: number;
  trailLimit: number;
};

export type BackendHealth = {
  ok: boolean;
  upstreamConfigured: boolean;
  aisstream?: AisStreamHealth;
};

function healthUrl() {
  return import.meta.env.VITE_HEALTH_URL?.trim() || "/health";
}

export async function loadBackendHealth(): Promise<BackendHealth | null> {
  const response = await fetch(healthUrl(), { headers: { Accept: "application/json" } });
  if (!response.ok) return null;
  return response.json() as Promise<BackendHealth>;
}
