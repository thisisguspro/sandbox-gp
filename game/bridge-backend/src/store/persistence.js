// Optional Postgres persistence for the in-memory store.
//
// Strategy: the game keeps all state in the Maps inside memory.js. Rather than
// reimplement ~40 store methods against SQL, we serialize the whole durable state
// to a single jsonb row and (a) load it on boot, (b) write it back on a debounce
// and on shutdown. This makes accounts, progression, credits, cosmetics, store
// edits, codes and checkout sessions survive restarts/redeploys.
//
// Activated automatically whenever DATABASE_URL is present (see store/index.js).

import pg from "pg";
import { __exportSnapshot, __importSnapshot } from "./memory.js";

const { Pool } = pg;
const STATE_ID = "singleton";
const FLUSH_MS = 8000;

let pool = null;
let saving = false;

// Connect, ensure the table exists, and hydrate the in-memory Maps from the last
// saved snapshot. Returns true if persistence is active. Throws on conn/ DDL
// failure so the caller can decide to fall back to pure in-memory mode.
export async function initPersistence() {
  const url = process.env.DATABASE_URL;
  if (!url) return false;

  pool = new Pool({ connectionString: url, max: 3 });
  await pool.query(
    `CREATE TABLE IF NOT EXISTS game_state (
       id text PRIMARY KEY,
       data jsonb NOT NULL,
       updated_at timestamptz NOT NULL DEFAULT now()
     )`
  );

  const { rows } = await pool.query("SELECT data FROM game_state WHERE id = $1", [STATE_ID]);
  if (rows[0]?.data) __importSnapshot(rows[0].data);

  const timer = setInterval(() => { flush().catch((e) => console.error("[persistence] flush failed:", e.message)); }, FLUSH_MS);
  if (timer.unref) timer.unref();

  // Best-effort final flush on shutdown. Kept fast so it never blocks a restart
  // long enough to earn a SIGKILL; the periodic flush is the real safety net.
  const onExit = async (sig) => {
    try { await flush(); } catch (e) { console.error("[persistence] shutdown flush failed:", e.message); }
    process.exit(sig === "SIGINT" ? 130 : 0);
  };
  process.once("SIGTERM", () => onExit("SIGTERM"));
  process.once("SIGINT", () => onExit("SIGINT"));

  return true;
}

// Serialize the current in-memory state and upsert it as the single snapshot row.
export async function flush() {
  if (!pool || saving) return;
  saving = true;
  try {
    const snap = __exportSnapshot();
    await pool.query(
      `INSERT INTO game_state (id, data, updated_at)
       VALUES ($1, $2::jsonb, now())
       ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
      [STATE_ID, JSON.stringify(snap)]
    );
  } finally {
    saving = false;
  }
}
