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
  EDGE_MARGIN: 2.2,       // soft wall begins this far past the track edge
  BODY_RADIUS: 1.05,      // for car-vs-car separation
  BUMP_RESTITUTION: 0.35,
};

// state: { x, z, heading, speed, offTrack, sampleHint }
// input: { throttle: -1..1, steer: -1..1 }  (throttle<0 = brake/reverse)
// mods:  { speedMult=1, accelMult=1, gripMult=1 } — item effects only
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
  const i = track.nearest(state.x, state.z, state.sampleHint ?? -1);
  state.sampleHint = i;
  const lat = track.lateral(state.x, state.z, i);
  const half = track.width / 2;
  state.offTrack = Math.abs(lat) > half;
  if (state.offTrack) {
    const sandMax = CAR.MAX_SPEED * CAR.SAND_MAX_FRAC * speedMult;
    if (state.speed > sandMax) state.speed = Math.max(sandMax, state.speed - CAR.SAND_DRAG * dt);
  }

  // --- steering (speed-sensitive) ---
  const spdFrac = Math.min(1, Math.abs(state.speed) / CAR.MAX_SPEED);
  const rate = CAR.STEER_RATE * (1 - (1 - CAR.STEER_SPEED_FALLOFF) * spdFrac) * gripMult;
  // steering only bites when moving; reversing steers mirrored like a real car
  const dir = state.speed >= 0 ? 1 : -1;
  state.heading += str * rate * dt * Math.min(1, Math.abs(state.speed) / 3) * dir;

  // --- integrate ---
  state.x += Math.cos(state.heading) * state.speed * dt;
  state.z += Math.sin(state.heading) * state.speed * dt;

  // --- soft outer wall: past edge+margin, glide back toward the ribbon ---
  const i2 = track.nearest(state.x, state.z, state.sampleHint);
  state.sampleHint = i2;
  const lat2 = track.lateral(state.x, state.z, i2);
  const limit = half + CAR.EDGE_MARGIN;
  if (Math.abs(lat2) > limit) {
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
