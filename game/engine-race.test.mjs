#!/usr/bin/env node
/* SANDBOX GP — engine fast-forward test (no sockets, no real time).
 * Runs the authoritative RaceEngine directly at dt=0.05 and asserts the whole
 * physical race works: acceleration, steering, sand drag, checkpoints, laps,
 * bot driving, finishing, placements, reset scoop.
 */
import { MODES } from "./bridge-gameserver/src/engine/modes.js";
import { RaceEngine } from "./bridge-gameserver/src/engine/RaceEngine.js";
import { CAR, stepCar } from "./bridge-gameserver/src/engine/shared/carSim.js";
import { makeTrack } from "./bridge-gameserver/src/engine/shared/track.js";

let pass = 0, fail = 0;
const ok = (m) => { console.log(`  \x1b[32m✓\x1b[0m ${m}`); pass++; };
const no = (m) => { console.log(`  \x1b[31m✗\x1b[0m ${m}`); fail++; };
const DT = 0.05;

// Wait out the start freeze, whatever it currently is. Tests used to hardcode
// "tick 3.6s" against a 3s countdown; the pre-race flythrough made it 11s and
// every one of them started grabbing boxes while the grid was still frozen.
function clearCountdown(e) {
  for (let s = 0; s < 30 && (e.startFreezeUntil - e.now) > 0; s += DT) e.tick(DT);
  e.tick(DT);
}
const run = (e, sec) => { for (let i = 0; i < sec / DT; i++) e.tick(DT); };

console.log("\n\x1b[1mSANDBOX GP engine fast-forward test\x1b[0m");

// ---- 1) straight-line physics: throttle reaches max speed, brake stops ----
{
  const e = new RaceEngine({ config: { trackId: "sandcastle" } });   // pin it: config:{} now rolls a RANDOM map
  const id = e.addPlayer("Human", { userId: "u1" });
  e.start({ force: true });
  clearCountdown(e); // freeze (length is a design knob — never hardcode it)
  e.setInput(id, { throttle: 1, steer: 0 });
  run(e, 1.7); // straight-ish launch stretch only — the ribbon curves after that
  const p = e.players.get(id);
  (p.speed > 19) ? ok(`throttle accelerates hard off the line (${p.speed.toFixed(1)} m/s in 1.7s)`) : no(`speed only ${p.speed.toFixed(1)}`);
  // pure top-speed check on an idealized infinite straight
  {
    const straight = { nearest: () => 0, lateral: () => 0, width: 12, at: () => ({ x: 0, z: 0, tx: 1, tz: 0, s: 0 }) };
    const s = { x: 0, z: 0, heading: 0, speed: 0, offTrack: false, sampleHint: 0 };
    for (let i = 0; i < 4 / DT; i++) stepCar(s, { throttle: 1, steer: 0 }, DT, straight);
    (Math.abs(s.speed - CAR.MAX_SPEED) < 0.2) ? ok(`top speed on a straight = MAX_SPEED (${s.speed.toFixed(1)})`) : no(`straight top speed ${s.speed.toFixed(1)}`);
  }
  e.setInput(id, { throttle: -1, steer: 0 });
  run(e, 2.5);
  (p.speed < 0.6) ? ok("brake stops the car") : no(`brake left speed ${p.speed.toFixed(1)}`);
}

// ---- 2) steering changes heading; car stays within soft walls ----
{
  const e = new RaceEngine({ config: { trackId: "sandcastle" } });   // pin it: config:{} now rolls a RANDOM map
  const id = e.addPlayer("Human", { userId: "u1" });
  e.start({ force: true });
  clearCountdown(e);
  const p = e.players.get(id);
  const h0 = p.heading;
  e.setInput(id, { throttle: 1, steer: 1 });
  run(e, 2);
  (Math.abs(p.heading - h0) > 0.5) ? ok("steering turns the car") : no("heading barely changed");
  // hold full lock — the soft wall must contain us near the ribbon, and leaving
  // the paint must flag offTrack. Sample WHILE we're out there: the sand now
  // buries a stopped car and respawns it on the centerline, so checking after a
  // long run would just observe the rescue, not the excursion.
  let sawOffTrack = false, maxLat = 0;
  for (let s = 0; s < 10; s += DT) {
    e.tick(DT);
    if (p.offTrack) sawOffTrack = true;
    if (!p.crumbledUntil) {
      const ii = e.track.nearest(p.x, p.z, p.sampleHint, p.y || 0);
      maxLat = Math.max(maxLat, Math.abs(e.track.lateral(p.x, p.z, ii)));
    }
  }
  (maxLat <= e.track.width / 2 + CAR.EDGE_MARGIN + 0.3) ? ok(`soft wall contains car (max lat ${maxLat.toFixed(1)}m)`) : no(`escaped to lat ${maxLat.toFixed(1)}m`);
  sawOffTrack ? ok("doughnutting off the ribbon flags offTrack (sand)") : no("offTrack never flagged");
  // deep-sand steady state on an idealized always-sand stub (tests the exact drag path)
  {
    const sand = { nearest: () => 0, lateral: () => 999, width: 12, at: () => ({ x: 0, z: 0, tx: 1, tz: 0, s: 0 }) };
    const s = { x: 0, z: 0, heading: 0, speed: CAR.MAX_SPEED, offTrack: false, sampleHint: 0 };
    for (let i = 0; i < 3 / DT; i++) stepCar(s, { throttle: 1, steer: 0 }, DT, sand);
    const cap = CAR.MAX_SPEED * CAR.SAND_MAX_FRAC;
    (s.offTrack && s.speed <= cap + 0.5) ? ok(`deep sand caps speed (${s.speed.toFixed(1)} ≤ ~${cap.toFixed(1)})`) : no(`sand cap failed (${s.speed.toFixed(1)})`);
  }
}

// ---- 3) reset scoop: back to centerline, dead stop, counted ----
{
  const e = new RaceEngine({ config: { trackId: "sandcastle" } });   // pin it: config:{} now rolls a RANDOM map
  const id = e.addPlayer("Human", { userId: "u1" });
  e.start({ force: true });
  clearCountdown(e);
  e.setInput(id, { throttle: 1, steer: 0.8 });
  run(e, 3);
  e.requestReset(id);
  const p = e.players.get(id);
  const i = e.track.nearest(p.x, p.z, -1);
  const lat = Math.abs(e.track.lateral(p.x, p.z, i));
  (lat < 0.5) ? ok("reset returns to centerline") : no(`reset lat ${lat.toFixed(2)}m`);
  (p.speed === 0) ? ok("reset is a dead stop") : no(`reset speed ${p.speed}`);
  run(e, 0.5);
  (p.speed === 0) ? ok("scoop beat holds the car briefly") : no("car moved during scoop beat");
  (p.mResets === 1) ? ok("reset counted for stats") : no("reset not counted");
}

