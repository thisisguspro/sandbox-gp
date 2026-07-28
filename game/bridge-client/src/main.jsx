import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import { I18nProvider } from "./api/i18n.jsx";
import { initAnalytics } from "./api/analytics.js";
import { cgInit, cgLoadingStart } from "./api/crazygames.js";
import "./styles/global.css";

initAnalytics(); // fire-and-forget; safe no-op unless a provider is configured
cgInit().then(() => cgLoadingStart()); // no-op unless built with VITE_CRAZYGAMES=1

// Browsers scroll the page on Space / arrow keys — a CrazyGames requirement
// (and generally correct for a game) is to suppress that outside text inputs.
window.addEventListener("keydown", (e) => {
  const tag = e.target?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || e.target?.isContentEditable) return;
  if ([" ", "Spacebar", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) e.preventDefault();
});

createRoot(document.getElementById("root")).render(
  <I18nProvider>
    <App />
  </I18nProvider>
);
