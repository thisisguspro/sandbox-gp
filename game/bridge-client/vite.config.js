import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev server runs on :5173. The client talks to the backend (:4000) and game
// server (:5000) directly via the URLs in src/api/config.js (override with a
// .env file — see .env.example).
export default defineConfig({
  // STAMP THE BUILD.
  //
  // There was no version visible anywhere in the app. You could push to Render and
  // then have no way of telling whether the thing in front of you was the build you
  // just deployed or a cached copy of the last one. Now the version and the build
  // time are baked in, and shown in the corner of the menu.
  define: {
    __APP_VERSION__: JSON.stringify("24.4.0"),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString().slice(0, 16).replace("T", " ")),
  },
  base: "./",
  plugins: [react()],
  server: { port: 5173, host: true },
});