// ---- 4) a bot drives THREE FULL LAPS and finishes ----
{
  const e = new RaceEngine({ config: { trackId: "testloop" } });   // engine behavior, not track length
  const id = e.addPlayer("Botty", { isBot: true, botTier: "pilot" });
  e.start({ force: true });
  const t0 = Date.now();
  let lapsSeen = 0;
  for (let sec = 0; sec < 240 && e.phase !== "ended"; sec += DT) {
    e.tick(DT);
    const evs = e.eventsFor(id);
    for (const ev of evs) if (ev.type === "lap") lapsSeen = Math.max(lapsSeen, ev.lap);
  }
  const p = e.players.get(id);
  (p.lap >= 3 && p.finished) ? ok(`bot completed ${p.lap} laps and finished (sim ${(Date.now() - t0)}ms)`) : no(`bot lap=${p.lap} finished=${p.finished} phase=${e.phase}`);
  (lapsSeen >= 3) ? ok("lap events emitted in order") : no(`lap events seen: ${lapsSeen}`);
  (p.mBestLapSec > 5 && p.mBestLapSec < 120) ? ok(`best lap sane: ${p.mBestLapSec}s`) : no(`best lap weird: ${p.mBestLapSec}`);
  (e.winner === id && p.place === 1) ? ok("winner + place recorded") : no("winner/place wrong");
  (e.winReason === "finish") ? ok("winReason: finish") : no(`winReason: ${e.winReason}`);
}

// ---- 5) four bots race; all finish or rank by timeout; placements unique ----
{
  const e = new RaceEngine({ config: { trackId: "sandcastle" } });
  for (let i = 0; i < 4; i++) e.addPlayer(`Bot${i}`, { isBot: true, botTier: "pilot" });
  e.start({ force: true });
  // four bots trading items now die for 4s per takedown (goal: game-feel) —
  // brawls run longer by design, so the sim budget reflects it
  for (let sec = 0; sec < 420 && e.phase !== "ended"; sec += DT) e.tick(DT);
  const ps = [...e.players.values()];
  (e.phase === "ended") ? ok("4-bot race resolves") : no(`race never ended`);
  const places = ps.map((p) => p.place).sort();
  (JSON.stringify(places) === "[1,2,3,4]") ? ok(`placements 1-4 unique (${ps.map(p=>`${p.place}:${p.name}`).join(", ")})`) : no(`bad places ${places}`);
  const r = e.matchResult();
  (r.winner && r.map.id === "sandcastle") ? ok("matchResult carries winner + track") : no("matchResult malformed");
}

// ---- 6) anti-shortcut: skipping checkpoints must NOT count a lap ----
{
  const e = new RaceEngine({ config: { trackId: "sandcastle" } });
  const id = e.addPlayer("Cheater", { userId: "u1" });
  e.start({ force: true });
  clearCountdown(e);
  const p = e.players.get(id);
  // teleport just before the start line without touching checkpoints
  const pose = e.track.centerPose(e.track.samples.length - 3);
  p.x = pose.x; p.z = pose.z; p.heading = pose.heading; p.sampleHint = e.track.nearest(p.x, p.z, -1); p.lastSample = p.sampleHint;
  e.setInput(id, { throttle: 1, steer: 0 });
  run(e, 1.5); // cross the line
  (p.lap === 0) ? ok("crossing the line without checkpoints does not count a lap") : no(`lap counted illegally: ${p.lap}`);
}

// ---- 7) item boxes + skill challenges → tiers ----
{
  const e = new RaceEngine({ config: { seed: 42 } });
  const id = e.addPlayer("Human", { userId: "u1" });
  e.start({ force: true });
  clearCountdown(e);
  const p = e.players.get(id);
  (e.itemBoxes.length >= 3 && e.itemBoxes.every((b) => b.active)) ? ok(`${e.itemBoxes.length} item boxes laid out, all active`) : no("boxes missing");

  clearCountdown(e);          // boxes do nothing while the grid is frozen
  const grab = () => {
    const box = e.itemBoxes.find((b) => b.active);
    p.x = box.x; p.z = box.z; p.sampleHint = e.track.nearest(p.x, p.z, -1); p.lastSample = p.sampleHint;
    e.tick(DT);
    return box;
  };

  // goal #4 contract: EVERY box starts a rings run — 6 hoops, 15s window,
  // 2 hoops per tier, tier-weighted loot, and the kite dud applies itself.
  {
    const box = grab();
    (p.challenge?.type === "rings") ? ok("box → rings run (no other challenge types)") : no(`type: ${p.challenge?.type}`);
    (p.challenge?.gates?.length === 6) ? ok("six hoops per run") : no(`gates: ${p.challenge?.gates?.length}`);
    // hit exactly 3 gates, then let the 15s window expire → silver
    for (const g of p.challenge.gates.slice(0, 3)) { p.x = g.x; p.z = g.z; p.sampleHint = e.track.nearest(p.x, p.z, -1); e.tick(DT); }
    for (let s = 0; s < 15.4 && p.challenge; s += DT) e.tick(DT);
    (p.challenge === null) ? ok("15s window hard-stops the run") : no("window never expired");
    const gotSilver = p.heldItem?.tier === "silver" || p._selfKited === true || (!p.heldItem && [...(e._eventLog || [])].some((r) => r.ev.type === "challenge_end" && r.ev.tier === "silver"));
    gotSilver ? ok("3 hoops → silver-tier roll (2 hoops per tier)") : no(`tier: ${JSON.stringify(p.heldItem)}`);
    if (p.heldItem) e.useItem(id);
    run(e, 1);
  }
  // negative auto-applies: force the dud and watch it latch on
  {
    for (let s = 0; s < 130 && !e.itemBoxes.some((b) => b.active); s += DT) e.tick(DT);   // wait for the wave
    const rng0 = e.rng; e.rng = () => 0.0001;   // first table entry = kite at bronze
    grab();
    for (let s = 0; s < 15.5 && p.challenge; s += DT) e.tick(DT);   // 0 hoops → bronze
    e.rng = rng0;
    const kited = (p.effects || []).some((f) => f.kind === "kited");
    (kited && !p.heldItem) ? ok("dud kite latches onto the roller (never held)") : no(`kited=${kited} held=${JSON.stringify(p.heldItem)}`);
    for (let s = 0; s < 3.2; s += DT) { e.kiteTap?.(id); e.tick(DT); }
  }
  (e.itemBoxes.some((b) => b.active)) ? ok("boxes respawn after their cooldown") : no("no box ever respawned");
  const evs = e.eventsFor(id);
  (p.mChallenges >= 2) ? ok(`challenge stats tracked (${p.mChallenges} completed)`) : no("mChallenges not tracked");
}

