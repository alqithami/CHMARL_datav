# Leaflet maritime AIS map

The CH-MARL portal uses Leaflet 1.9.4 as its interactive geographic renderer. Leaflet replaces the previous custom Web Mercator tile-grid implementation; it does not replace or modify the AIS providers, vessel records, port geofences, or EcoFair-CH-MARL calculations.

## Map layers

- Configurable OpenStreetMap-compatible raster base layer
- Optional OpenSeaMap seamark overlay
- Canvas-rendered AIS vessel points for the complete frontend vessel cohort
- Selected-vessel heading symbol
- AIS trails when supplied by the backend
- Eight monitored ports and 120 nautical-mile operational zones
- Port-event markers

## Operational controls

The map retains these explicit views:

- **Jeddah + KAP**: Jeddah Islamic Port and King Abdullah Port
- **8 ports**: complete monitored operational portfolio
- **World AIS**: worldwide tracking view
- **Fit vessels**: bounds of the current search and status filter

Layer toggles control ports, operational zones, events, trails, and seamarks. Native Leaflet dragging, wheel zoom, touch gestures, keyboard navigation, attribution, and metric scale controls are enabled.

## Complete vessel cohort

The PocketWorld adapter requests the provider's maximum 5,000-row page. PocketWorld can mark a snapshot as truncated and provide `snapshot_id` plus `total_available` while omitting `next_cursor`; in that case the adapter derives the next offset from the number of accumulated rows and continues with the same snapshot ID. Pagination stops only when the current snapshot is complete or the 50,000-row aggregate safety ceiling is reached. Provider diagnostics expose `totalAvailable`, `pagesFetched`, `snapshotId`, `nextCursor`, `fetchComplete`, and `truncated` so the portal can distinguish a complete fleet from a partial response.

The Leaflet renderer and frontend stabilizer accept up to 50,000 genuine AIS observations. The expanded vessel rail shows at most 500 rows at once for DOM performance, but search and filters operate on the complete cohort and all matching vessels remain on the Canvas-rendered map.

## Performance and integrity

Leaflet is configured with `preferCanvas: true`. AIS points are rendered as vector circle markers on a Canvas renderer rather than thousands of HTML marker elements. PocketWorld is polled on its configured backend interval and the resulting complete snapshot is cached on the persistent Render disk.

No manual, fixed, sample, synthetic, interpolated, or repositioned vessel is introduced by the map. Last-known observations keep their provider timestamp and remain visually differentiated. Backend freshness and eight-port geofencing continue to determine whether a vessel may contribute to EcoFair-CH-MARL calculations. Loading the complete world cohort may reveal a previously omitted port-area observation, but it does not allow unrelated or stale vessels to activate EcoFair.

## Configuration

The renderer uses these optional Vite variables:

```dotenv
VITE_MAP_TILE_URL=https://tile.openstreetmap.org/{z}/{x}/{y}.png
VITE_SEAMARK_TILE_URL=https://t1.openseamap.org/seamark/{z}/{x}/{y}.png
```

The base map URL can be changed without modifying the component. Any replacement tile service must permit the expected traffic and provide the required attribution. The portal remains a decision-support visualization and is not an official navigational chart or ECDIS.
