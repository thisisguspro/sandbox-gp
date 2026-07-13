// ============================================================================
// SANDBOX GP — GAME MODES
//
// The engine used to be a RACE engine: laps, checkpoints, a finish line, four
// players. Every one of these modes breaks at least one of those assumptions,
// so the rules are pluggable now. The engine owns physics, items, erosion and
// the tick loop; a MODE owns the win condition and whatever else makes it that
// mode.
//
// A mode is a plain object. Every hook is optional — implement only what you
// need, and the engine does the sane thing otherwise.
//
//   id            unique key
//   label         what the player sees
//   arena         null = uses the race tracks; otherwise the arena id
//   minPlayers    won't start below this
//   maxPlayers    hard cap (8 is the ceiling everywhere; netcode is tuned for it)
//   teams         2 for team modes, 0/undefined for free-for-all
//   durationSec   soft time limit (0 = runs until the win condition fires)
//   items         false to disable item boxes entirely
//
//   init(e)              once, at start(). Seed mode state on the engine.
//   tick(e, dt)          every tick, after physics. Where the mode lives.
//   onCrumble(e, p, by)  a kart was destroyed. Return true to suppress respawn.
//   onFinishCheck(e)     return { done, reason } to end the match.
//   score(e, p)          the number shown next to a player. Drives standings.
//   view(e, p)           extra per-player view data (mode HUD).
//   worldView(e)         mode data everyone sees (flags, zones, the word bank).
//
// The engine calls these; the mode never reaches back into engine internals it
// doesn't own. That boundary is what makes six modes tractable instead of six
// forks of a 600-line file.
// ============================================================================
import { CAR } from "./shared/carSim.js";

// ---------------------------------------------------------------------------
// helpers shared by several modes
// ---------------------------------------------------------------------------
const alive = (e) => [...e.players.values()].filter((p) => !p.eliminated && !p.spectating);
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

// Line of sight: can A see B? Walls block. Used by CTF (and the derby's hunters).
// Cheap segment-vs-AABB: an arena has a handful of walls, and we only test the
// pairs that matter, so a naive loop is genuinely fine here.
export function hasLineOfSight(arena, ax, az, bx, bz) {
  if (!arena?.walls?.length) return true;
  for (const w of arena.walls) {
    if (segmentHitsBox(ax, az, bx, bz, w)) return false;
  }
  return true;
}
function segmentHitsBox(x1, z1, x2, z2, w) {
  // slab method, 2D
  const minX = w.x - w.w / 2, maxX = w.x + w.w / 2;
  const minZ = w.z - w.d / 2, maxZ = w.z + w.d / 2;
  const dx = x2 - x1, dz = z2 - z1;
  let t0 = 0, t1 = 1;
  for (const [p, q0, q1] of [[dx, minX - x1, maxX - x1], [dz, minZ - z1, maxZ - z1]]) {
    if (Math.abs(p) < 1e-9) {
      if (q0 > 0 || q1 < 0) return false;      // parallel and outside
      continue;
    }
    let a = q0 / p, b = q1 / p;
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, b);
    if (t0 > t1) return false;
  }
  return true;
}

// Assign teams round-robin, so a 5-player CTF is 3v2 rather than 5v0.
function assignTeams(e, n = 2) {
  let i = 0;
  for (const p of e.players.values()) p.team = (i++) % n;
}

