import express from "express";
import cors from "cors";
import { config, MAPS } from "./config/index.js";
import { authRouter } from "./routes/auth.js";
import { storeRouter } from "./routes/store.js";
import { playerRouter } from "./routes/player.js";
import { profileRouter } from "./routes/profile.js";
import { paymentsRouter } from "./routes/payments.js";
import { internalRouter } from "./routes/internal.js";
import { adminToolRouter } from "./routes/admintool.js";
import { adminRouter } from "./routes/admin.js";
import { storageRouter } from "./routes/storage.js";
import { i18nRouter } from "./routes/i18n.js";

const app = express();
app.use(cors());
// Stash the raw request body so the Stripe webhook can verify its signature
// (Stripe signs the exact bytes; the parsed JSON can't be re-serialized identically).
app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } }));

// Health + map metadata (matchmaker reads scaling off the map, not hardcoded).
app.get("/health", (_req, res) => res.json({ ok: true, store: config.dataStore }));
app.get("/maps", (_req, res) => res.json({ maps: Object.values(MAPS) }));

app.use("/auth", authRouter);
app.use("/store", storeRouter);
app.use("/player", playerRouter);
app.use("/profile", profileRouter);
app.use("/payments", paymentsRouter);
app.use("/internal", internalRouter);
app.use("/admintool", adminToolRouter);
app.use("/admin", adminRouter);
app.use("/objects", storageRouter);
app.use("/i18n", i18nRouter);

// Only 404 on API paths. Other routes (the client app + its assets) are handled
// by the combined deploy server's static middleware when embedded; in standalone
// dev the backend isn't asked for those anyway.
const API_PREFIXES = ["/auth", "/store", "/player", "/profile", "/payments", "/internal", "/admintool", "/admin", "/objects", "/i18n", "/health", "/maps"];
app.use((req, res, next) => {
  if (API_PREFIXES.some((p) => req.path === p || req.path.startsWith(p + "/"))) {
    return res.status(404).json({ error: "Not found." });
  }
  next();
});

// Export the configured app so a combined deploy server can mount it alongside
// the game server on one port. Only auto-listen when this file is run directly.
export { app };

import { fileURLToPath } from "url";
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  app.listen(config.port, () => {
    console.log(`BRIDGE backend on :${config.port}  (store=${config.dataStore})`);
    if (config.google.clientId.startsWith("PLACEHOLDER")) {
      console.log("⚠ Google OAuth using PLACEHOLDER keys — sign-in is stubbed for dev.");
    }
  });
}
