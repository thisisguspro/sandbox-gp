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
  SAND_MAX_FRAC: 0.42,    // off-track top speed fraction
  SAND_DRAG: 18,          // extra m/s^2 drag while on sand above sand max
  CURB_SCRUB: 0.994,      // per-tick speed scrub while riding a curb (rumble strip)
  OFFTRACK_GRACE: 1.2,    // seconds off-track before the sand starts burying you
  OFFTRACK_STOP: 9,       // m/s^2 of bog past the grace window (ramps up)
  BUMPER_SHOULDER: 6,     // sand shoulder width past the paint before the rail
  BUMPER_DAMP: 0.55,      // speed kept on rail contact (scrubs, doesn't stop)
  AIR_GRAVITY: 6,         // floaty beach-toy gravity: jumps read as JUMPS
  AIR_STEER: 0.35,        // steering authority while airborne
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
  const rate = CAR.STEER_RATE * (1 - (1 - CAR.STEER_SPEED_FALLOFF) * spdFrac) * gripMult;
  const dir = state.speed >= 0 ? 1 : -1;
  state.heading += str * rate * dt * Math.min(1, Math.abs(state.speed) / 3) * dir;

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
  const ground = onRibbon && !smp.gap ? (smp.y || 0) : 0;
  if (state.y == null) { state.y = ground; state.vy = 0; state.airborne = false; }

  // LAUNCH happens ONLY at a gap: the road ends, the lip's kick becomes lift.
  // It must be checked while still flagged grounded (setting `airborne` from
  // height first made this unreachable — every jump fell with zero lift).
  // Grounded karts otherwise GLUE to the road: hills and crests are followed,
  // never "fallen off" — hint jitter near curved crests was manufacturing
  // phantom 1m cliffs and fake launches off the ramp face.
  if (!state.airborne && smp.gap && state.y > ground + 0.35) {
    const kick = smp.kickSlope ?? (track.at(Math.max(0, i - 1)).kickSlope ?? 0);
    state.vy = Math.max(0, (kick || 0) * Math.abs(state.speed));
    state.airborne = true;
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
  const rate = CAR.STEER_RATE * (1 - (1 - CAR.STEER_SPEED_FALLOFF) * spdFrac) * gripMult * hazGrip * (state.airborne ? CAR.AIR_STEER : 1);
  // steering only bites when moving; reversing steers mirrored like a real car
  const dir = state.speed >= 0 ? 1 : -1;
  state.heading += str * rate * dt * Math.min(1, Math.abs(state.speed) / 3) * dir;

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
}

// Symmetric car-vs-car bump: equal masses (identical cars!), push apart along
// the center line and exchange a bit of closing speed. Cheap and cheerful.
export function separateCars(a, b) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const d = Math.hypot(dx, dz);
  const min = CAR.BODY_RADIUS * 2;
  if (d >= min || d === 0) return false;
  const nx = dx / d, nz = dz / d;
  const push = (min - d) / 2;
  a.x -= nx * push; a.z -= nz * push;
  b.x += nx * push; b.z += nz * push;
  const va = a.speed * Math.cos(a.heading) * nx + a.speed * Math.sin(a.heading) * nz;
  const vb = b.speed * Math.cos(b.heading) * nx + b.speed * Math.sin(b.heading) * nz;
  const closing = va - vb;
  if (closing > 0) {
    a.speed -= closing * CAR.BUMP_RESTITUTION;
    b.speed += closing * CAR.BUMP_RESTITUTION * 0.6;
  }
  return true;
}
