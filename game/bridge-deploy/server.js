// BRIDGE — combined deploy server.
//
// Runs EVERYTHING on one port so it can be hosted as a single service (e.g. on
// Render's free tier): the backend REST API, the Socket.IO game server, and the
// built React client (served as static files). One URL, no cross-service wiring.
//
// How it fits together:
//   - The backend Express app is imported and mounted (all /auth, /store, etc.).
//   - The game server's Socket.IO is attached to the SAME HTTP server.
//   - The built client (bridge-client/dist) is served for everything else.
//   - The game server talks to the backend over localhost on this same port, and
//     they share JWT/service secrets automatically (same process env).
//
// Required: build the client first (npm run build in ../bridge-client) and set
// BACKEND_URL to this server's own origin so the game server's internal calls
// resolve to itself. The start script and render.yaml handle this for you.

import "./env.js"; // MUST be first: sets BACKEND_URL before the game server's
                   // config reads it at import time (ESM hoists imports above
                   // module-body code, so setting it here would be too late).
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import express from "express";

import { app } from "../bridge-backend/src/server.js";
import { attachGameServer } from "../bridge-gameserver/src/net/server.js";

const PORT = process.env.PORT || 8080;

// Resilience net: this is a SINGLE-PROCESS server — the backend API, the
// Socket.IO game server, and every active match all share one Node process. An
// unhandled rejection or uncaught exception from any one request would otherwise
// terminate the process (Node's default), dropping every connected player and
// wiping the in-memory store. Log loudly and stay up instead; individual routes
// still return their own error responses.
process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection] kept server alive:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[uncaughtException] kept server alive:", err);
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Serve the built client. Vite outputs to bridge-client/dist.
const clientDist = path.join(__dirname, "..", "bridge-client", "dist");
app.use(express.static(clientDist));

// SPA fallback: any non-API, non-asset route returns index.html so the client
// router handles it. API routes are already matched above by the backend.
app.get(/^(?!\/(auth|store|player|profile|payments|internal|admintool|admin|objects|i18n|health|maps|socket\.io)).*/, (_req, res) => {
  res.sendFile(path.join(clientDist, "index.html"));
});

// One HTTP server carries the Express app AND Socket.IO.
const server = http.createServer(app);
attachGameServer(server);

server.listen(PORT, () => {
  console.log(`BRIDGE running on :${PORT}  (backend + game + client, one port)`);
  console.log(`Open the service URL in a browser to play.`);
});
