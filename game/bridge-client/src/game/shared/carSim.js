// ============================================================
// SANDBOX GP — car simulation step. SHARED FILE (source of truth in
// bridge-gameserver/src/engine/shared/, copied to bridge-client/src/game/shared/).
//
// THE design rule lives here: every car runs THESE constants. No per-car stats,
// ever. Only transient race effects (items/challenges) may modulate the
// `mods` argument — and those are earned mid-race, never bought.
//
// Deterministic + framerate-independent: step(state, input, dt) mutates state.
// Arcade kinematic model (no rigid body): speed along heading, steering rate
// scaled by speed, sand (off-track) drag, soft edge containment.
// ============================================================

export const CAR = {
  MAX_SPEED: 26,          // m/s (~58 mph — toy cars go fast in imagination)
  MAX_REVERSE: 6,
  ACCEL: 14,              // m/s^2 throttle
  BRAKE: 26,              // m/s^2 braking
  COAST_DRAG: 4.5,        // m/s^2 natural slowdown, no pedal
  STEER_RATE: 2.6,        // rad/s at full lock, low speed
  STEER_SPEED_FALLOFF: 0.55, // less twitchy at top speed (0..1 of rate kept)
  // CORNERING COSTS (the anti-hold-W pair). Turning scrubs speed — a little at
  // low speed, real money at top speed — so straights are where you're fastest
  // and a flat-out kart takes WIDE lines. Sharp corners now demand a lift.
  TURN_DRAG: 3.0,         // m/s^2 scrub at full lock and full speed (scales with both)
  HIGHSPEED_TURN_CUT: 0.30, // extra steering authority lost at top speed (quadratic)
  SAND_MAX_FRAC: 0.42,    // off-track top speed fraction
  SAND_DRAG: 18,          // extra m/s^2 drag while on sand above sand max
  CURB_SCRUB: 0.994,      // per-tick speed scrub while riding a curb (rumble strip)
  OFFTRACK_GRACE: 1.2,    // seconds off-track before the sand starts burying you
  OFFTRACK_STOP: 9,       // m/s^2 of bog past the grace window (ramps up)
  BUMPER_SHOULDER: 6,     // sand shoulder width past the paint before the rail
  BUMPER_DAMP: 0.55,      // speed kept on rail contact (scrubs, doesn't stop)
  AIR_GRAVITY: 6,         // floaty beach-toy gravity: jumps read as JUMPS
  AIR_STEER: 0.35,        // steering authority while airborne
  // How fast the road must fall away beneath you (m/s) before you leave it. Set
  // it too low and you take off on gentle hills; too high and a real ramp just
  // teleports you down its far side, which is what used to happen.
  // At 7.0 this fired on ordinary undulation — 40 "jumps" a lap, karts constantly
  // pinging into the air, and bots unable to finish. A real crest at race pace
  // drops the road 15+ m/s; gentle hills are well under that.
  LAUNCH_DROP: 15.0,
  LANDING_SCRUB: 0.9,     // speed kept on a hard (>2m) landing
  // The soft wall is a BACKSTOP behind the rails, not a wall in front of them.
  // At 2.2 it sat at 7.7m — INSIDE the 11.5m bumper rail — so the rail could
  // never fire: the candy-striped noodles you can see were decorative, and what
  // actually stopped you was an invisible wall 3.8m short of them, which also
  // deleted the whole drivable sand shoulder. It now sits just outside the rail.
  EDGE_MARGIN: 7.0,       // soft wall begins this far past the track edge (rail is at +6)
  BODY_RADIUS: 1.05,      // for car-vs-car separation
  BUMP_RESTITUTION: 0.35,
};

