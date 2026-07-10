# EcoFair-CH-MARL input sources

The online EcoFair-CH-MARL runtime now consumes the merged vessel feed from:

1. live AISStream rows,
2. optional upstream vessel API rows (`UPSTREAM_VESSEL_DATA_URL`), and
3. fixed/manual vessel rows from file or ingest (`FIXED_VESSEL_DATA_FILE`, `/api/vessels/ingest`).

Rows are normalized into the dashboard vessel contract and de-duplicated by vessel ID. Live AIS rows override upstream/fixed rows with the same ID; upstream rows override fixed rows. This lets the portal continue scoring with manually supplied Saudi vessels when AISStream is not delivering regional messages.

## Fixed/manual vessel file

Default path:

```text
.runtime/manual_vessels.json
```

Example:

```json
{
  "vessels": [
    {
      "id": "MANUAL-JEDDAH-001",
      "name": "Manual Jeddah Baseline Vessel",
      "latitude": 21.49,
      "longitude": 39.18,
      "sog": 0.2,
      "timestamp": "2026-07-10T00:00:00.000Z"
    }
  ]
}
```

## Fixed/manual ingest endpoint

```bash
PORTAL_BASE_URL=http://127.0.0.1:8787 \
FIXED_VESSELS_FILE=public/data/manual_vessels.sample.json \
pnpm run ingest:fixed-vessels
```

or directly:

```bash
curl -X POST "$PORTAL_BASE_URL/api/vessels/ingest" \
  -H 'content-type: application/json' \
  --data @public/data/manual_vessels.sample.json
```

Set `FIXED_VESSEL_INGEST_TOKEN` to require `Authorization: Bearer <token>`.

## Runtime endpoints

- `/api/vessels` returns merged vessel rows plus per-source input counts.
- `/api/chmarl/episode` scores EcoFair-CH-MARL from the merged feed.
- `/api/port-events` derives AIS/manual geofence port events and queue rows.
- `/api/report` reports the same live merged-feed calculations.
