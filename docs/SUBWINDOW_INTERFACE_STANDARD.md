# Expanded Sub-Window Interface Standard

The Operational Vessel Intelligence Dashboard uses one consistent focus-window pattern for detailed maps, tables, charts, model state, weather, vessel risk, and port operations.

## Required structure

Every expanded view contains:

1. **Context header**
   - operational-detail label;
   - concise title;
   - one-sentence explanation of the data shown;
   - visible Close action.

2. **Toolbar or summary layer**
   - filters and view controls when applicable;
   - current provider or source state;
   - compact summary metrics.

3. **Primary content region**
   - chart, table, list, map, or split operational layout;
   - content fills the available viewport without fixed oversize minimums;
   - internal scrolling is used only where necessary.

4. **Truthful empty state**
   - explains whether data is absent because the provider is missing, the current filter has no rows, or the connected provider currently reports no activity;
   - never uses placeholder cards or fabricated rows.

## Overlay and viewport behavior

- Focus windows render above Leaflet controls and every other portal layer.
- Background scrolling is locked while a focus view is open.
- Escape, backdrop click, and the Close button dismiss the view.
- The focus panel is bounded by the current browser viewport.
- The expanded map uses the full content region and retains its own controls and vessel rail.
- Mobile layouts use a near-full-screen panel and single-column content.

## Port Event Feed

The expanded Port Event Feed uses a feed-first design:

- total event count and provider state;
- matching rows, represented ports, active berth/service actions, and latest update;
- compact event-type filters;
- structured event table;
- explicit provider-missing, filter-empty, and no-active-event states.

The map is not displayed behind or through this view. Map controls remain attached to the expanded map view only.

## Other expanded views

- **Vessel State Table:** fixed toolbar, summary, scrollable table, and pagination.
- **Operational Watchlist:** recommendation context beside a responsive exception grid.
- **CH-MARL lists:** two-column detail cards on wide displays and one column on small displays.
- **Weather and fleet summaries:** responsive metric-card grids.
- **Charts:** use the full bounded content area without historical fixed minimum heights.
- **Port coverage / queue:** retain their complete rows inside a viewport-safe content region.

## Visual rules

- Uses the same MAWANI-inspired dark and light tokens as the main portal.
- Semantic color communicates operational state rather than decoration.
- No decorative gradients, oversized pills, or empty placeholder columns.
- Tables use sticky headers and readable row separation.
- Empty states use a restrained icon, title, explanation, and optional recovery action.

## Operational integrity

The sub-window system changes presentation only. It does not modify:

- AIS providers or subscription behavior;
- vessel identities, coordinates, timestamps, or provenance;
- port-event rows;
- eight-port geofences;
- EcoFair-CH-MARL formulas, reward values, or activation conditions.
