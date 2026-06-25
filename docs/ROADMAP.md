# CH-MARL Platform Roadmap

This roadmap converts the high-level milestone list into concrete platform workstreams. The current repository contains the first CH-MARL dashboard scaffold with mock data. The following milestones are considered part of the planned platform scope.

## Milestone 1 — AIS and Port-Event Adapters

**Goal:** Replace static mock data with normalized data adapters for vessel movement and port operations.

**Inputs to support:**

- AIS vessel position updates: MMSI, IMO, vessel name, latitude, longitude, speed over ground, course over ground, heading, navigational status, draught, destination, ETA, timestamp.
- Port-call events: arrival, departure, berth assignment, anchorage entry/exit, cargo operation start/end, waiting time, service time.
- Optional operational data: weather, sea state, queue state, fuel price, emissions factors, port capacity.

**Planned modules:**

- `src/adapters/aisAdapter.ts` — added.
- `src/adapters/portEventAdapter.ts` — added.
- `src/types/chmarl.ts` — added.
- `src/data/mock/` for offline scenario fixtures — added.

**Dashboard outputs:**

- Live vessel table.
- Vessel trails and current positions on the 3D scene.
- Port-call timeline.
- Congestion and waiting-time KPIs.

## Milestone 2 — Maritime GeoJSON Layers

**Goal:** Replace the current procedural mock map with real maritime geospatial layers.

**Layers to support:**

- Ports and terminals.
- Berths and berth groups.
- Anchorages.
- Shipping corridors.
- Chokepoints and controlled waterways.
- Restricted zones and safety buffers.
- Optional EEZ, coastal, and weather-risk polygons.

**Planned modules:**

- `src/layers/portsLayer.tsx`
- `src/layers/routesLayer.tsx`
- `src/layers/anchoragesLayer.tsx`
- `src/layers/constraintsLayer.tsx`
- `src/assets/geojson/`

**Dashboard outputs:**

- Maritime base map.
- Route-risk colors.
- Port and anchorage markers.
- Constraint overlays and safety zones.

## Milestone 3 — CH-MARL Experiment Logs

**Goal:** Connect the dashboard to CH-MARL experiment output and show state, action, reward, constraint, fairness, and hierarchy-level decisions.

**Data to support:**

- Global environment state.
- Fleet-level / coordinator-level decisions.
- Port-agent decisions.
- Vessel-agent actions.
- Reward decomposition.
- Constraint penalties and feasibility status.
- Fairness metrics across vessels, ports, cargo classes, or operators.
- Episode, step, seed, and scenario metadata.

**Planned modules:**

- `src/adapters/experimentLogAdapter.ts` — added.
- `src/components/ExperimentTimeline.tsx`
- `src/components/RewardBreakdown.tsx`
- `src/components/ConstraintMonitor.tsx`
- `src/components/FairnessPanel.tsx`

**Dashboard outputs:**

- Decision timeline.
- Reward trend and reward decomposition.
- Constraint-pressure charts.
- Fairness and service-quality indicators.

## Milestone 4 — Scenario Switching

**Goal:** Add scenario switching for CH-MARL demonstrations and ablation comparisons.

**Initial scenarios:**

- `baseline`: nominal demand, nominal port capacity.
- `congestion`: increased arrivals and berth pressure.
- `disruption`: route or port disruption.
- `emissions-aware`: policy emphasizes fuel/emissions constraints.
- `fairness-aware`: policy emphasizes fairness across agents or cargo classes.

**Planned modules:**

- `src/scenarios/scenarioCatalog.ts` — added.
- `src/state/scenarioStore.ts`
- `src/components/ScenarioSwitcher.tsx`

**Dashboard outputs:**

- Scenario pills / tabs.
- Scenario-specific KPIs.
- Before/after policy comparison.
- Constraint and reward changes by scenario.

## Milestone 5 — Exportable Dashboards

**Goal:** Produce reusable visual evidence for papers, slides, demos, and experiment reports.

**Exports to support:**

- Static PNG export for dashboard panels.
- CSV/JSON export for metrics and event tables.
- Scenario summary snapshots.
- Paper-ready visual evidence bundles.

**Planned modules:**

- `src/export/exportDashboardSnapshot.ts`
- `src/export/exportMetrics.ts`
- `src/export/exportExperimentSummary.ts`

**Dashboard outputs:**

- Export buttons for charts and tables.
- Scenario summary artifacts.
- Reproducible figure metadata.

## Current Status

| Milestone | Status | Notes |
| --- | --- | --- |
| AIS and port-event adapters | Adapter scaffold added | Type contracts, AIS normalizer, port-event normalizer, and mock fixtures exist; live adapters are not yet connected. |
| Maritime GeoJSON layers | Planned | Procedural 3D maritime scene exists; real GeoJSON layers are next. |
| CH-MARL experiment logs | Adapter scaffold added | Experiment-step contract and log-to-dashboard helper functions exist; live experiment logs are not yet connected. |
| Scenario switching | Partially scaffolded | Scenario catalog and UI pills exist; interactive scenario data switching is next. |
| Exportable dashboards | Planned | Export requirements defined; implementation is next. |

## Recommended Next Commit

The next implementation commit should wire the scenario catalog and adapter outputs into dashboard state. This will make the scenario pills interactive and let the panels switch between baseline, congestion, disruption, emissions-aware, and fairness-aware mock datasets before live AIS, port-event, or experiment-log sources are introduced.
