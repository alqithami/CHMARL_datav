# Remote Vessel Feed Integration

The dashboard can now read vessel rows from a backend endpoint through the `VITE_VESSEL_DATA_URL` environment variable.

This keeps provider credentials out of the browser. The frontend should call your backend or proxy, and that backend can call a paid vessel-data provider, internal simulator, database, stream processor, or any other source.

## Frontend Environment Variable

Create `.env.local` in the project root:

```env
VITE_VESSEL_DATA_URL=http://localhost:8787/api/vessels
```

Restart Vite after changing `.env.local`:

```bash
pnpm dev -- --host 0.0.0.0 --port 5173
```

When the endpoint is reachable, the dashboard header should show:

```text
Data: remote
```

When the endpoint is missing or unavailable, the dashboard falls back to the local sample files.

## Accepted Response Shapes

The endpoint may return an array directly:

```json
[
  {
    "id": "MMSI-636020259",
    "name": "SUNNY HONOR",
    "route": "Jeddah → Jeddah",
    "cargo": "Bulk Carrier",
    "eta": "Arrived",
    "speed": "0.0 kn",
    "status": "Nominal"
  }
]
```

Or an object with `vessels`, `data`, or `items`:

```json
{
  "vessels": [
    {
      "id": "MMSI-636020259",
      "name": "SUNNY HONOR",
      "route": "Jeddah → Jeddah",
      "cargo": "Bulk Carrier",
      "eta": "Arrived",
      "speed": "0.0 kn",
      "status": "Nominal"
    }
  ]
}
```

## Preferred Dashboard Vessel Row

```ts
type Vessel = {
  id: string;
  name: string;
  route: string;
  cargo: string;
  eta: string;
  speed: string;
  status: "Nominal" | "Watch" | "Constrained";
};
```

## Raw Vessel Rows Also Work

The frontend provider now also normalizes common raw vessel fields. This means the endpoint may return rows like:

```json
{
  "vessels": [
    {
      "mmsi": "636020259",
      "imo": "9267106",
      "vesselName": "SUNNY HONOR",
      "vesselType": "Bulk Carrier",
      "originPort": "Jeddah",
      "destinationPort": "Jeddah",
      "speedKnots": 0,
      "eta": "Arrived",
      "navStatus": "Moored"
    }
  ]
}
```

The provider maps those rows into the dashboard vessel row shape automatically.

## Security Rule

Do not put provider credentials in Vite or frontend `.env` files. Use backend environment variables only. The frontend should only know your backend endpoint URL.
