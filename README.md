# CH-MARL DataV Platform

A Vite + React + TypeScript dashboard for CH-MARL maritime logistics experiments.

The project is structured as a runnable CH-MARL interface scaffold with a mock maritime operations dashboard, typed data contracts, adapter stubs, interactive scenario switching, and a documented roadmap for AIS, port-event, GeoJSON, experiment-log, scenario, and export integrations.

## Quick Start

```bash
git clone https://github.com/alqithami/CHMARL_datav.git
cd CHMARL_datav
corepack enable
pnpm install
pnpm build
pnpm dev
```

Open the local URL printed by Vite, usually:

```text
http://localhost:5173/
```

## Current Status

| Area | Status |
| --- | --- |
| Dashboard shell | Implemented with mock data |
| 3D maritime scene | Implemented with procedural ports, routes, and animated vessels |
| KPI, reward, constraint, port, timeline, and vessel-table panels | Implemented with mock data |
| CH-MARL TypeScript contracts | Implemented in `src/types/chmarl.ts` |
| AIS adapter scaffold | Implemented in `src/adapters/aisAdapter.ts` |
| Port-event adapter scaffold | Implemented in `src/adapters/portEventAdapter.ts` |
| Experiment-log adapter scaffold | Implemented in `src/adapters/experimentLogAdapter.ts` |
| Scenario catalog | Implemented in `src/scenarios/scenarioCatalog.ts` |
| Interactive scenario switching | Implemented for mock scenario datasets |
| Real AIS / port API / experiment-log connection | Planned |
| Maritime GeoJSON layers | Planned |
| Dashboard export tools | Planned |

## Project Structure

```text
.
├── docs/
│   ├── DATA_CONTRACTS.md
│   └── ROADMAP.md
├── src/
│   ├── adapters/
│   ├── components/
│   ├── data/
│   ├── data/mock/
│   ├── scenarios/
│   ├── types/
│   ├── App.tsx
│   ├── index.css
│   └── main.tsx
├── index.html
├── package.json
├── tsconfig.app.json
├── tsconfig.json
├── tsconfig.node.json
└── vite.config.ts
```

## Documentation

- Roadmap: [`docs/ROADMAP.md`](docs/ROADMAP.md)
- Data contracts: [`docs/DATA_CONTRACTS.md`](docs/DATA_CONTRACTS.md)

## Development Commands

```bash
pnpm dev      # start local dev server
pnpm build    # type-check and build production output
pnpm preview  # preview production build
pnpm lint     # run ESLint
```

## GitHub Pages Build

```bash
VITE_BASE_PATH=/CHMARL_datav/ pnpm build
```


