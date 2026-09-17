import React from "react";
import { createRoot } from "react-dom/client";
import App from "../UI/App.js";

export function startUI() {
  const container = document.getElementById("root");

  const root = createRoot(container!);

  root.render(
    React.createElement(React.StrictMode, null, React.createElement(App, null)),
  );
}
