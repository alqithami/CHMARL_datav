# Global vessel tracking and port-scoped EcoFair-CH-MARL

The portal uses two deliberately separate vessel scopes.

## 1. Tracking scope

The tracking scope is the vessel feed presented on the map, vessel table, fleet KPIs, and search/inspection views.

By default:

```text
AISSTREAM_GLOBAL_TRACKING_ENABLED=true
AISSTREAM_TRACKING_BBOX=-90,-180;90,180
AISSTREAM_FILTER_TYPES=PositionReport,StandardClassBPositionReport,ExtendedClassBPositionReport
AISSTREAM_MAX_VESSELS=5000
```

`GET /api/vessels` returns the tracking scope. The backend merges:

1. AISStream position rows.
2. `UPSTREAM_VESSEL_DATA_URL` rows.
3. `FIXED_VESSEL_DATA_URL` rows.
4. `FIXED_VESSEL_DATA_FILE` or `POST /api/vessels/ingest` rows.

The cache limit bounds browser and server memory; it is not a port filter.

## 2. Operational calculation scope

EcoFair-CH-MARL does not score every vessel displayed globally. It selects only vessels within the configured radius of the monitored ports:

```text
ECOFAIR_OPERATIONAL_RADIUS_NM=120
```

Monitored ports:

- Jeddah
- King Abdullah Port
- Yanbu
- Jizan
- Dammam
- Jebel Ali
- Suez

The operational scope drives:

- fuel and CO2 integration
- per-vessel emission budget
- Gini and max-min fairness
- EcoFair reward components
- primal-dual lambda
- port geofence events
- queue and berth utilization estimates
- CH-MARL constraints and decision trace

`GET /api/vessels?scope=operational` returns the exact rows currently eligible for those calculations.

## Continuous operation

The backend opens AISStream and runs the EcoFair tick independently of browser clients. Closing the dashboard does not stop:

- the AIS websocket
- vessel cache updates
- the 60-second EcoFair integration tick
- CH-MARL history creation
- runtime-state persistence

`/health` exposes:

```text
runtime.lastTickAt
trackingScope.rows
operationalScope.rows
aisstream.lastMessageAt
aisstream.usablePositionMessages
persistence.aisCacheFile
persistence.ecofairStateFile
```

## Render persistence

Production uses one Render instance with a persistent disk mounted at `/var/data`.

```text
RUNTIME_DATA_DIR=/var/data
```

This keeps the AIS cache, EcoFair state, fixed/manual vessel rows, and optional experiment files across normal restarts and deployments. A new deployment may briefly restart the service, but it should restore its saved runtime state instead of returning to zero.

## Verification

```bash
export LIVE_PORTAL=https://chmarl-datav.onrender.com

curl -s "$LIVE_PORTAL/health" | python -m json.tool
curl -s "$LIVE_PORTAL/api/vessels" | python -m json.tool | head -120
curl -s "$LIVE_PORTAL/api/vessels?scope=operational" | python -m json.tool | head -120
curl -s "$LIVE_PORTAL/api/chmarl/episode" | python -m json.tool | head -160
curl -s "$LIVE_PORTAL/api/report" | head -120
```

A healthy separation looks like:

```text
trackingScope.rows      = many vessels
operationalScope.rows   = smaller subset near monitored ports
EcoFair trackedVessels  = operationalScope.rows, not trackingScope.rows
```

To prove background operation, note `runtime.lastTickAt`, close the browser for several minutes, and request `/health` again. The timestamp should continue advancing.

## Capacity note

A world-scale AIS subscription can be high volume. Position-message filtering, a 5000-vessel cache cap, short trails, and constant-time cache updates are enabled by default. If the hosting instance cannot sustain the volume, keep the same two-scope architecture but narrow `AISSTREAM_TRACKING_BBOX` to the corridors required for the tracking mission; do not narrow the EcoFair port calculation logic into the display feed.
