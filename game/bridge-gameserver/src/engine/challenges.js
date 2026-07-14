// ============================================================
// SANDBOX GP — item boxes + personal skill challenges (THE signature system).
//
// Touching an item box doesn't hand you an item — it hands you a TEST. A
// private mini-gauntlet materializes on the track ahead (only you can see
// it), you keep racing the shared race the whole time, and how well you do
// sets the TIER of the item you're given: bronze → silver → gold → S.
// Skill-expression slot machine. Nobody else's screen shows your gauntlet.
//
// v1 challenge types:
//   RINGS  — 5 gates strung along the next ~130m, offset across the ribbon.
//            Score = gates passed (drive through the hoop).
//   RIBBON — a narrowed 3.5m lane you must hold for 8 seconds.
//            Score = fraction of ticks spent inside it.
//
// Pure logic, no rendering here. The engine owns instances; view exposes YOUR
// challenge only.
// ============================================================
import { CAR } from "./shared/carSim.js";
import { rollItem, rollItemTiered, applySelfKite } from "./items.js";

export const TIERS = ["bronze", "silver", "gold", "s"];

export function tierForScore(type, score) {
  // rings: every 2 hoops = a tier. 0-1 bronze · 2-3 silver · 4-5 gold · 6 = S
  if (type === "rings") return score >= 6 ? "s" : score >= 4 ? "gold" : score >= 2 ? "silver" : "bronze";
  // keys: 6 pads, every 2 clean hits = a tier (same ladder as the hoops)
  if (type === "keys") return score >= 6 ? "s" : score >= 4 ? "gold" : score >= 2 ? "silver" : "bronze";
  /* ribbon */ return score >= 0.92 ? "s" : score >= 0.75 ? "gold" : score >= 0.55 ? "silver" : "bronze";
}

// Item boxes: stations of three across the ribbon every ~65m of arc,
// so every lap offers several pickups without carpeting the ribbon.
export function makeItemBoxes(track) {
  // STATIONS of three boxes across the ribbon (kart-racer style): four racers
  // arriving together all get a pickup instead of the leader sweeping a lone
  // box. Stations every ~110m (sparser by design: pickups are meant to feel
  // like a find, not wallpaper), and grabbed boxes DON'T respawn on their own —
  // the whole field resets together on a 2-minute wave (see tickChallenges),
  // so item availability comes in beats the lobby can learn.
  const boxes = [];
  const gap = 110;
  let id = 0;
  for (let s = 40; s < track.total - 20; s += gap) {
    let best = 0, bd = Infinity;
    for (let i = 0; i < track.samples.length; i++) {
      const d = Math.abs(track.samples[i].s - s);
      if (d < bd) { bd = d; best = i; }
    }
    const p = track.at(best);
    // Each box in a station is a DIFFERENT minigame, colour-coded, so you can
    // choose which one you back yourself to do — a real decision at 90mph.
    const KINDS = ["rings", "ribbon", "keys"];
    let k = 0;
    for (const frac of [-0.36, 0, 0.36]) {   // wider than the grab radius: the choice is REAL
      const lat = track.width * frac;
      boxes.push({
        id: `box${id++}`,
        kind: KINDS[(k++ + Math.floor(s / gap)) % KINDS.length],   // rotate per station
        x: p.x + (-p.tz) * lat,
        z: p.z + (p.tx) * lat,
        sample: best,
        active: true,
        respawnAt: 0,
      });
    }
  }
  return boxes;
}

const BOX_RADIUS = 1.7;  // tight enough that neighbouring boxes don't overlap:
                         // picking your minigame has to be an actual choice, not
                         // "whichever one the loop happened to test first"
const BOX_RESPAWN_SEC = 8;

// Build a rings challenge starting just ahead of the player.
function buildRings(track, player, rng) {
  const gates = [];
  let j = player.sampleHint, lead = 18; // first ring 18m ahead
  const spacing = 26;
  for (let g = 0; g < 6; g++) {
    let left = g === 0 ? lead : spacing;
    while (left > 0) { const a = track.at(j), b = track.at(j + 1); left -= Math.hypot(b.x - a.x, b.z - a.z); j++; }
    const p = track.at(j);
    const lat = (rng() * 2 - 1) * track.width * 0.3;
    // SEND THE HEIGHT.
    //
    // This used to send only x and z. The client then had to GUESS how high the
    // hoop should be, and it guessed with `track.nearest(x, z, -1, 0)` — a search
    // pinned to GROUND LEVEL. On a circuit that climbs to 8.9 metres, a hoop
    // generated up on the bridge got placed down at the height of whatever
    // ground-level sample happened to be nearest. You'd take a hoop on the top
    // deck and it would spawn underneath you.
    //
    // The generator already knows the exact sample. Just send its altitude.
    gates.push({
      x: p.x + (-p.tz) * lat,
      z: p.z + (p.tx) * lat,
      y: p.y || 0,
      r: 2.6,
      hit: false,
    });
  }
  return { type: "rings", gates, next: 0, score: 0 };
}

