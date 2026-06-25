import type { ScenarioDefinition } from "@/types/chmarl";

export const scenarioCatalog: ScenarioDefinition[] = [
  {
    scenarioId: "baseline",
    label: "Baseline",
    description: "Nominal demand, nominal route availability, and nominal port capacity.",
    policyMode: "baseline",
    dataSource: "mock",
  },
  {
    scenarioId: "congestion",
    label: "Congestion-aware",
    description: "Increased arrivals and berth pressure around major ports.",
    policyMode: "congestion",
    dataSource: "mock",
  },
  {
    scenarioId: "disruption",
    label: "Disruption response",
    description: "Route or port disruption requiring policy-level replanning.",
    policyMode: "disruption",
    dataSource: "mock",
  },
  {
    scenarioId: "emissions-aware",
    label: "Emissions-aware",
    description: "Policy mode emphasizes fuel burn and emissions constraints.",
    policyMode: "emissions_aware",
    dataSource: "mock",
  },
  {
    scenarioId: "fairness-aware",
    label: "Fairness-aware",
    description: "Policy mode emphasizes fairness across vessels, ports, and cargo classes.",
    policyMode: "fairness_aware",
    dataSource: "mock",
  },
];

export function getScenarioDefinition(scenarioId: string) {
  return scenarioCatalog.find((scenario) => scenario.scenarioId === scenarioId) ?? scenarioCatalog[0];
}
