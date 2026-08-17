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

## Performance and integrity

Leaflet is configured with `preferCanvas: true`. AIS points are rendered as vector circle markers on a Canvas renderer rather than thousands of HTML marker elements. The expanded vessel rail shows at most 500 rows at once for DOM performance, but search and filters operate on the complete cohort and all matching vessels remain on the map.

No manual, fixed, sample, synthetic, interpolated, or repositioned vessel is introduced by the map. Last-known observations keep their provider timestamp and remain visually differentiated. Backend freshness and eight-port geofencing continue to determine whether a vessel may contribute to EcoFair-CH-MARL calculations.

## Configuration

The renderer uses these optional Vite variables:

```dotenv
VITE_MAP_TILE_URL=https://tile.openstreetmap.org/{z}/{x}/{y}.png
VITE_SEAMARK_TILE_URL=https://t1.openseamap.org/seamark/{z}/{x}/{y}.png
```

The base map URL can be changed without modifying the component. Any replacement tile service must permit the expected traffic and provide the required attribution. The portal remains a decision-support visualization and is not an official navigational chart or ECDIS.
