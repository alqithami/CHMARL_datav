# Always-on deployment outside Codespaces

The portal runs as one production web service. The backend serves `/api/*`, `/health`, and the built React dashboard from `dist/`. Codespaces is only a development environment; do not use a forwarded `*.app.github.dev` URL as the permanent portal URL.

## Production architecture

The Render service keeps two vessel scopes:

1. **Tracking scope** — all AIS/API/fixed rows returned by `/api/vessels` and shown on the map/table.
2. **Operational scope** — only vessels within `ECOFAIR_OPERATIONAL_RADIUS_NM` of monitored ports, used for EcoFair-CH-MARL fuel, CO2, fairness, queue, reward, and constraint calculations.

The backend AIS websocket and EcoFair tick run independently of browser clients. Closing the dashboard does not stop them.

## Repository deployment files

- `render.yaml` — paid Docker web service, one instance, 1 GB persistent disk.
- `Dockerfile` — builds the Vite dashboard and starts the backend.
- `scripts/start-prod.mjs` — production bootstrap without overriding persistent paths.
- `/health` — health, tracking scope, operational scope, background tick, and persistence diagnostics.

The stable service URL is:

```text
https://chmarl-datav.onrender.com/
```

## Required secret variables

Set secrets in Render, never in Git:

```text
AISSTREAM_API_KEY=<server-side key>
UPSTREAM_VESSEL_DATA_TOKEN=<optional>
FIXED_VESSEL_INGEST_TOKEN=<optional>
CHMARL_EXPERIMENT_TOKEN=<optional>
CHMARL_INGEST_TOKEN=<optional>
PORT_EVENTS_TOKEN=<optional>
WEATHER_TOKEN=<optional>
```

## Tracking and calculation configuration

```text
AISSTREAM_GLOBAL_TRACKING_ENABLED=true
AISSTREAM_TRACKING_BBOX=-90,-180;90,180
AISSTREAM_FILTER_TYPES=PositionReport,StandardClassBPositionReport,ExtendedClassBPositionReport
AISSTREAM_MAX_VESSELS=5000
AISSTREAM_MAX_AGE_MS=21600000
AISSTREAM_TRAIL_POINTS=12
ECOFAIR_OPERATIONAL_RADIUS_NM=120
```

The display feed can therefore be global while port calculations remain limited to Jeddah, King Abdullah Port, Yanbu, Jizan, Dammam, Jebel Ali, and Suez.

## Persistent disk

`render.yaml` attaches a disk at:

```text
/var/data
```

and sets:

```text
RUNTIME_DATA_DIR=/var/data
```

The following survive normal restarts and deployments:

- AIS tracking cache
- EcoFair accumulated state and daily history
- fixed/manual vessel input
- optional CH-MARL experiment file
- optional port and weather files

After changing `render.yaml`, open the Render Blueprint and sync it. Confirm the service has a disk on its **Disks** page with mount path `/var/data`. If the disk is not listed, add a 1 GB disk manually at `/var/data` before relying on persistence.

## Render deployment steps

1. Push the latest `main` branch.
2. Open the Render Blueprint for `chmarl-datav` and run **Sync**.
3. Approve the persistent-disk change if prompted.
4. Confirm `AISSTREAM_API_KEY` remains set in the service environment.
5. Deploy the latest commit.
6. Verify:

```bash
export LIVE_PORTAL=https://chmarl-datav.onrender.com

curl -s "$LIVE_PORTAL/health" | python -m json.tool
curl -s "$LIVE_PORTAL/api/vessels" | python -m json.tool | head -120
curl -s "$LIVE_PORTAL/api/vessels?scope=operational" | python -m json.tool | head -120
curl -s "$LIVE_PORTAL/api/chmarl/episode" | python -m json.tool | head -160
curl -s "$LIVE_PORTAL/api/report" | head -120
```

A healthy split looks like:

```text
trackingScope.rows      = the larger map/table fleet
operationalScope.rows   = the smaller monitored-port calculation fleet
```

To verify browser-independent operation, note `runtime.lastTickAt`, close the page for several minutes, then call `/health` again. The timestamp should continue advancing.

## Local production parity

```bash
pnpm install
pnpm build
PORT=8787 STATIC_DIR=dist pnpm start:prod
```

Then:

```bash
curl -I http://127.0.0.1:8787/
curl -s http://127.0.0.1:8787/health | python -m json.tool
```

## Capacity and provider notes

A world-scale AIS stream is high volume. Position-message filtering, a bounded 5000-vessel cache, short trails, and constant-time cache updates are enabled by default. If the paid instance cannot sustain the load, narrow `AISSTREAM_TRACKING_BBOX` to the required global corridors while keeping `ECOFAIR_OPERATIONAL_RADIUS_NM` unchanged.

AISStream remains a beta provider. Upstream API rows and fixed/manual rows can be merged into the tracking feed when required. Kpler or another authoritative port-operations provider should be connected through `PORT_EVENTS_URL` when available.
