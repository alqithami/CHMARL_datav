export type AgentType = string;

export type ConstraintSeverity = "low" | "medium" | "high";

export type MaritimeLayerType = string;

export type PolicyMode =
  | "baseline"
  | "congestion"
  | "disruption"
  | "emissions_aware"
  | "fairness_aware";

export type DataSourceKind = "mock" | "csv" | "api" | "experiment_log";

export interface VesselState {
  vesselId: string;
  mmsi?: string;
  imo?: string;
  name: string;
  vesselType?: string;
  cargoClass?: string;
  latitude?: number;
  longitude?: number;
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

export interface MaritimeFeatureProperties {
  id: string;
  name: string;
  layerType: MaritimeLayerType;
  riskLevel?: ConstraintSeverity;
  capacity?: number;
}

export interface ChmarlExperimentStep {
  experimentId: string;
  scenarioId: string;
  episode: number;
  step: number;
  timestamp?: string;
  state: Record<string, unknown>;
  actions?: ChmarlAction[];
  rewards?: ChmarlReward[];
  constraints?: ChmarlConstraint[];
  fairness?: ChmarlFairnessMetric[];
  hierarchyDecisions?: ChmarlHierarchyDecision[];
}

export interface ChmarlAction {
  agentId: string;
  agentType: AgentType;
  actionType: string;
  actionValue: string | number | boolean | Record<string, unknown>;
  targetId?: string;
}

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

export interface ChmarlConstraint {
  constraintId: string;
  name: string;
  value: number;
  limit: number;
  satisfied: boolean;
  severity: ConstraintSeverity;
  targetId?: string;
}

export interface ChmarlFairnessMetric {
  metricId: string;
  name: string;
  value: number;
  groupBy: "vessel" | "port" | "cargo_class" | "operator" | "region";
}

export interface ChmarlHierarchyDecision {
  level: string;
  decisionId: string;
  decisionLabel: string;
  rationale?: string;
  affectedAgents?: string[];
}

export interface ScenarioDefinition {
  scenarioId: string;
  label: string;
  policyMode: PolicyMode;
  description: string;
  dataSource?: DataSourceKind;
  assumptions?: string[];
  overlays?: string[];
}
