import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { frontendRoutes } from "./frontend-routes";
import { SwipeApp } from "./swipe-app";
import { WorkspaceApp } from "./workspace-app";
import "./styles.css";

const rootElement = document.getElementById("root");

if (rootElement === null) {
  throw new Error("Root element not found.");
}

const app = window.location.pathname === frontendRoutes.swipe ? <SwipeApp /> : <WorkspaceApp />;

createRoot(rootElement).render(
  <StrictMode>
    {app}
  </StrictMode>,
);
