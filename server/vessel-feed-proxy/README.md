# Vessel Feed Proxy Example

This folder contains a minimal Node.js proxy for feeding vessel rows into the CH-MARL dashboard.

It is intentionally dependency-free and uses Node's built-in HTTP server.

## Run the proxy locally

```bash
node server/vessel-feed-proxy/index.mjs
```

The endpoint will be available at:

```text
http://localhost:8787/api/vessels
```

Then create `.env.local` in the project root:

```env
VITE_VESSEL_DATA_URL=http://localhost:8787/api/vessels
```

Restart the dashboard:

```bash
pnpm dev -- --host 0.0.0.0 --port 5173
```

The dashboard header should show:

```text
Data: remote
```

## Connect an upstream source

The proxy can read from another JSON endpoint when these backend-only environment variables are set:

```bash
UPSTREAM_VESSEL_DATA_URL=https://example.com/provider/vessels
UPSTREAM_VESSEL_DATA_TOKEN=replace-with-server-side-token
node server/vessel-feed-proxy/index.mjs
```

Do not put upstream provider credentials in frontend `.env` files.

## Endpoint response expected by the frontend

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
      "status": "Nominal"
    }
  ]
}
```