// ===========================================================================
// 1. DEMOLITION DERBY — last kart standing, and the arena is hunting you
// ===========================================================================
export const DERBY = {
  id: "derby",
  label: "Demolition Derby",
  blurb: "Last kart standing. The wreckers are hunting you too.",
  arena: "pit",
  minPlayers: 2,
  maxPlayers: 8,
  durationSec: 300,
  items: true,

  init(e) {
    for (const p of e.players.values()) {
      p.lives = 3;                 // three crumbles, then you're out
      p.eliminated = false;
    }
    // THE WRECKERS: driverless karts that ram whoever is nearest. They are the
    // reason a derby doesn't stall into two cowards circling the rim.
    e.mode_wreckers = [];
    const arena = e.arena;
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      e.mode_wreckers.push({
        id: `wreck${i}`,
        x: Math.cos(a) * (arena.radius * 0.55),
        z: Math.sin(a) * (arena.radius * 0.55),
        heading: a + Math.PI,
        speed: 0,
        target: null,
      });
    }
    // the arena SHRINKS. No stalemates.
    e.mode_ring = arena.radius;
  },

  tick(e, dt) {
    const arena = e.arena;
    const living = alive(e);

    // ---- the closing ring ----
    // After a grace period the rim starts eating the arena. Outside it, the sand
    // scours you: erosion, fast. You cannot hide on the edge.
    if (e.now > 45) {
      e.mode_ring = Math.max(arena.radius * 0.35, e.mode_ring - dt * 1.6);
    }
    for (const p of living) {
      const r = Math.hypot(p.x, p.z);
      if (r > e.mode_ring) {
        e.erodePlayer?.(p, 0.55 * dt, null);
        p.speed *= 0.985;
      }
    }

    // ---- the wreckers ----
    for (const w of e.mode_wreckers) {
      // hunt the nearest living kart
      let best = null, bd = Infinity;
      for (const p of living) {
        const d = dist(w, p);
        if (d < bd) { bd = d; best = p; }
      }
      w.target = best?.id ?? null;
      if (!best) continue;

      const want = Math.atan2(best.z - w.z, best.x - w.x);
      let err = want - w.heading;
      while (err > Math.PI) err -= 2 * Math.PI;
      while (err < -Math.PI) err += 2 * Math.PI;
      w.heading += Math.max(-2.2 * dt, Math.min(2.2 * dt, err * 2.4));
      // accelerate toward the target — but a wrecker that just bounced is backing
      // off, and shouldn't instantly slam into forward gear again
      w.speed = Math.min(19, w.speed + 14 * dt);
      w.x += Math.cos(w.heading) * w.speed * dt;
      w.z += Math.sin(w.heading) * w.speed * dt;

      // keep them inside the ring too — they're wreckers, not escapees
      const wr = Math.hypot(w.x, w.z);
      if (wr > e.mode_ring) {
        w.x *= e.mode_ring / wr;
        w.z *= e.mode_ring / wr;
        w.heading += Math.PI;
      }

      // THE RAM.
      // A cooldown, and a real reverse afterwards. Without them the wrecker sits
      // ON you and fires the hit every single tick — 2,024 "impacts" in one
      // derby, which is a blender, not a wrecking ball.
      if (bd < CAR.BODY_RADIUS + 1.4 && e.now > (w.cooldown ?? 0)) {
        w.cooldown = e.now + 1.6;
        e.erodePlayer?.(best, 1.1, null);
        best.speed *= 0.35;
        const push = Math.atan2(best.z - w.z, best.x - w.x);
        best.x += Math.cos(push) * 2.4;
        best.z += Math.sin(push) * 2.4;
        // KEEP THEM IN THE ARENA. The shove is applied after physics, so nothing
        // re-clamps it this tick — a wrecker ramming a kart that's already on the
        // rim launched it clean OUTSIDE the bowl, where it sat at 64m unable to
        // drive back in. Any push in an arena has to respect the wall.
        const br = Math.hypot(best.x, best.z);
        if (br > arena.radius) {
          const k = arena.radius / br;
          best.x *= k;
          best.z *= k;
        }
        // the wrecker BOUNCES OFF and backs away — it has to reset for another run
        w.speed = -7;
        w.x -= Math.cos(w.heading) * 2.0;
        w.z -= Math.sin(w.heading) * 2.0;
        e._events.push({ type: "wrecker_hit", playerId: best.id, x: w.x, z: w.z });
      }
    }
  },

  onCrumble(e, p) {
    p.lives = (p.lives ?? 1) - 1;
    if (p.lives <= 0) {
      p.eliminated = true;
      p.spectating = true;
      p.eliminatedAt = e.now;
      // the killer gets credit — a derby with no scoreboard is just bumper cars
      const killer = p._lastHitBy ? e.players.get(p._lastHitBy) : null;
      if (killer && killer.id !== p.id) killer.mDerbyKills = (killer.mDerbyKills || 0) + 1;
      e._events.push({ type: "eliminated", playerId: p.id, lives: 0, by: killer?.id ?? null });
      return true;                    // no respawn — you're out
    }
    e._events.push({ type: "life_lost", playerId: p.id, lives: p.lives });
    return false;                     // respawn normally
  },

  onFinishCheck(e) {
    const living = alive(e);
    if (living.length <= 1 && e.players.size > 1) {
      return { done: true, reason: "last_standing", winner: living[0]?.id ?? null };
    }
    return { done: false };
  },

  // A derby bot hunts. It goes for whoever is nearest and rams them.
  botTarget(e, p) {
    let best = null, bd = Infinity;
    for (const q of alive(e)) {
      if (q.id === p.id) continue;
      const d = dist(p, q);
      if (d < bd) { bd = d; best = q; }
    }
    return best ? { x: best.x, z: best.z } : { x: 0, z: 0 };
  },

  score(e, p) { return p.lives ?? 0; },
  view(e, p) { return { lives: p.lives ?? 0, ring: Math.round(e.mode_ring) }; },
  worldView(e) {
    return {
      ring: Math.round(e.mode_ring * 10) / 10,
      wreckers: e.mode_wreckers.map((w) => ({
        id: w.id,
        x: Math.round(w.x * 10) / 10,
        z: Math.round(w.z * 10) / 10,
        heading: Math.round(w.heading * 100) / 100,
      })),
    };
  },
};

