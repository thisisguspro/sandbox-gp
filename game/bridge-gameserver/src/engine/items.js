// ============================================================
// SANDBOX GP — the item pool (Batch 5) + sand identity (Batch 6).
//
// Everything is water vs sand. Weapons are WATER (kid-friendly, funny first):
//   waterballoon — lobbed forward, splashes on a car or the ground
//   squirt       — a short forward jet; tagging a car soaks it
//   sprinkler    — drops a slick wet patch behind you (the oil slick)
//   wave         — THE equalizer: a rolling wave that hunts the race leader
//   kite         — the signature: latches the car ahead and DRAGS IT TO A STOP
//                  until its driver mashes release (SPACE)
//   bucket       — pops a bucket over you: blocks the next hit (timed)
//   juicebox     — slurp! straight-line turbo
//
// And the sand truth (Batch 6): cars are secretly sand. Getting hit ERODES
// you. Erode past the limit and you CRUMBLE — a sand-splosion that leaves a
// sand-pile hazard on the ribbon (~15s) while a bucket re-molds you on the
// centerline. Water dissolves sand piles (counterplay!).
//
// Tier scales POWER, never which item you get. All effects are transient race
// state — the identical-cars rule stays intact.
// ============================================================
import { CAR } from "./shared/carSim.js";

export const TIER_MULT = { bronze: 0.75, silver: 1.0, gold: 1.3, s: 1.7 };

// The pool. Weights are flat-ish with the funny ones slightly favored.
export const ITEMS = {
  // ---- the seven staples: available at every tier, scaled by TIER_MULT ----
  waterballoon: { weight: 18, label: "Water Balloon",    erode: 0.8 },
  squirt:       { weight: 14, label: "Squirt Stream",    erode: 0.5 },
  sprinkler:    { weight: 14, label: "Sprinkler Patch",  erode: 0.5 },
  wave:         { weight: 8,  label: "The Wave",         erode: 0.9 },
  kite:         { weight: 12, label: "Beach Kite" },
  bucket:       { weight: 16, label: "Bucket Shield" },
  juicebox:     { weight: 18, label: "Juice-Box Turbo" },

  // ---- BRONZE EXCLUSIVES — scrappy, cheap, close-range ----
  waterbomb:    { weight: 0, label: "Water Bomb",        erode: 0.6, tierOnly: "bronze" },
  puddle:       { weight: 0, label: "Puddle Splat",      erode: 0.4, tierOnly: "bronze" },
  fizzpop:      { weight: 0, label: "Fizz Pop",                      tierOnly: "bronze" },
  sandclod:     { weight: 0, label: "Sand Clod",         erode: 0.5, tierOnly: "bronze" },

  // ---- SILVER EXCLUSIVES — reliable, honest tools ----
  waterballoon3:{ weight: 0, label: "Balloon Cluster",   erode: 0.7, tierOnly: "silver" },
  supersoak:    { weight: 0, label: "Super Soaker",      erode: 0.9, tierOnly: "silver" },
  icepop:       { weight: 0, label: "Ice Pop",                       tierOnly: "silver" },
  beachball:    { weight: 0, label: "Bouncing Beachball", erode: 0.8, tierOnly: "silver" },

  // ---- GOLD EXCLUSIVES — genuinely nasty ----
  hydrobomb:    { weight: 0, label: "Hydro Bomb",        erode: 1.5, tierOnly: "gold" },
  geyser:       { weight: 0, label: "Geyser Trap",       erode: 1.4, tierOnly: "gold" },
  monsoon:      { weight: 0, label: "Monsoon Cloud",     erode: 1.2, tierOnly: "gold" },
  rocketfloat:  { weight: 0, label: "Rocket Floaty",                 tierOnly: "gold" },

  // ---- S-TIER EXCLUSIVES — the screen-clearing stuff ----
  tsunami:      { weight: 0, label: "TSUNAMI",           erode: 3.0, tierOnly: "s" },
  krakenwave:   { weight: 0, label: "KRAKEN'S GRASP",    erode: 2.2, tierOnly: "s" },
  meteorsplash: { weight: 0, label: "METEOR SPLASH",     erode: 3.0, tierOnly: "s" },
  hypernova:    { weight: 0, label: "HYPERNOVA TURBO",                tierOnly: "s" },
};

// ---- TIERED LOOT (goal #4): same seven items at every tier — what changes
// is the ODDS. Bronze runs are kite-heavy (the dud that slows YOU); an S-run
// is a jackpot table. Ring skill converts directly into loot quality.
export const TIER_LOOT = {
  // Each tier keeps the staples AND has four exclusives of its own. A bronze run
  // can never produce a TSUNAMI, and an S-run should rarely hand you a Sand Clod
  // — the tier you earn is the tier you fight with.
  bronze: {
    kite: 34, sprinkler: 12, squirt: 10, bucket: 8, waterballoon: 8, juicebox: 5, wave: 2,
    waterbomb: 8, puddle: 7, fizzpop: 3, sandclod: 3,
  },
  silver: {
    kite: 18, sprinkler: 11, squirt: 11, bucket: 10, waterballoon: 10, juicebox: 9, wave: 5,
    waterballoon3: 7, supersoak: 6, icepop: 8, beachball: 5,
  },
  gold: {
    kite: 6, sprinkler: 7, squirt: 9, bucket: 12, waterballoon: 12, juicebox: 14, wave: 10,
    hydrobomb: 9, geyser: 8, monsoon: 7, rocketfloat: 6,
  },
  s: {
    kite: 1, sprinkler: 4, squirt: 6, bucket: 10, waterballoon: 11, juicebox: 15, wave: 13,
    tsunami: 9, krakenwave: 10, meteorsplash: 10, hypernova: 11,
  },
};
export function rollItemTiered(rng, tier) {
  const table = TIER_LOOT[tier] || TIER_LOOT.bronze;
  const entries = Object.entries(table);
  const total = entries.reduce((a, [, w]) => a + w, 0);
  let r = rng() * total;
  for (const [id, w] of entries) { r -= w; if (r <= 0) return id; }
  return entries[0][0];
}

