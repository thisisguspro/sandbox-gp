import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import { I18nProvider } from "./api/i18n.jsx";
import "./styles/global.css";

createRoot(document.getElementById("root")).render(
  <I18nProvider>
    <App />
  </I18nProvider>
);