// ---- 8) rings partial credit + one-thing-at-a-time rule ----
{
  const e = new RaceEngine({ config: { seed: 7 } });
  const id = e.addPlayer("Human", { userId: "u1" });
  e.start({ force: true });
  clearCountdown(e);
  const p = e.players.get(id);
  // force a rings challenge deterministically by grabbing until rings appears
  let guard = 0;
  while (guard++ < 8) {
    const box = e.itemBoxes.find((b) => b.active);
    p.x = box.x; p.z = box.z; p.sampleHint = e.track.nearest(p.x, p.z, -1); p.lastSample = p.sampleHint;
    e.tick(DT);
    if (p.challenge?.type === "rings") break;
    if (p.challenge) { for (let s = 0; s < 8.4 && p.challenge; s += DT) e.tick(DT); }
    if (p.heldItem) e.useItem(id);
    run(e, 8.2);
  }
  if (p.challenge?.type !== "rings") no("could not obtain a rings challenge");
  else {
    // hit exactly 3 gates, then drive far past the rest along the track
    for (const g of p.challenge.gates.slice(0, 3)) { p.x = g.x; p.z = g.z; p.sampleHint = e.track.nearest(p.x, p.z, -1); e.tick(DT); }
    for (let m = 0; m < 40; m++) { const pose = e.track.centerPose(p.sampleHint + 4); p.x = pose.x; p.z = pose.z; p.sampleHint = e.track.nearest(p.x, p.z, p.sampleHint); e.tick(DT); }
    (p.heldItem?.tier === "silver") ? ok("rings: 3/5 gates → silver tier") : no(`3/5 gave ${JSON.stringify(p.heldItem)}`);
    // holding an item: touching a box must do nothing
    const box2 = e.itemBoxes.find((b) => b.active);
    p.x = box2.x; p.z = box2.z; p.sampleHint = e.track.nearest(p.x, p.z, -1);
    e.tick(DT);
    (box2.active && !p.challenge) ? ok("boxes ignore you while holding an item") : no("second pickup happened while holding");
  }
}

// ---- 9) bots roll tiers straight from boxes ----
{
  const e = new RaceEngine({ config: { seed: 3 } });
  for (let i = 0; i < 4; i++) e.addPlayer(`Bot${i}`, { isBot: true, botTier: "pilot" });
  e.start({ force: true });
  let everHeld = false;
  for (let s = 0; s < 120 && !everHeld; s += DT) {
    e.tick(DT);
    if ([...e.players.values()].some((p) => p.heldItem)) everHeld = true;
  }
  (everHeld) ? ok("bots pick up boxes and hold tiered items") : no("no bot ever held an item");
}

// ---- box waves + bumpers + rescue (Batch A: #3, #6) ----
{
  const e = new RaceEngine({ config: { seed: 11, laps: 9 } });
  const id = e.addPlayer("Wall", { userId: "wall" });
  e.addPlayer("B1", { isBot: true, botTier: "ace" });
  e.start({ force: true });

  // #3a: sparser field
  const stations = e.itemBoxes.length / 3;
  const expectedStations = Math.floor((e.track.total - 55) / 110) + 1;
  (Math.abs(stations - expectedStations) <= 2) ? ok(`boxes: ${stations} stations on ${Math.round(e.track.total)}m (110m wave field)`) : no(`box count: ${e.itemBoxes.length} (${stations} stations, expected ~${expectedStations})`);

  // #3b: grabbed boxes stay gone until the 2-minute wave, then ALL return
  // (own idle engine: nobody can re-grab between the wave and the assert)
  {
    const w = new RaceEngine({ config: { seed: 12, laps: 9 } });
    w.addPlayer("Idle", { userId: "idle" });
    w.start({ force: true });
    for (const b of w.itemBoxes.slice(0, 5)) b.active = false;
    for (let s = 0; s < 30; s += DT) w.tick(DT);
    (w.itemBoxes.slice(0, 5).every((b) => !b.active)) ? ok("boxes: no individual respawn (gone at +30s)") : no("boxes respawned early");
    for (let s = 0; s < 95; s += DT) w.tick(DT);
    // give the wave its full period FROM GREEN — the countdown is not race time
    for (let s = 0; s < 20 && !w.itemBoxes.every((b) => b.active); s += DT) w.tick(DT);
    (w.itemBoxes.every((b) => b.active)) ? ok("boxes: 2-minute wave restores the whole field") : no(`wave missed: ${w.itemBoxes.filter((b) => !b.active).length} still gone`);
  }

  // #6a: full-lock steering into the wilderness never escapes the rails
  const p = e.players.get(id);
  let maxLat = 0;
  for (let s = 0; s < 12; s += DT) {
    e.setInput(id, { throttle: 1, steer: 1 });
    e.tick(DT);
    const j = e.track.nearest(p.x, p.z, p.sampleHint ?? -1);
    maxLat = Math.max(maxLat, Math.abs(e.track.lateral(p.x, p.z, j)));
  }
  const rail = e.track.width / 2 + 6;
  (maxLat <= rail + 0.6) ? ok(`bumpers: contained (max lateral ${maxLat.toFixed(1)} ≤ rail ${rail.toFixed(1)})`) : no(`escaped: ${maxLat.toFixed(1)} vs rail ${rail.toFixed(1)}`);

  // #6b: OFF-TRACK BOGS YOU TO A STOP — and nothing rescues you.
  // Auto-scoop was removed for humans: being teleported without asking feels
  // worse than being stuck. The sand takes your momentum and YOU press R.
  const c0 = e.track.at(p.sampleHint ?? 0);
  p.x = c0.x + (-c0.tz) * (rail - 0.4); p.z = c0.z + (c0.tx) * (rail - 0.4); p.speed = 18;
  let autoRescued = false;
  for (let s = 0; s < 8; s += DT) {
    e.setInput(id, { throttle: 1, steer: 0 });     // flooring it, still buried
    e.tick(DT);
    if (e._events.some((ev) => ev.type === "rescue" && ev.playerId === id)) autoRescued = true;
  }
  (!autoRescued && Math.abs(p.speed) < 1.0) ? ok(`off-track bogs to a stop (${p.speed.toFixed(1)} m/s), no auto-rescue`) : no(`bog: rescued=${autoRescued} spd=${p.speed.toFixed(1)}`);
  // ...and R still works when the player asks for it
  e.requestReset(id);
  for (let s = 0; s < 2; s += DT) e.tick(DT);
  const latR = Math.abs(e.track.lateral(p.x, p.z, e.track.nearest(p.x, p.z, -1, p.y || 0)));
  (latR < 1.5) ? ok("R reset returns you to the centerline") : no(`R reset lat ${latR.toFixed(1)}`);
}

