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
  waterballoon: { weight: 18, label: "Water Balloon" },
  squirt:       { weight: 14, label: "Squirt Stream" },
  sprinkler:    { weight: 14, label: "Sprinkler Patch" },
  wave:         { weight: 8,  label: "The Wave" },
  kite:         { weight: 12, label: "Beach Kite" },
  bucket:       { weight: 16, label: "Bucket Shield" },
  juicebox:     { weight: 18, label: "Juice-Box Turbo" },
};

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
    if (e.kind === "slick")  { mods.gripMult *= 0.28; mods.speedMult *= 0.85; } // sprinkler patch
    if (e.kind === "turbo")  { mods.speedMult *= 1.45; mods.accelMult *= 2.0; }
    if (e.kind === "kited")  { /* handled as hard decel in tickItems */ }
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

function crumble(engine, p) {
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
  // bucket-mold respawn: same scoop as reset, slightly longer beat
  const pose = engine.track.centerPose(p.sampleHint);
  p.x = pose.x; p.z = pose.z; p.heading = pose.heading;
  p.speed = 0;
  p.resetUntil = engine.now + 1.4;
  engine._events.push({ type: "crumble", playerId: p.id, by: p._lastHitBy || null });
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
      let popped = e.y <= 0.15;
      for (const q of players) {
        if (q.id === e.by || q.finished) continue;
        if (Math.hypot(q.x - e.x, q.z - e.z) < CAR.BODY_RADIUS + 0.6 && e.y < 2.0) {
          if (!consumeShield(engine, q)) {
            const M = TIER_MULT[e.tier] ?? 1;
            addEffect(q, "soaked", 1.1 * M, { now });
            erode(engine, q, 0.8 * M, e.by);
            const _atk = engine.players.get(e.by); if (_atk) _atk.mSplashesCaused = (_atk.mSplashesCaused || 0) + 1;
            engine._events.push({ type: "splash", playerId: q.id, by: e.by, itemId: "waterballoon" });
          }
          popped = true;
          break;
        }
      }
      if (popped) {
        e.until = 0;
        dissolvePilesAt(engine, e.x, e.z, 2.8);   // the splash soaks the ground too
        engine._events.push({ type: "balloon_pop", x: Math.round(e.x * 10) / 10, z: Math.round(e.z * 10) / 10 });
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
        if (d > 1 && d < 13) {
          let ang = Math.atan2(dz, dx) - owner.heading;
          while (ang > Math.PI) ang -= 2 * Math.PI;
          while (ang < -Math.PI) ang += 2 * Math.PI;
          if (Math.abs(ang) < 0.22) {
            if (!consumeShield(engine, q)) {
              const M = TIER_MULT[e.tier] ?? 1;
              addEffect(q, "soaked", 0.55 * M, { now });
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
        if (Math.hypot(q.x - e.x, q.z - e.z) < 2.6) {
          const isLeader = leader && q.id === leader.id;
          if (!consumeShield(engine, q)) {
            const M = TIER_MULT[e.tier] ?? 1;
            addEffect(q, "soaked", (isLeader ? 2.0 : 0.9) * M, { now });
            erode(engine, q, (isLeader ? 1.6 : 0.6) * M, e.by);
            const _atk = engine.players.get(e.by); if (_atk) _atk.mSplashesCaused = (_atk.mSplashesCaused || 0) + 1;
            engine._events.push({ type: "splash", playerId: q.id, by: e.by, itemId: "wave" });
          }
          if (isLeader) { e.until = 0; break; }   // the wave spends itself on the leader
        }
      }
    }
    else if (e.kind === "slickzone" || e.kind === "sandpile") {
      for (const q of players) {
        if (q.finished) continue;
        if (Math.hypot(q.x - e.x, q.z - e.z) < e.r + CAR.BODY_RADIUS * 0.4) {
          if (e.kind === "slickzone") {
            if (q.id !== e.by) addEffect(q, "slick", 0.35, { now }); // refreshed while inside
          } else {
            // sand piles slow EVERYONE who clips them (even their maker)
            q.speed = Math.min(q.speed, CAR.MAX_SPEED * 0.5);
            addEffect(q, "soaked", 0.15, { now });
          }
        }
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
    kiteNeed: hasEffect(p, "kited") ? Math.max(0, (p.kiteNeed || 0) - (p.kiteTaps || 0)) : 0,
    erosion: Math.round((p.erosion || 0) * 100) / 100,
  };
}
