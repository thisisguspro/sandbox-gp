#!/usr/bin/env node
/* SANDBOX GP — engine fast-forward test (no sockets, no real time).
 * Runs the authoritative RaceEngine directly at dt=0.05 and asserts the whole
 * physical race works: acceleration, steering, sand drag, checkpoints, laps,
 * bot driving, finishing, placements, reset scoop.
 */
import { RaceEngine } from "./bridge-gameserver/src/engine/RaceEngine.js";
import { CAR, stepCar } from "./bridge-gameserver/src/engine/shared/carSim.js";

let pass = 0, fail = 0;
const ok = (m) => { console.log(`  \x1b[32m✓\x1b[0m ${m}`); pass++; };
const no = (m) => { console.log(`  \x1b[31m✗\x1b[0m ${m}`); fail++; };
const DT = 0.05;
const run = (e, sec) => { for (let i = 0; i < sec / DT; i++) e.tick(DT); };

console.log("\n\x1b[1mSANDBOX GP engine fast-forward test\x1b[0m");

// ---- 1) straight-line physics: throttle reaches max speed, brake stops ----
{
  const e = new RaceEngine({ config: {} });
  const id = e.addPlayer("Human", { userId: "u1" });
  e.start({ force: true });
  run(e, 3.2); // freeze
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
  const e = new RaceEngine({ config: {} });
  const id = e.addPlayer("Human", { userId: "u1" });
  e.start({ force: true });
  run(e, 3.2);
  const p = e.players.get(id);
  const h0 = p.heading;
  e.setInput(id, { throttle: 1, steer: 1 });
  run(e, 2);
  (Math.abs(p.heading - h0) > 0.5) ? ok("steering turns the car") : no("heading barely changed");
  // hold full lock for a long time — soft wall must contain us near the ribbon
  run(e, 10);
  const i = e.track.nearest(p.x, p.z, p.sampleHint);
  const lat = Math.abs(e.track.lateral(p.x, p.z, i));
  (lat <= e.track.width / 2 + CAR.EDGE_MARGIN + 0.3) ? ok(`soft wall contains car (lat ${lat.toFixed(1)}m)`) : no(`escaped to lat ${lat.toFixed(1)}m`);
  (p.offTrack) ? ok("doughnutting off the ribbon flags offTrack (sand)") : no("offTrack never flagged");
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
  const e = new RaceEngine({ config: {} });
  const id = e.addPlayer("Human", { userId: "u1" });
  e.start({ force: true });
  run(e, 3.2);
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
  const e = new RaceEngine({ config: {} });
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
  const e = new RaceEngine({ config: {} });
  for (let i = 0; i < 4; i++) e.addPlayer(`Bot${i}`, { isBot: true, botTier: "pilot" });
  e.start({ force: true });
  for (let sec = 0; sec < 300 && e.phase !== "ended"; sec += DT) e.tick(DT);
  const ps = [...e.players.values()];
  (e.phase === "ended") ? ok("4-bot race resolves") : no(`race never ended`);
  const places = ps.map((p) => p.place).sort();
  (JSON.stringify(places) === "[1,2,3,4]") ? ok(`placements 1-4 unique (${ps.map(p=>`${p.place}:${p.name}`).join(", ")})`) : no(`bad places ${places}`);
  const r = e.matchResult();
  (r.winner && r.map.id === "sandcastle") ? ok("matchResult carries winner + track") : no("matchResult malformed");
}

