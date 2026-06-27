# CH-MARL DataV Platform

A Vite + React + TypeScript dashboard for CH-MARL maritime logistics experiments.

The project is structured as a runnable CH-MARL interface scaffold with local JSON/GeoJSON sample fixtures, typed data contracts, adapter stubs, interactive scenario switching, remote vessel-feed support, refresh controls, and a documented roadmap for vessel, port-event, GeoJSON, experiment-log, scenario, and export integrations.

## Quick Start

```bash
git clone https://github.com/alqithami/CHMARL_datav.git
cd CHMARL_datav
corepack enable
pnpm install
pnpm build
pnpm dev:codespaces
```

Open the forwarded Vite port from the Codespaces **Ports** tab, usually port `5173`.

## One-Terminal Remote Feed Demo

To run both the local vessel-feed proxy and the dashboard from one Codespaces terminal:

```bash
corepack enable
pnpm install
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
| Vessel inspection map | Implemented with map tiles, clickable ship markers, vessel trails, hover cards, filters, fit controls, and detail cards |
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
| Provider-specific live AIS connection | Planned behind the proxy |
| Dashboard export tools | Planned |

## Middle Map

The center panel now uses a tile-based maritime map centered on the Red Sea region, with port markers, route overlays, clickable vessel figurines, hover cards, status filters, fit-to-vessels control, recent movement trails, and an inspection card for each selected vessel.

The current tile layer uses OpenStreetMap map tiles with visible attribution. A Google Maps layer can be added later if a Google Maps Platform API key and billing project are available.

## Local Data Fixtures

The first data-driven mock layer is available under `public/data/`:

```text
public/data/vessels.sample.json
public/data/port_events.sample.json
public/data/chmarl_episode.sample.json
public/data/maritime_layers.sample.geojson
```

The dashboard fetches these files at runtime and falls back to bundled data if a file cannot be loaded.

## Remote Vessel Feed

The frontend can read vessel rows from a backend endpoint through:

```env
VITE_VESSEL_DATA_URL=http://localhost:8787/api/vessels
```

See [`docs/REMOTE_VESSEL_FEED.md`](docs/REMOTE_VESSEL_FEED.md) and [`server/vessel-feed-proxy/README.md`](server/vessel-feed-proxy/README.md).

## Documentation

- Roadmap: [`docs/ROADMAP.md`](docs/ROADMAP.md)
- Data contracts: [`docs/DATA_CONTRACTS.md`](docs/DATA_CONTRACTS.md)
- Remote vessel feed: [`docs/REMOTE_VESSEL_FEED.md`](docs/REMOTE_VESSEL_FEED.md)

## Development Commands

```bash
pnpm dev             # start local dev server
pnpm dev:codespaces  # start Vite for Codespaces
pnpm proxy           # start the vessel-feed proxy only
pnpm dev:proxy       # start proxy and dashboard from one terminal
pnpm build           # type-check and build production output
pnpm preview         # preview production build
pnpm lint            # run ESLint
```

## CI

The GitHub Actions build workflow is currently manual-only to avoid notification spam during rapid UI commits. Run it from:

```text
GitHub → Actions → CI → Run workflow
```

Local/Codespaces build validation remains:

```bash
pnpm build
```

## GitHub Pages Build

```bash
VITE_BASE_PATH=/CHMARL_datav/ pnpm build
```
