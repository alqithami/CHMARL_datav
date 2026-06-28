import type { ChmarlExperimentStep } from "@/types/chmarl";

export type ChmarlExperimentFeed = {
  source: "runtime";
  steps: ChmarlExperimentStep[];
  experimentId?: string;
  scenarioId?: string;
};

function endpointUrl() {
  return import.meta.env.VITE_CHMARL_EXPERIMENT_URL?.trim() || "/api/chmarl/episode";
}

function extractSteps(payload: unknown): ChmarlExperimentStep[] {
  if (Array.isArray(payload)) return payload as ChmarlExperimentStep[];
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    if (Array.isArray(record.steps)) return record.steps as ChmarlExperimentStep[];
    if (Array.isArray(record.data)) return record.data as ChmarlExperimentStep[];
    if (Array.isArray(record.items)) return record.items as ChmarlExperimentStep[];
  }
  return [];
}

function extractString(payload: unknown, key: string) {
  if (!payload || typeof payload !== "object") return undefined;
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}

export async function loadRuntimeChmarlExperiment(): Promise<ChmarlExperimentFeed | null> {
  const response = await fetch(endpointUrl(), { headers: { Accept: "application/json" } });
  if (!response.ok) return null;

  const payload = await response.json();
  const steps = extractSteps(payload);
  if (steps.length === 0) return null;

  return {
    source: "runtime",
    steps,
    experimentId: extractString(payload, "experimentId") ?? steps[0]?.experimentId,
    scenarioId: extractString(payload, "scenarioId") ?? steps[0]?.scenarioId,
  };
}
