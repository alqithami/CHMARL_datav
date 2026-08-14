# CH-MARL DataV Platform

A Vite + React + TypeScript portal for CH-MARL maritime logistics, developed with the IBM Impact Accelerator for port optimization in Saudi ports and nearby regions.

The service is designed to run continuously on live sources: AIS vessel positions, Open-Meteo marine weather, AIS-derived port events, and **EcoFair-CH-MARL measures** such as emission budgets, the primal-dual emission price, fuel-based Gini and max-min fairness, and the paper's reward decomposition. Deployment liveness and vessel-data readiness are reported separately. When the external AIS provider is connected but silent, the dashboard remains available while `/health/ready` truthfully reports that live vessel data is not ready; sample data is not presented as current operational data. See [`docs/ECOFAIR_MEASURES.md`](docs/ECOFAIR_MEASURES.md), the paper ([arXiv:2603.14625](https://arxiv.org/abs/2603.14625)), and the reference implementation ([EcoFairCHAMRL](https://github.com/alqithami/EcoFairCHAMRL)).

## Quick Start

```bash
git clone https://github.com/alqithami/CHMARL_datav.git
cd CHMARL_datav
corepack enable
pnpm install --frozen-lockfile
pnpm build
pnpm dev:codespaces
```

Open the forwarded Vite port from the Codespaces **Ports** tab, usually port `5173`.

## One-Terminal Remote Feed Demo

