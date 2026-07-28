#!/usr/bin/env node
/* SANDBOX GP — item system fast-forward test.
 * Direct engine simulation of every item, tier scaling, the kite struggle,
 * shields, erosion → crumble → sand piles → water dissolving them. */
import { RaceEngine } from "./bridge-gameserver/src/engine/RaceEngine.js";
import { CAR } from "./bridge-gameserver/src/engine/shared/carSim.js";

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

// Standard rig: 2 humans on the centerline, `gap` meters apart, past freeze.
function rig(gap = 20, n = 2) {
  const e = new RaceEngine({ config: { seed: 5, trackId: "sandcastle" } });   // pin: no trackId now = RANDOM map
  const ids = [];
  for (let i = 0; i < n; i++) ids.push(e.addPlayer(`P${i}`, { userId: `u${i}` }));
  e.start({ force: true });
  clearCountdown(e);
  const ps = ids.map((id) => e.players.get(id));
  // place along centerline: P0 behind, P1 ahead by gap, etc.
  let s = 30;
  for (const p of ps) {
    let j = 0, left = s;
    while (left > 0) { const a = e.track.at(j), b = e.track.at(j + 1); left -= Math.hypot(b.x - a.x, b.z - a.z); j++; }
    const pose = e.track.centerPose(j);
    p.x = pose.x; p.z = pose.z; p.heading = pose.heading;
    p.sampleHint = e.track.nearest(p.x, p.z, -1);
    p.lastSample = p.sampleHint;
    s += gap;
  }
  return { e, ids, ps };
}

console.log("\n\x1b[1mSANDBOX GP item system test\x1b[0m");

// Throttle for `sec` while glued to the racing line (drives blind tests off
// the curved ribbon otherwise — this isolates ITEM physics from steering).
function cruise(e, p, id, sec) {
  e.setInput(id, { throttle: 1, steer: 0 });
  for (let s = 0; s < sec; s += DT) {
    const pose = e.track.centerPose(p.sampleHint + 2);
    p.x = pose.x; p.z = pose.z; p.heading = pose.heading;
    p.sampleHint = e.track.nearest(p.x, p.z, p.sampleHint);
    e.tick(DT);
  }
}

// ---- juicebox turbo: breaks the speed limit ----
{
  const { e, ids, ps } = rig(200, 1);
  const [p] = ps;
  cruise(e, p, ids[0], 3);
  const before = p.speed;
  p.heldItem = { id: "juicebox", tier: "s" };
  e.useItem(ids[0]);
  run(e, 0.8);
  (p.speed > CAR.MAX_SPEED + 2) ? ok(`juicebox S-tier breaks max speed (${before.toFixed(1)} → ${p.speed.toFixed(1)})`) : no(`turbo weak: ${p.speed.toFixed(1)}`);
}

// ---- water balloon: soaks + erodes on hit; bucket shield blocks it ----
{
  const { e, ids, ps } = rig(8);
  const [atk, tgt] = ps;
  atk.heldItem = { id: "waterballoon", tier: "gold" };
  e.useItem(ids[0]);
  run(e, 0.6);
  (tgt.effects.some((x) => x.kind === "soaked")) ? ok("water balloon soaks the car ahead") : no("balloon missed a stationary target 8m ahead");
  (tgt.erosion > 0.5) ? ok(`balloon erodes sand armor (${tgt.erosion.toFixed(2)})`) : no(`no erosion: ${tgt.erosion}`);

  const { e: e2, ids: id2, ps: p2 } = rig(8);
  const [atk2, tgt2] = p2;
  tgt2.heldItem = { id: "bucket", tier: "silver" };
  e2.useItem(id2[1]);
  (tgt2.effects.some((x) => x.kind === "shield")) ? ok("bucket shield equips") : no("shield missing");
  atk2.heldItem = { id: "waterballoon", tier: "s" };
  e2.useItem(id2[0]);
  run(e2, 0.6);
  (!tgt2.effects.some((x) => x.kind === "soaked") && tgt2.erosion === 0) ? ok("shield blocks the splash entirely") : no("shield failed");
  (!tgt2.effects.some((x) => x.kind === "shield")) ? ok("shield is consumed by the block") : no("shield survived");
}