// ===========================================================================
// 2. CAPTURE THE FLAG — 4v4, line of sight, flags always on the minimap
// ===========================================================================
export const CTF = {
  id: "ctf",
  label: "Capture the Flag",
  blurb: "4v4. Steal their flag, bring it home. Walls block sight.",
  arena: "fort",
  minPlayers: 2,
  maxPlayers: 8,
  teams: 2,
  durationSec: 420,
  items: true,
  captureTarget: 3,

  init(e) {
    assignTeams(e, 2);
    const a = e.arena;
    e.mode_flags = [0, 1].map((t) => ({
      team: t,
      x: a.bases[t].x, z: a.bases[t].z,
      homeX: a.bases[t].x, homeZ: a.bases[t].z,
      carrier: null,
      droppedAt: 0,
    }));
    e.mode_captures = [0, 0];
    for (const p of e.players.values()) p.captures = 0;
  },

  tick(e, dt) {
    const a = e.arena;
    // reset the carry penalty each tick; the carriers re-apply it below
    for (const p of e.players.values()) p.modeSpeedMult = 1;

    for (const flag of e.mode_flags) {
      // ---- carried ----
      if (flag.carrier) {
        const c = e.players.get(flag.carrier);
        if (!c || c.eliminated || c.crumbledUntil) {
          // dropped where they died. It sits there, and it's a beacon.
          flag.carrier = null;
          flag.droppedAt = e.now;
          e._events.push({ type: "flag_dropped", team: flag.team, x: flag.x, z: flag.z });
        } else {
          flag.x = c.x; flag.z = c.z;
          // THE COST OF CARRYING. You're slower, and the sand scours you the whole
          // way. Without this a capture is just "whoever touched it first drives
          // home", and there is no game between the grab and the score.
          c.modeSpeedMult = 0.88;
          e.erodePlayer?.(c, 0.10 * dt, null);
          // scored?
          const home = a.bases[c.team];
          const ownFlag = e.mode_flags[c.team];
          if (dist(c, home) < 6) {
            // THE CLASSIC RULE — "your own flag must be home to score" — DEADLOCKS
            // here. Both teams grab at once, each sits on the other's flag, and
            // neither can ever score. In a shooter you'd just kill the carrier;
            // in a kart game with respawns you can't reliably force a drop, so the
            // standoff is permanent. Measured: 300 seconds, 2 flags taken, 0
            // captures, both flags carried, forever.
            //
            // So a capture ALWAYS scores. The tension isn't a lock — it's that
            // carrying the flag makes you SLOW and VISIBLE (below), and the run
            // home is the whole game.
            e.mode_captures[c.team]++;
            c.captures = (c.captures || 0) + 1;
            c.mFlagCaptures = (c.mFlagCaptures || 0) + 1;
            flag.carrier = null;
            flag.x = flag.homeX; flag.z = flag.homeZ;
            flag.droppedAt = 0;
            e._events.push({ type: "flag_captured", team: c.team, playerId: c.id, score: e.mode_captures[c.team] });
          }
          continue;
        }
      }

      // ---- on the ground: pick up, or auto-return after 12s ----
      const atHome = Math.hypot(flag.x - flag.homeX, flag.z - flag.homeZ) < 1;
      if (!atHome && flag.droppedAt && e.now - flag.droppedAt > 12) {
        flag.x = flag.homeX; flag.z = flag.homeZ;
        flag.droppedAt = 0;
        e._events.push({ type: "flag_returned", team: flag.team });
        continue;
      }
      for (const p of alive(e)) {
        if (p.crumbledUntil) continue;
        if (dist(p, flag) > CAR.BODY_RADIUS + 1.6) continue;
        if (p.team === flag.team) {
          // touching your OWN flag away from base returns it instantly
          if (!atHome) {
            flag.x = flag.homeX; flag.z = flag.homeZ;
            flag.droppedAt = 0;
            p.mFlagReturns = (p.mFlagReturns || 0) + 1;
            e._events.push({ type: "flag_returned", team: flag.team, playerId: p.id });
          }
        } else {
          flag.carrier = p.id;
          flag.droppedAt = 0;
          p.mFlagGrabs = (p.mFlagGrabs || 0) + 1;
          e._events.push({ type: "flag_taken", team: flag.team, playerId: p.id });
        }
        break;
      }
    }
  },

  onFinishCheck(e) {
    for (const t of [0, 1]) {
      if (e.mode_captures[t] >= CTF.captureTarget) {
        return { done: true, reason: "captures", winningTeam: t };
      }
    }
    return { done: false };
  },

  // A CTF bot: if you're carrying, RUN HOME. If your flag is loose, go get it.
  // Otherwise, go take theirs. That's the whole game, and it's enough to make a
  // bot look like it understands what it's doing.
  botTarget(e, p) {
    const a = e.arena;
    const mine = e.mode_flags[p.team];
    const theirs = e.mode_flags[1 - p.team];
    if (theirs.carrier === p.id) return a.bases[p.team];               // run it home
    const loose = Math.hypot(mine.x - mine.homeX, mine.z - mine.homeZ) > 2;
    if (loose && !mine.carrier) return { x: mine.x, z: mine.z };        // recover ours
    if (mine.carrier) {                                                 // chase the thief
      const thief = e.players.get(mine.carrier);
      if (thief) return { x: thief.x, z: thief.z };
    }
    return { x: theirs.x, z: theirs.z };                                // go get theirs
  },

  score(e, p) { return p.captures ?? 0; },

  view(e, p) {
    // LINE OF SIGHT: you only see enemies you can actually see. Walls hide them.
    // Teammates are always visible — that's what a team is.
    const arena = e.arena;
    const visible = {};
    for (const q of e.players.values()) {
      if (q.id === p.id) continue;
      visible[q.id] = q.team === p.team
        ? true
        : hasLineOfSight(arena, p.x, p.z, q.x, q.z);
    }
    // and the direction to the enemy flag, for the on-screen indicator
    const enemyFlag = e.mode_flags[1 - p.team];
    const ang = Math.atan2(enemyFlag.z - p.z, enemyFlag.x - p.x) - p.heading;
    return {
      team: p.team,
      captures: p.captures ?? 0,
      visible,
      carrying: e.mode_flags.some((f) => f.carrier === p.id),
      flagBearing: Math.round(ang * 100) / 100,
      flagDist: Math.round(dist(p, enemyFlag)),
    };
  },

  worldView(e) {
    return {
      teams: e.mode_captures,
      target: CTF.captureTarget,
      // flags are ALWAYS on the map. That's the whole tension: you always know
      // where it is, you just may not be able to get to it.
      flags: e.mode_flags.map((f) => ({
        team: f.team,
        x: Math.round(f.x * 10) / 10,
        z: Math.round(f.z * 10) / 10,
        carrier: f.carrier,
        home: Math.hypot(f.x - f.homeX, f.z - f.homeZ) < 1,
      })),
    };
  },
};

