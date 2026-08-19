import { readFileSync } from "node:fs";

function read(path) {
  return readFileSync(path, "utf8");
}

function assertIncludes(content, text, label) {
  if (!content.includes(text)) throw new Error(`Sub-window UI contract failed: ${label}`);
}

function assertNotIncludes(content, text, label) {
  if (content.includes(text)) throw new Error(`Sub-window UI contract failed: ${label}`);
}

const shell = read("src/components/ProfessionalDashboardShell.tsx");
const eventFeed = read("src/components/insights/PortEventFeed.tsx");
const styles = read("src/subwindowViews.css");
const main = read("src/main.tsx");

assertIncludes(shell, "panel: ProfessionalFocusPanel", "focus modal is not typed by panel kind");
assertIncludes(shell, "portal-focus-backdrop", "focus modal does not use the high-layer backdrop");
assertIncludes(shell, "portal-focus-content", "focus modal does not use the standardized content region");
assertIncludes(shell, "document.body.style.overflow = \"hidden\"", "background scrolling is not locked while a focus view is open");
assertIncludes(shell, "if (event.currentTarget === event.target) onClose()", "backdrop dismissal is absent");
assertIncludes(shell, "description={focusContent.description}", "focus views do not expose explanatory context");
assertIncludes(shell, 'panel: focusPanel, title: "Port Event Feed"', "port event feed does not receive its panel-specific focus class");

assertIncludes(eventFeed, "port-event-stat-grid", "port event summary metrics are absent");
assertIncludes(eventFeed, "port-event-toolbar", "port event filters are not separated from the content area");
assertIncludes(eventFeed, "port-event-table-shell", "expanded event rows are not presented in a table shell");
assertIncludes(eventFeed, "portal-focus-empty-state", "professional empty-state handling is absent");
assertIncludes(eventFeed, "No active port events", "zero-event state is not explained clearly");
assertIncludes(eventFeed, "Port event provider not connected", "missing-provider state is not explained clearly");

assertIncludes(styles, "z-index: 30000", "focus views can still sit below Leaflet controls");
assertIncludes(styles, "grid-template-rows: auto minmax(0, 1fr)", "focus panel header and body are not bounded correctly");
assertIncludes(styles, ".portal-focus-content .port-event-feed", "port event feed does not have a dedicated three-row grid");
assertIncludes(styles, "grid-template-rows: auto auto minmax(0, 1fr)", "port event filters can still stretch into the content area");
assertIncludes(styles, ".portal-focus-vessels .vessel-table-shell", "vessel-table focus layout is not protected");
assertIncludes(styles, ".portal-focus-watchlist .watchlist-panel", "watchlist focus layout is not protected");
assertIncludes(styles, ".portal-focus-scene .leaflet-map-controls", "expanded map controls are not constrained to the map viewport");
assertIncludes(styles, ".portal-focus-empty-state", "shared empty-state styling is absent");
assertIncludes(styles, ":root[data-theme=\"light\"] .portal-focus-panel", "light-mode focus parity is absent");
assertIncludes(styles, "@media (max-width: 760px)", "small-screen focus layout is absent");
assertIncludes(styles, "@media (prefers-reduced-motion: reduce)", "reduced-motion focus handling is absent");
assertNotIncludes(styles, "linear-gradient(", "sub-window system uses decorative gradients");

assertIncludes(main, 'import "./subwindowViews.css"', "sub-window styles are not loaded last");

console.log("Professional sub-window and port-event-feed UI contract verified.");
