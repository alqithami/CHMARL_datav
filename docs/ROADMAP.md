# CH-MARL Platform Roadmap

This roadmap converts the high-level milestone list into concrete platform workstreams. The current repository contains a runnable CH-MARL dashboard scaffold that loads local sample fixtures from `public/data/` and normalizes them through provider-neutral adapters.

## Milestone 1 — AIS and Port-Event Adapters

**Goal:** Replace static mock data with normalized data adapters for vessel movement and port operations.

**Inputs to support:**

- AIS vessel position updates: MMSI, IMO, vessel name, latitude, longitude, speed over ground, course over ground, heading, navigational status, draught, destination, ETA, timestamp.
- Port-call events: arrival, departure, berth assignment, anchorage entry/exit, cargo operation start/end, waiting time, service time.
- Optional operational data: weather, sea state, queue state, fuel price, emissions factors, port capacity.

**Implemented modules:**

- `src/adapters/aisAdapter.ts`
- `src/adapters/portEventAdapter.ts`
- `src/types/chmarl.ts`
- `src/data/loadSampleDashboardData.ts`
- `public/data/vessels.sample.json`
- `public/data/port_events.sample.json`

**Dashboard outputs:**

- Live vessel table from local fixture data.
- Port-call summary metrics from local fixture data.
- Congestion and waiting-time KPIs through scenario transforms.

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

**Implemented seed file:**

- `public/data/maritime_layers.sample.geojson`

**Planned modules:**

- `src/layers/portsLayer.tsx`
- `src/layers/routesLayer.tsx`
- `src/layers/anchoragesLayer.tsx`
- `src/layers/constraintsLayer.tsx`

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

**Implemented modules:**

- `src/adapters/experimentLogAdapter.ts`
- `public/data/chmarl_episode.sample.json`

**Planned modules:**

- `src/components/ExperimentTimeline.tsx`
- `src/components/RewardBreakdown.tsx`
- `src/components/ConstraintMonitor.tsx`
- `src/components/FairnessPanel.tsx`

**Dashboard outputs:**

- Decision timeline from local CH-MARL fixture data.
- Reward trend from local CH-MARL fixture data.
- Constraint-pressure chart from local CH-MARL fixture data.
- Fairness and service-quality indicators.

## Milestone 4 — Scenario Switching

**Goal:** Add scenario switching for CH-MARL demonstrations and ablation comparisons.

**Initial scenarios:**

- `baseline`: nominal demand, nominal port capacity.
- `congestion`: increased arrivals and berth pressure.
- `disruption`: route or port disruption.
- `emissions-aware`: policy emphasizes fuel/emissions constraints.
- `fairness-aware`: policy emphasizes fairness across agents or cargo classes.

**Implemented modules:**

- `src/scenarios/scenarioCatalog.ts`
- Scenario buttons in `src/components/DashboardShell.tsx`
- Scenario-specific transforms over local fixture-driven dashboard data

**Dashboard outputs:**

- Scenario pills / tabs.
- Scenario-specific KPIs.
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
| AIS and port-event adapters | Local fixture integration added | AIS and port-event sample files are loaded from `public/data/` and normalized through adapters. |
| Maritime GeoJSON layers | Seed fixture added | Sample GeoJSON exists; rendering real GeoJSON layers in the 3D scene is next. |
| CH-MARL experiment logs | Local fixture integration added | CH-MARL episode sample file drives reward, constraint, and timeline panels. |
| Scenario switching | Implemented for local fixture data | Scenario pills switch dashboard transformations for baseline, congestion, disruption, emissions-aware, and fairness-aware modes. |
| Exportable dashboards | Planned | Export requirements defined; implementation is next. |

## Recommended Next Commit

The next implementation commit should render the sample GeoJSON features in the 3D scene and add basic export utilities for JSON/CSV summaries.