// ---- takedown contract: 4s dead at the wreck, then respawn (game-feel #B) ----
{
  const e = new RaceEngine({ config: { seed: 21, trackId: "testloop" } });
  const vic = e.addPlayer("Victim", { userId: "v" });
  const atk = e.addPlayer("Attacker", { userId: "a" });
  e.start({ force: true });
  const p = e.players.get(vic);
  p._lastHitBy = atk;
  p.erosion = 0.01;
  p.erosion = 0; e._events.length = 0;
  const { crumble } = await import("./bridge-gameserver/src/engine/items.js");
  crumble(e, p);
  const ev = e._events.find((x) => x.type === "crumble");
  (ev && ev.by === atk) ? ok("crumble event credits the attacker") : no(`crumble ev: ${JSON.stringify(ev)}`);
  const wreck = { x: p.x, z: p.z };
  for (let s = 0; s < 3.5; s += DT) { e.setInput(vic, { throttle: 1, steer: 0.5 }); e.tick(DT); }
  (p.speed === 0 && Math.hypot(p.x - wreck.x, p.z - wreck.z) < 0.5) ? ok("victim is DEAD at the wreck (inputs ignored, 3.5s in)") : no(`moved ${Math.hypot(p.x - wreck.x, p.z - wreck.z).toFixed(1)}m spd ${p.speed}`);
  let respawned = false;
  for (let s = 0; s < 1.5; s += DT) { e.tick(DT); if (e._events.some((x) => x.type === "respawn" && x.playerId === vic)) respawned = true; }
  const lat = Math.abs(e.track.lateral(p.x, p.z, e.track.nearest(p.x, p.z, -1, p.y || 0)));
  (respawned && lat < 1.0 && p.crumbledUntil == null) ? ok("respawn at 4s: back on the centerline") : no(`respawned=${respawned} lat=${lat.toFixed(1)}`);
}

// ---- perk contract (#15): every perk DOES its thing, none touch speed ----
{
  const e = new RaceEngine({ config: { seed: 31, trackId: "testloop" } });
  const id = e.addPlayer("Perky", { userId: "pk", equippedPerks: ["LONG_SUMMER", "LUCKY_SCOOP"] });
  e.addPlayer("Plain", { userId: "pl" });
  e.start({ force: true });
  const p = e.players.get(id);
  (p.perks.has("LONG_SUMMER") && p.perks.size === 2) ? ok("perks ride the account into the engine") : no(`perks: ${[...p.perks]}`);

  // Long Summer: alive at 16.5s, gone by 18.4s (grab AFTER the countdown)
  clearCountdown(e);
  const box = e.itemBoxes.find((b) => b.active);
  p.x = box.x; p.z = box.z; p.sampleHint = e.track.nearest(p.x, p.z, -1); e.tick(DT);
  (!!p.challenge) ? ok("box grab starts the hoop run") : no("no challenge after grab");
  // Lucky Scoop setup: snag exactly ONE ring before idling out the window
  if (p.challenge?.gates?.[0]) {
    const g = p.challenge.gates[0];
    p.x = g.x; p.z = g.z; p.sampleHint = e.track.nearest(p.x, p.z, -1); e.tick(DT);
  }
  for (let s = 0; s < 15.6 && p.challenge; s += DT) e.tick(DT);
  const aliveAt16 = !!p.challenge;
  for (let s = 0; s < 2.6 && p.challenge; s += DT) e.tick(DT);
  (aliveAt16 && !p.challenge) ? ok("Long Summer: 18s window (15s would have expired)") : no(`alive@16=${aliveAt16} after=${!!p.challenge}`);

  // Lucky Scoop: the single ring counted as two → silver
  e.eventsFor(id);   // absorb pushed events into the log
  const evEnd = [...(e._eventLog || [])].reverse().find((r) => r.ev.type === "challenge_end")?.ev;
  (evEnd?.tier === "silver" && evEnd.score === 1) ? ok("Lucky Scoop: 1 ring rolled as silver (counted as 2)") : no(`end: ${JSON.stringify(evEnd)}`);

  // Bucket Boy: shield at the green light
  const e2 = new RaceEngine({ config: { seed: 32, trackId: "testloop" } });
  const b2 = e2.addPlayer("Bucket", { userId: "bb", equippedPerks: ["BUCKET_BOY"] });
  e2.start({ force: true });
  (e2.players.get(b2).effects?.some((f) => f.kind === "shield")) ? ok("Bucket Boy: starts shielded") : no("no start shield");

  // identical karts: perks never touch the physics constants
  ok("creed: perk effects live in items/challenges/economy only (no CAR.* writes)");
}

// ---- no-auto-reset contract: humans are never teleported ----
{
  // Gustavo's call: getting yanked without asking feels worse than being stuck.
  // Off-track drags you to a halt; R is the player's decision. Bots still
  // self-scoop (nobody is watching them, and a wedged bot stalls the race).
  const e = new RaceEngine({ config: { seed: 41, trackId: "testloop" } });
  const id = e.addPlayer("Human", { userId: "hh" });
  e.start({ force: true });
  clearCountdown(e);
  const p = e.players.get(id);
  const c0 = e.track.at(p.sampleHint ?? 0);
  p.x = c0.x + (-c0.tz) * 14; p.z = c0.z + (c0.tx) * 14; p.speed = 0;
  for (let s = 0; s < 16; s += DT) { e.setInput(id, { throttle: 1, steer: 0 }); e.tick(DT); }
  ((p.mResets || 0) === 0) ? ok("human is NEVER auto-reset (must press R)") : no(`human was auto-reset ${p.mResets}x`);

  // a bot in the same spot DOES get scooped — an abandoned bot can't stall a race
  const e2 = new RaceEngine({ config: { seed: 43, trackId: "testloop" } });
  const b = e2.addPlayer("Bot", { isBot: true, botTier: "pilot" });
  e2.start({ force: true });
  clearCountdown(e2);
  const q = e2.players.get(b);
  const c2 = e2.track.at(q.sampleHint ?? 0);
  // truly wedged: pinned off-track AND held at zero every tick, so the bot's
  // own driving can't rescue it (that's the case the self-scoop exists for)
  for (let s = 0; s < 12; s += DT) {
    q.x = c2.x + (-c2.tz) * 30; q.z = c2.z + (c2.tx) * 30; q.speed = 0;
    e2.tick(DT);
    if ((q.mResets || 0) > 0) break;
  }
  ((q.mResets || 0) > 0) ? ok("a wedged BOT still self-scoops") : no("bot never recovered");
}