// ===========================================================================
// 3. SAND ARTIST — pictionary. One draws with water; everyone else guesses by
//    driving to the word they believe in.
// ===========================================================================
export const WORDS = [
  "SHARK", "PALM TREE", "SANDCASTLE", "SURFBOARD", "CRAB", "SUNGLASSES",
  "BEACH BALL", "ICE CREAM", "JELLYFISH", "LIGHTHOUSE", "SEAGULL", "ANCHOR",
  "STARFISH", "UMBRELLA", "PIRATE SHIP", "TURTLE", "COCONUT", "FLIP FLOP",
  "WHALE", "SEASHELL", "KITE", "OCTOPUS", "PELICAN", "SANDWICH",
];

export const ARTIST = {
  id: "artist",
  label: "Sand Artist",
  blurb: "Draw with water. Everyone else drives to the word they believe.",
  arena: "gallery",
  minPlayers: 3,
  maxPlayers: 8,
  items: false,                 // no items — this is a drawing game
  roundSec: 75,
  guessSec: 5,                  // stand in a hallway this long to lock it in

  init(e) {
    e.mode_order = [...e.players.keys()];
    e.mode_roundIdx = -1;
    e.mode_strokes = [];
    e.mode_props = [];
    for (const p of e.players.values()) {
      p.artScore = 0;
      p.guessLock = null;
      p.spectating = false;
      p.eliminated = false;
    }
    startRound(e);
  },

  tick(e, dt) {
    if (e.mode_roundOver) return;
    const drawer = e.players.get(e.mode_drawer);
    const a = e.arena;

    // ---- the drawer paints with water ----
    // Hold the paint key and water pours from the back of the kart, laying a
    // stroke wherever you drive. Only inside the canvas, only the drawer.
    if (drawer && !drawer.eliminated) {
      const painting = !!drawer.input?.keys?.PAINT;
      const inCanvas = Math.hypot(drawer.x - a.canvas.x, drawer.z - a.canvas.z) < a.canvas.r;
      if (painting && inCanvas) {
        const last = e.mode_strokes[e.mode_strokes.length - 1];
        // only lay a new dab when we've actually moved — otherwise sitting still
        // with the key down would spawn thousands of coincident points
        if (!last || Math.hypot(last.x - drawer.x, last.z - drawer.z) > 0.55) {
          e.mode_strokes.push({
            x: Math.round(drawer.x * 10) / 10,
            z: Math.round(drawer.z * 10) / 10,
            t: Math.round(e.now * 10) / 10,
          });
          if (e.mode_strokes.length > 900) e.mode_strokes.shift();   // bounded
        }
      }
      // ---- props on 1..5 ----
      for (let k = 1; k <= 5; k++) {
        if (!drawer.input?.keys?.[`PROP${k}`]) { drawer[`_prop${k}`] = false; continue; }
        if (drawer[`_prop${k}`]) continue;      // held, not a fresh press
        drawer[`_prop${k}`] = true;
        if (!inCanvas) continue;
        e.mode_props.push({
          kind: k,
          x: Math.round(drawer.x * 10) / 10,
          z: Math.round(drawer.z * 10) / 10,
        });
        if (e.mode_props.length > 60) e.mode_props.shift();
      }
    }

    // ---- the guessers park in a hallway ----
    for (const p of e.players.values()) {
      if (p.id === e.mode_drawer || p.spectating || p.eliminated) continue;
      let inHall = -1;
      for (let i = 0; i < a.halls.length; i++) {
        const h = a.halls[i];
        if (Math.hypot(p.x - h.x, p.z - h.z) < h.r) { inHall = i; break; }
      }
      if (inHall < 0) {
        p.guessLock = null;
        continue;
      }
      if (!p.guessLock || p.guessLock.hall !== inHall) {
        p.guessLock = { hall: inHall, since: e.now };
        continue;
      }
      const held = e.now - p.guessLock.since;
      if (held < ARTIST.guessSec) continue;

      // LOCKED IN.
      const correct = e.mode_options[inHall] === e.mode_word;
      p.guessLock = null;
      if (correct) {
        // the faster you get it, the more it's worth — and the drawer is paid
        // for being understood quickly, which is the only fair way to score a
        // drawing game.
        const elapsed = e.now - e.mode_roundStart;
        const speed = Math.max(0.2, 1 - elapsed / ARTIST.roundSec);
        const pts = Math.round(100 * speed) + 20;
        p.artScore = (p.artScore || 0) + pts;
        p.mCorrectGuesses = (p.mCorrectGuesses || 0) + 1;
        if (drawer) {
          drawer.artScore = (drawer.artScore || 0) + Math.round(pts * 0.6);
          drawer.mDrawingsGuessed = (drawer.mDrawingsGuessed || 0) + 1;
        }
        e._events.push({
          type: "guess_correct", playerId: p.id, word: e.mode_word,
          points: pts, drawerPoints: Math.round(pts * 0.6),
        });
        endRound(e, p.id);
        return;
      }
      // WRONG. The kart detonates and you spectate the rest of the round.
      p.spectating = true;
      p.speed = 0;
      e._events.push({ type: "guess_wrong", playerId: p.id, guessed: e.mode_options[inHall] });
      e.crumblePlayer?.(p, { holdSec: 2.0, cause: "wrong_guess" });
    }

    // ---- the clock ----
    if (e.now - e.mode_roundStart > ARTIST.roundSec) {
      e._events.push({ type: "round_timeout", word: e.mode_word });
      endRound(e, null);
    }
  },

  onFinishCheck(e) {
    // everyone has drawn exactly once
    if (e.mode_roundIdx >= e.mode_order.length) {
      const best = [...e.players.values()].sort((a, b) => (b.artScore || 0) - (a.artScore || 0))[0];
      return { done: true, reason: "all_drawn", winner: best?.id ?? null };
    }
    return { done: false };
  },

  // A bot in Sand Artist can't draw or interpret a drawing, so it does the only
  // honest thing: the drawer mills around the canvas, and the guessers pick a
  // hallway at random and commit. They're filler, not opponents — this mode is
  // for humans, and the bots are there so a 3-player lobby can start.
  botTarget(e, p) {
    const a = e.arena;
    if (p.id === e.mode_drawer) {
      const t = e.now * 0.6 + (p.bot?.seed ?? 0);
      return { x: Math.cos(t) * a.canvas.r * 0.6, z: Math.sin(t * 1.3) * a.canvas.r * 0.6 };
    }
    if (p._botHall == null) p._botHall = Math.floor(e.rng() * a.halls.length);
    const h = a.halls[p._botHall];
    return { x: h.x, z: h.z };
  },

  score(e, p) { return p.artScore ?? 0; },

  view(e, p) {
    const isDrawer = p.id === e.mode_drawer;
    return {
      drawer: e.mode_drawer,
      isDrawer,
      // ONLY the drawer sees the word. Obviously.
      word: isDrawer ? e.mode_word : null,
      options: e.mode_options,
      score: p.artScore ?? 0,
      spectating: !!p.spectating,
      guessProgress: p.guessLock
        ? Math.min(1, (e.now - p.guessLock.since) / ARTIST.guessSec)
        : 0,
      guessHall: p.guessLock?.hall ?? null,
      roundLeft: Math.max(0, Math.round(ARTIST.roundSec - (e.now - e.mode_roundStart))),
    };
  },

  worldView(e) {
    return {
      strokes: e.mode_strokes,
      props: e.mode_props,
      options: e.mode_options,
      round: e.mode_roundIdx + 1,
      rounds: e.mode_order.length,
      drawer: e.mode_drawer,
    };
  },
};