// state: { x, z, heading, speed, offTrack, sampleHint }
// input: { throttle: -1..1, steer: -1..1 }  (throttle<0 = brake/reverse)
// mods:  { speedMult=1, accelMult=1, gripMult=1 } — item effects only
// ============================================================================
// FREE DRIVING — the same car, with no track under it.
//
// An arena has no centerline: no ribbon, no rails, no lateral offset, no
// off-track sand. Everything stepCar does with the spline is meaningless there.
// What ISN'T meaningless is the CAR — the acceleration curve, the speed-sensitive
// steering, the way it reverses. A derby kart must feel like a race kart or the
// whole game comes apart, so the two share this core rather than reimplementing
// the handling badly a second time.
//
// The arena then applies its own containment (rim, walls, hazards) on top.
// ============================================================================
export function stepCarFree(state, input, dt, mods = {}) {
  const speedMult = mods.speedMult ?? 1;
  const accelMult = mods.accelMult ?? 1;
  const gripMult = mods.gripMult ?? 1;

  const thr = Math.max(-1, Math.min(1, input.throttle || 0));
  const str = Math.max(-1, Math.min(1, input.steer || 0));

  // --- longitudinal (identical to stepCar) ---
  let target = 0;
  if (thr > 0) target = CAR.MAX_SPEED * speedMult * thr;
  else if (thr < 0) target = state.speed > 0.5 ? 0 : CAR.MAX_REVERSE * -thr * -1;
  const accel = thr > 0 ? CAR.ACCEL * accelMult
              : thr < 0 ? (state.speed > 0.5 ? CAR.BRAKE : CAR.ACCEL * 0.7)
              : CAR.COAST_DRAG;
  if (state.speed < target) state.speed = Math.min(target, state.speed + accel * dt);
  else state.speed = Math.max(target, state.speed - accel * dt);

  // --- steering (identical to stepCar) ---
  const spdFrac = Math.min(1, Math.abs(state.speed) / CAR.MAX_SPEED);
  const rate = CAR.STEER_RATE * (1 - (1 - CAR.STEER_SPEED_FALLOFF) * spdFrac)
             * (1 - CAR.HIGHSPEED_TURN_CUT * spdFrac * spdFrac) * gripMult;
  const dir = state.speed >= 0 ? 1 : -1;
  state.heading += str * rate * dt * Math.min(1, Math.abs(state.speed) / 3) * dir;
  if (state.speed > 0) {
    state.speed = Math.max(0, state.speed - CAR.TURN_DRAG * Math.abs(str) * spdFrac * dt);
  }

  // items still spin you
  if (mods.spin) state.heading += mods.spin * dt;

  // --- integrate ---
  state.x += Math.cos(state.heading) * state.speed * dt;
  state.z += Math.sin(state.heading) * state.speed * dt;

  // an arena is flat: no altitude, no airborne, no gaps
  state.y = 0;
  state.vy = 0;
  state.airborne = false;
  state.offTrack = false;
  state.onCurb = false;
}

