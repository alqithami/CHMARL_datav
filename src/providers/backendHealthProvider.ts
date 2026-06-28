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
  cacheEnabled?: boolean;
  cacheFile?: string | null;
  cacheFlushMs?: number;
  cacheLoadedAt?: string | null;
  cacheSavedAt?: string | null;
  cacheSaveError?: string | null;
  restoredVessels?: number;
};

export type ChmarlRuntimeHealth = {
  enabled: boolean;
  active: boolean;
  source: "file" | "url" | string;
  configuredUrl: boolean;
  file: string;
  steps: number;
  experimentId: string | null;
  scenarioId: string | null;
  lastLoadedAt: string | null;
  lastError: string | null;
};

export type BackendHealth = {
  ok: boolean;
  upstreamConfigured: boolean;
  staticDashboard?: boolean;
  aisstream?: AisStreamHealth;
  chmarl?: ChmarlRuntimeHealth;
};

function healthUrl() {
  return import.meta.env.VITE_HEALTH_URL?.trim() || "/health";
}

export async function loadBackendHealth(): Promise<BackendHealth | null> {
  const response = await fetch(healthUrl(), { headers: { Accept: "application/json" } });
  if (!response.ok) return null;
  return response.json() as Promise<BackendHealth>;
}
