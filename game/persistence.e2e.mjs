#!/usr/bin/env node
/* SANDBOX GP — persistence proof.
 * Reproduces the exact production failure ("profile all zeros after coming
 * back"): earn progression in a real authed race, HARD-KILL the server,
 * boot a fresh process, and require every number to survive.
 * Run AFTER a race has happened and the server has been restarted:
 *   node persistence.e2e.mjs record   (before restart: saves expectations)
 *   node persistence.e2e.mjs verify   (after restart: compares)
 */
import { io } from "./bridge-gameserver/node_modules/socket.io-client/build/esm/index.js";
import { writeFileSync, readFileSync } from "node:fs";

const BASE = "http://localhost:8080";
const j = (r) => r.json();
const mode = process.argv[2] || "record";

if (mode === "record") {
  const guest = await fetch(`${BASE}/auth/guest`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Persist" }) }).then(j);
  const H = { authorization: `Bearer ${guest.token}` };
  const s = io(BASE, { transports: ["websocket"] });
  await new Promise((r) => s.on("connect", r));
  let view = null; s.on("state", (m) => { view = m.view; });
  const room = await new Promise((r) => s.emit("create_room", { config: { isPublic: false, laps: 1, finishTimeoutSec: 5, trackId: "testloop" }, name: "Persist", token: guest.token }, r));
  s.emit("start_match", { roomId: room.roomId });
  await new Promise((r) => { const t = setInterval(() => { if (view?.phase === "ended") { clearInterval(t); r(); } }, 300); setTimeout(r, 60000); });
  s.close();
  await new Promise((r) => setTimeout(r, 9500)); // beyond the 8s flush debounce
  const prof = await fetch(`${BASE}/profile`, { headers: H }).then(j);
  writeFileSync("/tmp/persist-expect.json", JSON.stringify({
    token: guest.token,
    xp: prof.xp, matches: prof.stats.matchesPlayed, credits: prof.balances.CREDITS,
    historyLen: prof.matchHistory.length,
  }));
  console.log(`recorded: xp=${prof.xp} matches=${prof.stats.matchesPlayed} credits=${prof.balances.CREDITS} history=${prof.matchHistory.length}`);
} else {
  const exp = JSON.parse(readFileSync("/tmp/persist-expect.json", "utf8"));
  const prof = await fetch(`${BASE}/profile`, { headers: { authorization: `Bearer ${exp.token}` } }).then(j);
  const okAll = prof.xp === exp.xp && prof.stats?.matchesPlayed === exp.matches
    && prof.balances?.CREDITS === exp.credits && (prof.matchHistory?.length ?? 0) === exp.historyLen;
  console.log(okAll
    ? `\x1b[32m✓ SURVIVED RESTART\x1b[0m xp=${prof.xp} matches=${prof.stats.matchesPlayed} credits=${prof.balances.CREDITS} history=${prof.matchHistory.length}`
    : `\x1b[31m✗ STATE LOST\x1b[0m got xp=${prof.xp} matches=${prof.stats?.matchesPlayed} credits=${prof.balances?.CREDITS} history=${prof.matchHistory?.length} expected ${JSON.stringify(exp)}`);
  process.exit(okAll ? 0 : 1);
}