// LANE HOLD: a narrow lane is painted on the road ahead of you and you must
// keep the KART INSIDE IT while driving forward. Drift a wheel out and you stop
// banking credit. Score = the fraction of the run you stayed inside.
function buildRibbon(track, player) {
  return {
    type: "ribbon",
    halfWidth: 1.9,          // lane is ~3.8m wide; the kart is ~2m
    durationSec: 10,
    elapsed: 0, inside: 0, samples: 0, score: 0,
    startSample: player.sampleHint ?? 0,
  };
}

// KEY DRILL: four pads (W/A/S/D) light one at a time. You have 2s to hit the lit
// one. If it's ALREADY held down, that doesn't count — you must release and
// press it again, so you can't just mash everything. Six pads, cleanly hit.
function buildKeys(engine, player) {
  const order = [];
  const KEYS = ["W", "A", "S", "D"];
  for (let i = 0; i < 6; i++) order.push(KEYS[Math.floor(engine.rng() * 4)]);
  return {
    type: "keys",
    order,
    idx: 0,
    score: 0,
    deadline: engine.now + 2.0,
    // A pad is ARMED only when its key is currently UP. Seed it from the
    // player's live key state at spawn: if they're already holding W (they're
    // accelerating — of course they are), the W pad must NOT count that hold.
    armed: !(player.input && player.input.keys && player.input.keys[order[0]]),
    elapsed: 0,
    durationSec: 16,
  };
}

// Called by the engine every tick for every player.
// Returns events to surface ("challenge_start" | "challenge_end").
export function tickChallenges(engine, dt) {
  // ---- 2-minute box wave: every grabbed box on the track pops back at once ----
  if (engine._boxWaveAt == null) engine._boxWaveAt = engine.now + 120;
  if (engine.now >= engine._boxWaveAt) {
    engine._boxWaveAt = engine.now + 120;
    for (const b of engine.itemBoxes) b.active = true;
  }
  const out = [];
  const t = engine.track;

  // ---- box pickups + respawns ----
  for (const box of engine.itemBoxes) {
    if (!box.active) {
      // (individual respawn removed — boxes come back on the 2-minute wave)
      continue;
    }
    for (const p of engine.players.values()) {
      if (p.finished || p.isBot && p.heldItem) continue;      // bots hold one at a time too
      if (p.challenge || p.heldItem) continue;                 // one thing at a time
      const d = Math.hypot(p.x - box.x, p.z - box.z);
      if (d <= BOX_RADIUS + CAR.BODY_RADIUS * 0.6) {
        box.active = false;   // stays gone until the next 2-minute wave
        if (p.isBot) {
          // Bots skip the show: they roll a tier weighted mid-low and hold it.
          const r = engine.rng();
          p.heldItem = { id: rollItem(engine.rng), tier: r > 0.92 ? "s" : r > 0.7 ? "gold" : r > 0.35 ? "silver" : "bronze" };
        } else {
          // The box you grabbed decides the minigame you play.
          const kind = box.kind || "rings";
          if (kind === "ribbon") p.challenge = buildRibbon(t, p);
          else if (kind === "keys") p.challenge = buildKeys(engine, p);
          else p.challenge = buildRings(t, p, engine.rng);
          p.challenge.startedAt = engine.now;
          const secs = kind === "rings" ? (p.perks?.has?.("LONG_SUMMER") ? 18 : 15)
                     : kind === "ribbon" ? p.challenge.durationSec
                     : p.challenge.durationSec;
          out.push({ type: "challenge_start", playerId: p.id, challengeType: kind, until: secs });
        }
        break;
      }
    }
  }

  // ---- advance live challenges ----
  for (const p of engine.players.values()) {
    const c = p.challenge;
    if (!c) continue;
    if (c.type === "rings") {
      const g = c.gates[c.next];
      if (g) {
        const grabR = g.r * (p.perks?.has?.("MAGNET_MITTS") ? 1.45 : 1);   // perk: Magnet Mitts
        if (Math.hypot(p.x - g.x, p.z - g.z) <= grabR) { g.hit = true; c.score++; c.next++; }
        else {
          // missed if we've clearly driven past its arc position
          const gs = t.at(t.nearest(g.x, g.z, p.sampleHint)).s;
          const ps = t.at(p.sampleHint).s;
          let ahead = ps - gs;
          if (ahead < -t.total / 2) ahead += t.total;
          if (ahead > 6 && ahead < t.total / 2) c.next++;
        }
      }
      const windowSec = p.perks?.has?.("LONG_SUMMER") ? 18 : 15;  // perk: Long Summer
      const expired = engine.now - (c.startedAt || 0) >= windowSec;
      if (c.next >= c.gates.length || expired) out.push(endChallenge(engine, p));
    } else if (c.type === "ribbon") {
      // LANE HOLD: bank credit only while the kart is inside the painted lane.
      c.elapsed += dt;
      c.samples++;
      const lat = Math.abs(t.lateral(p.x, p.z, p.sampleHint));
      const inLane = lat <= c.halfWidth && !p.offTrack;
      if (inLane) c.inside++;
      c.inLane = inLane;                      // client draws the lane red when you're out
      c.score = c.inside / Math.max(1, c.samples);
      if (c.elapsed >= c.durationSec) {
        if (c.score >= 0.999) p.mPerfectLanes = (p.mPerfectLanes || 0) + 1;   // never left the lane
        out.push(endChallenge(engine, p));
      }
    } else if (c.type === "keys") {
      // KEY DRILL: 2s per pad. A key that is ALREADY held doesn't count —
      // you have to release and press it again, so mashing everything fails.
      c.elapsed += dt;
      const want = c.order[c.idx];
      const held = !!(p.input && p.input.keys && p.input.keys[want]);
      // A pad only ARMS once we've seen its key RELEASED while that pad was the
      // live one. Arming on the first tick regardless meant a key you were
      // already holding (W, because you're accelerating) scored instantly —
      // which defeats the entire point of the drill.
      if (!held) c.armed = true;
      if (c.armed && held) {
        c.score++;
        p.mKeyPads = (p.mKeyPads || 0) + 1;
        c.idx++;
        c.deadline = engine.now + 2.0;
        // the NEXT pad starts armed only if its key isn't already down
        const nxt = c.order[c.idx];
        c.armed = !(p.input && p.input.keys && p.input.keys[nxt]);
      } else if (engine.now > c.deadline) {
        c.idx++;                              // ran out of time on this pad
        c.deadline = engine.now + 2.0;
        const nxt = c.order[c.idx];
        c.armed = !(p.input && p.input.keys && p.input.keys[nxt]);
      }
      if (c.idx >= c.order.length || c.elapsed >= c.durationSec) out.push(endChallenge(engine, p));
    }
  }
  return out;
}