// ---- 6) anti-shortcut: skipping checkpoints must NOT count a lap ----
{
  const e = new RaceEngine({ config: {} });
  const id = e.addPlayer("Cheater", { userId: "u1" });
  e.start({ force: true });
  run(e, 3.2);
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
  run(e, 3.2);
  const p = e.players.get(id);
  (e.itemBoxes.length >= 3 && e.itemBoxes.every((b) => b.active)) ? ok(`${e.itemBoxes.length} item boxes laid out, all active`) : no("boxes missing");

  const grab = () => {
    const box = e.itemBoxes.find((b) => b.active);
    p.x = box.x; p.z = box.z; p.sampleHint = e.track.nearest(p.x, p.z, -1); p.lastSample = p.sampleHint;
    e.tick(DT);
    return box;
  };

  let sawRings = false, sawRibbon = false, guard = 0;
  while ((!sawRings || !sawRibbon) && guard++ < 8) {
    const box = grab();
    if (!p.challenge) { no(`box grab #${guard} started nothing`); break; }
    (box.active === false) ? null : no("box did not deactivate");
    if (p.challenge.type === "rings" && !sawRings) {
      sawRings = true;
      // drive THROUGH every gate by teleporting to each in order
      for (const g of p.challenge.gates.slice()) { p.x = g.x; p.z = g.z; p.sampleHint = e.track.nearest(p.x, p.z, -1); e.tick(DT); }
      (p.challenge === null && p.heldItem?.tier === "s") ? ok("rings: all 5 gates → S-tier item") : no(`rings gave ${JSON.stringify(p.heldItem)}`);
    } else if (p.challenge.type === "ribbon" && !sawRibbon) {
      sawRibbon = true;
      // hold the exact centerline for the whole duration
      for (let s = 0; s < 8.2; s += DT) {
        const pose = e.track.centerPose(p.sampleHint + 2);
        p.x = pose.x; p.z = pose.z; p.sampleHint = e.track.nearest(p.x, p.z, p.sampleHint);
        e.tick(DT);
        if (!p.challenge) break;
      }
      (p.challenge === null && (p.heldItem?.tier === "s" || p.heldItem?.tier === "gold")) ? ok(`ribbon: perfect hold → ${p.heldItem.tier}-tier item`) : no(`ribbon gave ${JSON.stringify(p.heldItem)}`);
    } else {
      // duplicate type — finish it cheaply (rings: skip past; ribbon: wait out)
      if (p.challenge.type === "rings") for (const g of p.challenge.gates.slice()) { p.x = g.x; p.z = g.z; p.sampleHint = e.track.nearest(p.x, p.z, -1); e.tick(DT); }
      else for (let s = 0; s < 8.2 && p.challenge; s += DT) e.tick(DT);
    }
    // consume + let boxes respawn so the next grab works
    if (p.heldItem) e.useItem(id);
    (p.heldItem === null) ? null : no("useItem did not clear the slot");
    run(e, 8.2);
  }
  (sawRings && sawRibbon) ? ok("both challenge types generated from boxes") : no(`types seen: rings=${sawRings} ribbon=${sawRibbon}`);
  (e.itemBoxes.some((b) => b.active)) ? ok("boxes respawn after their cooldown") : no("no box ever respawned");
  const evs = e.eventsFor(id);
  (p.mChallenges >= 2) ? ok(`challenge stats tracked (${p.mChallenges} completed)`) : no("mChallenges not tracked");
}

// ---- 8) rings partial credit + one-thing-at-a-time rule ----
{
  const e = new RaceEngine({ config: { seed: 7 } });
  const id = e.addPlayer("Human", { userId: "u1" });
  e.start({ force: true });
  run(e, 3.2);
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
  for (let s = 0; s < 60; s += DT) e.tick(DT);
  const held = [...e.players.values()].filter((p) => p.heldItem || p.mChallenges === 0 && p.heldItem !== undefined);
  const got = [...e.players.values()].some((p) => p.heldItem);
  (got) ? ok("bots pick up boxes and hold tiered items") : no("no bot ever held an item");
}

// ---- time-trial mode: items fully off, clock recorded ----
{
  const e = new RaceEngine({ config: { seed: 7, mode: "timetrial", items: false, laps: 1 } });
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
    for (let s = 0; s < 240 && e.phase !== "ended"; s += DT) e.tick(DT);
    const p = e.players.get(id);
    if (!(p.lap >= 3 && p.finished)) wedged.push(seed);
  }
  (wedged.length === 0) ? ok("wedge sweep: bot finishes on all 12 seeds") : no(`wedged on seeds: ${wedged}`);
}

console.log(`\n\x1b[1mResult:\x1b[0m ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