// The dud, delivered: a kite latches onto the ROLLER. Same escape rules as
// being kited by a rival (mash to break free) — the track owes you nothing.
export function applySelfKite(engine, p) {
  const now = engine.now;
  addEffect(p, "kited", 2.6, { now, by: null });
  p.kiteTaps = 0;
  p.kiteNeed = 3;
  engine._events.push({ type: "kited", playerId: p.id, by: null, taps: p.kiteNeed });
}

export function rollItem(rng) {
  const entries = Object.entries(ITEMS);
  const total = entries.reduce((a, [, v]) => a + v.weight, 0);
  let r = rng() * total;
  for (const [id, v] of entries) { r -= v.weight; if (r <= 0) return id; }
  return "waterballoon";
}

// ---------- effect helpers (engine-side player state) ----------
// p.effects: [{ kind, until, mult?, by? }]
export function addEffect(p, kind, seconds, extra = {}) {
  p.effects = p.effects || [];
  p.effects.push({ kind, until: extra.now + seconds, ...extra });
}

export function computeMods(p, now) {
  const mods = { speedMult: 1, accelMult: 1, gripMult: 1 };
  if (!p.effects) return mods;
  p.effects = p.effects.filter((e) => e.until > now);
  for (const e of p.effects) {
    if (e.kind === "soaked") { mods.speedMult *= 0.62; }               // splashed: heavy slow
    if (e.kind === "spin") { mods.spin = (mods.spin || 0) + e.rate; }  // wrenched sideways
    if (e.kind === "slick")  { mods.gripMult *= 0.28; mods.speedMult *= 0.85; } // sprinkler patch
    if (e.kind === "turbo")  { mods.speedMult *= 1.45; mods.accelMult *= 2.0; }
    if (e.kind === "kited")  { /* handled as hard decel in tickItems */ }
    // BLINDED (Sand Clod): you can still drive, you just can't SEE. The engine
    // only flags it; the client throws sand across the screen.
    if (e.kind === "blinded") { mods.blinded = true; }
    // HYPERNOVA: everything is turned up. Nothing slows you down while it burns.
    if (e.kind === "hypernova") {
      mods.speedMult *= 1.35;
      mods.accelMult *= 1.6;
      mods.gripMult = Math.max(mods.gripMult, 1);   // ignore slicks entirely
      mods.hypernova = true;
    }
  }
  // A HYPERNOVA shrugs off everything: if it's active, no debuff sticks.
  if (mods.hypernova) {
    mods.speedMult = Math.max(mods.speedMult, 1.8);
    mods.gripMult = 1;
    mods.spin = 0;
  }
  return mods;
}

export function hasEffect(p, kind) {
  return !!p.effects?.some((e) => e.kind === kind);
}

function consumeShield(engine, p) {
  if (!hasEffect(p, "shield")) return false;
  p.effects = p.effects.filter((e) => e.kind !== "shield");
  engine._events.push({ type: "shield_block", playerId: p.id });
  return true;
}

// ---------- erosion / crumble / sand piles (Batch 6) ----------
const ERODE_LIMIT = 3;          // hits (tier-scaled fractions) to crumble
const ERODE_DECAY = 0.055;      // per second, sand slowly re-packs
const PILE_TTL = 15;
const PILE_RADIUS = 2.3;

export function erode(engine, p, amount, byId) {
  if (p.finished) return;
  if (consumeShield(engine, p)) return;
  if (byId) p._lastHitBy = byId;
  p.erosion = Math.min(ERODE_LIMIT, (p.erosion || 0) + amount);
  engine._events.push({ type: "eroded", playerId: p.id, by: byId, erosion: Math.round(p.erosion * 100) / 100 });
  if (p.erosion >= ERODE_LIMIT) crumble(engine, p);
}

