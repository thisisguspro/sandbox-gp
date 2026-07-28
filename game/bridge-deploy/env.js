// Import-order shim. This package is ESM ("type": "module"), so every `import`
// in server.js is HOISTED and evaluated before any module-body code. The game
// server's config reads BACKEND_URL at import time, so setting it in server.js's
// body ran TOO LATE — config already captured the localhost:4000 fallback and
// every gameserver->backend call (match rewards, in-match loadouts, invites,
// bounties) silently failed. Importing THIS file first guarantees BACKEND_URL is
// set before the backend/gameserver modules are imported.
// Run the whole combined server on US Central Time (America/Chicago, DST-aware) so
// server-side clock reads and logs are in Central. Storage timestamps stay ISO/UTC
// (toISOString is always UTC); daily resets compute their own Central day key.
process.env.TZ = process.env.TZ || "America/Chicago";

const PORT = process.env.PORT || 8080;
process.env.BACKEND_URL = process.env.BACKEND_URL || `http://localhost:${PORT}`;