function startRound(e) {
  e.mode_roundIdx++;
  if (e.mode_roundIdx >= e.mode_order.length) return;   // finish check will fire
  e.mode_drawer = e.mode_order[e.mode_roundIdx];
  e.mode_strokes = [];
  e.mode_props = [];
  e.mode_roundStart = e.now;
  e.mode_roundOver = false;

  // the word, and three decoys, one per hallway
  const pool = [...WORDS];
  const pick = () => pool.splice(Math.floor(e.rng() * pool.length), 1)[0];
  e.mode_word = pick();
  const opts = [e.mode_word, pick(), pick(), pick()];
  // shuffle so the answer isn't always hallway 0
  for (let i = opts.length - 1; i > 0; i--) {
    const j = Math.floor(e.rng() * (i + 1));
    [opts[i], opts[j]] = [opts[j], opts[i]];
  }
  e.mode_options = opts;

  // everyone back in play, back to the start pads
  let slot = 0;
  for (const p of e.players.values()) {
    p.spectating = false;
    p.guessLock = null;
    p.crumbledUntil = null;
    const pad = e.arena.spawns[slot++ % e.arena.spawns.length];
    p.x = pad.x; p.z = pad.z; p.heading = pad.heading ?? 0; p.speed = 0;
    p.erosion = 0;
  }
  e._events.push({ type: "round_start", drawer: e.mode_drawer, round: e.mode_roundIdx + 1 });
}

