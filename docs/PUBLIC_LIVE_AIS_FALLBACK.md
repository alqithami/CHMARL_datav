# Public live AIS fallback

The portal accepts only provider-issued AIS observations. It does not insert manually positioned, fixed, sample, synthetic, or placeholder vessels.

## Runtime provider order

1. AISStream remains the primary worldwide WebSocket source.
2. A configured Datalastic key supplies monitored-port live AIS when the primary stream is silent.
3. When neither source has produced rows, the backend polls PocketWorld's public `/api/ships` endpoint and accepts only fresh observations with MMSI, coordinates, original source, and observation timestamp.

PocketWorld currently aggregates working regional sources including BarentsWatch, Fintraffic, and Singapore MPA. Its payload explicitly reports whether worldwide coverage is ready. The portal preserves that coverage metadata and labels this source as regional rather than global.

## Production settings

- `POCKETWORLD_AIS_ENABLED=true`
- `POCKETWORLD_API_URL=https://pocketworld.org/api/ships`
- `POCKETWORLD_ACTIVATION_DELAY_MS=45000`
- `POCKETWORLD_POLL_INTERVAL_MS=300000`
- `POCKETWORLD_MAX_AGE_MS=1800000`
- `POCKETWORLD_MAX_VESSELS=2500`

No secret or account is required for this fallback. The backend polls no more than once every five minutes, rejects stale or invalid rows, caps retained rows, and exposes source health under `/health` and `/api/vessels`.

## Operational limitation

The current public sources provide regional coverage in Norway, Finland/Baltic waters, and Singapore. They restore genuine vessels to the global map, but they do not guarantee Saudi-port observations. EcoFair-CH-MARL remains inactive unless real AIS rows enter the monitored-port radius. Saudi operational continuity still requires AISStream recovery or a licensed provider with Red Sea/Gulf coverage.
