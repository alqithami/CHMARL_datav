# CH-MARL Portal Light-Mode Color Palette

This document defines the production light-mode palette used by the CH-MARL portal. The palette preserves the MAWANI-inspired teal and aqua identity while providing stronger contrast for operational text, controls, expanded map rails, tables, and status indicators.

The implementation is in `src/mawaniLightMode.css`, which is loaded after the historical theme and component style sheets so that the final light-mode hierarchy is deterministic.

## 1. Core neutral palette

| Design token | Value | Intended use |
|---|---:|---|
| `--mawani-bg` | `#EDF4F5` | Global application background |
| `--mawani-surface` | `#FFFFFF` | Primary cards, panels, modal surfaces, and expanded rail sections |
| `--mawani-surface-raised` | `#F4F8F9` | Inputs, filters, inner cards, table headers, and secondary surfaces |
| `--mawani-surface-hover` | `#E5EEF0` | Hover and selected-row support surfaces |
| `--mawani-border-subtle` | `#BFD0D4` | Standard component and control borders |
| `--mawani-border-strong` | `#78979E` | High-emphasis controls and focus boundaries |
| `--mawani-text-primary` | `#10272C` | Titles, values, vessel names, selected-vessel details, and body text |
| `--mawani-text-secondary` | `#36555C` | Supporting text, metadata, labels, and descriptions |
| `--mawani-text-helper` | `#5C747A` | Placeholders and low-priority helper text |

## 2. Brand palette

| Design token | Value | Intended use |
|---|---:|---|
| `--mawani-teal-70` | `#007984` | Primary brand teal and interactive emphasis |
| `--mawani-teal-80` | `#005D66` | Active tabs, selected map controls, and filled primary states |
| `--mawani-teal-90` | `#00434A` | Deep teal emphasis where stronger contrast is required |
| `--mawani-aqua-50` | `#006F79` | Section kickers, counters, active borders, and operational accents |
| `--mawani-aqua-60` | `#005F68` | Darker aqua support accent |
| `--mawani-ai-accent` | `#007985` | AI recommendations and analytical highlights |

## 3. Semantic palette

| Design token | Value | Meaning |
|---|---:|---|
| `--mawani-success` | `#19783A` | Healthy, nominal, complete, or available |
| `--mawani-warning` | `#9C5200` | Elevated, stale, constrained, or attention required |
| `--mawani-error` | `#B4232D` | Critical, unavailable, invalid, or failed |
| `--mawani-info` | `#2E5AA7` | Informational, neutral system state, or context |

Semantic colors are used as narrow borders, dots, labels, and text accents rather than large saturated fills. This keeps the interface calm while preserving status recognition.

## 4. Soft semantic surfaces

| Design token | Value | Intended use |
|---|---:|---|
| `--ui-aqua-soft` | `rgba(0, 111, 121, 0.10)` | AI and aqua-highlight surfaces |
| `--ui-success-soft` | `rgba(25, 120, 58, 0.10)` | Subtle healthy-state backgrounds |
| `--ui-warning-soft` | `rgba(156, 82, 0, 0.10)` | Stale or warning-row backgrounds |
| `--ui-error-soft` | `rgba(180, 35, 45, 0.08)` | Critical-state backgrounds |
| `--ui-info-soft` | `rgba(46, 90, 167, 0.10)` | Informational backgrounds |

## 5. Map and control surfaces

| Design token | Value | Intended use |
|---|---:|---|
| `--light-control-bg` | `#F7FAFB` | Inputs, buttons, filters, and compact controls |
| `--light-control-hover` | `#E8F1F2` | Hover and selected-row support state |
| `--light-map-overlay` | `rgba(255, 255, 255, 0.96)` | Leaflet controls, tooltips, and map command groups |
| `--light-map-overlay-strong` | `rgba(247, 251, 252, 0.98)` | Leaflet zoom controls and high-clarity overlays |
| `--light-focus-ring` | `#007984` | Keyboard focus indicator |

## 6. Usage rules

1. Use `--mawani-text-primary` for any information required to operate or interpret the portal.
2. Use `--mawani-text-secondary` for descriptive metadata and labels that must remain comfortably readable.
3. Reserve `--mawani-text-helper` for placeholders and optional helper text. Do not use it for vessel names, timestamps, selected-vessel fields, filter labels, or event descriptions.
4. Use `--mawani-teal-80` with white text for active controls and selected tabs.
5. Use aqua for brand and analytical emphasis, not as a replacement for semantic status colors.
6. Use semantic colors together with text labels. Color alone must not communicate operational status.
7. Keep primary panels white and inner controls near-white to maintain a clear depth hierarchy.
8. Expanded-map vessel rows, event cards, selected-vessel details, and filter controls must always use the primary and secondary text tokens rather than dark-mode literal colors.
9. Map tiles remain geographic content; the light theme only adjusts their saturation and contrast. It does not alter vessel coordinates or operational overlays.
10. The portal remains a decision-support interface and not an official navigational chart or ECDIS.

## 7. Accessibility behavior

The light theme provides:

- dark primary and secondary foregrounds on white and near-white surfaces;
- visible keyboard focus outlines;
- readable placeholders and form labels;
- semantic text plus color indicators;
- a `prefers-contrast: more` override that strengthens borders and secondary text;
- the same information hierarchy across desktop, tablet, and mobile layouts.

## 8. Components explicitly covered

The final light-mode layer includes dedicated treatment for:

- the application header and status controls;
- provider-readiness cards;
- KPI and command-summary cards;
- analysis and operations panels;
- focus dialogs and the Close control;
- the expanded Leaflet vessel rail;
- selected-vessel details;
- vessel filters, checkboxes, search, and sorting controls;
- vessel and port-event rows;
- Leaflet map controls, labels, tooltips, and attribution;
- vessel tables;
- the Vessel Speed Profile in compact and expanded layouts.

Changes to this palette should be made through design tokens first. Component-specific literal colors should be added only when a token cannot represent the intended semantic role.