export function crumble(engine, p, { holdSec = 4.0, cause = "hit" } = {}) {
  const killer = p._lastHitBy ? engine.players.get(p._lastHitBy) : null;
  if (killer && killer.id !== p.id) killer.mCrumblesCaused = (killer.mCrumblesCaused || 0) + 1;
  p.erosion = 0;
  p.effects = [];
  p.mCrumbles = (p.mCrumbles || 0) + 1;
  // the sand-splosion leaves a hazard right where you died
  engine.entities.push({
    id: `pile_${engine._entSeq++}`, kind: "sandpile",
    x: p.x, z: p.z, r: PILE_RADIUS, until: engine.now + PILE_TTL,
    born: engine.now,   // fresh piles shrug off the splash that made them
  });
  // THE TAKEDOWN: the kart stays a smoking sand pile right where it died for
  // a fixed, unskippable 4 seconds (authoritative — inputs are ignored), then
  // gets bucket-molded back onto the centerline. The victim watches the
  // wreck; the attacker gets their moment. Both matter.
  p.speed = 0;
  p.vy = 0;
  p.crumbledUntil = engine.now + holdSec;
  p.resetUntil = engine.now + holdSec;      // belt & suspenders for older gates
  p.crumbleCause = cause;
  p._respawnHint = p.groundedHint ?? p.sampleHint ?? 0;
  engine._events.push({ type: "crumble", playerId: p.id, by: p._lastHitBy || null, cause });
}