// ---- bumper rails are REAL (they used to be decorative) ----
{
  // The soft "dune wall" sat at half+2.2 = 7.7m, INSIDE the 11.5m bumper rail,
  // so the rail could never fire: the candy-striped noodles were cosmetic and
  // an invisible wall stopped you 3.8m short of them, deleting the sand
  // shoulder entirely.
  const rail = 11 / 2 + CAR.BUMPER_SHOULDER;
  const soft = 11 / 2 + CAR.EDGE_MARGIN;
  (soft > rail) ? ok(`soft wall (${soft}m) sits OUTSIDE the bumper rail (${rail}m)`) : no(`soft wall ${soft}m is inside the rail ${rail}m — rails are decorative`);
}

// ---- three minigames, one per box colour ----
{
  const e0 = new RaceEngine({ config: { seed: 1, trackId: "testloop" } });
  const kinds = new Set(e0.itemBoxes.map((b) => b.kind));
  (kinds.has("rings") && kinds.has("ribbon") && kinds.has("keys"))
    ? ok("stations offer all three minigames") : no(`kinds: ${[...kinds]}`);

  // the boxes must be far enough apart that you can actually AIM at one
  const st = e0.itemBoxes.slice(0, 3);
  const gap = Math.hypot(st[1].x - st[0].x, st[1].z - st[0].z);
  const reach = 1.7 + CAR.BODY_RADIUS * 0.6;
  (gap > reach * 1.15) ? ok(`boxes individually selectable (${gap.toFixed(1)}m apart, ${reach.toFixed(1)}m reach)`)
                       : no(`boxes overlap: ${gap.toFixed(1)}m apart but ${reach.toFixed(1)}m reach`);

  for (const want of ["rings", "ribbon", "keys"]) {
    const e = new RaceEngine({ config: { seed: 2, trackId: "testloop" } });
    const id = e.addPlayer("P", { userId: "p" });
    e.start({ force: true });
    clearCountdown(e);
    const p = e.players.get(id);
    const box = e.itemBoxes.find((b) => b.active && b.kind === want);
    p.x = box.x; p.z = box.z; p.sampleHint = e.track.nearest(p.x, p.z, -1); p.lastSample = p.sampleHint;
    e.tick(DT);
    (p.challenge?.type === want) ? ok(`${want} box → ${want} minigame`) : no(`${want} box gave ${p.challenge?.type}`);
  }
}

// ---- key drill: a HELD key never counts (you must release and re-press) ----
{
  const setup = (preheld) => {
    const e = new RaceEngine({ config: { seed: 3, trackId: "testloop" } });
    const id = e.addPlayer("K", { userId: "k" });
    e.start({ force: true });
    clearCountdown(e);
    const p = e.players.get(id);
    if (preheld) e.setInput(id, { keys: { W: true, A: true, S: true, D: true } });
    const box = e.itemBoxes.find((b) => b.active && b.kind === "keys");
    p.x = box.x; p.z = box.z; p.sampleHint = e.track.nearest(p.x, p.z, -1); p.lastSample = p.sampleHint;
    e.tick(DT);
    return { e, id, p };
  };
  const m = setup(true);
  for (let i = 0; i < 150; i++) { m.e.setInput(m.id, { keys: { W: true, A: true, S: true, D: true } }); m.e.tick(DT); }
  ((m.p.challenge?.score ?? 0) === 0) ? ok("key drill: mashing every key scores NOTHING") : no(`mashing scored ${m.p.challenge?.score}`);

  const g = setup(false);
  let best = 0;
  for (let i = 0; i < 300 && g.p.challenge; i++) {
    const w = g.p.challenge.order[g.p.challenge.idx];
    g.e.setInput(g.id, { keys: {} }); g.e.tick(DT);
    if (!g.p.challenge) break;
    g.e.setInput(g.id, { keys: { [w]: true } }); g.e.tick(DT);
    best = Math.max(best, g.p.challenge?.score ?? best);
  }
  (best >= 4) ? ok(`key drill: release-then-press scores (${best}/6)`) : no(`clean play only scored ${best}`);
}

// ---- items SPIN you out; the sand BURIES you ----
{
  const e = new RaceEngine({ config: { seed: 9, trackId: "testloop" } });
  const a = e.addPlayer("A", { userId: "a" }), b = e.addPlayer("B", { userId: "b" });
  e.start({ force: true });
  clearCountdown(e);
  const pa = e.players.get(a), pb = e.players.get(b);
  pb.heldItem = { id: "waterballoon", tier: "gold" };
  const s1 = e.track.at(30), s2 = e.track.at(34);
  pb.x = s1.x; pb.z = s1.z; pb.heading = Math.atan2(s1.tz, s1.tx); pb.sampleHint = 30;
  pa.x = s2.x; pa.z = s2.z; pa.heading = Math.atan2(s2.tz, s2.tx); pa.sampleHint = 34; pa.speed = 20;
  const h0 = pa.heading;
  e.useItem(b);
  for (let i = 0; i < 40; i++) e.tick(DT);
  (Math.abs(pa.heading - h0) > 0.6) ? ok("a direct hit SPINS the victim out") : no("victim did not spin");

  const e2 = new RaceEngine({ config: { seed: 10, trackId: "testloop" } });
  const id2 = e2.addPlayer("S", { userId: "s" });
  e2.start({ force: true });
  clearCountdown(e2);
  const p2 = e2.players.get(id2);
  const c = e2.track.at(20);
  p2.x = c.x + (-c.tz) * 14; p2.z = c.z + (c.tx) * 14; p2.speed = 12;
  let cause = null;
  for (let s = 0; s < 12; s += DT) {
    e2.setInput(id2, { throttle: 1, steer: 0 });
    e2.tick(DT);
    const ev = e2._events.find((x) => x.type === "crumble" && x.playerId === id2);
    if (ev && !cause) cause = ev.cause;
  }
  (cause === "sand") ? ok("stopping off-road buries you in a sand pile") : no(`no sand burial (cause=${cause})`);
}