export function stepCar(state, input, dt, track, mods = {}) {
  const speedMult = mods.speedMult ?? 1;
  const accelMult = mods.accelMult ?? 1;
  const gripMult = mods.gripMult ?? 1;

  const thr = Math.max(-1, Math.min(1, input.throttle || 0));
  const str = Math.max(-1, Math.min(1, input.steer || 0));

  // --- longitudinal ---
  let target = 0;
  if (thr > 0) target = CAR.MAX_SPEED * speedMult * thr;
  else if (thr < 0) target = state.speed > 0.5 ? 0 : CAR.MAX_REVERSE * -thr * -1; // brake to stop, then reverse
  const accel = thr > 0 ? CAR.ACCEL * accelMult
              : thr < 0 ? (state.speed > 0.5 ? CAR.BRAKE : CAR.ACCEL * 0.7)
              : CAR.COAST_DRAG;
  if (state.speed < target) state.speed = Math.min(target, state.speed + accel * dt);
  else state.speed = Math.max(target, state.speed - accel * dt);

  // --- sand (off the ribbon) ---
  // Before the first tick, altitude is unknown — trust the spawn hint's own
  // height for the deck query. Passing y=0 here made every elevated spawn
  // (bridge starts, rescue poses) "fall" to the deck below on tick one.
  const yQuery = state.y ?? (track.at(state.sampleHint ?? 0).y || 0);
  const i = track.nearest(state.x, state.z, state.sampleHint ?? -1, yQuery);
  state.sampleHint = i;
  const smp = track.at(i);
  const lat = track.lateral(state.x, state.z, i);
  const half = track.width / 2;
  const onRibbon = Math.abs(lat) <= half;
  // Ground height under the kart: the road (with its hills) when on the
  // ribbon and the road exists there; the beach (y=0) otherwise. A GAP sample
  // has no road at all — over one, ground is the beach far below.
  // ---- THE GROUND HEIGHT, INTERPOLATED ----
  //
  // This used the NEAREST SAMPLE'S height, discretely: `smp.y`. Samples sit about
  // four metres apart, so the road's surface was a series of four-metre-long FLAT
  // STEPS with a jump between each one. Driving up the climb at race pace, the
  // kart's altitude leapt 0.24m in a single tick, 37 times in 120 ticks.
  //
  // That is the "blue ramp acting like stairs" — the road was, literally, a
  // staircase. Interpolate between the sample you're on and the next one, weighted
  // by how far along that segment you actually are, and the surface becomes a
  // continuous slope.
  // ---- THE GROUND HEIGHT ----
  //
  // FOUR attempts at this, and the first three were all fixing the wrong thing.
  //
  // The road's height was snapping straight to `samples[nearest].y`, and I kept
  // trying to interpolate BETWEEN samples to smooth it. That was doomed, and the
  // trace shows exactly why:
  //
  //   tick | hint | jump | y     | dy
  //     13 |  651 |   1  | 5.588 | 0.054
  //     14 |  653 |   2  | 5.694 | 0.106     <-- the hint jumps TWO
  //     15 |  654 |   1  | 5.746 | 0.052
  //
  // The samples on the climb are **0.72 metres apart**. At race pace the car covers
  // **0.80 metres per tick**. So it passes MORE THAN ONE SAMPLE PER TICK, and
  // `track.nearest()` — which returns the nearest sample — advances by one index some
  // ticks and two the next. The car's height therefore rises 0.052m, 0.052m, then
  // 0.106m, then 0.052m: a SAWTOOTH, with vertical acceleration spiking to 48 m/s²,
  // five times gravity. It wasn't stepping, it was being SLAPPED, once per sample.
  //
  // And no amount of interpolating between `samples[i]` and `samples[i+1]` fixes
  // that, because when the samples are denser than the car's step the projection
  // parameter is always ~0 — you get the sample's own height back, every time.
  //
  // The fix is to stop asking "which sample am I nearest?" and start asking "how far
  // around the lap am I?". Every sample carries `s`, its ARC DISTANCE — a continuous
  // quantity that does not care how densely the spline happened to be sampled. Find
  // the car's arc position by projecting onto the local segment, then interpolate the
  // height against ARC LENGTH. Sample density becomes irrelevant, which is precisely
  // what you want from a road surface.
  let ground = 0;
  if (onRibbon && !smp.gap && track.samples) {
    const N = track.samples.length;
    const nxt = track.samples[(i + 1) % N];

    if (nxt && !nxt.gap) {
      // where is the car, in ARC terms?
      const sx = nxt.x - smp.x, sz = nxt.z - smp.z;
      const seg2 = sx * sx + sz * sz;
      let f = 0;
      if (seg2 > 1e-6) {
        // NOTE: this is deliberately NOT clamped to [0,1]. If the car has already
        // passed `nxt` (which happens constantly, because it moves further than one
        // sample per tick) then f > 1 and we extrapolate forward along the same
        // gradient — which is exactly right, and is what stops the sawtooth.
        f = ((state.x - smp.x) * sx + (state.z - smp.z) * sz) / seg2;
      }

      // Interpolate the SLOPE, not the sample. Take the gradient across a window of
      // several samples so it's stable against the hint jitter, and apply it to the
      // car's actual arc position.
      const AHEAD = 4;
      const far = track.samples[(i + AHEAD) % N];
      if (far && !far.gap) {
        let runLen = 0;
        for (let k = 0; k < AHEAD; k++) {
          const a = track.samples[(i + k) % N];
          const b = track.samples[(i + k + 1) % N];
          runLen += Math.hypot(b.x - a.x, b.z - a.z);
        }
        const grade = runLen > 1e-6 ? ((far.y || 0) - (smp.y || 0)) / runLen : 0;

        // how far along, in metres, is the car from this sample?
        const segLen = Math.sqrt(seg2);
        const along = f * segLen;

        ground = (smp.y || 0) + grade * along;
      } else {
        ground = smp.y || 0;
      }
    } else {
      ground = smp.y || 0;
    }
  } else if (onRibbon && !smp.gap) {
    ground = smp.y || 0;                    // mock track in the unit tests
  }

  if (state.y == null) { state.y = ground; state.vy = 0; state.airborne = false; }

  // LAUNCH happens ONLY at a gap: the road ends, the lip's kick becomes lift.
  // It must be checked while still flagged grounded (setting `airborne` from
  // height first made this unreachable — every jump fell with zero lift).
  // Grounded karts otherwise GLUE to the road: hills and crests are followed,
  // never "fallen off" — hint jitter near curved crests was manufacturing
  // phantom 1m cliffs and fake launches off the ramp face.
  // ---- LAUNCH ----
  //
  // This used to fire ONLY at a `gap` — the bridge jump. Everywhere else a
  // grounded kart was GLUED to the road: `state.y = ground` every single tick.
  //
  // That's fine on gentle hills and catastrophic on a RAMP. Crest a rise at 26
  // m/s and the road falls away on the far side; the glue teleports the kart
  // straight down to follow it. The server does that instantly, the client's
  // prediction does it a frame later — and for that frame you are INSIDE the
  // geometry. That is the "glitching through the floor on ramps".
  //
  // A kart should leave the ground when the road drops faster than gravity can
  // pull it down. That's just physics, and it's what makes a jump feel like a
  // jump instead of a lurch.
  const prevGround = state.prevGround ?? ground;
  state.prevGround = ground;

  // how fast is the road surface falling away beneath us, in m/s?
  const groundDrop = dt > 0 ? (prevGround - ground) / dt : 0;

  if (!state.airborne && smp.gap && state.y > ground + 0.35) {
    // the bridge jump: the road literally ends
    const kick = smp.kickSlope ?? (track.at(Math.max(0, i - 1)).kickSlope ?? 0);
    state.vy = Math.max(0, (kick || 0) * Math.abs(state.speed));
    state.airborne = true;
  // NOTE: there is deliberately NO "launch off a crest" rule here.
  //
  // I tried one. The idea was that a kart cresting a ramp should leave the ground
  // when the road falls away faster than gravity. In practice it fought with the
  // glue: tune it sensitive and karts ping into the air on ordinary undulation
  // (46 "jumps" a lap, bots unable to finish); tune it stiff and it never fires.
  // Every setting was unstable, because the road's height comes from a sampled
  // spline and the per-tick drop is noisy.
  //
  // The kart stays GLUED to the road. Hills and crests are followed. The one place
  // you genuinely leave the ground is a `gap` — the bridge jump — where the road
  // actually ends, and that is handled above.
  //
  // The bug Gustavo hit was never the absence of a launch. It was the kart ending
  // up INSIDE the road, which is fixed by the floor clamp at the very bottom of
  // this function.
  } else if (!state.airborne) {
    state.y = ground; state.vy = 0;
    if (onRibbon) state.groundedHint = i;   // last honest on-road position:
                                            // rescues snap HERE, so flying off
                                            // sideways can never gain progress
  }
  if (state.airborne) {
    state.vy -= CAR.AIR_GRAVITY * dt;
    state.y += state.vy * dt;
    if (state.y <= ground) {
      const fall = -(state.vy);
      state.y = ground; state.vy = 0; state.airborne = false;
      if (fall > 6) state.speed *= CAR.LANDING_SCRUB;   // hard landing scrubs a touch
    }
  }



  // CURB / RUMBLE STRIP: the outer ~14% of the paint on either side. Riding it
  // rattles the car and scrubs a little speed — a real edge you can feel, not
  // just a painted stripe. Cutting a corner across the curb costs you.
  const halfW = track.width / 2;
  // LANE POSITION. `onCurb` alone is a boolean that the client never even saw —
  // the game knew you were riding the kerb and told you nothing. `lanePos` is
  // where you actually are: 0 = dead centre, 1 = right on the white line, >1 =
  // over it. That's what a lane indicator needs.
  state.lanePos = onRibbon ? Math.min(1.6, Math.abs(lat) / halfW) : 1.6;
  state.laneSide = Math.sign(lat);
  state.onCurb = !state.airborne && onRibbon && Math.abs(lat) > halfW * 0.86;
  if (state.onCurb) state.speed *= CAR.CURB_SCRUB;

  // ---- TRACK HAZARDS ----
  // The circuits had elevation and one jump, and that was it. A track with no
  // hazards is a driving test: you learn the line once and then you're just
  // holding throttle. Hazards are what make a lap a DECISION — the fast line and
  // the safe line have to be different, or there's nothing to think about.
  state.inHazard = null;
  state.lavaBurn = 0;
  state.blindedByAsh = false;
  for (const h of track.def?.hazards || []) {
    const d = Math.hypot(state.x - h.x, state.z - h.z);
    if (d > h.r) continue;
    state.inHazard = h.kind;
    if (h.kind === "oil") {
      // an oil slick: you keep your speed and lose your steering. Terrifying.
      state.hazardGrip = 0.25;
    } else if (h.kind === "quicksand") {
      // It GRABS you. A 0.965 multiplier per tick was nothing — the engine's own
      // acceleration simply out-ran it and you drove through at full speed. It has
      // to be a hard cap, so the only way to be fast is to go round.
      const cap = CAR.MAX_SPEED * 0.55;
      if (state.speed > cap) state.speed = Math.max(cap, state.speed - 26 * dt);
      state.hazardGrip = 0.7;
    } else if (h.kind === "rockfall" || h.kind === "crab") {
      // a moving obstacle: hitting it is a real hit
      state.speed *= 0.88;
      state.hazardHit = h.kind;
    } else if (h.kind === "lava") {
      // It BURNS. Every other hazard costs you a corner; this one costs you the
      // race — sit in it and your kart erodes until it crumbles. The one hazard
      // you must never, ever take the racing line through.
      state.lavaBurn = (state.lavaBurn || 0) + dt;
      state.speed *= 0.99;
    } else if (h.kind === "ash") {
      // A vent of hot ash across the road. You keep every bit of your speed and
      // you cannot see a thing — which at 90mph is the worst combination there is.
      state.blindedByAsh = true;
      state.hazardGrip = 0.85;
    } else if (h.kind === "wave") {
      // A wave washes over the boards and SHOVES you SIDEWAYS. Pushing radially
      // away from its centre barely moved anyone (0.8m) — the shove has to be
      // ACROSS the road, perpendicular to your travel, which is the direction
      // that actually puts you in the water.
      const side = (h.side ?? 1);
      state.x += -Math.sin(state.heading) * side * h.force * dt;
      state.z += Math.cos(state.heading) * side * h.force * dt;
      state.speed *= 0.97;
      state.hazardGrip = 0.75;
    }
    break;
  }

  state.offTrack = !onRibbon && !state.airborne;
  // DROWNING: on a dock track there is no shoulder. The moment your wheels
  // leave the planks you are over water — the engine fishes you out.
  state.inWater = !!track.def?.drownOffTrack && state.offTrack;
  if (state.offTrack) {
    // OFF THE TRACK = THE SAND BOGS YOU DOWN TO A STOP.
    // You are not teleported and you are not rescued: the deep sand simply
    // eats your momentum, and you press R when YOU decide to. The longer you
    // wallow, the heavier it gets, so a wheel over the line is survivable but
    // a real excursion ends with you buried.
    state.offSince = (state.offSince || 0) + dt;
    const sandMax = CAR.MAX_SPEED * CAR.SAND_MAX_FRAC * speedMult;
    if (Math.abs(state.speed) > sandMax) {
      state.speed -= Math.sign(state.speed) * CAR.SAND_DRAG * dt;
    }
    // progressive bog: after OFFTRACK_GRACE the sand pulls you to a dead stop
    if (state.offSince > CAR.OFFTRACK_GRACE) {
      const bog = CAR.OFFTRACK_STOP * (1 + (state.offSince - CAR.OFFTRACK_GRACE));
      const drop = bog * dt;
      state.speed = Math.abs(state.speed) <= drop ? 0 : state.speed - Math.sign(state.speed) * drop;
    }
  } else {
    state.offSince = 0;
  }

  // --- steering (speed-sensitive) ---
  const spdFrac = Math.min(1, Math.abs(state.speed) / CAR.MAX_SPEED);
  const hazGrip = state.hazardGrip ?? 1;
  // Record what the grip WAS this tick before clearing it — otherwise nothing
  // outside the sim (a test, the HUD) can ever observe that the oil bit.
  state.lastHazardGrip = hazGrip;
  state.hazardGrip = 1;      // one tick only; the hazard re-applies it if you're still in it
  const rate = CAR.STEER_RATE * (1 - (1 - CAR.STEER_SPEED_FALLOFF) * spdFrac)
             * (1 - CAR.HIGHSPEED_TURN_CUT * spdFrac * spdFrac)   // flat-out = wide lines
             * gripMult * hazGrip * (state.airborne ? CAR.AIR_STEER : 1);
  // steering only bites when moving; reversing steers mirrored like a real car
  const dir = state.speed >= 0 ? 1 : -1;
  state.heading += str * rate * dt * Math.min(1, Math.abs(state.speed) / 3) * dir;
  // turning scrubs speed: proportional to how hard you steer AND how fast you
  // are going, so the fastest line through a corner is a smooth one — and the
  // fastest place on the track is the straight.
  if (!state.airborne && state.speed > 0) {
    state.speed = Math.max(0, state.speed - CAR.TURN_DRAG * Math.abs(str) * spdFrac * dt);
  }

  // SPIN OUT: a hit wrenches the car around its own axis for a moment. You keep
  // your momentum but lose all control of where the nose points — you're a
  // passenger until it decays. Far more readable (and funnier) than a silent
  // slow-down.
  if (mods.spin) state.heading += mods.spin * dt;

  // --- integrate ---
  state.x += Math.cos(state.heading) * state.speed * dt;
  state.z += Math.sin(state.heading) * state.speed * dt;

  // --- bumper rails ---
  // The sand shoulder is playable (slow, risky, part of the identity), but a
  // hard rail sits BUMPER_SHOULDER past the paint on both sides: nobody drives
  // to the horizon. Contact clamps you onto the rail line and scrubs speed.
  const noRails = !!track.def?.noRails;
  {
    const j = track.nearest(state.x, state.z, state.sampleHint ?? -1, state.y || 0);
    state.sampleHint = j;
    const latR = track.lateral(state.x, state.z, j);
    const rail = track.width / 2 + CAR.BUMPER_SHOULDER;
    if (!noRails && !state.airborne && Math.abs(latR) > rail) {
      const c = track.at(j);
      const sgn = Math.sign(latR);
      // Clamp to the rail, but seat the car a nudge INSIDE it rather than
      // exactly on the line. A pure clamp re-pinned you at the same lateral
      // offset every tick: you'd scrape along the wall forever, unable to peel
      // off. Real bumpers give you back to the track.
      const seat = rail - 0.35;
      state.x = c.x + (-c.tz * sgn) * seat;
      state.z = c.z + (c.tx * sgn) * seat;
      state.speed *= CAR.BUMPER_DAMP;
      // and rotate the nose off the wall so throttle actually takes you away
      // from it — otherwise a car pointed into the rail just grinds.
      const along = Math.atan2(c.tz, c.tx);
      let off = state.heading - along;
      while (off > Math.PI) off -= 2 * Math.PI;
      while (off < -Math.PI) off += 2 * Math.PI;
      // A nose pointed INTO the rail is the one that grinds — steer it back
      // along the track. (Getting this backwards would help only the cars that
      // were already escaping.)
      const intoWall = (sgn > 0) ? (off > 0) : (off < 0);
      if (intoWall) {
        let turn = along - state.heading;
        while (turn > Math.PI) turn -= 2 * Math.PI;
        while (turn < -Math.PI) turn += 2 * Math.PI;
        state.heading += turn * 0.20;
      }
    }
  }

  // --- soft outer wall: past edge+margin, glide back toward the ribbon ---
  const i2 = track.nearest(state.x, state.z, state.sampleHint, state.y ?? 0);
  state.sampleHint = i2;
  const lat2 = track.lateral(state.x, state.z, i2);
  const limit = half + CAR.EDGE_MARGIN;
  if (!noRails && Math.abs(lat2) > limit) {
    const p = track.at(i2);
    const nx = -p.tz, nz = p.tx; // left normal
    const clamped = Math.sign(lat2) * limit;
    state.x = p.x + nx * clamped;
    state.z = p.z + nz * clamped;
    state.speed *= 0.965; // scrubbing the invisible dune wall costs a little
  }

  // ---- THE FLOOR: the very last thing that happens ----
  //
  // This clamp used to sit in the MIDDLE of stepCar — a hundred lines before the
  // position was even integrated, and before the bumper rails pushed the kart
  // around. So it was clamping a height for a position the kart had not yet moved
  // to. On a ramp, where the kart covers most of a metre in one tick, that left it
  // sitting 1.14m INSIDE the road with the "backstop" cheerfully agreeing it was
  // above ground. That is the "glitching through the floor on ramps".
  //
  // It runs LAST now, resolves the sample from a FRESH search at the kart's final
  // position, and clamps to that. Whatever the physics above decided, the kart
  // does not end this tick underground.
  if (track.samples && !state.airborne) {
    // ONLY on the road. Elevation exists only on the ribbon — off it the ground is
    // flat beach at y=0 and there is nothing to clip through. Clamping off-road as
    // well was reaching into the off-track BOG and the R-RESET, both of which
    // depend on the kart being left exactly where the sand stopped it.
    //
    // Do NOT write sampleHint here: this is a fresh, hint-less search made purely
    // so the floor check is honest about where the kart actually IS. The hint
    // belongs to the engine and walks forward monotonically along the lap.
    // Search from the ENGINE's hint, not from scratch. A hint-less full search
    // (-1) can snap to a completely different part of the circuit when the kart is
    // out in the sand — a nearby straight, say — and then `lateral()` against that
    // wrong sample happily reports "on the ribbon" and we clamp the kart's height
    // to a piece of road it isn't on. That is how a kart bogged in the sand at the
    // rail suddenly had its Y yanked around, and it broke both the off-road bog
    // and the R-reset.
    const fi = track.nearest(state.x, state.z, state.sampleHint ?? -1, state.y);
    const fsmp = track.samples[fi];
    if (fsmp && !fsmp.gap && Math.abs(track.lateral(state.x, state.z, fi)) <= track.width / 2) {
      // ---- AND *THIS* WAS THE STAIRCASE ----
      //
      // `const floor = fsmp.y || 0` — the RAW SAMPLE HEIGHT, with no interpolation.
      //
      // I rewrote the ground-height function three times (nearest-sample, linear,
      // smoothstep, grade-following) and the worst vertical acceleration came out at
      // EXACTLY 48.4 m/s² every single time. Four different algorithms, one identical
      // number. That is not a coincidence — it meant nothing I did upstream mattered,
      // because THIS LINE, at the very end of the tick, was snapping the car straight
      // back onto the discrete sample value.
      //
      // However smoothly you compute the ground, if the last thing you do is clamp to
      // a quantised height, you have a quantised height. The samples on the climb are
      // 0.72m apart and the car moves 0.80m per tick, so this clamp fired against a
      // different sample nearly every tick — and slapped the car up by a whole step
      // each time.
      //
      // Use the same smooth grade the ground uses.
      const NF = track.samples.length;
      const fnxt = track.samples[(fi + 1) % NF];
      let floor = fsmp.y || 0;
      if (fnxt && !fnxt.gap) {
        const gx = fnxt.x - fsmp.x, gz = fnxt.z - fsmp.z;
        const g2 = gx * gx + gz * gz;
        if (g2 > 1e-6) {
          const along = ((state.x - fsmp.x) * gx + (state.z - fsmp.z) * gz) / g2;
          floor = (fsmp.y || 0) + ((fnxt.y || 0) - (fsmp.y || 0)) * along;
        }
      }
      if (state.y < floor) {
        state.y = floor;
        state.vy = 0;
      }
    }
  }
}