// ---------- using an item ----------
export function useItem(engine, p) {
  const item = p.heldItem;
  if (!item) return;
  p.heldItem = null;
  const tier = item.tier;
  const M = TIER_MULT[tier] ?? 1;
  const now = engine.now;
  p.mItemsUsed = (p.mItemsUsed || 0) + 1;
  engine._events.push({ type: "item_used", playerId: p.id, itemId: item.id, tier });

  switch (item.id) {
    case "juicebox":
      addEffect(p, "turbo", 1.6 * M, { now });
      break;
    case "bucket":
      addEffect(p, "shield", 5 * M, { now });
      break;
    case "sprinkler": {
      // drop behind the car
      const bx = p.x - Math.cos(p.heading) * 2.4;
      const bz = p.z - Math.sin(p.heading) * 2.4;
      engine.entities.push({ id: `spr_${engine._entSeq++}`, kind: "slickzone", x: bx, z: bz, r: 2.6 * Math.sqrt(M), until: now + 9 + 4 * M, by: p.id, tier });
      break;
    }
    case "waterballoon": {
      const speed = 30;
      engine.entities.push({
        id: `bal_${engine._entSeq++}`, kind: "balloon", by: p.id, tier,
        x: p.x + Math.cos(p.heading) * 1.8, z: p.z + Math.sin(p.heading) * 1.8,
        vx: Math.cos(p.heading) * (speed + p.speed * 0.5), vz: Math.sin(p.heading) * (speed + p.speed * 0.5),
        vy: 4.5, y: 1.2, until: now + 2.4,
      });
      break;
    }
    case "squirt": {
      engine.entities.push({ id: `sq_${engine._entSeq++}`, kind: "squirt", by: p.id, tier, until: now + 0.8, x: p.x, z: p.z, heading: p.heading });
      break;
    }
    case "wave": {
      {
        const tg0 = engine.track.at(p.sampleHint);
        engine.entities.push({ id: `wav_${engine._entSeq++}`, kind: "wave", by: p.id, tier, sample: p.sampleHint, speed: 34, until: now + 14, x: p.x, z: p.z, heading: Math.atan2(tg0.tz, tg0.tx) });
      }
      break;
    }
    // ---------- BRONZE ----------
    case "waterbomb": {
      // A lobbed bomb: it arcs, and its value is the SPLASH — wider than a
      // straight shot, so it still catches you even if the throw isn't perfect.
      // (The lob is gentle: at vy 8.5 it peaked over head height and came down
      // well past its target, hitting nothing on the way and nothing at the end.)
      engine.entities.push({
        id: `bomb_${engine._entSeq++}`, kind: "balloon", by: p.id, tier, splashR: 4.2,
        x: p.x + Math.cos(p.heading) * 1.8, z: p.z + Math.sin(p.heading) * 1.8,
        vx: Math.cos(p.heading) * (24 + p.speed * 0.4), vz: Math.sin(p.heading) * (24 + p.speed * 0.4),
        vy: 3.2, y: 1.3, until: now + 3.2,
      });
      break;
    }
    case "puddle": {
      // three little slicks dropped in a fan behind you
      for (let i = -1; i <= 1; i++) {
        const a = p.heading + Math.PI + i * 0.35;
        engine.entities.push({
          id: `pud_${engine._entSeq++}`, kind: "slickzone", by: p.id, tier,
          x: p.x + Math.cos(a) * 3.0, z: p.z + Math.sin(a) * 3.0,
          r: 1.7 * Math.sqrt(M), until: now + 8 + 3 * M,
        });
      }
      break;
    }
    case "fizzpop": {
      // a short, sharp pop of speed — the cheap turbo
      addEffect(p, "turbo", 0.9 * M, { now });
      break;
    }
    case "sandclod": {
      // A heavy lump that blinds whoever it hits. It flies FLAT and fast — a
      // lobbing arc (vy 3.0) buried it in the sand after ~9m, well short of
      // anyone, so it could never actually hit a thing.
      engine.entities.push({
        id: `clod_${engine._entSeq++}`, kind: "balloon", by: p.id, tier, blind: true, splashR: 2.4,
        x: p.x + Math.cos(p.heading) * 1.8, z: p.z + Math.sin(p.heading) * 1.8,
        vx: Math.cos(p.heading) * (26 + p.speed * 0.4), vz: Math.sin(p.heading) * (26 + p.speed * 0.4),
        // A FLAT trajectory. At vy 6.5 it peaked at y=2.6 and sailed clean over
        // the victim's head — the hit test only registers below y=2.0, so a
        // dead-centre shot passed straight through them.
        vy: 1.2, y: 1.3, until: now + 2.2,
      });
      break;
    }

    // ---------- SILVER ----------
    case "waterballoon3": {
      // three balloons in a spread — the shotgun
      for (let i = -1; i <= 1; i++) {
        const a = p.heading + i * 0.16;
        engine.entities.push({
          id: `bal_${engine._entSeq++}`, kind: "balloon", by: p.id, tier,
          x: p.x + Math.cos(a) * 1.8, z: p.z + Math.sin(a) * 1.8,
          vx: Math.cos(a) * (30 + p.speed * 0.5), vz: Math.sin(a) * (30 + p.speed * 0.5),
          vy: 4.5, y: 1.2, until: now + 2.4,
        });
      }
      break;
    }
    case "supersoak": {
      // a long, sustained jet — the squirt stream with real reach and duration
      engine.entities.push({
        id: `soak_${engine._entSeq++}`, kind: "squirt", by: p.id, tier, reach: 26, wide: 0.5,
        until: now + 2.2, x: p.x, z: p.z, heading: p.heading,
      });
      break;
    }
    case "icepop": {
      // freeze the road behind you: a slick that's bigger AND spins whoever hits it
      const bx = p.x - Math.cos(p.heading) * 2.4;
      const bz = p.z - Math.sin(p.heading) * 2.4;
      engine.entities.push({
        id: `ice_${engine._entSeq++}`, kind: "slickzone", by: p.id, tier, icy: true,
        x: bx, z: bz, r: 3.4 * Math.sqrt(M), until: now + 11 + 4 * M,
      });
      break;
    }
    case "beachball": {
      // a big ball that bounces down the track ahead of you, hitting anything it meets
      const tg = engine.track.at(p.sampleHint);
      engine.entities.push({
        id: `ball_${engine._entSeq++}`, kind: "bouncer", by: p.id, tier,
        x: p.x + Math.cos(p.heading) * 2.2, z: p.z + Math.sin(p.heading) * 2.2,
        sample: p.sampleHint, speed: 26, bounces: 5, y: 1.4, vy: 3.0,
        heading: Math.atan2(tg.tz, tg.tx), until: now + 10,
      });
      break;
    }

    // ---------- GOLD ----------
    case "hydrobomb": {
      // a heavy shell with a wide, hard-hitting blast
      engine.entities.push({
        id: `hyd_${engine._entSeq++}`, kind: "balloon", by: p.id, tier, splashR: 5.5, heavy: true,
        x: p.x + Math.cos(p.heading) * 2.0, z: p.z + Math.sin(p.heading) * 2.0,
        vx: Math.cos(p.heading) * (34 + p.speed * 0.5), vz: Math.sin(p.heading) * (34 + p.speed * 0.5),
        vy: 5.5, y: 1.3, until: now + 3.0,
      });
      break;
    }
    case "geyser": {
      // a mine that erupts UNDER whoever drives over it — launches them airborne
      const bx = p.x - Math.cos(p.heading) * 3.0;
      const bz = p.z - Math.sin(p.heading) * 3.0;
      engine.entities.push({
        id: `gey_${engine._entSeq++}`, kind: "geyser", by: p.id, tier,
        x: bx, z: bz, r: 2.4, armed: now + 1.0, until: now + 26,
      });
      break;
    }
    case "monsoon": {
      // a rain cloud that PARKS over the racer ahead and soaks them continuously
      const t = engine.track;
      const myS = t.at(p.sampleHint).s + p.lap * t.total;
      let best = null, bd = Infinity;
      for (const q of engine.players.values()) {
        if (q.id === p.id || q.finished) continue;
        const qs = t.at(q.sampleHint).s + q.lap * t.total;
        const gap = qs - myS;
        if (gap > 0.5 && gap < 90 && gap < bd) { bd = gap; best = q; }
      }
      if (best) {
        engine.entities.push({
          id: `mon_${engine._entSeq++}`, kind: "cloud", by: p.id, tier,
          target: best.id, x: best.x, z: best.z, r: 3.0, until: now + 5.5 * M,
        });
      } else {
        engine._events.push({ type: "item_fizzle", playerId: p.id, itemId: "monsoon" });
      }
      break;
    }
    case "rocketfloat": {
      // a long turbo AND a shield — the "get out of here" button
      addEffect(p, "turbo", 2.4 * M, { now });
      addEffect(p, "shield", 3.5 * M, { now });
      break;
    }

    // ---------- S-TIER: the screen-clearing stuff ----------
    case "tsunami": {
      // a wall of water that sweeps the ENTIRE track ahead of you, hitting everyone
      const tg0 = engine.track.at(p.sampleHint);
      engine.entities.push({
        id: `tsu_${engine._entSeq++}`, kind: "wave", by: p.id, tier,
        sample: p.sampleHint, speed: 48, width: 3.0, mega: true,
        until: now + 20, x: p.x, z: p.z, heading: Math.atan2(tg0.tz, tg0.tx),
      });
      p.mUltimates = (p.mUltimates || 0) + 1;
      engine._events.push({ type: "ultimate", playerId: p.id, itemId: "tsunami" });
      break;
    }
    case "krakenwave": {
      // tentacles grab EVERY racer ahead of you at once — no dodging it
      let caught = 0;
      const t = engine.track;
      const myS = t.at(p.sampleHint).s + p.lap * t.total;
      for (const q of engine.players.values()) {
        if (q.id === p.id || q.finished) continue;
        const qs = t.at(q.sampleHint).s + q.lap * t.total;
        if (qs <= myS) continue;                      // only those AHEAD
        if (consumeShield(engine, q)) continue;
        addEffect(q, "kited", 2.4, { now, by: p.id });
        q.kiteTaps = 0;
        q.kiteNeed = Math.round(4 + 2 * M);
        erode(engine, q, (ITEMS.krakenwave.erode || 2.2) * M, p.id);
        engine._events.push({ type: "kited", playerId: q.id, by: p.id, taps: q.kiteNeed });
        caught++;
      }
      p.mUltimates = (p.mUltimates || 0) + 1;
      p.mKrakenBest = Math.max(p.mKrakenBest || 0, caught);
      engine._events.push({ type: "ultimate", playerId: p.id, itemId: "krakenwave", caught });
      break;
    }
    case "meteorsplash": {
      // a shell that streaks to the LEADER and craters them, wherever they are
      let leader = null;
      for (const q of engine.players.values()) {
        if (q.id === p.id || q.finished) continue;
        if (!leader || q.progress > leader.progress) leader = q;
      }
      if (leader && leader.progress > p.progress) {
        engine.entities.push({
          id: `met_${engine._entSeq++}`, kind: "homing", by: p.id, tier,
          target: leader.id, x: p.x, z: p.z, y: 14, speed: 42, splashR: 6.0,
          until: now + 8,
        });
        p.mUltimates = (p.mUltimates || 0) + 1;
        engine._events.push({ type: "ultimate", playerId: p.id, itemId: "meteorsplash", target: leader.id });
      } else {
        // you ARE the leader — it detonates around you instead, clearing the pack
        engine.entities.push({
          id: `met_${engine._entSeq++}`, kind: "balloon", by: p.id, tier, splashR: 7.0, heavy: true,
          x: p.x, z: p.z, vx: 0, vz: 0, vy: -1, y: 2.0, until: now + 0.3,
        });
        p.mUltimates = (p.mUltimates || 0) + 1;
        engine._events.push({ type: "ultimate", playerId: p.id, itemId: "meteorsplash", target: null });
      }
      break;
    }
    case "hypernova": {
      // the big one: huge turbo, a shield, and you shrug off the sand entirely
      addEffect(p, "turbo", 4.0 * M, { now });
      addEffect(p, "shield", 5.0 * M, { now });
      addEffect(p, "hypernova", 4.0 * M, { now });
      p.erosion = Math.max(0, (p.erosion || 0) - 1.0);   // the blast packs your sand back
      p.mUltimates = (p.mUltimates || 0) + 1;
      engine._events.push({ type: "ultimate", playerId: p.id, itemId: "hypernova" });
      break;
    }

    case "kite": {
      // latch the nearest racer AHEAD of you (within 55m of arc), else fizzle
      const t = engine.track;
      const myS = t.at(p.sampleHint).s + p.lap * t.total;
      let best = null, bd = Infinity;
      for (const q of engine.players.values()) {
        if (q.id === p.id || q.finished) continue;
        const qs = t.at(q.sampleHint).s + q.lap * t.total;
        const gap = qs - myS;
        if (gap > 0.5 && gap < 55 && gap < bd) { bd = gap; best = q; }
      }
      if (best) {
        if (!consumeShield(engine, best)) {
          addEffect(best, "kited", 2.2 + 1.1 * M, { now, by: p.id });
          best.kiteTaps = 0;
          best.kiteNeed = Math.round(3 + 2 * M);      // taps to break free
          engine._events.push({ type: "kited", playerId: best.id, by: p.id, taps: best.kiteNeed });
        }
      } else {
        engine._events.push({ type: "kite_fizzle", playerId: p.id });
      }
      break;
    }
  }
}