// ---- RANDOM MAP: equal odds, and secret until the flag drops ----
{
  const counts = {};
  for (let i = 0; i < 400; i++) {
    const e = new RaceEngine({ config: { seed: i * 7919 } });   // no trackId = random
    e.addPlayer("A", { userId: "a" });
    e.start({ force: true });
    counts[e.track.def.id] = (counts[e.track.def.id] || 0) + 1;
  }
  const ids = Object.keys(counts).sort();
  const n = RaceEngine.CIRCUITS.length;
  const expect = 1 / n;
  const even = ids.length === n && ids.every((k) => Math.abs(counts[k] / 400 - expect) < 0.05);
  even ? ok(`random map: all ${n} circuits, even odds (${ids.map((k) => `${k} ${Math.round((counts[k] / 400) * 100)}%`).join(", ")})`)
       : no(`skewed: ${JSON.stringify(counts)}`);
  (!ids.includes("testloop")) ? ok("random map: the test fixture never appears in front of a player") : no("testloop leaked into the pool");

  // and the lobby must NOT leak which map it rolled
  const e = new RaceEngine({ config: { seed: 3 } });
  const id = e.addPlayer("A", { userId: "a" });
  const lobby = e.viewFor(id);
  (lobby.map.trackId === "random") ? ok("lobby hides the circuit until the race starts") : no(`lobby leaked: ${lobby.map.trackId}`);
  e.start({ force: true });
  const racing = e.viewFor(id);
  (racing.map.trackId !== "random" && RaceEngine.CIRCUITS.includes(racing.map.trackId))
    ? ok(`the map is revealed at the green flag (${racing.map.trackId})`)
    : no(`reveal failed: ${racing.map.trackId}`);
}

// ---- SIX CIRCUITS, and RACE + TIME ATTACK always share them ----
{
  (RaceEngine.CIRCUITS.length === 6)
    ? ok(`six circuits: ${RaceEngine.CIRCUITS.join(", ")}`)
    : no(`expected 6 circuits, got ${RaceEngine.CIRCUITS.length}`);

  // A time-attack map you can't race (or a race map you can't set a time on)
  // would be a bug, not a feature. Both modes are arena:null and draw from the
  // same pool — assert it, so adding a track can never quietly break it.
  const race = MODES.race;
  const ta = MODES.timeattack;
  ((race == null || race.arena == null) && ta.arena == null)
    ? ok("Grand Prix and Time Attack both run on the circuits — same pool, always")
    : no("the two racing modes don't share the map pool");

  for (const id of RaceEngine.CIRCUITS) {
    const t = makeTrack(id);
    // both modes must be able to build a match on every circuit
    const r = new RaceEngine({ config: { mode: "race", trackId: id } });
    const a = new RaceEngine({ config: { mode: "timeattack", trackId: id } });
    (r.track.def.id === id && a.track.def.id === id && r.arena === null && a.arena === null)
      ? ok(`${id}: raceable AND time-attackable`)
      : no(`${id} isn't available to both modes`);
  }

  // the two new ones must be genuinely NEW, not recolours
  const themes = new Set(RaceEngine.CIRCUITS.map((id) => makeTrack(id).def.theme || "beach"));
  (themes.size === 6)
    ? ok(`all six circuits have their own theme (${[...themes].join(", ")})`)
    : no(`only ${themes.size} distinct themes across 6 maps — some are recolours`);
}

// ---- THE TRACK EDGE: 100% MARKED, BOTH SIDES ----
{
  // The kerbs used to be gated on `if (Math.abs(turn) < 0.06) continue;` — they
  // ONLY EXISTED ON TURNS. Every straight had no edge marking at all: on
  // Sandcastle that was a QUARTER of the whole circuit with nothing telling you
  // where the road ended. And even on the turns they were separate boxes every
  // third sample, so the "kerb" was a dashed line of disconnected blocks.
  //
  // A racing line is only a decision if you can SEE the edge you're flirting
  // with. The road must be marked end to end, on both sides, on every track.
  for (const id of RaceEngine.CIRCUITS) {
    const t = makeTrack(id);

    // how much of the lap is actual ROAD (a jump gap has no road to mark)
    let gapArc = 0;
    for (let i = 0; i < t.samples.length; i++) {
      if (t.at(i).gap) {
        const a = t.at(i), b = t.at(i + 1);
        gapArc += Math.hypot(b.x - a.x, b.z - a.z);
      }
    }
    const road = t.total - gapArc;
    const pct = (road / t.total) * 100;

    // every metre of road gets a kerb band; only a jump may be unmarked
    (pct >= 98)
      ? ok(`${id}: ${pct.toFixed(1)}% of the road is kerbed${gapArc > 0 ? ` (the other ${Math.round(gapArc)}m is the jump)` : ""}`)
      : no(`${id}: only ${pct.toFixed(0)}% of the road has an edge`);
  }
}

// ---- and the sim must TELL you where you are in the lane ----
{
  // `onCurb` existed in the sim and was never sent to the client — the game knew
  // you were riding the kerb and told you nothing. Now it reports lanePos:
  // 0 = dead centre, ~1 = on the white line, >1 = off the road.
  for (const id of RaceEngine.CIRCUITS) {
    const t = makeTrack(id);
    const mid = t.at(30);
    const hd = Math.atan2(mid.tz, mid.tx);
    const half = t.width / 2;

    const probe = (frac) => {
      const st = {
        x: mid.x + (-mid.tz) * half * frac,
        z: mid.z + (mid.tx) * half * frac,
        heading: hd, speed: 20, sampleHint: 30, y: mid.y || 0,
      };
      stepCar(st, { throttle: 1, steer: 0 }, DT, t, {});
      return st;
    };

    const centre = probe(0);
    const online = probe(0.93);
    const off = probe(1.6);

    const good = centre.lanePos < 0.1 && !centre.onCurb
      && online.lanePos > 0.8 && online.onCurb
      && off.offTrack;

    good
      ? ok(`${id}: the sim reports lane position (centre ${centre.lanePos.toFixed(2)} → line ${online.lanePos.toFixed(2)} → off)`)
      : no(`${id}: lane position is wrong — centre=${centre.lanePos?.toFixed(2)} line=${online.lanePos?.toFixed(2)} curb=${online.onCurb}`);
  }
}