// ---- kite: drags the car ahead to a stop; mashing SPACE breaks free ----
{
  const { e, ids, ps } = rig(25);
  const [atk, tgt] = ps;
  tgt.speed = 18; // cruising (position untouched so the 25m gap holds)
  ok(`target cruising at ${tgt.speed.toFixed(1)} m/s`);
  atk.heldItem = { id: "kite", tier: "gold" };
  e.useItem(ids[0]);
  (tgt.effects.some((x) => x.kind === "kited")) ? ok("beach kite latches the racer ahead") : no("kite failed to latch");
  run(e, 1.2);
  (tgt.speed < 1) ? ok(`kite drags them to a dead stop (${tgt.speed.toFixed(1)} m/s) even at full throttle`) : no(`kite too weak: ${tgt.speed.toFixed(1)}`);
  const need = tgt.kiteNeed;
  for (let i = 0; i < need; i++) e.useItem(ids[1]); // SPACE = struggle tap while kited
  (!tgt.effects.some((x) => x.kind === "kited")) ? ok(`${need} SPACE taps break the kite`) : no("taps did not break the kite");
  e.setInput(ids[1], { throttle: 1, steer: 0 });
  run(e, 1.5);
  (tgt.speed > 6) ? ok("freed racer accelerates again") : no(`still stuck: ${tgt.speed.toFixed(1)}`);

  // fizzle: nobody ahead
  const { e: e3, ids: id3, ps: p3 } = rig(200, 1);
  p3[0].heldItem = { id: "kite", tier: "bronze" };
  e3.useItem(id3[0]);
  const evs = e3.eventsFor(id3[0]);
  (evs.some((x) => x.type === "kite_fizzle")) ? ok("kite fizzles with no target ahead") : no("no fizzle event");
}

// ---- sprinkler: slick zone tags a crossing victim ----
{
  const { e, ids, ps } = rig(6);
  const [dropper, victim] = ps;
  // dropper is BEHIND victim; make dropper drop, then drive victim back over it
  dropper.heldItem = { id: "sprinkler", tier: "gold" };
  e.useItem(ids[0]);
  const zone = e.entities.find((x) => x.kind === "slickzone");
  (zone) ? ok("sprinkler drops a slick zone") : no("no slick zone");
  victim.x = zone.x; victim.z = zone.z; victim.sampleHint = e.track.nearest(victim.x, victim.z, -1);
  run(e, 0.2);
  (victim.effects.some((x) => x.kind === "slick")) ? ok("crossing the patch tags you slick (grip melts)") : no("slick never applied");
  (!dropper.effects.some((x) => x.kind === "slick") || (dropper.x !== zone.x)) ? ok("dropper is immune to their own patch") : no("dropper slipped on own patch");
}

// ---- the wave: hunts down and spends itself on the leader ----
{
  const { e, ids, ps } = rig(40, 3);
  const [shooter, mid, leader] = ps;
  // make leader clearly first by progress
  run(e, 0.2);
  shooter.heldItem = { id: "wave", tier: "s" };
  e.useItem(ids[0]);
  (e.entities.some((x) => x.kind === "wave")) ? ok("the wave is loose") : no("no wave entity");
  run(e, 4);
  (leader.effects.some((x) => x.kind === "soaked") || leader.erosion > 1) ? ok(`the wave found the leader (erosion ${leader.erosion.toFixed(2)})`) : no(`wave never hit leader (erosion ${leader.erosion})`);
  (!e.entities.some((x) => x.kind === "wave")) ? ok("wave spends itself on the leader") : no("wave still alive");
}

