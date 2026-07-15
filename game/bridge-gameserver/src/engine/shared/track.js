// ============================================================
// SANDBOX GP — track definition + geometry math.
// SHARED FILE: lives in bridge-gameserver/src/engine/shared/ (source of truth)
// and is copied verbatim to bridge-client/src/game/shared/. A test diffs them.
//
// A track is a closed Catmull-Rom loop through control points on the XZ plane
// (Y is up). We precompute a dense sample table with arc lengths so progress,
// nearest-point, and "is this position on the asphalt?" queries are O(samples)
// worst case and O(1) amortized with a hint. All units are meters.
// ============================================================

// Catmull-Rom point for segment p0..p3 at t in [0,1]. Y is part of the spline
// now: tracks have HILLS and OVERPASSES. Control points default y to 0, so
// every flat layout keeps working untouched.
function cr(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  const y0 = p0.y || 0, y1 = p1.y || 0, y2 = p2.y || 0, y3 = p3.y || 0;
  return {
    x: 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
    z: 0.5 * ((2 * p1.z) + (-p0.z + p2.z) * t + (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * t2 + (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * t3),
    y: 0.5 * ((2 * y1) + (-y0 + y2) * t + (2 * y0 - 5 * y1 + 4 * y2 - y3) * t2 + (-y0 + 3 * y1 - 3 * y2 + y3) * t3),
  };
}

export function buildTrack(def) {
  const pts = def.points;
  const n = pts.length;
  const SUBDIV = def.subdiv || 24;
  const samples = []; // { x, z, s (arc length), tx, tz (unit tangent) }
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    for (let j = 0; j < SUBDIV; j++) {
      samples.push({ ...cr(p0, p1, p2, p3, j / SUBDIV), s: 0, tx: 0, tz: 0 });
    }
  }
  // arc lengths + tangents (+ per-sample slope for launch physics)
  let total = 0;
  for (let i = 0; i < samples.length; i++) {
    const a = samples[i], b = samples[(i + 1) % samples.length];
    a.s = total;
    const dx = b.x - a.x, dz = b.z - a.z;
    const len = Math.hypot(dx, dz) || 1e-6;
    a.tx = dx / len; a.tz = dz / len;
    a.slope = ((b.y || 0) - (a.y || 0)) / len;   // dy per meter of travel
    total += len;
  }
  // ---- HAZARDS, PLACED ON THE ROAD ----
  // Authored as (arc fraction, lateral offset) and resolved against the spline,
  // because hand-written world coordinates drift off the ribbon: six of the
  // first seventeen ended up 14-55m out in the empty sand, where no kart would
  // ever have touched them. A hazard you can't hit is scenery.
  if (def.hazardSpec) {
    def.hazards = def.hazardSpec.map((h) => {
      const s = h.frac * total;
      let best = 0, bd = Infinity;
      for (let i = 0; i < samples.length; i++) {
        const d = Math.abs(samples[i].s - s);
        if (d < bd) { bd = d; best = i; }
      }
      const p = samples[best];
      const lat = (h.lat ?? 0) * (def.width / 2);
      return {
        ...h,
        x: p.x + (-p.tz) * lat,
        z: p.z + (p.tx) * lat,
      };
    });
  }

  // ELEVATION BUMPS: smooth hills/dips stamped by arc fraction, so a track can
  // add a crest or a sunken dip without hand-authoring y on every control point.
  // Cosine-eased in and out, so the spline never gets a corner in it.
  for (const e of def.elevation || []) {
    const centre = e.frac * total;
    const half = (e.span ?? 0.05) * total;
    for (const smp of samples) {
      let d = smp.s - centre;
      if (d > total / 2) d -= total;
      if (d < -total / 2) d += total;
      if (Math.abs(d) > half) continue;
      const k = 0.5 * (1 + Math.cos((d / half) * Math.PI));   // 1 at the centre, 0 at the edges
      smp.y = (smp.y || 0) + e.y * k;
    }
  }
  // recompute slopes now that y has changed
  for (let i = 0; i < samples.length; i++) {
    const a = samples[i], b = samples[(i + 1) % samples.length];
    const len = Math.hypot(b.x - a.x, b.z - a.z) || 1e-6;
    a.slope = ((b.y || 0) - (a.y || 0)) / len;
  }

  // GAPS: arc-length ranges where the road simply ISN'T (jump sections).
  // A gap sample has no ground: karts over it are airborne, and coming up
  // short drops you onto whatever's below (usually an earlier road — the
  // built-in punishment for blowing the jump).
  for (const g of def.gaps || []) {
    const a = g.fromFrac * total, b = g.toFrac * total;
    let lastBefore = null;
    for (const smp of samples) {
      if (smp.s >= a && smp.s <= b) {
        smp.gap = true;
        smp.kickSlope = g.kick || 0;   // readable from anywhere inside the gap:
                                       // at speed, the launch tick often lands
                                       // several samples past the lip
      } else if (smp.s < a) lastBefore = smp;
    }
    if (lastBefore) lastBefore.kickSlope = g.kick || 0;   // …and on the lip itself
  }
  const width = def.width;

  // Nearest sample to a position; `hint` = last known index for O(1) tracking.
  function nearest(x, z, hint = -1, y = 0) {
    let best = -1, bd = Infinity;
    if (hint >= 0) {
      // local window search around the hint (covers ~2 segments of movement/tick)
      const W = 40;
      for (let k = -W; k <= W; k++) {
        const i = (hint + k + samples.length) % samples.length;
        const dy = ((samples[i].y || 0) - (y || 0)) * 5;   // decks separate hard
        const d = (samples[i].x - x) ** 2 + (samples[i].z - z) ** 2 + dy * dy;
        if (d < bd) { bd = d; best = i; }
      }
      // Trust the local result while it's clearly on/near the track; otherwise
      // fall through to a global scan (teleports, resets).
      if (Math.sqrt(bd) < width * 2) return best;
    }
    bd = Infinity; best = -1;
    for (let i = 0; i < samples.length; i++) {
      const dy = ((samples[i].y || 0) - (y || 0)) * 5;
      const d = (samples[i].x - x) ** 2 + (samples[i].z - z) ** 2 + dy * dy;
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  function at(i) { return samples[(i % samples.length + samples.length) % samples.length]; }

  // Signed lateral offset from centerline at sample i (positive = left of travel).
  function lateral(x, z, i) {
    const p = at(i);
    return (x - p.x) * (-p.tz) + (z - p.z) * (p.tx);
  }

  return {
    def, samples, total, width,
    nearest, at, lateral,
    onTrack(x, z, i) { return Math.abs(lateral(x, z, i)) <= width / 2; },
    // Progress in meters along the lap for a position near sample i.
    progressAt(i) { return at(i).s; },
    // A safe respawn pose on the centerline at sample i.
    centerPose(i) {
      const p = at(i);
      return { x: p.x, z: p.z, y: p.y || 0, heading: Math.atan2(p.tz, p.tx) };
    },
    // Start grid: 2x2 slots just behind the start line (sample 0), staggered.
    gridPose(slot) {
      const back = 6 + Math.floor(slot / 2) * 5;      // rows 6m and 11m behind line
      const side = (slot % 2 === 0 ? -1 : 1) * width * 0.22;
      const i = nearest(at(0).x, at(0).z, 0);
      // walk back along samples by arc length
      let j = i, left = back;
      while (left > 0) { const a = at(j), b = at(j - 1); left -= Math.hypot(a.x - b.x, a.z - b.z); j--; }
      const p = at(j);
      return { x: p.x + (-p.tz) * side, z: p.z + (p.tx) * side, y: p.y || 0, heading: Math.atan2(p.tz, p.tx) };
    },
  };
}

// ------------------------------------------------------------
// TRACK 1 — "Sandcastle Circuit". A rounded kidney loop, ~340m lap,
// wide enough for 4 toy cars to fight over the racing line.
// checkpoints: fractions of total arc length a racer must cross IN ORDER
// (anti-shortcut + lap counting; the lap ticks on re-crossing 0 with all hit).
// ------------------------------------------------------------
export const TRACKS = {
  sandcastle: {
    // frac = where round the lap · lat = how far across the road (-1..1)
    hazardSpec: [
      { kind: "oil",       frac: 0.14, lat: 0.55, r: 5 },    // wet sand on the T1 exit
      { kind: "crab",      frac: 0.38, lat: -0.5, r: 3 },    // a beach ball loose on the road
      { kind: "crab",      frac: 0.62, lat: 0.45, r: 3 },
      { kind: "quicksand", frac: 0.88, lat: -0.6, r: 5 },    // soft sand on the inside line
    ],
    id: "sandcastle",
    name: "Sandcastle Grand Circuit",
    minPlayers: 1,
    maxPlayers: 4,
    laps: 3,
    width: 11,
    subdiv: 28,
    // ~1.55km figure-8. Reading order = driving order:
    //  • the OPENING STRAIGHT east along z=-140 (start line at its west end)
    //  • T1 sweep + a chute into the ESSES up the east side
    //  • the BACK STRAIGHT west along z≈+128
    //  • down the west side into the BRIDGE: a climb to +6.5m that JUMPS the
    //    opening straight (the gap is pinned below), landing on the south road
    //  • the south run east, a HAIRPIN, and the west return to the line.
    // Blow the jump and you drop onto the opening straight — earlier track,
    // which is exactly the setback the layout promises.
    points: [
      { x: -180, z: -140 },                    // start line, heading +X
      { x: -60,  z: -142 },
      { x: 60,   z: -138 },
      { x: 180,  z: -140 },                    // end of opening straight
      { x: 236,  z: -118 },                    // T1 sweep
      { x: 258,  z: -66 },
      { x: 250,  z: -16 },                     // chute
      { x: 200,  z: 8 },                       // esses dive INTO the infield…
      { x: 128,  z: -12 },
      { x: 62,   z: 6 },                       // …around the GREAT SANDCASTLE
      { x: 30,   z: 54 },
      { x: 74,   z: 92 },
      // ---- THE HAIRPIN THAT WASN'T MEANT TO BE ONE ----
      //
      // This used to run (140,74) -> (196,96) -> (120,124): out EAST to x=196, then
      // straight back WEST to x=120. The spline doubled back on itself in the space
      // of two control points, producing a 105-DEGREE turn over ten samples — a
      // near-hairpin, with the road folding over its own kerbs. That's the corner
      // that "looks weird": it isn't a corner, it's a crease.
      //
      // It's a proper sweeping right-hander now. Same shape of lap, same direction
      // of travel, but the curvature is spread over a real arc instead of being
      // concentrated in one crumpled point.
      { x: 148,  z: 84 },                      // turn in
      { x: 186,  z: 106 },                     // apex, out east
      { x: 158,  z: 128 },                     // exit, sweeping back
      { x: 120,  z: 130 },                     // onto the back straight (westbound)
      { x: 0,    z: 130 },
      { x: -120, z: 126 },
      { x: -196, z: 96 },                      // west descent
      { x: -228, z: 40 },
      { x: -232, z: -20 },
      // ---- THE CLIMB, AS A ROAD RATHER THAN A WALL ----
      //
      // These heights were authored for a JUMP: rise hard, kick off a lip at 8.7m,
      // and land on a ledge at 3.2m. The jump is gone (it was a 35-metre gap that
      // no kart could ever clear — see the note above), so what was left was a
      // twenty-percent gradient with a five-metre drop in the middle of it.
      //
      // Measured: a 20% grade. A steep mountain pass is twelve. A kart hitting a
      // 20% wall at 24 m/s rises 0.2 METRES PER TICK — and that is precisely the
      // juddering, staircase feeling: the car is not stepping, it is being
      // catapulted.
      //
      // Same crest, same 8.9m summit, same view over the beach. Spread over twice
      // the distance, so you DRIVE up it.
      { x: -206, z: -74,  y: 1.6 },            // the climb starts gently
      { x: -180, z: -90,  y: 3.4 },
      { x: -160, z: -106, y: 5.2 },            // steady
      { x: -142, z: -116, y: 6.6 },
      { x: -130, z: -124, y: 7.6 },
      { x: -122, z: -138, y: 8.4 },            // the summit
      { x: -112, z: -156, y: 7.4 },            // and over the top
      // ---- THE SECOND CREASE ----
      //
      // This ran (-96,-170) -> (-72,-182) -> (-120,-222): east to x=-72, then
      // straight back west to x=-120. Another 92-degree fold in the space of two
      // control points, right at the bottom of the bridge descent — where you are
      // going fastest and least able to react to a road that suddenly isn't there.
      //
      // Now it sweeps: the descent runs out and CURVES into the southwest return
      // instead of snapping into it.
      // THE DESCENT. This dropped from 5.0m to 0.6m in ten metres of road — a
      // THIRTY-EIGHT PERCENT cliff, right where you're carrying the most speed off
      // the crest. Measured as the steepest thing on any map. Spread it out.
      { x: -104, z: -168, y: 5.8 },
      { x: -98,  z: -182, y: 3.4 },
      { x: -94,  z: -196, y: 1.4 },
      { x: -90,  z: -208, y: 0.2 },            // back on the beach
      { x: -88,  z: -216, y: 0 },              // and turns south…
      { x: -104, z: -218 },                    // …sweeping west
      { x: -136, z: -226 },                    // southwest return
      { x: -204, z: -212 },
      { x: -238, z: -180 },                    // curl north to the line
    ],
    decor: [{ kind: "sandcastle", x: -19, z: -50, r: 30, h: 34 }],
    // The jump: road vanishes for 26m off the kicker. `kick` is the launch
    // slope stamped on the final road sample (the spline rounds the crest off,
    // so the ramp kick is explicit). Full commitment (~16+ m/s) reaches the
    // landing ramp; braking, timidity, or a well-timed soak on the climb drops
    // you onto the opening straight below — earlier track, position lost.
    // A JUMP YOU CAN ACTUALLY MAKE.
    //
    // It used to be a 35-metre gap with a kick of 0.07. The ballistics are damning:
    // at full race pace that kick carries you EIGHTEEN metres. There is no value
    // that clears thirty-five — even an absurd 0.45 only reaches thirty-one. Every
    // kart fell in, every single lap. And with no ramp to sight down, you could not
    // even see where you were meant to aim. A hole you cannot jump is a pit.
    //
    // Eighteen metres now, with a real kick. You clear it with margin at race pace
    // and you still make it at 20 m/s.
    // NO GAP JUMP. Here is why, and it is worth writing down.
    //
    // Sandcastle had a 35-metre hole in the road with a kick of 0.07. The
    // ballistics: at full race pace that kick carries you EIGHTEEN metres. No kick
    // value clears thirty-five — even an absurd 0.45 reaches only thirty-one. Every
    // kart fell in, every lap.
    //
    // So I made it smaller. Then I discovered the road TURNS NINETEEN DEGREES
    // across the gap, and a kart in mid-air travels in a straight line — landing on
    // the road was geometrically impossible regardless of the span.
    //
    // So I moved it to the straightest section of the circuit. There the road
    // climbs THROUGH the gap (7.6m to 8.5m): you'd be jumping uphill into a wall.
    //
    // This circuit's geometry cannot support a gap jump, and forcing one in was
    // making the track unreadable — you genuinely could not tell where you were
    // meant to be going, because there was nowhere to go. The road is continuous.
    // Sandcastle keeps its big elevation change as a CREST: a rise you carry speed
    // over and a descent you have to hold. That is a corner-shaped decision, and
    // it is a far better piece of track than a hole nobody could clear.
    gaps: [],
    checkpointFracs: [0.25, 0.5, 0.75],
  },
};

// ============================================================================
// MAP 2 — VALLEY OF KINGS (Egyptian). Long straights between temple walls, a
// tight switchback through a collapsed colonnade, and a sunken tomb dip. Sand
// everywhere, but hard-edged and monumental instead of soft and beachy.
// ============================================================================
TRACKS.pharaoh = {
    hazardSpec: [
      { kind: "quicksand", frac: 0.18, lat: 0.5, r: 6 },     // the desert taking the road back
      { kind: "quicksand", frac: 0.72, lat: -0.5, r: 6 },
      // A hazard DEAD CENTRE of the racing line (lat: 0.0) is not a hazard — it's a
      // WALL. There is no line through it; you simply hit it. And these are rendered
      // as brown dodecahedrons, which is exactly what the roadside SCENERY rocks are
      // made of, so it reads as "somebody left rocks on the track" rather than as a
      // deliberate obstacle.
      //
      // Off the centreline, so there is always a way past — and the choice of which
      // side is the interesting bit.
      { kind: "rockfall",  frac: 0.42, lat: 0.55, r: 3 },
      { kind: "rockfall",  frac: 0.58, lat: -0.55, r: 3 },
    ],
  id: "pharaoh",
  name: "Valley of Kings",
  minPlayers: 1, maxPlayers: 4, laps: 3, width: 12, subdiv: 26,
  theme: "egypt",
  points: [
    { x: -170, z: -120 }, { x: -40, z: -134 }, { x: 80, z: -128 },
    { x: 160, z: -96 },  { x: 186, z: -30 },  { x: 168, z: 34 },
    { x: 104, z: 70 },   { x: 96, z: 118 },   { x: 40, z: 146 },
    { x: -30, z: 138 },  { x: -58, z: 92 },   { x: -120, z: 104 },
    { x: -168, z: 70 },  { x: -196, z: 6 },   { x: -186, z: -66 },
  ],
  checkpointFracs: [0.25, 0.5, 0.75],
  // The Great Sphinx sits in the infield — your compass, same job the castle does.
  decor: [
    { kind: "sphinx", x: -10, z: 0, r: 34, h: 26 },
    { kind: "obelisk", x: 120, z: -60, r: 5, h: 30 },
    { kind: "obelisk", x: -120, z: 40, r: 5, h: 30 },
  ],
  // The tomb dip: the road plunges then climbs back. No gap — just a fast,
  // blind compression that unsettles the car if you're greedy with throttle.
  elevation: [
    { frac: 0.42, y: -4.5, span: 0.154 },
    { frac: 0.68, y: 7.0, span: 0.132 },
  ],
};

// ============================================================================
// MAP 3 — SHINGLE COVE (white pebble beach). Tight, technical, cold-bright.
// A narrow ribbon between tide pools with a chicane through a breakwater.
// ============================================================================
TRACKS.shingle = {
    hazardSpec: [
      { kind: "oil",  frac: 0.22, lat: 0.0, r: 5 },          // wet stone after the tide
      { kind: "oil",  frac: 0.66, lat: 0.5, r: 5 },
      { kind: "crab", frac: 0.35, lat: -0.55, r: 2.5 },      // crabs, right where you brake
      { kind: "crab", frac: 0.50, lat: 0.5, r: 2.5 },
      { kind: "crab", frac: 0.85, lat: 0.0, r: 2.5 },
    ],
  id: "shingle",
  name: "Shingle Cove",
  minPlayers: 1, maxPlayers: 4, laps: 3, width: 10, subdiv: 30,
  theme: "shingle",
  points: [
    { x: -140, z: -80 }, { x: -60, z: -104 }, { x: 30, z: -96 },
    { x: 74, z: -50 },   { x: 60, z: -6 },    { x: 96, z: 30 },
    { x: 150, z: 40 },   { x: 176, z: 92 },   { x: 120, z: 128 },
    { x: 40, z: 120 },   { x: -20, z: 86 },   { x: -84, z: 100 },
    { x: -140, z: 64 },  { x: -164, z: 0 },
  ],
  checkpointFracs: [0.25, 0.5, 0.75],
  decor: [
    { kind: "lighthouse", x: 10, z: 10, r: 8, h: 40 },
    { kind: "tidepool", x: -70, z: -20, r: 16, h: 0 },
    { kind: "tidepool", x: 110, z: 76, r: 14, h: 0 },
  ],
  elevation: [
    { frac: 0.30, y: 5.0, span: 0.110 },   // over the breakwater
    { frac: 0.78, y: 3.5, span: 0.110 },
  ],
};

// ============================================================================
// MAP 4 — ROSE LAGOON PIER (the dangerous one). The TRACK IS A DOCK over pink
// water. No rails, anywhere. Leave the boards and you go in the drink and get
// fished out at the last plank you touched. Narrow, exposed, unforgiving.
// ============================================================================
TRACKS.pier = {
    // On a dock with NO RAILS the hazard writes itself: waves break over the
    // boards and SHOVE you sideways. Anywhere else that's an inconvenience.
    // Here it puts you in the pink sea.
    hazardSpec: [
      { kind: "wave", frac: 0.12, lat: 0.0, r: 4, force: 4.5, side: 1 },
      { kind: "wave", frac: 0.38, lat: 0.0, r: 4, force: 4.5, side: -1 },
      { kind: "wave", frac: 0.62, lat: 0.0, r: 4, force: 5.5, side: 1 },
      { kind: "wave", frac: 0.86, lat: 0.0, r: 4, force: 5.5, side: -1 },
    ],
  id: "pier",
  name: "Rose Lagoon Pier",
  minPlayers: 1, maxPlayers: 4, laps: 3, width: 9, subdiv: 30,
  theme: "pier",
  noRails: true,          // <- the whole point: nothing catches you out here
  drownOffTrack: true,    // <- off the boards = in the water = respawn
  points: [
    { x: -150, z: -60 }, { x: -70, z: -92 }, { x: 20, z: -84 },
    { x: 96, z: -44 },   { x: 128, z: 20 },  { x: 92, z: 84 },
    { x: 20, z: 110 },   { x: -60, z: 96 },  { x: -128, z: 52 },
    { x: -156, z: -4 },
  ],
  checkpointFracs: [0.25, 0.5, 0.75],
  decor: [
    { kind: "pierlamp", x: 0, z: 0, r: 3, h: 14 },
    { kind: "buoy", x: -40, z: 30, r: 4, h: 3 },
    { kind: "buoy", x: 60, z: -20, r: 4, h: 3 },
  ],
  elevation: [],   // flat boards; the danger is lateral, not vertical
};

// ============================================================================
// MAP 5 — VOLCANO BEACH. Black volcanic sand, still-warm lava flows, and the
// cone smoking in the middle of the infield. The only track where the ground
// itself is trying to kill you: cooled lava crust cracks under a kart, and the
// vents throw ash across the road.
//
// Still sand — just sand that used to be a mountain.
// ============================================================================
TRACKS.volcano = {
  id: "volcano",
  name: "Obsidian Shore",
  minPlayers: 1, maxPlayers: 4, laps: 3, width: 11, subdiv: 28,
  theme: "volcano",
  points: [
    { x: -180, z: -70 }, { x: -80, z: -120 }, { x: 30, z: -130 },
    { x: 120, z: -100 }, { x: 176, z: -40 }, { x: 190, z: 40 },
    { x: 140, z: 108 },  { x: 60, z: 140 },  { x: -40, z: 132 },
    { x: -110, z: 96 },  { x: -100, z: 30 }, { x: -150, z: -10 },
  ],
  checkpointFracs: [0.25, 0.5, 0.75],
  hazardSpec: [
    // LAVA CRACKS: glowing fissures across the road. They don't slow you, they
    // BURN you — the erosion hazard, the only one that costs you the race
    // rather than the corner.
    { kind: "lava", frac: 0.20, lat: 0.0, r: 5 },
    { kind: "lava", frac: 0.55, lat: 0.4, r: 5 },
    { kind: "lava", frac: 0.80, lat: -0.4, r: 5 },
    // ASH VENTS: they blind you, and you're doing 90.
    { kind: "ash", frac: 0.35, lat: 0.0, r: 7 },
    { kind: "ash", frac: 0.68, lat: 0.0, r: 7 },
    // and the cooled crust: soft, black, treacherous
    { kind: "quicksand", frac: 0.90, lat: 0.5, r: 6 },
  ],
  decor: [
    { kind: "volcano", x: 0, z: 0, r: 46, h: 62 },
    { kind: "lavarock", x: -140, z: 60, r: 8, h: 10 },
    { kind: "lavarock", x: 150, z: -70, r: 7, h: 9 },
    { kind: "lavarock", x: 60, z: 90, r: 6, h: 7 },
  ],
  elevation: [
    { frac: 0.30, y: 9.0, span: 0.154 },     // up the old flow
    { frac: 0.62, y: -3.5, span: 0.132 },    // down into the caldera cut
  ],
};

// ============================================================================
// MAP 6 — MOONLIT DUNES. Night. The desert under a full moon, glowing tide
// pools of bioluminescence, and dunes big enough to jump. The one track you run
// in the dark — the headlights and the glow are all you get.
// ============================================================================
TRACKS.dunes = {
  id: "dunes",
  name: "Moonlit Dunes",
  minPlayers: 1, maxPlayers: 4, laps: 3, width: 12, subdiv: 26,
  theme: "night",
  points: [
    { x: -160, z: -100 }, { x: -50, z: -140 }, { x: 60, z: -136 },
    { x: 150, z: -90 },   { x: 186, z: -10 },  { x: 160, z: 70 },
    { x: 90, z: 126 },    { x: -10, z: 146 },  { x: -100, z: 120 },
    { x: -164, z: 60 },   { x: -190, z: -20 },
  ],
  checkpointFracs: [0.25, 0.5, 0.75],
  hazardSpec: [
    // GLOWING POOLS: bioluminescent water pooled in the hollows. Beautiful, and
    // they have no grip at all.
    { kind: "oil", frac: 0.16, lat: -0.45, r: 6 },
    { kind: "oil", frac: 0.58, lat: 0.45, r: 6 },
    // SAND DRIFTS across the road
    { kind: "quicksand", frac: 0.38, lat: 0.0, r: 8 },
    { kind: "quicksand", frac: 0.78, lat: -0.5, r: 7 },
    // scorpions. At night. In the dark.
    { kind: "crab", frac: 0.28, lat: 0.5, r: 3 },
    { kind: "crab", frac: 0.68, lat: -0.5, r: 3 },
  ],
  decor: [
    { kind: "moonrock", x: 0, z: -20, r: 30, h: 34 },
    { kind: "glowpool", x: -110, z: 40, r: 18, h: 0 },
    { kind: "glowpool", x: 120, z: 30, r: 15, h: 0 },
    { kind: "cactus", x: -60, z: -60, r: 4, h: 12 },
    { kind: "cactus", x: 80, z: 70, r: 4, h: 14 },
  ],
  // THE DUNES. Three big crests — this is the jumping track.
  elevation: [
    { frac: 0.22, y: 11.0, span: 0.260 },
    { frac: 0.50, y: 13.0, span: 0.260 },
    { frac: 0.84, y: 9.0, span: 0.260 },
  ],
};

TRACKS.testloop = {
  id: "testloop",
  name: "Test Loop",
  minPlayers: 1, maxPlayers: 4, laps: 3, width: 11, subdiv: 28,
  // The original 336m circuit, kept verbatim: timing-sensitive tests run here
  // so they assert ENGINE behavior, not track length. Not player-selectable.
  points: [
    { x: 0, z: -46 }, { x: 34, z: -40 }, { x: 52, z: -18 }, { x: 48, z: 10 },
    { x: 28, z: 26 }, { x: 30, z: 44 }, { x: 12, z: 56 }, { x: -14, z: 50 },
    { x: -22, z: 30 }, { x: -46, z: 22 }, { x: -54, z: -2 }, { x: -42, z: -28 },
    { x: -20, z: -40 },
  ],
  checkpointFracs: [0.25, 0.5, 0.75],
};

export function makeTrack(id) {
  const def = TRACKS[id] || TRACKS.sandcastle;
  const t = buildTrack(def);
  // checkpoint sample indices from fractions
  t.checkpoints = def.checkpointFracs.map((f) => {
    const target = f * t.total;
    let best = 0, bd = Infinity;
    for (let i = 0; i < t.samples.length; i++) {
      const d = Math.abs(t.samples[i].s - target);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  });
  return t;
}
