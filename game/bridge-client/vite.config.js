import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev server runs on :5173. The client talks to the backend (:4000) and game
// server (:5000) directly via the URLs in src/api/config.js (override with a
// .env file — see .env.example).
export default defineConfig({
  base: "./",
  plugins: [react()],
  server: { port: 5173, host: true },
});