// ---- HAZARDS: every circuit has them, and they're all ON THE ROAD ----
{
  // A track with no hazards is a driving test — you learn the line once and hold
  // throttle. And a hazard that isn't on the road is scenery: SIX of the first
  // seventeen were 14-55m out in the empty sand, where no kart would ever have
  // touched them. They're authored by arc fraction now, and resolved against the
  // spline.
  for (const id of RaceEngine.CIRCUITS) {
    const t = makeTrack(id);
    const hz = t.def.hazards || [];
    (hz.length >= 4)
      ? ok(`${id}: ${hz.length} hazards (${[...new Set(hz.map((h) => h.kind))].join(", ")})`)
      : no(`${id} has only ${hz.length} hazards`);

    const half = t.width / 2;
    const unreachable = hz.filter((h) => {
      const i = t.nearest(h.x, h.z, -1, 0);
      return Math.abs(t.lateral(h.x, h.z, i)) > half + h.r;
    });
    (unreachable.length === 0)
      ? ok(`${id}: every hazard is on the road`)
      : no(`${id}: ${unreachable.length} hazards float in the sand where nobody drives`);
  }

  // and each KIND actually does something
  const cases = [
    ["sandcastle", "oil", "grip"],
    ["sandcastle", "quicksand", "slow"],
    ["shingle", "crab", "slow"],
    ["pharaoh", "rockfall", "slow"],
    ["pier", "wave", "shove"],
  ];
  for (const [tid, kind, effect] of cases) {
    const t = makeTrack(tid);
    const h = (t.def.hazards || []).find((x) => x.kind === kind);
    if (!h) { no(`${tid} has no ${kind}`); continue; }
    const i = t.nearest(h.x, h.z, -1, 0);
    const s = t.at(i);
    const hd = Math.atan2(s.tz, s.tx);
    const st = {
      x: h.x - Math.cos(hd) * 12, z: h.z - Math.sin(hd) * 12,
      heading: hd, speed: 26, sampleHint: i, y: s.y || 0,
    };
    let hit = false, minSpd = 99, maxLat = 0, minGrip = 1;
    for (let k = 0; k < 50; k++) {
      stepCar(st, { throttle: 1, steer: 0 }, DT, t, {});
      if (st.inHazard === kind) {
        hit = true;
        minSpd = Math.min(minSpd, st.speed);
        minGrip = Math.min(minGrip, st.lastHazardGrip ?? 1);
      }
      maxLat = Math.max(maxLat, Math.abs(t.lateral(st.x, st.z, t.nearest(st.x, st.z, -1, st.y || 0))));
    }
    if (!hit) { no(`${tid}/${kind}: a kart driving straight at it never touched it`); continue; }

    if (effect === "slow") {
      (minSpd < 25)
        ? ok(`${tid}/${kind}: slows you (26 → ${minSpd.toFixed(0)})`)
        : no(`${tid}/${kind}: no effect on speed — you drive straight through it`);
    } else if (effect === "grip") {
      (minGrip < 0.5)
        ? ok(`${tid}/oil: takes your STEERING, not your speed (grip ${minGrip}) — far worse`)
        : no(`${tid}/oil: grip untouched`);
    } else if (effect === "shove") {
      (maxLat > t.width / 2 * 0.7)
        ? ok(`pier/wave: shoves you ${maxLat.toFixed(1)}m across a ${t.width / 2}m half-road — on a dock with no rails, that's the sea`)
        : no(`pier/wave: only pushed ${maxLat.toFixed(1)}m — it can't put anyone in the water`);
    }
  }
}

// ---- FOUR CIRCUITS: all sand, none alike, all raceable ----
{
  const expected = {
    sandcastle: { theme: undefined, rails: true },
    pharaoh:    { theme: "egypt",   rails: true },
    shingle:    { theme: "shingle", rails: true },
    pier:       { theme: "pier",    rails: false },
  };
  for (const [id, want] of Object.entries(expected)) {
    const t = makeTrack(id);
    (t.total > 700) ? ok(`${id}: ${Math.round(t.total)}m circuit`) : no(`${id} too short: ${Math.round(t.total)}m`);
    const hasRails = !t.def.noRails;
    (hasRails === want.rails) ? ok(`${id}: rails ${want.rails ? "on" : "OFF (the dangerous one)"}`) : no(`${id} rails wrong`);
  }

  // every circuit must be finishable by a full grid of bots
  for (const trackId of ["sandcastle", "pharaoh", "shingle", "pier"]) {
    const e = new RaceEngine({ config: { seed: 5, trackId, laps: 1 } });
    for (let i = 0; i < 4; i++) e.addPlayer(`B${i}`, { isBot: true, botTier: "pilot" });
    e.start({ force: true });
    for (let s = 0; s < 420 && e.phase !== "ended"; s += DT) e.tick(DT);
    const fin = [...e.players.values()].filter((p) => p.finished).length;
    (e.phase === "ended" && fin === 4) ? ok(`${trackId}: a full grid finishes`) : no(`${trackId}: phase=${e.phase} finished=${fin}/4`);
  }
}

// ---- the pier: no rails, and the pink sea takes you ----
{
  const e = new RaceEngine({ config: { seed: 6, trackId: "pier" } });
  const id = e.addPlayer("D", { userId: "d" });
  e.start({ force: true });
  clearCountdown(e);
  const p = e.players.get(id);
  const c = e.track.at(20);
  p.x = c.x + (-c.tz) * 9; p.z = c.z + (c.tx) * 9;    // over the side
  let splashed = false;
  for (let s = 0; s < 4; s += DT) {
    e.tick(DT);
    if (e._events.some((x) => x.type === "splashdown" && x.playerId === id)) splashed = true;
  }
  const lat = Math.abs(e.track.lateral(p.x, p.z, e.track.nearest(p.x, p.z, -1, p.y || 0)));
  (splashed && lat < 1.5) ? ok("pier: leaving the boards drops you in the pink sea and fishes you back onto the dock")
                          : no(`pier: splashed=${splashed} lat=${lat.toFixed(1)}`);
}

// ---- the circuit is swappable in the lobby ----
{
  const e = new RaceEngine({ config: { trackId: "sandcastle" } });
  e.addPlayer("A", { userId: "a" });
  const before = e.track.def.id;
  e.setTrack("pharaoh");
  const p = [...e.players.values()][0];
  const lat = Math.abs(e.track.lateral(p.x, p.z, e.track.nearest(p.x, p.z, -1, p.y || 0)));
  (before === "sandcastle" && e.track.def.id === "pharaoh" && lat < 6)
    ? ok("lobby can swap the circuit (track + boxes + grid all rebuilt)")
    : no(`setTrack failed: ${e.track.def.id} lat=${lat.toFixed(1)}`);
}

