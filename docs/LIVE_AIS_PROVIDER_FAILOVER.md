# Live AIS provider failover

The production portal accepts only genuine AIS observations. It never inserts manually positioned, fixed, sample, or synthetic vessels.

## Provider order

1. AISStream WebSocket remains the primary worldwide source.
2. When AISStream has delivered no frame for the configured activation window, the runtime can scan monitored ports through Datalastic's live AIS Location Traffic endpoint.
3. When AISStream recovers, its worldwide observations take precedence for duplicate MMSIs. Datalastic observations remain visible only until their real timestamps exceed the configured age limit.

## Render secret required

Set this secret in the Render service environment:

`DATALASTIC_API_KEY=<your Datalastic API key>`

Do not place the key in GitHub, a Vite variable, or browser code. The backend sends it only in the `x-api-key` request header.

The repository Blueprint already defines the non-secret controls:

- `DATALASTIC_AIS_ENABLED=true`
- `DATALASTIC_ACTIVATION_DELAY_MS=45000`
- `DATALASTIC_SCAN_INTERVAL_MS=900000`
- `DATALASTIC_SCAN_RADIUS_NM=50`
- `DATALASTIC_MAX_AGE_MS=2700000`
- `DATALASTIC_SCAN_POINT_IDS=Jeddah,King Abdullah Port`

The default deliberately scans one port per interval to control API credits. Expand the comma-separated scan-point list or set it to `all` only after selecting a plan that supports the resulting traffic volume.

## Runtime evidence

`/health` exposes separate `aisstream` and `datalastic` states. `/api/vessels` exposes the active source as `aisstream`, `datalastic`, or `ais-multi-provider`, together with per-provider diagnostics. A Datalastic row retains `inputSource=datalastic-live-ais` and its provider timestamp.
