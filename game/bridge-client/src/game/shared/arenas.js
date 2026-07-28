// ============================================================================
// SANDBOX GP — ARENAS
//
// The race tracks are splines: a ribbon with a direction of travel. That works
// for racing and is useless for a derby, a flag fort, or a drawing gallery —
// none of which have a "forward". Arenas are the other thing: an enclosed disc
// with walls you can hide behind, hazards that punish standing still, and spawn
// pads.
//
// They're SHARED (server + client) so collision and rendering can't disagree.
//
// Every arena is themed to match one of the four circuits, because a beach kart
// racer where the derby pit looks like it's from a different game is a beach
// kart racer nobody believes in.
//
//   radius   the playable disc; outside it is the wall/water/void
//   theme    reuses the track themes: beach | egypt | shingle | pier
//   walls    AABBs. Block movement AND line of sight.
//   hazards  things that hurt you for being there
//   spawns   where karts appear
//   bases    CTF only: the two flag stands
//   canvas   Sand Artist only: the drawable disc
//   halls    Sand Artist only: the four answer alcoves
// ============================================================================

export const ARENAS = {
  // -------------------------------------------------------------------------
  // THE PIT — demolition derby + tag. Beach theme: a sand bowl ringed with
  // bumper stacks, with a wrecked-kart graveyard in the middle you can use for
  // cover. It's a bowl on purpose: you can't run away, only circle.
  // -------------------------------------------------------------------------
  pit: {
    id: "pit",
    name: "The Sand Pit",
    theme: "beach",
    radius: 62,
    walls: [
      // the central wreck pile — the only hard cover in the arena
      { x: 0, z: 0, w: 16, d: 16, h: 3.2, kind: "wreck" },
      // four bumper stacks at the diagonals: enough to break a charge, not
      // enough to hide behind forever
      { x: 30, z: 30, w: 12, d: 4, h: 2.2, kind: "bumper" },
      { x: -30, z: 30, w: 4, d: 12, h: 2.2, kind: "bumper" },
      { x: 30, z: -30, w: 4, d: 12, h: 2.2, kind: "bumper" },
      { x: -30, z: -30, w: 12, d: 4, h: 2.2, kind: "bumper" },
    ],
    hazards: [
      // TAR PITS: stand in one and you bog down. They punish camping, which is
      // the failure mode of every last-man-standing game ever made.
      { kind: "tar", x: 22, z: -8, r: 7 },
      { kind: "tar", x: -22, z: 8, r: 7 },
      { kind: "tar", x: 0, z: 34, r: 6 },
      { kind: "tar", x: 0, z: -34, r: 6 },
    ],
    spawns: ringSpawns(8, 50),
  },

  // -------------------------------------------------------------------------
  // THE FORT — capture the flag. EGYPT theme: two temple compounds facing each
  // other across a colonnade. The pillars are what make line of sight a
  // mechanic instead of a gimmick — there is a middle you must cross, and it is
  // not safe, but it is broken up enough that a good driver can pick a line.
  // -------------------------------------------------------------------------
  fort: {
    id: "fort",
    name: "Temple Standoff",
    theme: "egypt",
    radius: 120,
    walls: [
      // base compounds — three sides, open toward the middle, flags deep inside
      { x: -104, z: 0, w: 6, d: 88, h: 5, kind: "stone" },
      { x: -84, z: -42, w: 40, d: 6, h: 5, kind: "stone" },
      { x: -84, z: 42, w: 40, d: 6, h: 5, kind: "stone" },

      { x: 104, z: 0, w: 6, d: 88, h: 5, kind: "stone" },
      { x: 84, z: -42, w: 40, d: 6, h: 5, kind: "stone" },
      { x: 84, z: 42, w: 40, d: 6, h: 5, kind: "stone" },

      // THE MAZE: three colonnades and staggered cross walls — no straight line
      // between the flags, every route a decision, the trip long enough to be
      // hunted on.
      { x: -46, z: -52, w: 7, d: 7, h: 8, kind: "pillar" },
      { x: -46, z: 0, w: 7, d: 7, h: 8, kind: "pillar" },
      { x: -46, z: 52, w: 7, d: 7, h: 8, kind: "pillar" },
      { x: 0, z: -66, w: 7, d: 7, h: 8, kind: "pillar" },
      { x: 0, z: -22, w: 7, d: 7, h: 8, kind: "pillar" },
      { x: 0, z: 22, w: 7, d: 7, h: 8, kind: "pillar" },
      { x: 0, z: 66, w: 7, d: 7, h: 8, kind: "pillar" },
      { x: 46, z: -52, w: 7, d: 7, h: 8, kind: "pillar" },
      { x: 46, z: 0, w: 7, d: 7, h: 8, kind: "pillar" },
      { x: 46, z: 52, w: 7, d: 7, h: 8, kind: "pillar" },
      { x: -24, z: -30, w: 30, d: 5, h: 5, kind: "stone" },
      { x: 24, z: 30, w: 30, d: 5, h: 5, kind: "stone" },
      // flank walls: the outside line is fast, exposed, and mined (below)
      { x: 0, z: -92, w: 70, d: 6, h: 5, kind: "stone" },
      { x: 0, z: 92, w: 70, d: 6, h: 5, kind: "stone" },
    ],
    hazards: [
      // sinkholes on the flanks, LAVA in the two fast inner channels: the
      // quick routes are the ones that can kill a careless carrier.
      { kind: "sink", x: -66, z: 60, r: 6 },
      { kind: "sink", x: 66, z: -60, r: 6 },
      { kind: "sink", x: -66, z: -60, r: 6 },
      { kind: "sink", x: 66, z: 60, r: 6 },
      { kind: "lava", x: -23, z: 8, r: 5 },
      { kind: "lava", x: 23, z: -8, r: 5 },
    ],
    bases: [
      { x: -84, z: 0 },     // team 0
      { x: 84, z: 0 },      // team 1
    ],
    spawns: [
      { x: -88, z: -20, heading: 0 }, { x: -88, z: 20, heading: 0 },
      { x: -78, z: -10, heading: 0 }, { x: -78, z: 10, heading: 0 },
      { x: 88, z: -20, heading: Math.PI }, { x: 88, z: 20, heading: Math.PI },
      { x: 78, z: -10, heading: Math.PI }, { x: 78, z: 10, heading: Math.PI },
    ],
  },

  gallery: {
    id: "gallery",
    name: "The Gallery",
    theme: "shingle",
    radius: 78,
    walls: [
      // the alcove dividers — they define four hallways without blocking the
      // view of the canvas, which would ruin the game
      { x: 0, z: -46, w: 3, d: 26, h: 3 },
      { x: 0, z: 46, w: 3, d: 26, h: 3 },
      { x: -46, z: 0, w: 26, d: 3, h: 3 },
      { x: 46, z: 0, w: 26, d: 3, h: 3 },
    ],
    hazards: [],
    // the drawable disc, dead centre
    canvas: { x: 0, z: 0, r: 26 },
    // four answer alcoves, N/E/S/W
    halls: [
      { x: 0, z: -58, r: 9 },
      { x: 58, z: 0, r: 9 },
      { x: 0, z: 58, r: 9 },
      { x: -58, z: 0, r: 9 },
    ],
    // OFFSET the spawn ring. The alcove dividers sit on the N/E/S/W axes, and a
    // straight 8-point ring puts four pads exactly inside them — every other
    // kart would start the round wedged in a wall.
    spawns: ringSpawns(8, 40, Math.PI / 8),
  },

  // -------------------------------------------------------------------------
  // THE LAGOON — Pearl Rush. PIER theme: a broad shallow over the pink sea,
  // dotted with sandbars. Pearls scatter across the whole floor. The sandbars
  // are cover AND obstacle, and the deep water at the rim will take you.
  // -------------------------------------------------------------------------
  lagoon: {
    id: "lagoon",
    name: "Rose Lagoon",
    theme: "pier",
    radius: 72,
    walls: [
      // sandbars: low, rounded, break up the sight lines a little
      { x: -28, z: -20, w: 18, d: 10, h: 2.0, kind: "sandbar" },
      { x: 30, z: 16, w: 10, d: 20, h: 2.0, kind: "sandbar" },
      { x: 6, z: -38, w: 22, d: 8, h: 2.0, kind: "sandbar" },
      { x: -14, z: 36, w: 14, d: 12, h: 2.0, kind: "sandbar" },
    ],
    hazards: [
      // the DEEP: four pools now, and (engine-side) they actually take you —
      // drown, crumble, respawn, and your pearls scatter right where you sank.
      { kind: "deep", x: 0, z: 0, r: 12, inverted: false },
      { kind: "deep", x: -40, z: -34, r: 7.5 },
      { kind: "deep", x: 42, z: 30, r: 7.5 },
      { kind: "deep", x: -34, z: 42, r: 6.5 },
    ],
    spawns: ringSpawns(8, 58),
  },
};