function endRound(e, winnerId) {
  e.mode_roundOver = true;
  e._events.push({ type: "round_end", word: e.mode_word, winner: winnerId ?? null });
  // brief interlude, then the next artist takes the canvas
  e.mode_nextRoundAt = e.now + 4;
}

// the engine calls this each tick so the interlude can advance
ARTIST.postTick = (e) => {
  if (e.mode_roundOver && e.mode_nextRoundAt && e.now >= e.mode_nextRoundAt) {
    e.mode_nextRoundAt = 0;
    startRound(e);
  }
};

// ===========================================================================
// 4. TIME ATTACK — ranked, one kart, the clock, the leaderboard
// ===========================================================================
export const TIME_ATTACK = {
  id: "timeattack",
  label: "Time Attack",
  blurb: "You, the track, the clock. Top 3% get the prize.",
  arena: null,                 // races on the real circuits
  minPlayers: 1,
  maxPlayers: 1,
  items: false,
  ranked: true,

  init(e) {
    for (const p of e.players.values()) p.bestLap = null;
  },
  // everything else is stock racing — the engine already does laps and best-lap
  // tracking. The MODE's job is only to say "no items, one player, ranked".
  score(e, p) { return p.mBestLapSec ?? 0; },
  view(e, p) { return { bestLap: p.mBestLapSec ?? null, ranked: true }; },
};

