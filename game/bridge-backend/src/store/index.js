// Store factory. The rest of the app imports `db` from here and never knows
// which backend it is. The in-memory store holds all state in RAM; when a
// DATABASE_URL is present we additionally turn on a Postgres persistence layer
// that snapshots that state so it survives restarts/redeploys (accounts,
// progression, credits, cosmetics, store edits, codes, checkout sessions).

import { memoryStore } from "./memory.js";
import { initPersistence } from "./persistence.js";

// Hydrate from Postgres before the app starts serving, if configured. On any
// failure we log and continue with pure in-memory state rather than crash the
// whole game server.
if (process.env.DATABASE_URL) {
  try {
    const ok = await initPersistence();
    console.log(ok ? "[store] persistence ON (Postgres snapshot)" : "[store] persistence OFF (no DATABASE_URL)");
  } catch (e) {
    console.error("[store] persistence init failed, using in-memory only:", e.message);
  }
} else {
  console.log("[store] persistence OFF (no DATABASE_URL) — state is in-memory only");
}

// `db` is always the in-memory store; persistence loads into / saves from its
// Maps in place, so callers are unchanged.
export const db = memoryStore;