To run both the local vessel-feed proxy and the dashboard from one Codespaces terminal:

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm dev:proxy
```

This starts:

```text
http://localhost:8787/api/vessels   # local vessel feed proxy
http://localhost:5173/              # dashboard
```

Open port `5173` from the Codespaces **Ports** tab. The dashboard should show:

```text
Data: remote
```

The dashboard refreshes vessel data every 30 seconds and also includes a manual **Refresh** button in the header.

## Current Status

| Area | Status |
| --- | --- |
| Dashboard shell | Implemented |
| Vessel inspection map | Implemented with map tiles, clickable ship markers, vessel trails, hover cards, filters, fit controls, port-event markers, and detail cards |
| KPI, reward, constraint, port, timeline, and vessel-table panels | Implemented |
| Local JSON sample data layer | Implemented in `public/data/` |
| Remote vessel feed | Implemented through `VITE_VESSEL_DATA_URL` |
| Local vessel-feed proxy | Implemented in `server/vessel-feed-proxy/` |
| Manual and timed vessel refresh | Implemented |
| Dashboard data loading | Implemented through `src/data/loadSampleDashboardData.ts` |
| CH-MARL TypeScript contracts | Implemented in `src/types/chmarl.ts` |
| Vessel/AIS adapter scaffold | Implemented in `src/adapters/aisAdapter.ts` |
| Port-event adapter scaffold | Implemented in `src/adapters/portEventAdapter.ts` |
| Experiment-log adapter scaffold | Implemented in `src/adapters/experimentLogAdapter.ts` |
| Scenario catalog | Implemented in `src/scenarios/scenarioCatalog.ts` |
| Interactive scenario switching | Implemented |
| Dashboard export tools | Implemented for JSON snapshots, vessel CSV, and paper-ready Markdown reports |
| Live AIS connection (aisstream.io) | Implemented behind the proxy (`AISSTREAM_API_KEY`); provider availability and message freshness are exposed separately from deployment liveness |
| EcoFair-CH-MARL live measures | Implemented in `server/vessel-feed-proxy/ecofair.mjs` (fuel cubic law, emission budget + dual price, fuel Gini / max-min, reward decomposition) |
| AIS-derived port events, queues, and berth utilization | Implemented (geofence transitions; demo events opt-in only) |
| Server-side evidence report | Implemented at `GET /api/report` (Markdown, `?format=json`) |
| EcoFairCHMARL.py research-run ingestion | Implemented via `scripts/chmarl-ingest-bridge.py` and `GET /api/chmarl/episode?source=experiment` |
| Release-aware production monitoring | Implemented through `.github/workflows/production-monitor.yml` and `pnpm monitor:production` |

## Middle Map

The center panel uses a tile-based maritime map centered on the Red Sea region, with port markers, port-event markers, route overlays, clickable vessel figurines, hover cards, status filters, fit-to-vessels control, recent movement trails, and an inspection card for each selected vessel.

The current tile layer uses OpenStreetMap map tiles with visible attribution. A Google Maps layer can be added later if a Google Maps Platform API key and billing project are available.

## Export Tools

The dashboard header includes:

```text
Export JSON
Export CSV
Export Report
```

`Export JSON` downloads a scenario snapshot containing metrics, vessels, port events, reward trends, constraint pressure, port utilization, and timeline events. `Export CSV` downloads the current vessel table with coordinates, status, and trail-count metadata. `Export Report` downloads a paper-ready Markdown evidence report summarizing the scenario, KPI table, vessel-status distribution, port-event distribution, constraint pressure, port utilization, and hierarchy decision timeline.

## Local Data Fixtures

The first data-driven mock layer is available under `public/data/`:

```text
public/data/vessels.sample.json
public/data/port_events.sample.json
public/data/chmarl_episode.sample.json
public/data/maritime_layers.sample.geojson
```

The dashboard fetches these files at runtime and falls back to bundled data only where the active runtime configuration permits it. The production Render configuration disables sample vessel and CH-MARL data.

## Remote Vessel Feed

The frontend can read vessel rows from a backend endpoint through:

```env
VITE_VESSEL_DATA_URL=http://localhost:8787/api/vessels
```

See [`docs/REMOTE_VESSEL_FEED.md`](docs/REMOTE_VESSEL_FEED.md) and [`server/vessel-feed-proxy/README.md`](server/vessel-feed-proxy/README.md).

## Documentation

- EcoFair-CH-MARL live measures: [`docs/ECOFAIR_MEASURES.md`](docs/ECOFAIR_MEASURES.md)
- Production monitoring: [`docs/PRODUCTION_MONITORING.md`](docs/PRODUCTION_MONITORING.md)
- CI and runtime governance: [`docs/CI_RUNTIME_GOVERNANCE.md`](docs/CI_RUNTIME_GOVERNANCE.md)
- Roadmap: [`docs/ROADMAP.md`](docs/ROADMAP.md)
- Data contracts: [`docs/DATA_CONTRACTS.md`](docs/DATA_CONTRACTS.md)
- Remote vessel feed: [`docs/REMOTE_VESSEL_FEED.md`](docs/REMOTE_VESSEL_FEED.md)

## Development Commands

```bash
pnpm dev                 # start local dev server
pnpm dev:codespaces      # start Vite for Codespaces
pnpm proxy               # start the vessel-feed proxy only
pnpm dev:proxy           # start proxy and dashboard from one terminal
pnpm build               # type-check and build production output
pnpm check               # CI contract, lint, build, and runtime smoke test
pnpm monitor:production  # inspect the deployed Render release and AIS state
pnpm preview             # preview production build
pnpm lint                # run ESLint
```

## CI and deployment monitoring

`Build` is the single authoritative automatic workflow for pull requests and `main` pushes. It validates the CI contract, installs the frozen lockfile, lints, builds, runs backend smoke tests, verifies artifacts, builds the production Docker image, and starts that image for endpoint checks.

`CI` is retained as a manually dispatched operator verification path. It is not triggered automatically, which prevents duplicate build notifications.

`Production deployment monitor` runs after a successful main-branch Build, every six hours, or manually. It waits for the exact commit to reach Render, verifies `/health/live`, `/version`, the dashboard HTML, `/health/ready`, and `/api/vessels`, and uploads a retained report. AIS provider silence produces a warning rather than a false deployment failure unless strict data readiness is explicitly requested.

## GitHub Pages Build

```bash
VITE_BASE_PATH=/CHMARL_datav/ pnpm build
```