// Target mashes SPACE while kited → early release.
export function kiteTap(engine, p) {
  if (!hasEffect(p, "kited")) return false;
  p.kiteTaps = (p.kiteTaps || 0) + 1;
  if (p.kiteTaps >= (p.kiteNeed || 4)) {
    p.effects = p.effects.filter((e) => e.kind !== "kited");
    engine._events.push({ type: "kite_break", playerId: p.id });
  }
  return true;
}

// ---------- per-tick entity + effect simulation ----------
export function tickItems(engine, dt) {
  const t = engine.track;
  const now = engine.now;
  const players = [...engine.players.values()];

  // hard drag for kited players: yank toward zero regardless of throttle
  for (const p of players) {
    if (hasEffect(p, "kited")) {
      p.speed = Math.max(0, p.speed - 34 * dt);
    }
    // erosion re-packs slowly
    if (p.erosion > 0) p.erosion = Math.max(0, p.erosion - ERODE_DECAY * dt);
  }

  // entities
  engine.entities = engine.entities.filter((e) => e.until > now);
  for (const e of engine.entities.slice()) {
    if (e.kind === "balloon") {
      e.x += e.vx * dt; e.z += e.vz * dt;
      e.vy -= 16 * dt; e.y += e.vy * dt;
      // A projectile pops when it LANDS, or when it strikes a kart on the way.
      // The strike test used to require y < 2.0 — so any lobbed bomb (a Water
      // Bomb peaks around y=2.6) sailed clean over a dead-centre target and
      // buried itself in the sand behind them. A shell that can't hit anything
      // is not a weapon. Direct strikes now use the kart's real height, and a
      // landing detonates on whatever is underneath it regardless.
      let popped = e.y <= 0.15;
      if (!popped) {
        for (const q of players) {
          if (q.id === e.by || q.finished) continue;
          if (Math.hypot(q.x - e.x, q.z - e.z) < CAR.BODY_RADIUS + 0.6 && e.y < 2.6) {
            popped = true;
            break;
          }
        }
      }
      if (popped) {
        // SPLASH RADIUS: a Water Bomb, Hydro Bomb or Meteor doesn't just hit the
        // one kart it touched — it catches everyone inside the blast.
        const R = e.splashR ?? (CAR.BODY_RADIUS + 0.6);
        const Mt = TIER_MULT[e.tier] ?? 1;
        const dmg = (e.heavy ? 1.5 : 1.0);
        for (const q of players) {
          if (q.id === e.by || q.finished) continue;
          if (Math.hypot(q.x - e.x, q.z - e.z) > R) continue;
          if (consumeShield(engine, q)) continue;
          addEffect(q, "soaked", 1.1 * Mt * dmg, { now });
          addEffect(q, "spin", 0.9 * dmg, { now, rate: (engine.rng() < 0.5 ? -1 : 1) * 7.5 * dmg });
          if (e.blind) addEffect(q, "blinded", 1.6 * Mt, { now });
          erode(engine, q, 0.8 * Mt * dmg, e.by);
          const _atk = engine.players.get(e.by); if (_atk) _atk.mSplashesCaused = (_atk.mSplashesCaused || 0) + 1;
          engine._events.push({ type: "splash", playerId: q.id, by: e.by, itemId: e.blind ? "sandclod" : "waterballoon" });
        }
        e.until = 0;
        dissolvePilesAt(engine, e.x, e.z, Math.max(2.8, R));
        engine._events.push({
          type: "balloon_pop", x: Math.round(e.x * 10) / 10, z: Math.round(e.z * 10) / 10,
          r: R, heavy: !!e.heavy, blind: !!e.blind,
        });
      }
    }
    else if (e.kind === "squirt") {
      const owner = engine.players.get(e.by);
      if (!owner) { e.until = 0; continue; }
      e.x = owner.x; e.z = owner.z; e.heading = owner.heading;
      for (const q of players) {
        if (q.id === e.by || q.finished) continue;
        const dx = q.x - owner.x, dz = q.z - owner.z;
        const d = Math.hypot(dx, dz);
        if (d > 1 && d < (e.reach ?? 13)) {
          let ang = Math.atan2(dz, dx) - owner.heading;
          while (ang > Math.PI) ang -= 2 * Math.PI;
          while (ang < -Math.PI) ang += 2 * Math.PI;
          if (Math.abs(ang) < (e.wide ?? 0.22)) {
            if (!consumeShield(engine, q)) {
              const M = TIER_MULT[e.tier] ?? 1;
              addEffect(q, "soaked", 0.55 * M, { now });
              addEffect(q, "spin", 0.6, { now, rate: (engine.rng() < 0.5 ? -1 : 1) * 5.0 });
              erode(engine, q, 0.5 * M * dt * 4, e.by);
              if (!e._tagged) { const _atk = engine.players.get(e.by); if (_atk) _atk.mSplashesCaused = (_atk.mSplashesCaused || 0) + 1;
            engine._events.push({ type: "splash", playerId: q.id, by: e.by, itemId: "squirt" }); e._tagged = true; }
            }
          }
        }
      }
    }
    else if (e.kind === "wave") {
      // rides the centerline forward, hunting the leader
      let left = e.speed * dt;
      let j = e.sample;
      while (left > 0) { const a = t.at(j), b = t.at(j + 1); left -= Math.hypot(b.x - a.x, b.z - a.z); j++; }
      { const tg = t.at(j); e.heading = Math.atan2(tg.tz, tg.tx); } // live facing for the client
      e.sample = j % t.samples.length;
      const p0 = t.at(e.sample);
      e.x = p0.x; e.z = p0.z;
      // find the current leader (not the shooter, not finished)
      const leader = players.filter((q) => !q.finished && q.id !== e.by)
        .sort((a, b) => b.progress - a.progress)[0];
      for (const q of players) {
        if (q.finished || q.id === e.by) continue;
        if (Math.hypot(q.x - e.x, q.z - e.z) < (e.mega ? 9.0 : 2.6)) {
          const isLeader = leader && q.id === leader.id;
          if (!consumeShield(engine, q)) {
            const M = TIER_MULT[e.tier] ?? 1;
            addEffect(q, "soaked", (isLeader ? 2.0 : 0.9) * M, { now });
            addEffect(q, "spin", 1.0, { now, rate: (engine.rng() < 0.5 ? -1 : 1) * 8.5 });
            erode(engine, q, (isLeader ? 1.6 : 0.6) * M, e.by);
            const _atk = engine.players.get(e.by); if (_atk) _atk.mSplashesCaused = (_atk.mSplashesCaused || 0) + 1;
            engine._events.push({ type: "splash", playerId: q.id, by: e.by, itemId: "wave" });
          }
          // A TSUNAMI does not spend itself — it sweeps the whole field.
          if (isLeader && !e.mega) { e.until = 0; break; }
        }
      }
    }
    else if (e.kind === "slickzone" || e.kind === "sandpile") {
      for (const q of players) {
        if (q.finished) continue;
        if (Math.hypot(q.x - e.x, q.z - e.z) < e.r + CAR.BODY_RADIUS * 0.4) {
          if (e.kind === "slickzone") {
            if (q.id !== e.by) {
              addEffect(q, "slick", 0.35, { now }); // refreshed while inside
              // THE SPRINKLER SHOVES. On ENTRY (once per zone) the jet kicks
              // you sideways — a real heading punch, not just soap under the
              // tyres. Deterministic side from the zone id so client
              // prediction agrees with the server.
              if (!q._sprHit) q._sprHit = {};
              if (!q._sprHit[e.id] || now - q._sprHit[e.id] > 4) {
                q._sprHit[e.id] = now;
                const side = (e.id.charCodeAt(e.id.length - 1) % 2) ? 1 : -1;
                q.heading += side * 0.38;
                q.speed *= 0.9;
              }
              // ICE POP: not just slippery — it spins you out.
              if (e.icy) addEffect(q, "spin", 0.5, { now, rate: (engine.rng() < 0.5 ? -1 : 1) * 4.0 });
            }
          } else {
            // sand piles slow EVERYONE who clips them (even their maker)
            q.speed = Math.min(q.speed, CAR.MAX_SPEED * 0.5);
            addEffect(q, "soaked", 0.15, { now });
          }
        }
      }
    }
    // ---- BOUNCING BEACHBALL: rides the centerline, bouncing, hitting anyone ----
    else if (e.kind === "bouncer") {
      let left = e.speed * dt;
      let j = e.sample;
      while (left > 0) { const a = t.at(j), b = t.at(j + 1); left -= Math.hypot(b.x - a.x, b.z - a.z); j++; }
      e.sample = j % t.samples.length;
      const p0 = t.at(e.sample);
      e.x = p0.x; e.z = p0.z;
      e.heading = Math.atan2(p0.tz, p0.tx);
      // the bounce
      e.vy -= 14 * dt; e.y += e.vy * dt;
      if (e.y <= 0.5) { e.y = 0.5; e.vy = 4.2; e.bounces--; engine._events.push({ type: "ball_bounce", x: e.x, z: e.z }); }
      if (e.bounces <= 0) e.until = 0;
      for (const q of players) {
        if (q.finished || q.id === e.by) continue;
        if (Math.hypot(q.x - e.x, q.z - e.z) < 2.2 && e.y < 2.2) {
          if (!consumeShield(engine, q)) {
            const Mt = TIER_MULT[e.tier] ?? 1;
            addEffect(q, "soaked", 1.0 * Mt, { now });
            addEffect(q, "spin", 1.1, { now, rate: (engine.rng() < 0.5 ? -1 : 1) * 9.0 });
            erode(engine, q, (ITEMS.beachball.erode || 0.8) * Mt, e.by);
            const _atk = engine.players.get(e.by); if (_atk) _atk.mSplashesCaused = (_atk.mSplashesCaused || 0) + 1;
            engine._events.push({ type: "splash", playerId: q.id, by: e.by, itemId: "beachball" });
          }
          e.until = 0;
          break;
        }
      }
    }
    // ---- GEYSER TRAP: a mine that erupts underneath and launches you ----
    else if (e.kind === "geyser") {
      if (now < e.armed) continue;                    // brief arming delay
      for (const q of players) {
        if (q.finished) continue;
        if (q.id === e.by) continue;
        if (Math.hypot(q.x - e.x, q.z - e.z) > e.r) continue;
        if (!consumeShield(engine, q)) {
          const Mt = TIER_MULT[e.tier] ?? 1;
          q.vy = Math.max(q.vy || 0, 11 * Mt);        // LAUNCHED
          q.airborne = true;
          addEffect(q, "soaked", 1.2 * Mt, { now });
          addEffect(q, "spin", 1.4, { now, rate: (engine.rng() < 0.5 ? -1 : 1) * 10.0 });
          erode(engine, q, (ITEMS.geyser.erode || 1.4) * Mt, e.by);
          const _atk = engine.players.get(e.by); if (_atk) _atk.mSplashesCaused = (_atk.mSplashesCaused || 0) + 1;
          engine._events.push({ type: "geyser_blow", playerId: q.id, by: e.by, x: e.x, z: e.z });
        }
        e.until = 0;
        break;
      }
    }
    // ---- MONSOON CLOUD: parks over its target and rains on them ----
    else if (e.kind === "cloud") {
      const victim = engine.players.get(e.target);
      if (!victim || victim.finished) { e.until = 0; continue; }
      e.x = victim.x; e.z = victim.z;                 // it follows you. you cannot leave.
      if (!consumeShield(engine, victim)) {
        const Mt = TIER_MULT[e.tier] ?? 1;
        addEffect(victim, "soaked", 0.4, { now });
        erode(engine, victim, (ITEMS.monsoon.erode || 1.2) * Mt * dt * 0.8, e.by);
        if (!e._tagged) {
          const _atk = engine.players.get(e.by); if (_atk) _atk.mSplashesCaused = (_atk.mSplashesCaused || 0) + 1;
          engine._events.push({ type: "splash", playerId: victim.id, by: e.by, itemId: "monsoon" });
          e._tagged = true;
        }
      }
    }
    // ---- METEOR SPLASH: streaks to the leader and craters them ----
    else if (e.kind === "homing") {
      const victim = engine.players.get(e.target);
      if (!victim || victim.finished) { e.until = 0; continue; }
      const dx = victim.x - e.x, dz = victim.z - e.z;
      const d = Math.hypot(dx, dz) || 1e-6;
      const step = e.speed * dt;
      e.x += (dx / d) * step;
      e.z += (dz / d) * step;
      e.y = Math.max(0.6, e.y - 9 * dt);              // falling as it closes
      if (d < 3.0 || e.y <= 0.7) {
        const Mt = TIER_MULT[e.tier] ?? 1;
        for (const q of players) {
          if (q.id === e.by || q.finished) continue;
          if (Math.hypot(q.x - e.x, q.z - e.z) > (e.splashR ?? 6)) continue;
          if (consumeShield(engine, q)) continue;
          addEffect(q, "soaked", 2.0 * Mt, { now });
          addEffect(q, "spin", 1.6, { now, rate: (engine.rng() < 0.5 ? -1 : 1) * 12.0 });
          erode(engine, q, (ITEMS.meteorsplash.erode || 3.0) * Mt, e.by);
          const _atk = engine.players.get(e.by); if (_atk) _atk.mSplashesCaused = (_atk.mSplashesCaused || 0) + 1;
          engine._events.push({ type: "splash", playerId: q.id, by: e.by, itemId: "meteorsplash" });
        }
        dissolvePilesAt(engine, e.x, e.z, e.splashR ?? 6);
        engine._events.push({ type: "meteor_impact", x: Math.round(e.x * 10) / 10, z: Math.round(e.z * 10) / 10, r: e.splashR ?? 6 });
        e.until = 0;
      }
    }
  }

  // water dissolves sand piles: any water entity overlapping a pile removes it
  for (const w of engine.entities) {
    if (!["balloon", "squirt", "wave", "slickzone"].includes(w.kind)) continue;
    if (w.until <= now) continue;              // spent entities don't dissolve
    for (const pile of engine.entities) {
      if (pile.kind !== "sandpile" || pile.until <= now) continue;
      if (now - (pile.born ?? 0) < 0.15) continue;        // newborn immunity
      if (Math.hypot((w.x ?? 0) - pile.x, (w.z ?? 0) - pile.z) < pile.r + 1.5) {
        pile.until = 0;
        engine._events.push({ type: "pile_dissolved", x: pile.x, z: pile.z });
      }
    }
  }
}

