# Live AIS vessel feed

The production dashboard reads vessel rows only from the same-origin backend endpoint configured by `VITE_VESSEL_DATA_URL` (normally `/api/vessels`). The backend holds the AISStream credential and maintains one worldwide WebSocket subscription.

## Production policy

- Live AIS is the sole vessel-position source.
- The subscription bounding box is worldwide: `-90,-180;90,180`.
- The provider subscription is unfiltered; the runtime normalizes position-bearing messages.
- Operational port scope is derived from the global AIS cache.
- Manual vessel insertion, fixed vessel files, bundled vessel samples, and secondary vessel APIs are disabled.
- If AIS provides no positions, the endpoint returns an empty vessel array with an explicit waiting/degraded state.

## Frontend endpoint

`VITE_VESSEL_DATA_URL=/api/vessels`

Provider credentials must remain in the backend environment. Never place `AISSTREAM_API_KEY` in a Vite variable or browser-delivered file.