// ===========================================================================
// 5. RIPTIDE TAG — one kart is IT. Touch someone to pass it on. Be IT when the
//    clock runs out and you lose. (Zombie variant: infected keep spreading.)
// ===========================================================================
export const TAG = {
  id: "tag",
  label: "Riptide Tag",
  blurb: "One kart is IT. Pass it on, or be holding it at the horn.",
  arena: "pit",
  minPlayers: 3,
  maxPlayers: 8,
  durationSec: 180,
  items: true,
  tagCooldown: 2.5,            // grace after being tagged, or it's a tug of war

  init(e) {
    const ids = [...e.players.keys()];
    e.mode_it = ids[Math.floor(e.rng() * ids.length)];
    e.mode_tagAt = e.now;
    for (const p of e.players.values()) {
      p.itTime = 0;
      p.tags = 0;
    }
  },

  tick(e, dt) {
    const it = e.players.get(e.mode_it);
    if (!it) return;

    // holding IT costs you: the clock counts your time, and the sand scours you
    it.itTime = (it.itTime || 0) + dt;
    e.erodePlayer?.(it, 0.18 * dt, null);

    // and IT is FASTER — otherwise a good driver simply never gets caught and
    // the mode is a boring procession
    it.modeSpeedMult = 1.12;
    for (const p of e.players.values()) if (p.id !== e.mode_it) p.modeSpeedMult = 1;

    if (e.now - e.mode_tagAt < TAG.tagCooldown) return;

    for (const p of alive(e)) {
      if (p.id === e.mode_it) continue;
      if (p.crumbledUntil) continue;
      if (dist(it, p) > CAR.BODY_RADIUS * 2 + 0.8) continue;
      // TAGGED
      it.tags = (it.tags || 0) + 1;
      it.mTagsMade = (it.mTagsMade || 0) + 1;
      e.mode_it = p.id;
      e.mode_tagAt = e.now;
      e._events.push({ type: "tagged", playerId: p.id, by: it.id });
      break;
    }
  },

  onFinishCheck(e) {
    if (e.now >= (e.hardEndAt ?? Infinity)) {
      // whoever is IT loses; the rest rank by time spent holding it
      return { done: true, reason: "horn", loser: e.mode_it };
    }
    return { done: false };
  },

  // IT chases. Everyone else runs. The simplest AI in the game, and the most
  // legible — you can tell at a glance who's carrying it.
  botTarget(e, p) {
    const a = e.arena;
    const it = e.players.get(e.mode_it);
    if (!it) return { x: 0, z: 0 };
    if (p.id === e.mode_it) {
      let best = null, bd = Infinity;
      for (const q of alive(e)) {
        if (q.id === p.id) continue;
        const d = dist(p, q);
        if (d < bd) { bd = d; best = q; }
      }
      return best ? { x: best.x, z: best.z } : { x: 0, z: 0 };
    }
    // flee: head for the point opposite IT, on the far side of the arena
    const away = Math.atan2(p.z - it.z, p.x - it.x);
    return { x: Math.cos(away) * a.radius * 0.8, z: Math.sin(away) * a.radius * 0.8 };
  },

  // lower is better here: your score is how long you were stuck with it
  score(e, p) { return -Math.round(p.itTime || 0); },
  view(e, p) {
    return {
      it: e.mode_it,
      amIt: p.id === e.mode_it,
      itTime: Math.round((p.itTime || 0) * 10) / 10,
      tags: p.tags || 0,
      cooldown: Math.max(0, Math.round((TAG.tagCooldown - (e.now - e.mode_tagAt)) * 10) / 10),
    };
  },
  worldView(e) { return { it: e.mode_it }; },
};