// spawn pads evenly around a ring, all facing the middle
function ringSpawns(n, r, offset = 0) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + offset;
    out.push({
      x: Math.cos(a) * r,
      z: Math.sin(a) * r,
      heading: a + Math.PI,     // face inward
    });
  }
  return out;
}

export function getArena(id) {
  return ARENAS[id] ?? null;
}

// ---------------------------------------------------------------------------
// ARENA PHYSICS
//
// An arena has no centerline, so none of the track's lateral maths applies. It
// needs its own containment: the rim, the walls, and the hazards. This runs
// INSTEAD of the track logic when a mode is arena-based.
// ---------------------------------------------------------------------------
export function stepArena(state, arena, dt, CAR) {
  // ---- the rim ----
  const r = Math.hypot(state.x, state.z);
  const limit = arena.radius;
  if (r > limit) {
    const k = limit / r;
    state.x *= k;
    state.z *= k;
    state.speed *= 0.55;               // hitting the wall costs you
    state.hitWall = true;
  } else {
    state.hitWall = false;
  }

  // ---- the walls ----
  // Push out along the shallowest axis: that's what makes a kart SLIDE along a
  // wall instead of sticking to it, which is the difference between an arena
  // that feels solid and one that feels like flypaper.
  for (const w of arena.walls) {
    const halfW = w.w / 2 + CAR.BODY_RADIUS;
    const halfD = w.d / 2 + CAR.BODY_RADIUS;
    const dx = state.x - w.x;
    const dz = state.z - w.z;
    if (Math.abs(dx) > halfW || Math.abs(dz) > halfD) continue;

    const penX = halfW - Math.abs(dx);
    const penZ = halfD - Math.abs(dz);
    if (penX < penZ) {
      state.x = w.x + Math.sign(dx || 1) * halfW;
    } else {
      state.z = w.z + Math.sign(dz || 1) * halfD;
    }
    state.speed *= 0.7;
    state.hitWall = true;
  }

  // ---- the hazards ----
  state.inTar = false;
  state.inDeep = false;
  state.inSink = false;
  for (const h of arena.hazards || []) {
    const d = Math.hypot(state.x - h.x, state.z - h.z);
    if (h.kind === "tar" && d < h.r) {
      state.inTar = true;
      // tar doesn't stop you dead, it makes you SLOW and heavy — you can drive
      // out of it, you just won't like how long it takes
      state.speed *= 0.94;
    }
    if (h.kind === "deep" && d < h.r) {
      state.inDeep = true;
    }
    // SINKHOLES / PITS. These were pure decoration — you could park in one all
    // match. Now they GRAB, but only if you LINGER: a gentle inward pull that
    // ramps up the deeper and longer you're in, so crossing one costs you speed
    // but doesn't instantly swallow you. The engine ejects you only after real
    // dwell time (see RaceEngine), which is what "the pits push you off" means —
    // camping the edge or getting stuck is punished, a clean pass is just slow.
    if (h.kind === "sink" && d < h.r) {
      state.inSink = true;
      // deeper = slower; a glancing pass at the rim is barely affected
      const depth = 1 - d / h.r;                 // 0 at rim → 1 at centre
      state.speed *= (1 - 0.10 * depth);
      // only the inner half actually pulls, and gently — you can still drive out
      if (depth > 0.5) {
        const pull = 1.6 * depth * dt;
        const k = d > 0.001 ? Math.min(1, pull / d) : 0;
        state.x += (h.x - state.x) * k;
        state.z += (h.z - state.z) * k;
      }
    }
  }
}

// Is this point inside a wall? (spawning pearls, placing flags, etc.)
export function insideWall(arena, x, z, pad = 0) {
  for (const w of arena.walls) {
    if (Math.abs(x - w.x) < w.w / 2 + pad && Math.abs(z - w.z) < w.d / 2 + pad) return true;
  }
  return false;
}
