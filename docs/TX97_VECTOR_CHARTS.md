# TX-97 vector-chart integration

The portal renders its nautical base chart through a dedicated **Wärtsilä TX-97 chart gateway**. The former OpenStreetMap raster-tile renderer is not used by the TX-97 map.

## Integration boundary

Raw TX-97 chart packages are proprietary chart data and are not decoded in the browser. The runtime expects an authorized, MapLibre-compatible style endpoint produced by a Wärtsilä-approved chart engine or chart service. That service must expose a style document and its referenced HTTPS vector tiles, TileJSON, sprites, glyphs, or GeoJSON resources.

The CH-MARL runtime proxies those chart assets through same-origin endpoints so that credentials remain on the server:

- `GET /api/charts/tx97/status`
- `GET /api/charts/tx97/style.json`
- internal same-origin resource, tile, glyph, and sprite proxy routes

AIS vessel positions, vessel trails, monitored ports, and port events remain application overlays. They are not written into, or represented as part of, the licensed TX-97 chart data.

## Required configuration

```dotenv
TX97_CHARTS_ENABLED=true
TX97_STYLE_URL=https://authorized-chart-service.example/style.json
TX97_PUBLIC_DISPLAY_AUTHORIZED=false
TX97_ALLOWED_ORIGINS=https://authorized-chart-service.example
TX97_BEARER_TOKEN=
TX97_API_KEY=
TX97_API_KEY_HEADER=x-api-key
TX97_CHART_COLLECTION=Licensed TX-97 chart collection
TX97_REQUEST_TIMEOUT_MS=20000
TX97_CACHE_SECONDS=300
```

`TX97_PUBLIC_DISPLAY_AUTHORIZED` deliberately defaults to `false`. Set it to `true` only when the chart license explicitly permits the portal's deployment and audience. If the authorization is absent, the gateway exposes its status but blocks chart content.

The style URL and all referenced chart resources must use HTTPS. Every remote origin must match the style origin or be listed in `TX97_ALLOWED_ORIGINS`. Bearer tokens and API keys are added only by the backend proxy and are never returned to the browser.

## Frontend behavior

The frontend uses MapLibre GL JS to render the authorized vector style. It adds separate GeoJSON layers for:

- clustered live AIS vessel symbols;
- selected-vessel highlighting;
- vessel trails;
- monitored port references;
- port-operation events.

When the gateway is not configured, not licensed for the current audience, or unreachable, the map displays a precise TX-97 status panel. It does **not** silently substitute OpenStreetMap, a fixed image, sample vessels, or a synthetic chart.

## Operational limitation

This display supports research and operational decision support. It is explicitly marked **not for navigation** and must not be represented as an ECDIS or an approved primary means of navigation.
