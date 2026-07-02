# MAWANI UI implementation rules

This portal follows the uploaded MAWANI Design System for future UI work.

## Foundation

- Use IBM Carbon v11 interaction principles: clear buttons, inputs, tables, modals, tags, and side navigation patterns.
- Re-skin Carbon surfaces and interactive tokens using MAWANI deep teal and aqua.
- Extend only for ports-domain needs: AI recommendation cards, vessel-status tags, port congestion and queue meters.

## Visual tone

- Operational, decisive, bilingual, calm.
- Dark by default for 24/7 operator fatigue.
- No emoji.
- No decorative gradients.
- No decoration without operational meaning.

## Typography

- Use IBM Plex Sans and IBM Plex Sans Arabic fallbacks.
- Big numbers use light weight.
- Labels are uppercase.
- Monospace is reserved for identifiers such as vessel names, IMO, MMSI, and code-like telemetry.

## Colours

- Use MAWANI deep teal and aqua for brand and AI surfaces.
- Keep Carbon semantic colours untouched:
  - Success: `#24A148`
  - Warning: `#FF6800`
  - Error: `#DA1E28`
  - Info: `#284291`
  - AI accent: `#00DBE7`

## Components

- Operational recommendations must be quantified and cite their inputs in the UI copy where possible.
- Status should be carried by Carbon-like tags and icons, not decorative colour washes.
- Important dashboard panels must stay visible; secondary details may be moved into tabs or expanded panels, but not hidden behind unclear affordances.

## Applied files

- `src/mawaniDesignSystem.css` contains the design-system token and override layer.
- `src/main.tsx` imports it after all legacy CSS so it is authoritative.
