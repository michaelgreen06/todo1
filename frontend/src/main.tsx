import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { WorkspaceApp } from "./workspace-app";
import "./styles.css";

const rootElement = document.getElementById("root");

if (rootElement === null) {
  throw new Error("Root element not found.");
}

createRoot(rootElement).render(
  <StrictMode>
    <WorkspaceApp />
  </StrictMode>,
);
