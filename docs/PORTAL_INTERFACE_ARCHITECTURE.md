# Operational Vessel Intelligence Dashboard — Interface Architecture

This document describes the production organization of the CH-MARL portal. The implementation follows a map-first maritime command pattern and keeps operational context, readiness, analysis, vessel inspection, and drill-down tools inside one coherent interface.

The visible product title remains:

> **Operational Vessel Intelligence Dashboard**

Design-system tokens are documented in repository files and are not shown as an operational panel in the live portal.

## 1. Information hierarchy

The interface is organized into five layers:

1. **Compact application header**
   - product identity and exact title;
   - UTC clock and current provider state;
   - operational mode selector;
   - inline dark/light theme control;
   - refresh and export actions.

2. **Four-card readiness strip**
   - live input readiness;
   - vessel tracking / AIS;
   - EcoFair-CH-MARL readiness and score state;
   - port operations readiness.

3. **Map-first command stage**
   - left analysis rail;
   - dominant central Leaflet maritime map;
   - persistent right operations rail.

4. **Command workspace**
   - at-a-glance operational metrics;
   - eight-port coverage matrix;
   - vessel and event preview;
   - compact event table.

5. **Viewport-safe focus views**
   - expanded map;
   - CH-MARL reward, action, fairness, and constraint details;
   - vessel table and risk register;
   - port queue, coverage, and event views;
   - marine weather and risk views.

## 2. Analysis rail

The left rail keeps the most important model and operational indicators visible without competing with the map:

- CH-MARL reward index;
- feasibility score;
- monitored-port pressure;
- compact Vessel Speed Profile.

Every item opens the related detailed panel. A missing score remains visibly marked as unavailable rather than being replaced with a fabricated value.

## 3. Central map

The Leaflet map remains the hero component. It retains:

- Jeddah + King Abdullah Port focus;
- eight-port overview;
- World AIS and fit-to-vessels views;
- ports, 120 NM operational zones, events, trails, and seamarks;
- Canvas-rendered vessel positions;
- full-screen expansion.

The interface layer does not insert, move, synthesize, or reinterpret AIS observations.

## 4. Operations rail

The right rail provides persistent operational context:

- selected-vessel facts;
- searchable and sortable tracked-vessel list;
- moving and last-known filters;
- compact operational watchlist;
- recent port events;
- direct links to full detail panels.

This keeps the core operator workflow self-contained without requiring a separate screen.

## 5. Command workspace

The lower workspace supports three modes:

- **Command summary** — global vessels, moving vessels, port-scope rows, events, AIS age, and data quality, followed by a recent event table;
- **Port coverage matrix** — current eight-port geographic coverage;
- **Vessel & event preview** — latest vessel observations and port activity.

The workspace is intended for drill-down and evidence review, not as a design-token showcase.

## 6. Theme and color behavior

Dark and light modes use the same information hierarchy and semantic statuses. The light-mode production palette is documented in `docs/LIGHT_MODE_COLOR_PALETTE.md`.

Semantic colors are reserved for operational meaning:

- green: ready / nominal;
- orange: degraded / attention required;
- red: critical / constrained;
- blue: informational;
- teal and aqua: brand and analytical emphasis.

Large saturated warning boxes and decorative gradients are avoided.

## 7. Responsive behavior

- Wide screens use the full three-column map-first command stage.
- Medium screens place the map and operations rail first, followed by a horizontal analysis section.
- Small screens use a single-column sequence with the map first.
- Focus panels remain bounded by the viewport.
- The interface supports reduced-motion preferences.

## 8. Operational integrity

This interface architecture does not change:

- AIS provider behavior;
- vessel identities, coordinates, timestamps, or provenance;
- eight-port geofences;
- port-event truth;
- CH-MARL calculation formulas or activation rules;
- EcoFair reward, fairness, emissions, queue, or constraint logic.

Presentation and calculation remain explicitly separated.