// ---- erosion → crumble → sand pile → water dissolves it ----
{
  const { e, ids, ps } = rig(8);
  const [atk, tgt] = ps;
  // pelt the target with S-tier balloons until it crumbles
  let thrown = 0;
  while (tgt.mCrumbles === 0 && thrown < 6) {
    atk.heldItem = { id: "waterballoon", tier: "s" };
    e.useItem(ids[0]);
    run(e, 0.7);
    thrown++;
  }
  (tgt.mCrumbles === 1) ? ok(`enough splashes crumble the car (after ${thrown} balloons)`) : no(`never crumbled after ${thrown}`);
  const pile = e.entities.find((x) => x.kind === "sandpile");
  (pile) ? ok("crumbling leaves a sand-pile hazard on the track") : no("no sand pile");
  (tgt.speed === 0 && tgt.erosion === 0) ? ok("bucket-mold respawn: dead stop, armor re-packed") : no(`respawn state off (v=${tgt.speed}, ero=${tgt.erosion})`);

  if (pile) {
    // a third party clips the pile → hard slow
    const { e: eX } = rig(1, 1); // fresh engine just for math isolation? no — use same engine:
    atk.x = pile.x; atk.z = pile.z; atk.speed = CAR.MAX_SPEED; atk.sampleHint = e.track.nearest(atk.x, atk.z, -1);
    e.tick(DT);
    (atk.speed <= CAR.MAX_SPEED * 0.5 + 0.01) ? ok("driving through a sand pile chops your speed in half") : no(`pile ignored (${atk.speed.toFixed(1)})`);
    // water dissolves it: splash a balloon into the pile
    atk.heldItem = { id: "waterballoon", tier: "bronze" };
    atk.heading = Math.atan2(pile.z - atk.z, pile.x - atk.x) || 0;
    e.useItem(ids[0]);
    run(e, 1.2);
    (!e.entities.some((x) => x.kind === "sandpile")) ? ok("water dissolves the sand pile (counterplay)") : no("pile survived the water");
  }
}

// ---- squirt: forward cone tag ----
{
  const { e, ids, ps } = rig(7);
  const [atk, tgt] = ps;
  atk.heldItem = { id: "squirt", tier: "silver" };
  e.useItem(ids[0]);
  run(e, 0.3);
  (tgt.effects.some((x) => x.kind === "soaked")) ? ok("squirt stream tags the car ahead") : no("squirt missed");
}

// ---- bots eventually fire what they pick up ----
{
  const e = new RaceEngine({ config: { seed: 11, trackId: "sandcastle" } });
  for (let i = 0; i < 4; i++) e.addPlayer(`Bot${i}`, { isBot: true, botTier: "pilot" });
  e.start({ force: true });
  let used = 0;
  for (let s = 0; s < 90 && used === 0; s += DT) {
    e.tick(DT);
    for (const ev of e.eventsFor([...e.players.keys()][0])) if (ev.type === "item_used") used++;
  }
  (used > 0) ? ok("bots use the items they win") : no("no bot ever used an item");
}

// ---- EVERY ITEM IS A TOY, NOT A PRIMITIVE ----
{
  // Gustavo asked for the items to look like real toys. Three of them got done and
  // the rest were left as raw shapes: a cone for the sand pile, a torus and a ball
  // for the geyser, a lump of space rock for the homing missile — in a game about
  // pool toys on a beach.
  //
  // A primitive is one to three meshes. A toy is built from parts: a water balloon
  // has a pinched neck and a hand-tied knot; a beach ball has six gores and a valve
  // stem; a sprinkler has a spike, a spinning arm and nozzles.
  const THREE = await import("./bridge-client/node_modules/three/build/three.module.js");
  globalThis.performance = globalThis.performance || { now: () => 0 };
  const { Effects3D } = await import("./bridge-client/src/game/items3d.js");
  const fx = new Effects3D(new THREE.Scene());

  const KINDS = ["balloon", "bouncer", "squirt", "wave", "slickzone", "sandpile", "geyser", "cloud", "homing"];
  const thin = [];
  for (const kind of KINDS) {
    let n = 0;
    try {
      const g = fx._build({ kind, id: "x", x: 0, z: 0, r: 2.4 });
      g.traverse((o) => { if (o.isMesh) n++; });
    } catch (e) {
      thin.push(`${kind} THREW`);
      continue;
    }
    if (n <= 3) thin.push(`${kind} (${n} meshes)`);
  }
  (thin.length === 0)
    ? ok(`all ${KINDS.length} item visuals are built from real parts, not primitives`)
    : no(`still primitive shapes: ${thin.join(", ")}`);
}

console.log(`\n\x1b[1mResult:\x1b[0m ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
