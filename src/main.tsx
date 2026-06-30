import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import "./tileMap.css";
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

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
