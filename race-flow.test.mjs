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

  const created = await new Promise((r) => socket.emit("create_room", { config: { isPublic: false, laps: 1, finishTimeoutSec: 4 }, name: "TestHost" }, r));
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

  // While frozen, driving input must do nothing.
  const meBefore = () => (view?.players || []).find((p) => p.id === view?.you?.id);
  const f0 = meBefore();
  socket.emit("race_input", { roomId, throttle: 1, steer: 0 });
  await new Promise((r) => setTimeout(r, 800));
  const f1 = meBefore();
  (Math.hypot((f1?.x ?? 0) - (f0?.x ?? 0), (f1?.z ?? 0) - (f0?.z ?? 0)) < 0.2)
    ? ok("input ignored during 3-2-1 freeze") : no("car moved during freeze!");

  // Past the freeze: throttle=1 must move the HUMAN car authoritatively.
  await new Promise((r) => setTimeout(r, 2600));
  socket.emit("race_input", { roomId, throttle: 1, steer: 0 });
  const m0 = meBefore();
  await new Promise((r) => setTimeout(r, 1500));
  const m1 = meBefore();
  const moved = Math.hypot((m1?.x ?? 0) - (m0?.x ?? 0), (m1?.z ?? 0) - (m0?.z ?? 0));
  (moved > 6) ? ok(`race_input drives the car on the server (${moved.toFixed(1)}m in 1.5s)`) : no(`car barely moved: ${moved.toFixed(1)}m`);
  ((m1?.speed ?? 0) > 5) ? ok(`server reports live speed (${m1.speed.toFixed(1)} m/s)`) : no(`speed missing: ${m1?.speed}`);
  (typeof view?.serverNow === "number") ? ok("view carries serverNow (client interp clock)") : no("serverNow missing");

  // The shovel reset: back to a dead stop.
  socket.emit("race_reset", { roomId });
  await new Promise((r) => setTimeout(r, 400));
  const r1 = meBefore();
  (r1?.resetting === true || (r1?.speed ?? 9) < 0.5) ? ok("race_reset scoops to a dead stop") : no(`reset failed (speed ${r1?.speed})`);
  socket.emit("race_input", { roomId, throttle: 0, steer: 0 });

  // Bots race 1 lap; human idles → ranked at timeout. Poll up to 75s.
  const deadline = Date.now() + 75_000;
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

  // ---- auto bot-fill: a SOLO host starting alone gets a full grid ----
  // The retention case: someone hits "Host Match" then "Start" with nobody
  // else present. They must NOT race an empty track — the server tops the
  // grid up with bots automatically.
  {
    const s2 = await connect();
    let v2 = null;
    s2.on("state", (msg) => { v2 = msg.view; });
    const room2 = await new Promise((r) => s2.emit("create_room", { config: { isPublic: false, laps: 1, finishTimeoutSec: 4 }, name: "SoloHost" }, r));
    if (!room2?.roomId) { no("solo create_room failed"); }
    else {
      await new Promise((r) => setTimeout(r, 300));
      (v2?.players?.length === 1) ? ok("solo lobby has just the host (no manual bots)") : no(`solo lobby roster: ${v2?.players?.length}`);
      s2.emit("start_match", { roomId: room2.roomId });
      await new Promise((r) => setTimeout(r, 700));
      (v2?.players?.length === 4) ? ok("start auto-fills the grid to 4 racers") : no(`auto-fill roster: ${v2?.players?.length}`);
      const bots = (v2?.players || []).filter((p) => p.id !== v2?.you?.id);
      (bots.length === 3) ? ok("3 bots added around the solo human") : no(`bot count: ${bots.length}`);
      const tiers = new Set(bots.map((b) => b.name?.split(" ")[0]));
      (tiers.size >= 2) ? ok(`filled grid has a spread of tiers (${[...tiers].join("/")})`) : no(`tiers not varied: ${[...tiers]}`);
      (v2?.phase === "active" || v2?.phase === "starting") ? ok("solo race starts (phase active)") : no(`solo phase: ${v2?.phase}`);
    }
    s2.close();
  }

  // ---- TIME TRIAL over sockets: no auto-fill, no items, mode in view + result ----
  {
    const s3 = await connect();
    let v3 = null;
    s3.on("state", (msg) => { v3 = msg.view; });
    const room3 = await new Promise((r) => s3.emit("create_room", { config: { isPublic: false, mode: "timetrial", items: false, autoFill: false, laps: 1, finishTimeoutSec: 4 }, name: "ClockHost" }, r));
    if (!room3?.roomId) { no("timetrial create_room failed"); }
    else {
      s3.emit("start_match", { roomId: room3.roomId });
      await new Promise((r) => setTimeout(r, 700));
      (v3?.players?.length === 1) ? ok("timetrial: no bot auto-fill (solo on the grid)") : no(`tt roster: ${v3?.players?.length}`);
      (v3?.mode === "timetrial") ? ok("timetrial: view carries the mode") : no(`view mode: ${v3?.mode}`);
      ((v3?.itemBoxes || []).length === 0) ? ok("timetrial: zero item boxes on track") : no(`boxes: ${v3?.itemBoxes?.length}`);
      // no finish-timeout without a finisher (by design: practice has no clock
      // pressure); leaving must unseat + destroy the solo room.
      s3.emit("leave_room", { roomId: room3.roomId });
      await new Promise((r) => setTimeout(r, 500));
      const rejoin = await new Promise((r) => s3.emit("join_room", { roomId: room3.roomId, name: "Ghost" }, r));
      (rejoin?.error) ? ok("timetrial: leave destroys the solo room (rejoin refused)") : no(`tt room lingered: ${JSON.stringify(rejoin)}`);
    }
    s3.close();
  }

  console.log(`\n\x1b[1mResult:\x1b[0m ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { no(`fatal: ${e.message}`); process.exit(1); });
