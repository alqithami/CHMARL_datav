import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "leaflet/dist/leaflet.css";
import "./index.css";
import "./tileMap.css";
import "./leafletMap.css";
import "./statusPanel.css";
import "./operationalWatchlist.css";
import "./platformLayout.css";
import "./mapPolish.css";
import "./commandBar.css";
import "./aisDiagnostics.css";
import "./mapRailControls.css";
import "./professionalLayout.css";
import "./insightPanels.css";
import "./uiClutterPolish.css";
import "./mapMarkerPolish.css";
import "./vesselTablePolish.css";
import "./metricTonePolish.css";
import "./executiveDeclutter.css";
import "./mawaniDesignSystem.css";
import "./mawaniCommandSummary.css";
import "./mawaniTopbarCompact.css";
import "./portCoverageMatrix.css";
import "./mawaniThemeModes.css";
import "./topbarStatusClarity.css";
import "./mapMotionStability.css";
import "./mawaniVisualRefresh.css";
import "./vesselSpeedProfile.css";
import "./mawaniLightMode.css";
import "./portalVision.css";
import "./subwindowViews.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
