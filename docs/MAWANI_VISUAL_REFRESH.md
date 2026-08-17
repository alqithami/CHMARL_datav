# MAWANI visual refresh

The CH-MARL portal uses a restrained MAWANI-inspired operational design rather than a generic boxed dashboard. The refresh changes presentation only; AIS ingestion, port geofencing, Leaflet behavior, and EcoFair-CH-MARL calculations remain unchanged.

## Design direction

- IBM Plex typography with bilingual font fallbacks
- deep teal operator background with aqua brand accents
- semantic colours fixed to success `#24A148`, warning `#FF6800`, error `#DA1E28`, and information `#284291`
- compact status controls and readable labels rather than cryptic abbreviations
- neutral card borders with semantic colour used as a small edge, dot, or top rule instead of a full red/orange box
- modest 4–8 px radii rather than oversized pill and container treatments
- no decorative gradients
- complete dark and light modes

## Layout hierarchy

1. Compact identity and live-provider bar
2. Live-input readiness matrix
3. Four operational KPIs
4. Four-mode command summary
5. Map-first command workspace

On wide screens, the Leaflet map occupies the central flexible column. Reward/constraint panels form the left rail, while port operations and the watchlist form the right rail. On medium screens, the map becomes the full-width first row and both rails follow beneath it. Mobile uses a single-column sequence.

## Map presentation

The map remains the primary operational surface. Controls use a compact translucent command group, monitored ports remain visible, and the selected-vessel inspector uses the same design tokens as the rest of the portal. The map renderer continues to show every accepted AIS row on Canvas; no vessel is added, removed, or repositioned by the visual refresh.

## Accessibility

- visible keyboard focus states
- semantic status colours supported by text labels
- light/dark colour-scheme declarations
- responsive layouts without horizontal dependence
- reduced-motion support

The final override is loaded from `src/mawaniVisualRefresh.css` after the historical style layers so the intended hierarchy is deterministic.
