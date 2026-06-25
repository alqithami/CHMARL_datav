# CH-MARL DataV Platform

A CH-MARL-focused geospatial visualization platform for maritime logistics, ship movement, port operations, and constrained hierarchical multi-agent reinforcement learning experiments.

This repository was initialized from the English Three.js/React/ECharts dashboard baseline and is now prepared as the dedicated CH-MARL interface and platform repository.

## Purpose

The platform is intended to become the visualization and experiment-control layer for CH-MARL maritime logistics research. It is designed to display vessel trajectories, port and berth utilization, MARL policy behavior, constraints, reward trends, risk indicators, emissions, ETA performance, and live transportation events.

## Initial Interface

The current UI includes:

- A 3D maritime operations scene with vessels, ports, routes, corridor markers, and animated movement.
- KPI cards for active vessels, port calls, constraint satisfaction, reward score, average ETA error, and emissions intensity.
- ECharts panels for reward trends, constraint pressure, and port utilization.
- A live vessel table with status, route, cargo, ETA, speed, and constraint flags.
- A decision timeline showing CH-MARL hierarchy actions and platform events.

## Simulated Outcome

The current dashboard uses deterministic mock data in `src/data/chmarlData.ts`. It is not yet connected to AIS feeds, port APIs, or CH-MARL experiment logs.

When you run it locally, you should see:

1. A dark maritime command-center interface.
2. A CH-MARL header with scenario pills for real-time stream, congestion-aware policy, and emissions shield.
3. Six KPI cards showing active vessels, port calls, constraint score, reward index, ETA error, and CO2 intensity.
4. A central 3D ocean scene with labeled ports, route lines, and animated vessel markers.
5. Left-side charts for policy reward and constraint pressure.
6. Right-side panels for port utilization and hierarchical decision events.
7. A live vessel state table at the bottom.

This simulated screen is meant to validate the platform layout, visual hierarchy, and dashboard components before connecting real CH-MARL data.

## Technology Stack

- React 19
- TypeScript
- Vite
- Three.js
- @react-three/fiber
- @react-three/drei
- ECharts

## Development

### Requirements

- Node.js >= 18
- PNPM >= 8

### Install

```bash
pnpm install
```

### Run

```bash
pnpm dev
```

After running `pnpm dev`, open the local URL printed in your terminal, usually:

```text
http://localhost:5173/
```

### Build

```bash
pnpm build
```

### Preview

```bash
pnpm preview
```

## Local Validation Checklist

Please run these locally when you are ready:

```bash
pnpm install
pnpm dev
```

Then, in a second validation pass:

```bash
pnpm build
pnpm preview
```

A successful build means the migrated UI compiles and the dashboard can be deployed. If `pnpm build` fails, copy the terminal output and we can fix the exact TypeScript or Vite issue.

## Deployment Base Path

The Vite base path is configurable for GitHub Pages or subpath deployment:

```bash
VITE_BASE_PATH=/CHMARL_datav/ pnpm build
```

## Current Repository File Map

```text
.
├── README.md
├── index.html
├── package.json
├── vite.config.ts
├── tsconfig.json
├── tsconfig.app.json
├── tsconfig.node.json
├── eslint.config.js
└── src/
    ├── App.tsx
    ├── main.tsx
    ├── index.css
    ├── data/
    │   └── chmarlData.ts
    └── components/
        ├── Chart.tsx
        ├── DashboardShell.tsx
        ├── DecisionTimeline.tsx
        ├── MetricCard.tsx
        ├── PanelCard.tsx
        ├── ShipScene.tsx
        ├── VesselTable.tsx
        └── charts/
            ├── ConstraintChart.tsx
            ├── PortUtilizationChart.tsx
            └── RewardTrend.tsx
```

## Suggested Repository About Description

Set the GitHub About description to:

> CH-MARL maritime logistics dashboard for AIS-informed vessel, port, route, reward, and constraint visualization.

Suggested topics:

```text
chmarl, multi-agent-reinforcement-learning, maritime-logistics, ais, threejs, react, echarts, geospatial-visualization
```

## Next CH-MARL Platform Milestones

1. Replace mock data with AIS/port-event adapters.
2. Add maritime GeoJSON layers for ports, corridors, anchorages, chokepoints, and berth areas.
3. Connect CH-MARL experiment logs for state, action, reward, constraint, fairness, and hierarchy-level decisions.
4. Add scenario switching for baseline, congestion, disruption, emissions-aware, and fairness-aware experiments.
5. Add exportable dashboards for figures, demos, and paper-ready visual evidence.
