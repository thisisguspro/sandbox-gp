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
import { rollItem } from "./items.js";

export const TIERS = ["bronze", "silver", "gold", "s"];

export function tierForScore(type, score) {
  if (type === "rings") return score >= 5 ? "s" : score >= 4 ? "gold" : score >= 3 ? "silver" : "bronze";
  /* ribbon */ return score >= 0.92 ? "s" : score >= 0.75 ? "gold" : score >= 0.55 ? "silver" : "bronze";
}

// Item boxes: stations of three across the ribbon every ~65m of arc,
// so every lap offers several pickups without carpeting the ribbon.
export function makeItemBoxes(track) {
  // STATIONS of three boxes across the ribbon (kart-racer style): four racers
  // arriving together all get a pickup instead of the leader sweeping a lone
  // box. Stations every ~65m; each box respawns independently.
  const boxes = [];
  const gap = 65;
  let id = 0;
  for (let s = 40; s < track.total - 20; s += gap) {
    let best = 0, bd = Infinity;
    for (let i = 0; i < track.samples.length; i++) {
      const d = Math.abs(track.samples[i].s - s);
      if (d < bd) { bd = d; best = i; }
    }
    const p = track.at(best);
    for (const frac of [-0.28, 0, 0.28]) {
      const lat = track.width * frac;
      boxes.push({
        id: `box${id++}`,
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

const BOX_RADIUS = 2.6;  // kart-generous: a natural racing line clips a station box
const BOX_RESPAWN_SEC = 8;

// Build a rings challenge starting just ahead of the player.
function buildRings(track, player, rng) {
  const gates = [];
  let j = player.sampleHint, lead = 18; // first ring 18m ahead
  const spacing = 26;
  for (let g = 0; g < 5; g++) {
    let left = g === 0 ? lead : spacing;
    while (left > 0) { const a = track.at(j), b = track.at(j + 1); left -= Math.hypot(b.x - a.x, b.z - a.z); j++; }
    const p = track.at(j);
    const lat = (rng() * 2 - 1) * track.width * 0.3;
    gates.push({ x: p.x + (-p.tz) * lat, z: p.z + (p.tx) * lat, r: 2.6, hit: false });
  }
  return { type: "rings", gates, next: 0, score: 0 };
}

function buildRibbon(track, player) {
  return { type: "ribbon", halfWidth: 1.75, durationSec: 8, elapsed: 0, inside: 0, samples: 0, score: 0 };
}

// Called by the engine every tick for every player.
// Returns events to surface ("challenge_start" | "challenge_end").
export function tickChallenges(engine, dt) {
  const out = [];
  const t = engine.track;

  // ---- box pickups + respawns ----
  for (const box of engine.itemBoxes) {
    if (!box.active) {
      if (engine.now >= box.respawnAt) box.active = true;
      continue;
    }
    for (const p of engine.players.values()) {
      if (p.finished || p.isBot && p.heldItem) continue;      // bots hold one at a time too
      if (p.challenge || p.heldItem) continue;                 // one thing at a time
      const d = Math.hypot(p.x - box.x, p.z - box.z);
      if (d <= BOX_RADIUS + CAR.BODY_RADIUS * 0.6) {
        box.active = false;
        box.respawnAt = engine.now + BOX_RESPAWN_SEC;
        if (p.isBot) {
          // Bots skip the show: they roll a tier weighted mid-low and hold it.
          const r = engine.rng();
          p.heldItem = { id: rollItem(engine.rng), tier: r > 0.92 ? "s" : r > 0.7 ? "gold" : r > 0.35 ? "silver" : "bronze" };
        } else {
          p.challenge = engine.rng() < 0.5 ? buildRings(t, p, engine.rng) : buildRibbon(t, p);
          p.challenge.startedAt = engine.now;
          out.push({ type: "challenge_start", playerId: p.id, challengeType: p.challenge.type });
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
        if (Math.hypot(p.x - g.x, p.z - g.z) <= g.r) { g.hit = true; c.score++; c.next++; }
        else {
          // missed if we've clearly driven past its arc position
          const gs = t.at(t.nearest(g.x, g.z, p.sampleHint)).s;
          const ps = t.at(p.sampleHint).s;
          let ahead = ps - gs;
          if (ahead < -t.total / 2) ahead += t.total;
          if (ahead > 6 && ahead < t.total / 2) c.next++;
        }
      }
      if (c.next >= c.gates.length) out.push(endChallenge(engine, p));
    } else { // ribbon
      c.elapsed += dt;
      c.samples++;
      const lat = Math.abs(t.lateral(p.x, p.z, p.sampleHint));
      if (lat <= c.halfWidth) c.inside++;
      c.score = c.inside / Math.max(1, c.samples);
      if (c.elapsed >= c.durationSec) out.push(endChallenge(engine, p));
    }
  }
  return out;
}

function endChallenge(engine, p) {
  const c = p.challenge;
  const tier = tierForScore(c.type, c.score);
  p.challenge = null;
  p.heldItem = { id: rollItem(engine.rng), tier };
  p.mChallenges = (p.mChallenges || 0) + 1;
  if (tier === "s") p.mSTiers = (p.mSTiers || 0) + 1;
  return { type: "challenge_end", playerId: p.id, challengeType: c.type, score: Math.round(c.score * 100) / 100, tier };
}

// Serialize YOUR challenge for the view (others never see it).
export function challengeView(p) {
  const c = p.challenge;
  if (!c) return null;
  if (c.type === "rings") {
    return { type: "rings", next: c.next, gates: c.gates.map((g) => ({ x: g.x, z: g.z, r: g.r, hit: g.hit })) };
  }
  return { type: "ribbon", halfWidth: c.halfWidth, left: Math.max(0, c.durationSec - c.elapsed), score: Math.round(c.score * 100) / 100 };
}