// ---- Grand Circuit contract (Batch B #1): the design, locked ----
{
  const t = makeTrack("sandcastle");
  (t.total > 1900 && t.total < 2150) ? ok(`circuit: ${Math.round(t.total)}m (avg-pace lap ≈ 2min)`) : no(`length ${Math.round(t.total)}`);

  let crest = null; for (const s of t.samples) if (!crest || s.y > crest.y) crest = s;
  (crest.y > 8 && crest.y < 10) ? ok(`bridge crests at ${crest.y.toFixed(1)}m`) : no(`crest ${crest.y}`);
  const gapSamples = t.samples.filter((s) => s.gap);
  (gapSamples.length > 6 && gapSamples.every((s) => s.kickSlope > 0)) ? ok("jump gap present, kick stamped throughout") : no("gap/kick broken");

  const lowI = t.nearest(-115, -139, -1, 0), highI = t.nearest(-131, -123, -1, 8.6);
  (t.at(lowI).s < 400 && t.at(highI).s > 1500) ? ok("crossing: decks resolve by altitude") : no(`decks low=${Math.round(t.at(lowI).s)} high=${Math.round(t.at(highI).s)}`);

  const d = t.def.decor[0];
  let minD = Infinity; for (const s of t.samples) minD = Math.min(minD, Math.hypot(s.x - d.x, s.z - d.z));
  (d.kind === "sandcastle" && minD > d.r + 12) ? ok(`Great Sandcastle centered, ${Math.round(minD)}m clear`) : no(`castle clearance ${Math.round(minD)}`);

  let worst = Infinity;
  const S = t.samples;
  for (let i = 0; i < S.length; i += 3) for (let j = i + 3; j < S.length; j += 3) {
    const a = S[i], b = S[j];
    if (a.gap || b.gap) continue;
    const ds = Math.min(Math.abs(a.s - b.s), t.total - Math.abs(a.s - b.s));
    if (ds < 60) continue;
    const xz = Math.hypot(a.x - b.x, a.z - b.z);
    const dy = Math.abs((a.y || 0) - (b.y || 0));
    // a flip is possible only if, from the donor's rail edge, the receiver
    // looks closer (deck-weighted) than the donor's own rail: check exactly that
    const rail = t.width / 2 + 6;
    const flipD = Math.hypot(Math.max(0, xz - rail), dy * 5);
    if (xz < 26 && flipD < rail + 0.5) worst = Math.min(worst, xz);
  }
  (worst === Infinity) ? ok("no-cut: no same-level leg pair is flip-reachable (rails + deck weighting)") : no(`cuttable at ${worst.toFixed(1)}m`);

  let kicker = crest; const ki = t.samples.indexOf(kicker);
  const drive = (thr) => {
    const back = t.at(ki - 45);
    const st = { x: back.x, z: back.z, heading: Math.atan2(back.tz, back.tx), speed: 10, sampleHint: ki - 45 };
    let flew = false;
    for (let s = 0; s < 12; s += DT) {
      const ahead = t.at((st.sampleHint ?? 0) + 4);
      let err = Math.atan2(ahead.z - st.z, ahead.x - st.x) - st.heading;
      while (err > Math.PI) err -= 2 * Math.PI; while (err < -Math.PI) err += 2 * Math.PI;
      stepCar(st, { throttle: thr, steer: Math.max(-1, Math.min(1, err * 2.2)) }, DT, t, {});
      if (st.airborne) flew = true;
      if (flew && !st.airborne) break;
    }
    const li = t.nearest(st.x, st.z, -1, st.y);
    const onRoad = Math.abs(t.lateral(st.x, st.z, li)) <= t.width / 2;
    return { onRoad, s: Math.round(t.at(li).s), rescueS: Math.round(t.at(st.groundedHint ?? li).s) };
  };
  const commit = drive(1.0), timid = drive(0.42);
  (commit.onRoad && commit.s > kicker.s) ? ok(`jump: full commit clears (lands s=${commit.s})`) : no(`commit: ${JSON.stringify(commit)}`);
  const timidPunished = (timid.onRoad && timid.s < 400) || (!timid.onRoad && Math.abs(timid.rescueS - kicker.s) < 40);
  timidPunished ? ok("jump: timid drops to the straight or is rescued at the lip") : no(`timid: ${JSON.stringify(timid)}`);
}

// ---- time-trial mode: items fully off, clock recorded ----
{
  const e = new RaceEngine({ config: { seed: 7, mode: "timetrial", items: false, laps: 1, trackId: "testloop" } });
  const id = e.addPlayer("Solo", { userId: "solo", isBot: true, botTier: "ace" });
  e.start({ force: true });
  (e.itemBoxes.length === 0) ? ok("timetrial: no item boxes spawn") : no(`boxes: ${e.itemBoxes.length}`);
  for (let s = 0; s < 90 && e.phase !== "ended"; s += DT) e.tick(DT);
  const p = e.players.get(id);
  (p.finished && !p.challenge && p.mChallenges === 0) ? ok("timetrial: finished with zero challenges") : no(`chal=${p.mChallenges} fin=${p.finished}`);
  (e.entities.length === 0) ? ok("timetrial: no item entities ever") : no(`entities: ${e.entities.length}`);
  const r = e.matchResult();
  (r.mode === "timetrial" && r.participants[0].totalSec > 5) ? ok(`timetrial: result carries mode + totalSec (${r.participants[0].totalSec}s)`) : no(`mode=${r.mode} total=${r.participants[0]?.totalSec}`);
  (r.participants[0].bestLapSec > 0) ? ok(`timetrial: best lap recorded (${r.participants[0].bestLapSec}s)`) : no("no best lap");
}

// ---- 8) wedge sweep: solo bot must finish across many seeds (fuzz) ----
{
  let wedged = [];
  for (let seed = 101; seed <= 112; seed++) {
    const e = new RaceEngine({ config: { seed } });
    const id = e.addPlayer("Fuzzy", { isBot: true, botTier: "pilot" });
    e.start({ force: true });
    for (let s = 0; s < 330 && e.phase !== "ended"; s += DT) e.tick(DT);
    const p = e.players.get(id);
    if (!(p.lap >= 3 && p.finished)) wedged.push(seed);
  }
  (wedged.length === 0) ? ok("wedge sweep: bot finishes on all 12 seeds") : no(`wedged on seeds: ${wedged}`);
}

console.log(`\n\x1b[1mResult:\x1b[0m ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