function endChallenge(engine, p) {
  const c = p.challenge;
  const scored = c.score + (p.perks?.has?.("LUCKY_SCOOP") ? 1 : 0);   // perk: Lucky Scoop
  const tier = tierForScore(c.type, Math.min(6, scored));
  p.challenge = null;
  // tier-weighted roll. The kite is the DUD: it never sits in your hand — it
  // latches onto you the moment the roulette lands (goal #5: negatives apply
  // themselves). Everything else is held and fired with SPACE.
  let itemId = rollItemTiered(engine.rng, tier);
  if (itemId === "kite" && p.perks?.has?.("ENCORE") && !p._encoreUsed) {   // perk: Encore
    p._encoreUsed = true;
    itemId = rollItemTiered(engine.rng, tier);
  }
  const negative = itemId === "kite";
  if (negative) applySelfKite(engine, p);
  else p.heldItem = { id: itemId, tier };
  p.mChallenges = (p.mChallenges || 0) + 1;
  if (tier === "s") p.mSTiers = (p.mSTiers || 0) + 1;
  return { type: "challenge_end", playerId: p.id, challengeType: c.type, score: Math.round(c.score * 100) / 100, tier, itemId, negative };
}

// Serialize YOUR challenge for the view (others never see it).
export function challengeView(p, now = 0) {
  const c = p.challenge;
  if (!c) return null;
  c._now = now;
  if (c.type === "rings") {
    // The gate's ALTITUDE has to survive the trip. This mapped to { x, z, r, hit }
    // and silently DROPPED y — so the generator could stamp the road height on
    // every gate and the client would never see it. The client then fell back to
    // a ground-level search, and hoops taken on the bridge spawned underneath it.
    return {
      type: "rings",
      next: c.next,
      gates: c.gates.map((g) => ({ x: g.x, y: g.y ?? 0, z: g.z, r: g.r, hit: g.hit })),
    };
  }
  if (c.type === "keys") {
    return {
      type: "keys",
      want: c.order[c.idx] || null,
      idx: c.idx, total: c.order.length, score: c.score,
      armed: !!c.armed,
      left: Math.max(0, c.deadline - (c._now ?? 0)),
    };
  }
  return {
    type: "ribbon",
    halfWidth: c.halfWidth,
    left: Math.max(0, c.durationSec - c.elapsed),
    score: Math.round(c.score * 100) / 100,
    inLane: c.inLane !== false,
    startSample: c.startSample,
  };
}