function dissolvePilesAt(engine, x, z, radius) {
  for (const pile of engine.entities) {
    if (pile.kind !== "sandpile" || pile.until <= engine.now) continue;
    if (engine.now - (pile.born ?? 0) < 0.15) continue;   // newborn immunity
    if (Math.hypot(x - pile.x, z - pile.z) < pile.r + radius) {
      pile.until = 0;
      engine._events.push({ type: "pile_dissolved", x: pile.x, z: pile.z });
    }
  }
}

// serialize entities + statuses into the view
export function itemsView(engine, me) {
  return {
    entities: engine.entities.map((e) => ({
      id: e.id, kind: e.kind, tier: e.tier,
      x: Math.round((e.x ?? 0) * 100) / 100,
      z: Math.round((e.z ?? 0) * 100) / 100,
      y: e.y != null ? Math.round(e.y * 100) / 100 : undefined,
      r: e.r, heading: e.heading, by: e.by,
      vx: e.vx != null ? Math.round(e.vx * 10) / 10 : undefined,
      vz: e.vz != null ? Math.round(e.vz * 10) / 10 : undefined,
      speed: e.speed,
      left: Math.round((e.until - engine.now) * 10) / 10,
    })),
  };
}

export function statusFlags(p, now) {
  return {
    soaked: hasEffect(p, "soaked"),
    slick: hasEffect(p, "slick"),
    turbo: hasEffect(p, "turbo"),
    shield: hasEffect(p, "shield"),
    kited: hasEffect(p, "kited"),
    blinded: hasEffect(p, "blinded"),
    hypernova: hasEffect(p, "hypernova"),
    kiteNeed: hasEffect(p, "kited") ? Math.max(0, (p.kiteNeed || 0) - (p.kiteTaps || 0)) : 0,
    erosion: Math.round((p.erosion || 0) * 100) / 100,
  };
}
