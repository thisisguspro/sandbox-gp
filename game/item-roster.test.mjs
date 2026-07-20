// SANDBOX GP — THE ITEM ROSTER: 23 items, four exclusive to each tier.
//
// The bug this file exists to prevent: an item that cannot hit anything. The
// projectile hit test used to require y < 2.0, so ANY lobbed shot (a Water Bomb
// peaks around y=2.6) sailed clean over a dead-centre target and buried itself
// in the sand behind them. That silently affected the original Water Balloon
// too. A weapon that can't connect is not a weapon, and no unit test that only
// asks "does the entity spawn" would ever have caught it.
import { RaceEngine } from "./bridge-gameserver/src/engine/RaceEngine.js";
import { ITEMS, TIER_LOOT, TIER_MULT, rollItemTiered } from "./bridge-gameserver/src/engine/items.js";

const DT = 1 / 30;
let pass = 0, fail = 0;
const ok = (m) => { console.log(`  \x1b[32m✓\x1b[0m ${m}`); pass++; };
const no = (m) => { console.log(`  \x1b[31m✗\x1b[0m ${m}`); fail++; };

const clearCountdown = (e) => {
  for (let s = 0; s < 30 && (e.startFreezeUntil - e.now) > 0; s += DT) e.tick(DT);
  e.tick(DT);
};

// Traps are dropped BEHIND you — a victim parked ahead can never touch one.
const TRAPS = new Set(["sprinkler", "puddle", "geyser", "icepop"]);

// A duel: attacker fires, victim is either ahead (projectiles) or behind and
// driving forward over the trap.
function duel(itemId, tier) {
  const e = new RaceEngine({ config: { seed: 4, trackId: "sandcastle" } });
  const a = e.addPlayer("A", { userId: "a" });
  const b = e.addPlayer("B", { userId: "b" });
  e.start({ force: true });
  clearCountdown(e);
  const pa = e.players.get(a), pb = e.players.get(b);
  const trap = TRAPS.has(itemId);

  const s1 = e.track.at(40);
  pa.x = s1.x; pa.z = s1.z; pa.heading = Math.atan2(s1.tz, s1.tx);
  pa.sampleHint = 40; pa.speed = 20; pa.progress = 100;

  const sb = e.track.at(trap ? 32 : 44);
  pb.x = sb.x; pb.z = sb.z; pb.heading = Math.atan2(sb.tz, sb.tx);
  pb.sampleHint = trap ? 32 : 44; pb.speed = trap ? 20 : 0; pb.progress = trap ? 60 : 180;

  pa.heldItem = { id: itemId, tier };
  e.useItem(a);

  let landed = false, launched = false;
  for (let i = 0; i < 260; i++) {
    if (trap) e.setInput(b, { throttle: 1, steer: 0 });
    e.tick(DT);
    if (e._events.some((x) => ["splash", "crumble", "geyser_blow"].includes(x.type))) landed = true;
    if ((pb.effects || []).some((f) => ["slick", "soaked", "kited", "blinded"].includes(f.kind))) landed = true;
    if ((pb.vy || 0) > 3) launched = true;
  }
  return { landed: landed || launched, launched, attacker: pa, victim: pb, engine: e };
}

