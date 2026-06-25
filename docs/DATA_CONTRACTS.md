# CH-MARL Data Contracts

This document defines the planned data contracts for connecting the CH-MARL DataV dashboard to AIS feeds, port-event streams, maritime GeoJSON layers, and experiment logs.

These contracts are intentionally provider-neutral. MarineTraffic, VesselFinder, internal simulators, CSV exports, and CH-MARL logs should all be normalized into these shapes before reaching the UI.

## Vessel State

```ts
export interface VesselState {
  vesselId: string;
  mmsi?: string;
  imo?: string;
  name: string;
  vesselType?: string;
  cargoClass?: string;
  latitude: number;
  longitude: number;
  speedKnots?: number;
  courseDeg?: number;
  headingDeg?: number;
  navStatus?: string;
  draughtMeters?: number;
  originPort?: string;
  destinationPort?: string;
  eta?: string;
  timestamp: string;
}
```

## Port Event

```ts
export interface PortEvent {
  eventId: string;
  vesselId?: string;
  portId: string;
  berthId?: string;
  eventType:
    | "arrival"
    | "departure"
    | "anchorage_entry"
    | "anchorage_exit"
    | "berth_assigned"
    | "service_started"
    | "service_completed";
  timestamp: string;
  metadata?: Record<string, string | number | boolean>;
}
```

## Maritime GeoJSON Feature

```ts
export interface MaritimeFeatureProperties {
  id: string;
  name: string;
  layerType:
    | "port"
    | "berth"
    | "anchorage"
    | "corridor"
    | "chokepoint"
    | "restricted_zone"
    | "safety_buffer";
  riskLevel?: "low" | "medium" | "high";
  capacity?: number;
}
```

## CH-MARL Experiment Step

```ts
export interface ChmarlExperimentStep {
  experimentId: string;
  scenarioId: string;
  episode: number;
  step: number;
  timestamp?: string;
  state: Record<string, unknown>;
  actions: ChmarlAction[];
  rewards: ChmarlReward[];
  constraints: ChmarlConstraint[];
  fairness?: ChmarlFairnessMetric[];
  hierarchyDecisions: ChmarlHierarchyDecision[];
}
```

## CH-MARL Action

```ts
export interface ChmarlAction {
  agentId: string;
  agentType: "fleet" | "port" | "berth" | "vessel" | "constraint_shield";
  actionType: string;
  actionValue: string | number | boolean | Record<string, unknown>;
  targetId?: string;
}
```

## Reward Component

```ts
export interface ChmarlReward {
  agentId?: string;
  component:
    | "throughput"
    | "delay"
    | "fuel"
    | "emissions"
    | "safety"
    | "fairness"
    | "constraint_penalty"
    | "global";
  value: number;
}
```

## Constraint Metric

```ts
export interface ChmarlConstraint {
  constraintId: string;
  name: string;
  value: number;
  limit: number;
  satisfied: boolean;
  severity: "low" | "medium" | "high";
  targetId?: string;
}
```

## Fairness Metric

```ts
export interface ChmarlFairnessMetric {
  metricId: string;
  name: string;
  value: number;
  groupBy: "vessel" | "port" | "cargo_class" | "operator" | "region";
}
```

## Hierarchy Decision

```ts
export interface ChmarlHierarchyDecision {
  level: "coordinator" | "fleet" | "port" | "berth" | "vessel" | "shield";
  decisionId: string;
  decisionLabel: string;
  rationale?: string;
  affectedAgents?: string[];
}
```

## Scenario Definition

```ts
export interface ScenarioDefinition {
  scenarioId: string;
  label: string;
  description: string;
  policyMode: "baseline" | "congestion" | "disruption" | "emissions_aware" | "fairness_aware";
  dataSource: "mock" | "csv" | "api" | "experiment_log";
}
```

## Export Manifest

```ts
export interface DashboardExportManifest {
  exportId: string;
  createdAt: string;
  scenarioId: string;
  experimentId?: string;
  includedPanels: string[];
  formats: ("png" | "csv" | "json")[];
  notes?: string;
}
```

## Integration Rule

All external providers and simulator outputs should be converted into these provider-neutral contracts first. UI components should consume normalized data only.
