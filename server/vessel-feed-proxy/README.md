# Vessel Feed Proxy

This folder contains the backend vessel-feed proxy used by the CH-MARL dashboard.

The proxy can run in three modes:

1. local fallback vessels when no external source is configured;
2. a generic upstream JSON endpoint through `UPSTREAM_VESSEL_DATA_URL`;
3. live AISStream websocket mode through `AISSTREAM_API_KEY`.

## One-terminal dashboard demo

From Codespaces or local development:

```bash
pnpm dev:proxy
```

This starts:

```text
http://localhost:8787/api/vessels
http://localhost:5173/
```

## Generic upstream JSON source

```bash
UPSTREAM_VESSEL_DATA_URL=https://example.com/provider/vessels \
UPSTREAM_VESSEL_DATA_TOKEN=replace-with-server-side-token \
node server/vessel-feed-proxy/index.mjs
```

## AISStream live source

```bash
AISSTREAM_API_KEY=replace-with-server-side-key \
AISSTREAM_BBOX='11,32;31,56' \
node server/vessel-feed-proxy/index.mjs
```

`AISSTREAM_BBOX` uses:

```text
lat1,lon1;lat2,lon2
```

Multiple boxes can be separated with `|`.

The proxy keeps the AIS key server-side, subscribes to live position messages, normalizes them into dashboard vessel rows, and serves the current cache through:

```text
GET /api/vessels
```

Health information is available through:

```text
GET /health
```

## Frontend response shape

```json
{
  "vessels": [
    {
      "id": "MMSI-538214",
      "name": "Al Riyadh Trader",
      "route": "Jeddah → Suez",
      "cargo": "Containers",
      "eta": "04:20 UTC",
      "speed": "14.8 kn",
      "status": "Nominal",
      "latitude": 21.45,
      "longitude": 39.12,
      "courseDeg": 322
    }
  ],
  "source": "aisstream"
}
```