// ---- the roster ----
{
  const total = Object.keys(ITEMS).length;
  (total === 23) ? ok(`23 items: 7 staples + 4 exclusives per tier`) : no(`roster is ${total}, expected 23`);

  for (const tier of ["bronze", "silver", "gold", "s"]) {
    const excl = Object.entries(ITEMS).filter(([, v]) => v.tierOnly === tier).map(([k]) => k);
    (excl.length === 4)
      ? ok(`${tier}: 4 exclusives (${excl.join(", ")})`)
      : no(`${tier} has ${excl.length} exclusives`);

    // an exclusive must appear in its OWN tier's table and NOWHERE else
    const leaks = [];
    for (const id of excl) {
      if (!TIER_LOOT[tier][id]) leaks.push(`${id} missing from ${tier}`);
      for (const other of ["bronze", "silver", "gold", "s"]) {
        if (other !== tier && TIER_LOOT[other][id]) leaks.push(`${id} LEAKED into ${other}`);
      }
    }
    (leaks.length === 0)
      ? ok(`${tier}: exclusives are exclusive`)
      : no(leaks.join("; "));
  }

  // a bronze run must NEVER be able to produce an S-tier ultimate
  const ults = ["tsunami", "krakenwave", "meteorsplash", "hypernova"];
  let rolledUlt = false;
  const rng = (() => { let s = 1; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
  for (let i = 0; i < 4000; i++) {
    if (ults.includes(rollItemTiered(rng, "bronze"))) rolledUlt = true;
  }
  (!rolledUlt)
    ? ok("4000 bronze rolls never produced an ultimate")
    : no("a bronze run rolled an S-tier ultimate");
}

// ---- EVERY offensive item must actually connect ----
{
  const broken = [];
  for (const [id, def] of Object.entries(ITEMS)) {
    if (!def.erode) continue;
    const r = duel(id, def.tierOnly || "gold");
    if (!r.landed) broken.push(id);
  }
  (broken.length === 0)
    ? ok(`all ${Object.values(ITEMS).filter((i) => i.erode).length} offensive items connect with their target`)
    : no(`items that can never hit anything: ${broken.join(", ")}`);
}

// ---- the specific regression: a LOBBED shot must not fly over its target ----
{
  // Water Bomb, Hydro Bomb, Sand Clod and Meteor all arc. Every one of them was
  // passing straight through a dead-centre hit because of the y < 2.0 ceiling.
  const lobbed = ["waterbomb", "hydrobomb", "sandclod", "meteorsplash"];
  const missed = lobbed.filter((id) => !duel(id, ITEMS[id].tierOnly).landed);
  (missed.length === 0)
    ? ok("lobbed shells hit the kart they're aimed at (they used to sail over it)")
    : no(`lobbed shells still passing through targets: ${missed.join(", ")}`);
}

// ---- the buffs must buff ----
{
  for (const id of ["fizzpop", "rocketfloat", "hypernova", "bucket", "juicebox", "icepop"]) {
    const e = new RaceEngine({ config: { seed: 7, trackId: "sandcastle" } });
    const a = e.addPlayer("A", { userId: "a" });
    e.addPlayer("B", { userId: "b" });
    e.start({ force: true });
    clearCountdown(e);
    const p = e.players.get(a);
    p.heldItem = { id, tier: ITEMS[id].tierOnly || "gold" };
    const before = (p.effects || []).length;
    const entsBefore = e.entities.length;
    e.useItem(a);
    const gained = (p.effects || []).length - before;
    const spawned = e.entities.length - entsBefore;
    (gained > 0 || spawned > 0)
      ? ok(`${id}: does something (${gained} effects, ${spawned} entities)`)
      : no(`${id}: fires and NOTHING happens`);
  }
}

// ---- the ultimates announce themselves ----
{
  for (const id of ["tsunami", "krakenwave", "meteorsplash", "hypernova"]) {
    const e = new RaceEngine({ config: { seed: 8, trackId: "sandcastle" } });
    const a = e.addPlayer("A", { userId: "a" });
    const b = e.addPlayer("B", { userId: "b" });
    e.start({ force: true });
    clearCountdown(e);
    const pa = e.players.get(a), pb = e.players.get(b);
    const s1 = e.track.at(40), s2 = e.track.at(50);
    pa.x = s1.x; pa.z = s1.z; pa.sampleHint = 40; pa.progress = 100;
    pb.x = s2.x; pb.z = s2.z; pb.sampleHint = 50; pb.progress = 300;
    pa.heldItem = { id, tier: "s" };
    e.useItem(a);
    const ult = e._events.find((x) => x.type === "ultimate" && x.itemId === id);
    ult ? ok(`${id}: fires an "ultimate" event (the client's cue for the name-card)`)
        : no(`${id}: no ultimate event — the anime beat never plays`);
  }
}

// ---- HYPERNOVA shrugs off everything ----
{
  const { computeMods } = await import("./bridge-gameserver/src/engine/items.js");
  const p = { effects: [
    { kind: "soaked", until: 99 },
    { kind: "slick", until: 99 },
    { kind: "spin", until: 99, rate: 8 },
    { kind: "hypernova", until: 99 },
  ] };
  const m = computeMods(p, 0);
  (m.speedMult >= 1.8 && m.gripMult === 1 && !m.spin)
    ? ok("HYPERNOVA ignores soaked, slick and spin — nothing sticks while it burns")
    : no(`hypernova didn't cleanse: ${JSON.stringify(m)}`);
}

// ---- erosion is visible on EVERY kart, not just your own ----
{
  const e = new RaceEngine({ config: { seed: 9, trackId: "sandcastle" } });
  const a = e.addPlayer("A", { userId: "a" });
  const b = e.addPlayer("B", { userId: "b" });
  e.start({ force: true });
  clearCountdown(e);
  e.players.get(b).erosion = 1.7;
  const view = e.viewFor(a);
  const them = view.players.find((p) => p.id === b);
  (them && them.erosion === 1.7)
    ? ok("a rival's erosion is in the view — you can watch them fall apart")
    : no(`erosion not visible on other karts: ${JSON.stringify(them?.erosion)}`);
}

console.log(`\n\x1b[1mResult:\x1b[0m ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