// ===========================================================================
// 6. PEARL RUSH — the researched one.
//
// Every other mode here is elimination or a duel: get destroyed early and you
// sit and watch. Pearl Rush is the one mode where a weak player still does
// something useful every second they're alive, which is exactly why Coin Runners
// has survived every Mario Kart generation since the Wii. Collecting is a
// parallel activity, not a fight you can lose outright.
//
// The two rules that make it work, straight from the source material:
//   • getting hit MAKES YOU DROP PEARLS — combat is interference, not a kill
//   • the leader wears a crown everyone can see, so the pack self-corrects
// ===========================================================================
export const PEARL = {
  id: "pearl",
  label: "Pearl Rush",
  blurb: "Grab the most pearls. Get hit and you drop them. The leader wears a crown.",
  arena: "lagoon",
  minPlayers: 2,
  maxPlayers: 8,
  durationSec: 180,
  items: true,
  fieldSize: 40,

  init(e) {
    e.mode_pearls = [];
    e.mode_seq = 0;
    for (const p of e.players.values()) p.pearls = 0;
    for (let i = 0; i < PEARL.fieldSize; i++) spawnPearl(e);
  },

  tick(e, dt) {
    // collect
    for (const p of alive(e)) {
      if (p.crumbledUntil) continue;
      for (const pearl of e.mode_pearls) {
        if (pearl.taken) continue;
        if (dist(p, pearl) > CAR.BODY_RADIUS + 1.2) continue;
        pearl.taken = true;
        p.pearls = (p.pearls || 0) + 1;
        p.mPearls = (p.mPearls || 0) + 1;
        e._events.push({ type: "pearl_taken", playerId: p.id, total: p.pearls });
      }
    }
    // top the field back up — a bare arena is a boring arena
    e.mode_pearls = e.mode_pearls.filter((x) => !x.taken);
    while (e.mode_pearls.length < PEARL.fieldSize) spawnPearl(e);

    // the crown
    let lead = null;
    for (const p of alive(e)) if (!lead || (p.pearls || 0) > (lead.pearls || 0)) lead = p;
    e.mode_leader = (lead?.pearls || 0) > 0 ? lead.id : null;
  },

  // getting wrecked spills your pearls all over the sand. This is the mode's
  // whole risk curve: the more you're carrying, the more you have to lose.
  onCrumble(e, p) {
    const drop = Math.min(p.pearls || 0, Math.max(3, Math.ceil((p.pearls || 0) * 0.5)));
    p.pearls = (p.pearls || 0) - drop;
    for (let i = 0; i < drop; i++) {
      const a = e.rng() * Math.PI * 2;
      const r = 2 + e.rng() * 5;
      e.mode_pearls.push({
        id: `pl${e.mode_seq++}`,
        x: p.x + Math.cos(a) * r,
        z: p.z + Math.sin(a) * r,
        taken: false,
      });
    }
    if (drop > 0) e._events.push({ type: "pearls_spilled", playerId: p.id, dropped: drop });
    return false;                     // you respawn — this isn't elimination
  },

  onFinishCheck(e) {
    if (e.now >= (e.hardEndAt ?? Infinity)) {
      const best = [...e.players.values()].sort((a, b) => (b.pearls || 0) - (a.pearls || 0))[0];
      return { done: true, reason: "time", winner: best?.id ?? null };
    }
    return { done: false };
  },

  // Go for the nearest pearl. Greedy, and correct — the mode rewards nothing else.
  botTarget(e, p) {
    let best = null, bd = Infinity;
    for (const pearl of e.mode_pearls) {
      if (pearl.taken) continue;
      const d = dist(p, pearl);
      if (d < bd) { bd = d; best = pearl; }
    }
    return best ? { x: best.x, z: best.z } : { x: 0, z: 0 };
  },

  score(e, p) { return p.pearls ?? 0; },
  view(e, p) {
    return {
      pearls: p.pearls ?? 0,
      leader: e.mode_leader,
      amLeader: e.mode_leader === p.id,
    };
  },
  worldView(e) {
    return {
      leader: e.mode_leader,
      pearls: e.mode_pearls.filter((x) => !x.taken).map((x) => ({
        id: x.id,
        x: Math.round(x.x * 10) / 10,
        z: Math.round(x.z * 10) / 10,
      })),
    };
  },
};

function spawnPearl(e) {
  const a = e.arena;
  const ang = e.rng() * Math.PI * 2;
  const r = Math.sqrt(e.rng()) * a.radius * 0.9;    // sqrt = uniform over the disc
  e.mode_pearls.push({
    id: `pl${e.mode_seq++}`,
    x: Math.cos(ang) * r,
    z: Math.sin(ang) * r,
    taken: false,
  });
}

// ---------------------------------------------------------------------------
export const MODES = {
  race: null,                  // the default: the engine's own racing rules
  derby: DERBY,
  ctf: CTF,
  artist: ARTIST,
  timeattack: TIME_ATTACK,
  tag: TAG,
  pearl: PEARL,
};

export function getMode(id) {
  return MODES[id] ?? null;
}

// what the lobby shows
export const MODE_LIST = [
  { id: "race", label: "Grand Prix", blurb: "Three laps. Items. The classic.", min: 1, max: 4, arena: null },
  { id: "timeattack", label: "Time Attack", blurb: "You, the track, the clock. Ranked.", min: 1, max: 1, arena: null },
  { id: "derby", label: "Demolition Derby", blurb: "Last kart standing. The wreckers hunt you too.", min: 2, max: 8, arena: "pit" },
  { id: "ctf", label: "Capture the Flag", blurb: "4v4. Walls block sight. Steal it and run.", min: 2, max: 8, arena: "fort" },
  { id: "artist", label: "Sand Artist", blurb: "Draw with water. Drive to the word you believe.", min: 3, max: 8, arena: "gallery" },
  { id: "tag", label: "Riptide Tag", blurb: "One kart is IT. Don't be holding it at the horn.", min: 3, max: 8, arena: "pit" },
  { id: "pearl", label: "Pearl Rush", blurb: "Grab the most pearls. Get hit, drop them.", min: 2, max: 8, arena: "lagoon" },
];
