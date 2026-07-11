#!/usr/bin/env node
/* SANDBOX GP — race-flow integration test (Batch 1).
 *
 * Proves the full loop with the stub RaceEngine end-to-end over real Socket.IO:
 *   create_room → add 3 bots → start_match → 3-2-1 freeze → progress advances
 *   → all racers finish → phase "ended" → standings + places + winner present.
 *
 * Start the combined server first (PORT=8080 node bridge-deploy/server.js), then:
 *   node race-flow.test.mjs
 */
import { io } from "./bridge-gameserver/node_modules/socket.io-client/build/esm/index.js";

const GAME = process.env.GAME_URL || "http://localhost:8080";
let pass = 0, fail = 0;
const ok = (m) => { console.log(`  \x1b[32m✓\x1b[0m ${m}`); pass++; };
const no = (m) => { console.log(`  \x1b[31m✗\x1b[0m ${m}`); fail++; };

function connect() {
  return new Promise((resolve, reject) => {
    const socket = io(GAME, { transports: ["websocket"] });
    const t = setTimeout(() => reject(new Error("socket connect timeout")), 8000);
    socket.on("connect", () => { clearTimeout(t); resolve(socket); });
    socket.on("connect_error", (e) => { clearTimeout(t); reject(e); });
  });
}

async function main() {
  console.log("\n\x1b[1mSANDBOX GP race-flow test\x1b[0m");
  const socket = await connect();
  ok("socket connected");

  let view = null;
  const phases = new Set();
  socket.on("state", (msg) => { view = msg.view; if (view?.phase) phases.add(view.phase); });

  const created = await new Promise((r) => socket.emit("create_room", { config: { isPublic: false, raceSeconds: 8 }, name: "TestHost" }, r));
  if (!created?.roomId) return no(`create_room failed: ${JSON.stringify(created)}`);
  ok(`room created (${created.roomId})`);
  const roomId = created.roomId;

  for (let i = 0; i < 3; i++) socket.emit("add_bot", { roomId, tier: "pilot" });
  await new Promise((r) => setTimeout(r, 600));
  (view?.players?.length === 4) ? ok("lobby holds 4 racers (host + 3 bots)") : no(`expected 4 racers, got ${view?.players?.length}`);
  (view?.phase === "lobby") ? ok("phase: lobby") : no(`expected lobby phase, got ${view?.phase}`);

  socket.emit("start_match", { roomId });
  await new Promise((r) => setTimeout(r, 1500));
  (view?.phase === "active") ? ok("phase: active (race running)") : no(`expected active, got ${view?.phase}`);
  ((view?.startFreezeLeft ?? 0) > 0) ? ok(`3-2-1 freeze live (${view.startFreezeLeft.toFixed(1)}s left)`) : no("start freeze missing");

  // Wait past the freeze, sample progress twice to prove it advances.
  await new Promise((r) => setTimeout(r, 2500));
  const s1 = Math.max(...(view?.standings || []).map((p) => p.progress || 0));
  await new Promise((r) => setTimeout(r, 2000));
  const s2 = Math.max(...(view?.standings || []).map((p) => p.progress || 0));
  (s2 > s1 && s2 > 0) ? ok(`progress advances (${s1.toFixed(1)}% → ${s2.toFixed(1)}%)`) : no(`progress stuck (${s1} → ${s2})`);

  // Test race is 8s + freeze; poll up to 25s for ended.
  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline && view?.phase !== "ended") await new Promise((r) => setTimeout(r, 1000));
  (view?.phase === "ended") ? ok("phase: ended (race resolved)") : no(`race never ended (phase ${view?.phase})`);

  const st = view?.standings || [];
  (st.length === 4 && st.every((p) => p.place >= 1 && p.place <= 4)) ? ok(`all 4 racers placed (${st.map((p) => `${p.place}:${p.name}`).join(", ")})`) : no("placements missing");
  (view?.winner && st.find((p) => p.place === 1)?.id === view.winner) ? ok("winner matches 1st place") : no(`winner mismatch: ${view?.winner}`);
  (view?.you?.place >= 1) ? ok(`host placed ${view.you.place}`) : no("host has no place");
  (["finish", "timeout"].includes(view?.winReason)) ? ok(`winReason: ${view.winReason}`) : no(`bad winReason: ${view?.winReason}`);
  (phases.has("lobby") && phases.has("active") && phases.has("ended")) ? ok("full lobby→active→ended lifecycle observed") : no(`phases seen: ${[...phases]}`);

  // Rematch: host re-runs — room must flip back to lobby with the same roster.
  socket.emit("rematch", { roomId });
  await new Promise((r) => setTimeout(r, 800));
  (view?.phase === "lobby") ? ok("rematch returns to lobby") : no(`rematch phase: ${view?.phase}`);
  (view?.players?.length === 4) ? ok("rematch re-seats host + 3 bots") : no(`rematch roster: ${view?.players?.length}`);

  socket.close();
  console.log(`\n\x1b[1mResult:\x1b[0m ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { no(`fatal: ${e.message}`); process.exit(1); });