// Symmetric car-vs-car bump: equal masses (identical cars!), push apart along
// the center line and exchange a bit of closing speed. Cheap and cheerful.
export function separateCars(a, b) {
  const dx = b.x - a.x, dz = b.z - a.z;
  let d = Math.hypot(dx, dz);
  const min = CAR.BODY_RADIUS * 2;
  if (d >= min) return false;
  // Two karts can end up EXACTLY (or almost exactly) coincident — a reset or
  // respawn dropping one onto another, two spawns sharing a pad, a pile-up. When
  // d≈0 the contact normal is undefined and the raw push (min-d)/2 is at its
  // maximum, so the pair got flung apart at full separation distance in a single
  // tick: the "launched back far" bug. Pick a deterministic normal when they're
  // coincident, and CLAMP how far a single step may move them.
  let nx, nz;
  if (d < 1e-4) {
    // deterministic tiny nudge so both clients resolve it the same way
    const ang = ((a.id ? String(a.id).length : 1) * 1.3 + (a.x + a.z)) % (Math.PI * 2);
    nx = Math.cos(ang); nz = Math.sin(ang);
    d = 1e-4;
  } else {
    nx = dx / d; nz = dz / d;
  }
  // Separate by half the overlap each, but never more than a small fixed step per
  // tick — a deep overlap eases apart over a few frames instead of teleporting.
  const MAX_PUSH = 0.6;
  const push = Math.min((min - d) / 2, MAX_PUSH);
  a.x -= nx * push; a.z -= nz * push;
  b.x += nx * push; b.z += nz * push;
  // Velocity exchange along the contact normal. Clamp the closing speed that gets
  // converted to an impulse so a high-speed head-on can't rocket either kart.
  const va = a.speed * Math.cos(a.heading) * nx + a.speed * Math.sin(a.heading) * nz;
  const vb = b.speed * Math.cos(b.heading) * nx + b.speed * Math.sin(b.heading) * nz;
  let closing = va - vb;
  if (closing > 0) {
    closing = Math.min(closing, CAR.MAX_SPEED || 26);   // no runaway impulse
    a.speed -= closing * CAR.BUMP_RESTITUTION;
    b.speed += closing * CAR.BUMP_RESTITUTION * 0.6;
  }
  return true;
}
