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

// Catmull-Rom point for segment p0..p3 at t in [0,1]
function cr(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return {
    x: 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
    z: 0.5 * ((2 * p1.z) + (-p0.z + p2.z) * t + (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * t2 + (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * t3),
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
  // arc lengths + tangents
  let total = 0;
  for (let i = 0; i < samples.length; i++) {
    const a = samples[i], b = samples[(i + 1) % samples.length];
    a.s = total;
    const dx = b.x - a.x, dz = b.z - a.z;
    const len = Math.hypot(dx, dz) || 1e-6;
    a.tx = dx / len; a.tz = dz / len;
    total += len;
  }
  const width = def.width;

  // Nearest sample to a position; `hint` = last known index for O(1) tracking.
  function nearest(x, z, hint = -1) {
    let best = -1, bd = Infinity;
    if (hint >= 0) {
      // local window search around the hint (covers ~2 segments of movement/tick)
      const W = 40;
      for (let k = -W; k <= W; k++) {
        const i = (hint + k + samples.length) % samples.length;
        const d = (samples[i].x - x) ** 2 + (samples[i].z - z) ** 2;
        if (d < bd) { bd = d; best = i; }
      }
      // Trust the local result while it's clearly on/near the track; otherwise
      // fall through to a global scan (teleports, resets).
      if (Math.sqrt(bd) < width * 2) return best;
    }
    bd = Infinity; best = -1;
    for (let i = 0; i < samples.length; i++) {
      const d = (samples[i].x - x) ** 2 + (samples[i].z - z) ** 2;
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
      return { x: p.x, z: p.z, heading: Math.atan2(p.tz, p.tx) };
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
      return { x: p.x + (-p.tz) * side, z: p.z + (p.tx) * side, heading: Math.atan2(p.tz, p.tx) };
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
    id: "sandcastle",
    name: "Sandcastle Circuit",
    minPlayers: 1,
    maxPlayers: 4,
    laps: 3,
    width: 11,
    subdiv: 28,
    points: [
      { x: 0, z: -46 }, { x: 34, z: -40 }, { x: 52, z: -18 }, { x: 48, z: 10 },
      { x: 28, z: 26 }, { x: 30, z: 44 }, { x: 12, z: 56 }, { x: -14, z: 50 },
      { x: -22, z: 30 }, { x: -46, z: 22 }, { x: -54, z: -2 }, { x: -42, z: -28 },
      { x: -20, z: -40 },
    ],
    checkpointFracs: [0.25, 0.5, 0.75],
  },
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
