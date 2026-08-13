import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { setDockVisibility } from "@tauri-apps/api/app";

import App from "./App";
import { SeatTargetBubble } from "./pet/SeatIcon";
import "./styles.css";

if ("__TAURI_INTERNALS__" in window && navigator.userAgent.includes("Mac")) {
  void setDockVisibility(false);
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {new URLSearchParams(location.search).has("seat-target") ? <SeatTargetBubble /> : <App />}
  </StrictMode>,
);
