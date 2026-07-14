// ============================================================
// SANDBOX GP — the kart itself (goals #7, #8, #9).
// #7 ANIME LOOK: smooth lathe-built shell, scooped cockpit, chunky fenders,
//    a big rear wing, and a chibi driver — big helmeted head, tiny torso.
// #9 WHEELS ARE CAR MODS: the "shoes" loadout slot styles ALL FOUR wheels
//    (rim color, hub shape) — the character never wears them, the kart does.
// #8 EQUIPPED COSMETICS RENDER: headpiece → helmet topper, bandana → neck
//    scarf, breather → snorkel, oxygenTank → the floaty ring on the back,
//    belt → tow-rope coil, weapon → rear-mounted tool. Unknown ids still
//    render: a stable hash picks their colors, so every purchase shows up.
// ============================================================
import * as THREE from "three";
import { PALETTE } from "./palette.js";

const toon = (color, opts = {}) => new THREE.MeshLambertMaterial({ color, ...opts });

// stable per-id color so every cosmetic id has a consistent look
function idHue(id) {
  let h = 0;
  for (let i = 0; i < (id || "").length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return new THREE.Color().setHSL((h % 360) / 360, 0.62, 0.55).getHex();
}

// ---- wheel styles (#9): the shoes slot dresses all four ----
// WHEELS. Each set's wheels look like that set.
//
// This used to know about `shoes_boots`, `shoes_sandals`, `shoes_flippers` and
// `shoes_cleats` — none of which exist any more. Every real wheel fell through to
// a HASH OF ITS ID for the rim colour, so "Chrome Rims" and "Neon Rims" came out
// as whatever hue their name happened to hash to. The item didn't look like what
// it said it was.
function wheelStyle(shoeId) {
  const known = {
    // SANDCASTLE — flip-flop rubber, cheerful and cheap
    shoes_standard: { tire: 0x3a2f24, rim: 0xf0c04a, hub: "star" },
    // SURF PUNK — bare, sun-faded, salt-eaten
    shoes_sandal:   { tire: 0x2c2620, rim: 0xe8dcc0, hub: "disc" },
    // NEON ARCADE — hot pink rims with a chrome star
    shoes_neon:     { tire: 0x1c1712, rim: 0xff5fa2, hub: "star" },
    // MECHA — machined, warm metal
    shoes_turbo:    { tire: 0x241f1a, rim: 0xff8c42, hub: "bolt" },
    shoes_chrome:   { tire: 0x1c1712, rim: 0xd8dde3, hub: "bolt" },
    // CORAL COURT — nacre: pale, pearlescent
    shoes_coral:    { tire: 0x2a2028, rim: 0xffe8f0, hub: "disc" },
    // STORM — dark, heavy, with a live-wire rim
    shoes_storm:    { tire: 0x14171c, rim: 0x59b7e8, hub: "star" },
    // GOLDEN HOUR — the prestige wheel
    shoes_comet:    { tire: 0x1c1712, rim: 0xffc83d, hub: "star" },
  };
  if (known[shoeId]) return known[shoeId];
  return { tire: 0x2c2620, rim: 0xcfc7b8, hub: "disc" };   // the plain default
}

function buildWheel(style) {
  // ============================================================================
  // A WHEEL, BUILT COHERENTLY.
  //
  // Everything about this was fighting itself:
  //
  //   • the TYRE is a TorusGeometry, which lies in its local XY plane and spins
  //     about local +Z — so its axle is Z
  //   • the RIM was a cylinder rotated about Z, putting its axle on X — ninety
  //     degrees out from the tyre it sits inside. On screen the white rim disc
  //     faced FORWARD, out of the side of the wheel.
  //   • the spokes were fanned about X, so they spread across the WRONG plane
  //   • and `animateCar` rolls the wheel about X — a third axis again
  //
  // The wheels visibly rotated sideways, because they were.
  //
  // ONE axle: X. The tyre is turned to lie in the YZ plane, the rim's cylinder
  // axis is X natively, the spokes fan about X, and the roll is about X. Every
  // part agrees.
  // ============================================================================
  const g = new THREE.Group();

  const tire = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.16, 10, 18), toon(style.tire));
  tire.rotation.y = Math.PI / 2;                 // torus's Z-axle -> X
  g.add(tire);

  // a cylinder's axis is its local +Y, so lay it down onto X
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.22, 12), toon(style.rim));
  rim.rotation.z = Math.PI / 2;
  g.add(rim);

  if (style.hub === "star") {
    for (let k = 0; k < 5; k++) {
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.26, 0.05), toon(style.rim));
      spoke.rotation.x = (k / 5) * Math.PI * 2;   // fan about the X axle
      g.add(spoke);
    }
  } else if (style.hub === "bolt") {
    const bolt = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), toon(0xfff7ea));
    bolt.position.x = 0.12;                       // sitting on the hub cap
    g.add(bolt);
  }

  const spin = new THREE.Group();                 // rolls about X (see animateCar)
  spin.add(g);
  const holder = new THREE.Group();               // steers about Y
  holder.add(spin);
  return holder;   // holder(y-steer) → spin(rolls about X) → visuals
}

// ============================================================================
// COSMETIC ATTACHMENTS — a SHAPE REGISTRY, not a pile of substring guesses.
//
// The old code branched on /cap|hat/ and /crown/ and dumped everything else into
// one generic cone, so a hundred items would have rendered as three shapes. Each
// item now names its own builder. Anything unregistered still gets a sane
// fallback (colour-hashed), so a new item can never render as nothing.
//
// THE ANCHOR CONTRACT — all local to the DRIVER group:
//   head centre y=0.48 (r=0.26) · helmet r=0.29 · CROWN (top of helmet) = 0.78
//   face is at y≈0.45, z=+0.25 · neck y=0.27 · torso y=0.16 (r=0.17)
//   mitts at (±0.16, 0.26, 0.30)
// And on the CAR group (buildCar's local space):
//   shell top y=0.71 · rear deck z=-0.9..-1.1 · flanks x=±0.58 · wheels y=0.34
// Get these wrong and the hat ends up inside the driver's face — which is
// exactly what used to happen.
// ============================================================================
const CROWN = 0.78;     // top of the helmet
const FACE_Z = 0.25;    // front of the face
const NECK_Y = 0.27;

const M = (geo, color, opts) => new THREE.Mesh(geo, toon(color, opts));

// ---- HEADWEAR (attaches to the driver, sits on the helmet crown) ----
const HEAD_SHAPES = {
  // legacy ids kept from before the reskin — they still need real shapes
  head_goggles:  (c) => visorShape(0x2fe6c8),
  head_foxears:  (c) => earsShape(c, "cat"),
  head_kabuto:   (c) => racingHelm(c),
  head_marshal:  (c) => crownShape(0x2fe6c8, true),      // MYTHIC: Crown of the Tides
  // wide-brim / caps
  head_cap:      (c) => capShape(c, 0.40, 0.30),
  head_sunhat:   (c) => capShape(0xf2dCA8, 0.52, 0.34),          // big straw brim
  head_visor:    (c) => visorShape(0x2fe6c8),
  head_shades:   (c) => visorShape(0x1c1712),
  head_bucket:   (c) => bucketHat(c),
  head_captain:  (c) => captainCap(c),
  head_lifeguard:(c) => capShape(0xe2574c, 0.40, 0.30),
  head_headband: (c) => headband(c),
  // crowns / regal
  head_crown:    (c) => crownShape(0xf0c04a),
  head_shellcrown:(c) => coralCrown(),
  // creature ears / fins
  head_catears:  (c) => earsShape(c, "cat"),
  head_bunnyears:(c) => earsShape(c, "bunny"),
  head_sharkfin: (c) => finShape(0x59b7e8),
  head_mohawk:   (c) => mohawk(c),
  head_antenna:  (c) => antenna(c),
  head_halo:     (c) => haloShape(0xfff1d6),
  head_pineapple:(c) => pineappleHat(),
  head_flowercrown: (c) => flowerCrown(),
  head_helmetwing: (c) => wingedHelm(c),
  head_horns:    (c) => hornsShape(c),
};
function capShape(c, brimR, domeR) {
  const g = new THREE.Group();
  const dome = M(new THREE.SphereGeometry(domeR, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), c);
  dome.position.y = CROWN - 0.06;
  const brim = M(new THREE.CylinderGeometry(brimR, brimR + 0.04, 0.05, 16), c);
  brim.position.set(0, CROWN - 0.05, brimR > 0.46 ? 0 : 0.10);   // huge brims are all-round
  g.add(dome, brim);
  return g;
}
// ============================================================================
// NEON VISOR — the Neon Arcade crown jewel. 4 shells.
//
// This was a TORUS AND A CURVED PANE. A headband and a bit of tinted plastic.
//
// The Neon set is 80s boardwalk at midnight — chrome, hot pink, laser grids. The
// visor should be a WRAPAROUND with a scanline grid burning across it, glowing
// edge strips, a pink light bar over the brow, and side pods. It is the loudest,
// most look-at-me item in the shop, and it should be.
// ============================================================================
function visorShape(c) {
  const g = new THREE.Group();

  // the WRAPAROUND lens, dark and mirrored
  const lens = M(
    new THREE.SphereGeometry(0.32, 16, 10, -1.15, 2.30, Math.PI * 0.33, Math.PI * 0.27),
    0x1c1712,
    { transparent: true, opacity: 0.88 }
  );
  lens.position.y = 0.54;
  g.add(lens);

  // THE SCANLINE GRID — horizontal laser lines burning across the lens. This is
  // the item. It's what makes it neon and not just "sunglasses".
  for (let i = 0; i < 4; i++) {
    const line = M(
      new THREE.TorusGeometry(0.30 - i * 0.006, 0.008, 5, 20, Math.PI * 0.9),
      i % 2 ? 0xff5fa2 : 0x2fe6c8,
      { emissive: i % 2 ? 0xc42d68 : 0x1a9d8a, emissiveIntensity: 0.9 }
    );
    line.rotation.y = Math.PI / 2;
    line.rotation.x = Math.PI / 2;
    line.rotation.z = -Math.PI * 0.45;
    line.position.set(0, 0.485 + i * 0.035, 0.005);
    g.add(line);
  }
  // a few vertical grid lines, so it reads as a GRID
  for (let i = -1; i <= 1; i++) {
    const v = M(new THREE.BoxGeometry(0.008, 0.14, 0.01), 0x2fe6c8, { emissive: 0x1a9d8a, emissiveIntensity: 0.7, transparent: true, opacity: 0.6 });
    v.position.set(i * 0.14, 0.53, 0.29);
    g.add(v);
  }

  // the BROW LIGHT BAR — hot pink, glowing
  const bar = M(new THREE.BoxGeometry(0.52, 0.035, 0.05), 0xff5fa2, { emissive: 0xc42d68, emissiveIntensity: 1.0 });
  bar.position.set(0, 0.66, 0.19);
  bar.rotation.x = -0.22;
  g.add(bar);
  // a chrome strip under it
  const chrome = M(new THREE.BoxGeometry(0.54, 0.022, 0.04), 0xd8dde3);
  chrome.position.set(0, 0.628, 0.20);
  chrome.rotation.x = -0.22;
  g.add(chrome);

  // the strap round the back
  const strap = M(new THREE.TorusGeometry(0.29, 0.028, 8, 18, Math.PI * 1.1), 0x2c2620);
  strap.rotation.x = Math.PI / 2;
  strap.rotation.z = Math.PI * 0.45;
  strap.position.y = 0.58;
  g.add(strap);

  // SIDE PODS with a glowing vent
  for (const s of [-1, 1]) {
    const pod = M(new THREE.BoxGeometry(0.06, 0.12, 0.14), 0x2c2620);
    pod.position.set(s * 0.30, 0.57, 0.02);
    g.add(pod);
    const vent = M(new THREE.BoxGeometry(0.02, 0.08, 0.10), 0x2fe6c8, { emissive: 0x1a9d8a, emissiveIntensity: 0.9 });
    vent.position.set(s * 0.335, 0.57, 0.02);
    g.add(vent);
  }

  return g;
}
function bucketHat(c) {
  const g = new THREE.Group();
  const crown = M(new THREE.CylinderGeometry(0.29, 0.31, 0.24, 14), c);
  crown.position.y = CROWN + 0.06;
  const brim = M(new THREE.CylinderGeometry(0.44, 0.40, 0.05, 16), c);
  brim.position.y = CROWN - 0.05;
  g.add(crown, brim);
  return g;
}
function captainCap(c) {
  const g = new THREE.Group();
  const crown = M(new THREE.CylinderGeometry(0.32, 0.30, 0.14, 16), 0xfff7ea);
  crown.position.y = CROWN + 0.04;
  const band = M(new THREE.CylinderGeometry(0.305, 0.305, 0.07, 16), 0x0b3140);
  band.position.y = CROWN - 0.04;
  const peak = M(new THREE.CylinderGeometry(0.34, 0.30, 0.04, 14, 1, false, -0.9, 1.8), 0x1c1712);
  peak.position.set(0, CROWN - 0.07, 0.16);
  const anchor = M(new THREE.TorusGeometry(0.05, 0.014, 6, 10), 0xf0c04a);
  anchor.position.set(0, CROWN + 0.02, 0.30);
  g.add(crown, band, peak, anchor);
  return g;
}
function headband(c) {
  const g = new THREE.Group();
  const band = M(new THREE.TorusGeometry(0.285, 0.045, 8, 18), c);
  band.rotation.x = Math.PI / 2;
  band.position.y = 0.62;
  const knot = M(new THREE.BoxGeometry(0.08, 0.08, 0.16), c);
  knot.position.set(0, 0.62, -0.30);
  g.add(band, knot);
  return g;
}
// ============================================================================
// CORAL CROWN — the Coral Court crown jewel. 6 shells.
//
// This shared `crownShape()` with three other items — a torus with six cones on
// it. The "deep-sea royalty" set's centrepiece was a generic party hat.
//
// A crown of LIVING CORAL: a nacre band, branching coral growing out of it in
// three colours, pearls set into the crown, sea-fan fronds, and a single big pearl
// at the front. It is the most expensive-looking thing in the shop, which is the
// entire point of a 6-shell item.
// ============================================================================
function coralCrown() {
  const g = new THREE.Group();
  const PEARL = 0xffe8f0, PINK = 0xff5fa2, ROSE = 0xff9ec4, TEAL = 0x2fe6c8;

  // the NACRE BAND — pearlescent, with a raised lip
  const band = M(new THREE.TorusGeometry(0.30, 0.045, 10, 22), PEARL);
  band.rotation.x = Math.PI / 2;
  band.position.y = CROWN - 0.02;
  g.add(band);
  const lip = M(new THREE.TorusGeometry(0.305, 0.018, 8, 22), ROSE);
  lip.rotation.x = Math.PI / 2;
  lip.position.y = CROWN + 0.03;
  g.add(lip);

  // BRANCHING CORAL growing out of the band. Six stalks, each forking twice —
  // that fork is what makes it read as coral rather than as spikes.
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    const col = [PINK, ROSE, TEAL][k % 3];
    const bx = Math.cos(a) * 0.28, bz = Math.sin(a) * 0.28;

    // the trunk
    const trunk = M(new THREE.CylinderGeometry(0.028, 0.042, 0.17, 6), col);
    trunk.position.set(bx, CROWN + 0.09, bz);
    trunk.rotation.z = -Math.cos(a) * 0.25;
    trunk.rotation.x = Math.sin(a) * 0.25;
    g.add(trunk);

    // the fork — two branches
    for (const s of [-1, 1]) {
      const branch = M(new THREE.CylinderGeometry(0.018, 0.026, 0.13, 5), col);
      branch.position.set(
        bx + Math.cos(a) * 0.03 + s * 0.045 * Math.sin(a),
        CROWN + 0.22,
        bz + Math.sin(a) * 0.03 - s * 0.045 * Math.cos(a)
      );
      branch.rotation.z = -Math.cos(a) * 0.3 + s * 0.35 * Math.sin(a);
      branch.rotation.x = Math.sin(a) * 0.3 + s * 0.35 * Math.cos(a);
      g.add(branch);
      // and a rounded tip on each — coral is soft, not sharp
      const tip = M(new THREE.SphereGeometry(0.026, 6, 5), col);
      tip.position.set(
        bx + Math.cos(a) * 0.05 + s * 0.075 * Math.sin(a),
        CROWN + 0.29,
        bz + Math.sin(a) * 0.05 - s * 0.075 * Math.cos(a)
      );
      g.add(tip);
    }
  }

  // PEARLS set into the band between the coral
  for (let k = 0; k < 6; k++) {
    const a = ((k + 0.5) / 6) * Math.PI * 2;
    const pearl = M(new THREE.SphereGeometry(0.038, 8, 6), PEARL);
    pearl.position.set(Math.cos(a) * 0.30, CROWN + 0.01, Math.sin(a) * 0.30);
    g.add(pearl);
  }

  // SEA-FAN fronds, thin and translucent, catching the light
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2 + 0.5;
    const fan = M(new THREE.PlaneGeometry(0.16, 0.20), TEAL, { side: THREE.DoubleSide, transparent: true, opacity: 0.6 });
    fan.position.set(Math.cos(a) * 0.26, CROWN + 0.20, Math.sin(a) * 0.26);
    fan.rotation.y = -a;
    fan.rotation.x = 0.3;
    g.add(fan);
  }

  // THE BIG PEARL at the front — the focal point
  const centre = M(new THREE.SphereGeometry(0.075, 12, 9), PEARL);
  centre.position.set(0, CROWN + 0.09, 0.30);
  g.add(centre);
  // its setting
  const setting = M(new THREE.TorusGeometry(0.075, 0.018, 6, 12), ROSE);
  setting.position.set(0, CROWN + 0.09, 0.30);
  setting.rotation.x = Math.PI / 2;
  setting.rotation.z = Math.PI / 2;
  g.add(setting);

  return g;
}

function crownShape(c, shells = false) {
  const g = new THREE.Group();
  const band = M(new THREE.TorusGeometry(0.29, 0.035, 8, 18), c);
  band.rotation.x = Math.PI / 2;
  band.position.y = CROWN - 0.02;
  g.add(band);
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    const spike = shells
      ? M(new THREE.ConeGeometry(0.07, 0.15, 7), 0xfff1d6)
      : M(new THREE.ConeGeometry(0.055, 0.19, 5), c);
    spike.position.set(Math.cos(a) * 0.27, CROWN + 0.08, Math.sin(a) * 0.27);
    g.add(spike);
  }
  return g;
}
function earsShape(c, kind) {
  const g = new THREE.Group();
  for (const s of [-1, 1]) {
    const h = kind === "bunny" ? 0.40 : 0.20;
    const ear = M(new THREE.ConeGeometry(kind === "bunny" ? 0.08 : 0.11, h, 6), c);
    ear.position.set(s * 0.17, CROWN + h / 2 - 0.02, -0.02);
    ear.rotation.z = s * (kind === "bunny" ? 0.12 : 0.28);
    const inner = M(new THREE.ConeGeometry(kind === "bunny" ? 0.045 : 0.06, h * 0.7, 6), 0xff9ec4);
    inner.position.set(s * 0.17, CROWN + h / 2 - 0.04, 0.03);
    inner.rotation.z = s * (kind === "bunny" ? 0.12 : 0.28);
    g.add(ear, inner);
  }
  return g;
}
function finShape(c) {
  const g = new THREE.Group();
  const fin = M(new THREE.ConeGeometry(0.15, 0.42, 3), c);
  fin.position.y = CROWN + 0.20;
  fin.rotation.y = Math.PI / 2;
  g.add(fin);
  return g;
}
function mohawk(c) {
  const g = new THREE.Group();
  for (let i = 0; i < 6; i++) {
    const h = 0.16 + Math.sin((i / 5) * Math.PI) * 0.18;
    const sp = M(new THREE.ConeGeometry(0.05, h, 4), c);
    sp.position.set(0, CROWN + h / 2 - 0.03, 0.20 - i * 0.09);
    g.add(sp);
  }
  return g;
}
function antenna(c) {
  const g = new THREE.Group();
  const rod = M(new THREE.CylinderGeometry(0.014, 0.014, 0.36, 5), 0xd9d2c4);
  rod.position.y = CROWN + 0.18;
  const ball = M(new THREE.SphereGeometry(0.06, 8, 6), c);
  ball.position.y = CROWN + 0.38;
  g.add(rod, ball);
  return g;
}
// ============================================================================
// SUN HALO — the Golden Hour crown jewel. 6 shells.
//
// This was ONE TORUS. A single ring, three centimetres thick, and we were asking
// people to pay real money for it. You cannot sell a primitive.
//
// A halo should look like the last light of the day caught in a ring above your
// head: a bright inner band, an outer corona of gold, RAYS radiating out of it,
// and little motes of light drifting off. It should be the thing on the grid that
// makes someone else ask "how do I get that".
// ============================================================================
function haloShape(c) {
  const g = new THREE.Group();
  const Y = CROWN + 0.30;

  // the core ring — bright, almost white-hot
  const core = M(new THREE.TorusGeometry(0.26, 0.030, 10, 24), 0xfffdf0, { emissive: 0xf5c542, emissiveIntensity: 0.6 });
  core.rotation.x = Math.PI / 2;
  core.position.y = Y;
  g.add(core);

  // an outer corona, softer and warmer
  const corona = M(new THREE.TorusGeometry(0.30, 0.055, 10, 24), 0xf5a623, { transparent: true, opacity: 0.55 });
  corona.rotation.x = Math.PI / 2;
  corona.position.y = Y;
  g.add(corona);

  // a faint outermost bloom, so it glows rather than just sits there
  const bloom = M(new THREE.TorusGeometry(0.35, 0.09, 8, 20), 0xffe08a, { transparent: true, opacity: 0.22 });
  bloom.rotation.x = Math.PI / 2;
  bloom.position.y = Y;
  g.add(bloom);

  // THE RAYS. Eight of them, alternating long and short, tapering outward. This is
  // the silhouette — it's what makes it read as a SUN and not as a hoop.
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const long = i % 2 === 0;
    const len = long ? 0.20 : 0.11;
    const ray = M(new THREE.ConeGeometry(0.035, len, 4), 0xffc83d, { transparent: true, opacity: 0.9 });
    ray.position.set(
      Math.cos(a) * (0.30 + len / 2),
      Y,
      Math.sin(a) * (0.30 + len / 2)
    );
    ray.rotation.z = -Math.PI / 2;
    ray.rotation.y = -a;
    g.add(ray);
  }

  // motes of light drifting off it
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.4;
    const mote = M(new THREE.SphereGeometry(0.022, 6, 5), 0xfffdf0, { transparent: true, opacity: 0.75 });
    mote.position.set(
      Math.cos(a) * 0.42,
      Y + 0.05 + (i % 2) * 0.06,
      Math.sin(a) * 0.42
    );
    g.add(mote);
  }

  return g;
}
// ============================================================================
// PINEAPPLE HEAD — the Sandcastle crown jewel. 4 shells.
//
// This was a squashed sphere with five cones on top. A yellow egg with a fringe.
//
// The funniest item in a shop is very often the best seller — people buy a laugh
// far more readily than they buy a sword. So this is a REAL pineapple: a textured
// diamond-cross-hatched body, a proper spray of serrated leaves fanning out at
// different angles, a rind that shades from green at the base to gold at the top,
// and — because it's a Sandcastle item and the whole set is a joke — a tiny paper
// umbrella stuck in the side of it.
// ============================================================================
function pineappleHat() {
  const g = new THREE.Group();
  const GOLD = 0xf7c04a, DEEP = 0xd99a1e, GREEN = 0x2a9d8f, LEAF = 0x1f8a72;

  // the BODY — a barrel, wider at the middle
  const body = M(new THREE.CylinderGeometry(0.18, 0.20, 0.40, 12), GOLD);
  body.position.y = CROWN + 0.18;
  g.add(body);
  // the rounded shoulders and base
  const top = M(new THREE.SphereGeometry(0.18, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), GOLD);
  top.position.y = CROWN + 0.38;
  g.add(top);
  const base = M(new THREE.SphereGeometry(0.20, 12, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), DEEP);
  base.position.y = CROWN - 0.02;
  g.add(base);

  // THE RIND — the diamond cross-hatch. This is the entire reason it reads as a
  // pineapple and not as a lemon. Two crossing helices of little raised scales.
  for (let row = 0; row < 5; row++) {
    const y = CROWN + 0.03 + row * 0.085;
    const r = 0.185 + (row === 2 ? 0.012 : 0);
    for (let k = 0; k < 9; k++) {
      const a = (k / 9) * Math.PI * 2 + row * 0.35;   // offset each row: a spiral
      const scale = M(new THREE.BoxGeometry(0.055, 0.055, 0.030), row % 2 ? DEEP : GOLD);
      scale.position.set(Math.cos(a) * r, y, Math.sin(a) * r);
      scale.rotation.y = -a;
      scale.rotation.z = 0.78;                        // turned 45° -> a DIAMOND
      g.add(scale);
    }
  }

  // THE LEAVES — a real crown of them. Serrated, splayed at different angles and
  // heights, shading from deep green at the base to bright at the tips.
  for (let i = 0; i < 11; i++) {
    const a = (i / 11) * Math.PI * 2 + (i % 2) * 0.28;
    const tall = i % 3 === 0;
    const len = tall ? 0.34 : 0.22;
    const lean = tall ? 0.30 : 0.62;                  // short ones splay out further

    const leaf = M(new THREE.ConeGeometry(0.035, len, 4), i % 2 ? GREEN : LEAF);
    leaf.position.set(
      Math.cos(a) * (0.05 + lean * 0.10),
      CROWN + 0.48 + len / 2 - lean * 0.06,
      Math.sin(a) * (0.05 + lean * 0.10)
    );
    leaf.rotation.z = -Math.cos(a) * lean;
    leaf.rotation.x = Math.sin(a) * lean;
    g.add(leaf);

    // a serration ridge down the middle of the long ones
    if (tall) {
      const ridge = M(new THREE.BoxGeometry(0.012, len * 0.8, 0.012), 0x0f6b56);
      ridge.position.copy(leaf.position);
      ridge.rotation.copy(leaf.rotation);
      g.add(ridge);
    }
  }

  // THE PAPER UMBRELLA. It's a Sandcastle item. The set is a joke. Lean in.
  const stick = M(new THREE.CylinderGeometry(0.008, 0.008, 0.22, 5), 0xfff7ea);
  stick.position.set(0.20, CROWN + 0.34, 0.10);
  stick.rotation.z = -0.55;
  stick.rotation.x = -0.25;
  g.add(stick);
  const canopy = M(new THREE.ConeGeometry(0.085, 0.055, 8), 0xff5fa2);
  canopy.position.set(0.28, CROWN + 0.44, 0.14);
  canopy.rotation.z = -0.55;
  canopy.rotation.x = -0.25;
  g.add(canopy);
  // its little gores, so it's a paper parasol and not a party hat
  for (let k = 0; k < 4; k++) {
    const gore = M(
      new THREE.ConeGeometry(0.086, 0.056, 8, 1, true, (k / 4) * Math.PI * 2, Math.PI / 4),
      0xfff7ea
    );
    gore.position.copy(canopy.position);
    gore.rotation.copy(canopy.rotation);
    g.add(gore);
  }

  return g;
}
function flowerCrown() {
  const g = new THREE.Group();
  const vine = M(new THREE.TorusGeometry(0.29, 0.025, 6, 18), 0x2a9d8f);
  vine.rotation.x = Math.PI / 2;
  vine.position.y = CROWN - 0.02;
  g.add(vine);
  const cols = [0xff5fa2, 0xfff1d6, 0xf7c04a, 0xff9a4d, 0xff5fa2, 0xfff1d6];
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    for (let pI = 0; pI < 5; pI++) {
      const pa = (pI / 5) * Math.PI * 2;
      const petal = M(new THREE.SphereGeometry(0.035, 6, 5), cols[k]);
      petal.position.set(
        Math.cos(a) * 0.29 + Math.cos(pa) * 0.04,
        CROWN + 0.02,
        Math.sin(a) * 0.29 + Math.sin(pa) * 0.04
      );
      g.add(petal);
    }
  }
  return g;
}
// ============================================================================
// WINGED HELM — the Mecha Pilot crown jewel. 6 shells.
//
// This was TWO 3-SIDED CONES stuck to the sides of the head. A triangle each. For
// six shells.
//
// A mecha pilot's helm is a MACHINE: a hard shell with panel lines, a mirrored
// visor, an antenna, and swept thruster fins that look like they'd actually do
// something. It's the anime-mech look — the one people genuinely want.
// ============================================================================
function wingedHelm(c) {
  const g = new THREE.Group();

  // the SHELL — a hard dome sitting over the head
  const shell = M(new THREE.SphereGeometry(0.34, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.62), 0x9aa3ad);
  shell.position.y = CROWN - 0.10;
  g.add(shell);
  // the crest running front to back
  const crest = M(new THREE.BoxGeometry(0.06, 0.10, 0.58), 0xff8c42);
  crest.position.set(0, CROWN + 0.12, -0.02);
  g.add(crest);
  // panel lines — the single detail that says MACHINE rather than helmet
  for (const s of [-1, 1]) {
    const panel = M(new THREE.BoxGeometry(0.02, 0.16, 0.42), 0x6b737c);
    panel.position.set(s * 0.20, CROWN + 0.02, -0.02);
    panel.rotation.z = s * 0.25;
    g.add(panel);
  }

  // the MIRRORED VISOR
  const visor = M(
    new THREE.SphereGeometry(0.345, 14, 8, -1.0, 2.0, Math.PI * 0.36, Math.PI * 0.24),
    0x2fa8d8,
    { transparent: true, opacity: 0.85, emissive: 0x1a6f96, emissiveIntensity: 0.35 }
  );
  visor.position.set(0, CROWN - 0.10, 0.02);
  g.add(visor);
  // a highlight streak across it
  const glint = M(new THREE.BoxGeometry(0.20, 0.015, 0.02), 0xd8fbff, { transparent: true, opacity: 0.7 });
  glint.position.set(-0.06, CROWN - 0.02, 0.31);
  glint.rotation.z = 0.3;
  g.add(glint);

  // THE THRUSTER FINS — swept back, layered, with an orange intake
  for (const s of [-1, 1]) {
    // the main blade
    const fin = M(new THREE.BoxGeometry(0.05, 0.20, 0.46), 0xd8dde3);
    fin.position.set(s * 0.34, CROWN + 0.04, -0.18);
    fin.rotation.z = s * 0.42;
    fin.rotation.y = s * -0.30;
    g.add(fin);
    // a second, smaller blade above it
    const fin2 = M(new THREE.BoxGeometry(0.04, 0.13, 0.30), 0x9aa3ad);
    fin2.position.set(s * 0.30, CROWN + 0.18, -0.22);
    fin2.rotation.z = s * 0.55;
    fin2.rotation.y = s * -0.35;
    g.add(fin2);
    // the intake at its root, glowing
    const intake = M(new THREE.CylinderGeometry(0.05, 0.06, 0.08, 7), 0xff8c42, { emissive: 0xd1521a, emissiveIntensity: 0.6 });
    intake.position.set(s * 0.30, CROWN - 0.04, -0.30);
    intake.rotation.x = Math.PI / 2;
    g.add(intake);
    // the exhaust bloom behind it
    const bloom = M(new THREE.ConeGeometry(0.05, 0.16, 6), 0xffe08a, { transparent: true, opacity: 0.55 });
    bloom.position.set(s * 0.30, CROWN - 0.04, -0.42);
    bloom.rotation.x = -Math.PI / 2;
    g.add(bloom);
  }

  // the ANTENNA — a little thing, and it completes the whole silhouette
  const mast = M(new THREE.CylinderGeometry(0.012, 0.012, 0.30, 5), 0x6b737c);
  mast.position.set(0.16, CROWN + 0.30, -0.14);
  mast.rotation.z = -0.20;
  g.add(mast);
  const bulb = M(new THREE.SphereGeometry(0.030, 6, 5), 0xff5a3c, { emissive: 0xc42d1a, emissiveIntensity: 0.8 });
  bulb.position.set(0.19, CROWN + 0.46, -0.14);
  g.add(bulb);
  return g;
}
// ============================================================================
// THUNDER HORNS — the Storm Chaser crown jewel. 6 shells.
//
// This was TWO CONES. Two. For six shells.
//
// A storm rider's horns should be CURVED and ridged like a ram's, dark as wet
// slate, with a live charge crackling between them and static arcing off the tips.
// The arc between the horns is the whole idea — you're carrying a thunderstorm on
// your head.
// ============================================================================
function hornsShape(c) {
  const g = new THREE.Group();

  for (const s of [-1, 1]) {
    // the horn itself: five tapering segments, each rotated a little further, so
    // it CURVES back and out instead of being a spike
    for (let i = 0; i < 5; i++) {
      const f = i / 4;
      const seg = M(
        new THREE.CylinderGeometry(0.075 - f * 0.055, 0.085 - f * 0.055, 0.10, 7),
        i % 2 ? 0x3a4048 : 0x2a2f36
      );
      const bend = f * 0.9;
      seg.position.set(
        s * (0.19 + f * 0.16),
        CROWN + 0.04 + i * 0.085 - f * 0.02,
        -0.03 - f * 0.05
      );
      seg.rotation.z = s * (-0.35 - bend * 0.55);
      seg.rotation.x = -bend * 0.25;
      g.add(seg);
    }
    // the ridges — a horn without ridges is a cone
    for (let i = 0; i < 3; i++) {
      const f = i / 3;
      const ring = M(new THREE.TorusGeometry(0.070 - f * 0.028, 0.012, 5, 9), 0x1c2026);
      ring.position.set(
        s * (0.20 + f * 0.14),
        CROWN + 0.09 + i * 0.10,
        -0.04 - f * 0.04
      );
      ring.rotation.y = Math.PI / 2;
      ring.rotation.x = s * (0.35 + f * 0.5);
      g.add(ring);
    }
    // a charged TIP
    const tip = M(new THREE.SphereGeometry(0.035, 7, 6), 0x59b7e8, { emissive: 0x2a7fa8, emissiveIntensity: 0.7 });
    tip.position.set(s * 0.36, CROWN + 0.44, -0.09);
    g.add(tip);
  }

  // THE ARC. Static crackling between the two horns — this is the item.
  for (let i = 0; i < 7; i++) {
    const f = i / 6;
    const x = -0.36 + f * 0.72;
    // a jagged path, not a smooth curve
    const jag = (i % 2 ? 0.035 : -0.035) * (1 - Math.abs(f - 0.5) * 1.4);
    const bolt = M(new THREE.BoxGeometry(0.12, 0.022, 0.022), 0xd8fbff, { emissive: 0x59b7e8, emissiveIntensity: 0.9 });
    bolt.position.set(x, CROWN + 0.50 + jag + Math.sin(f * Math.PI) * 0.06, -0.09);
    bolt.rotation.z = (i % 2 ? 0.5 : -0.5);
    g.add(bolt);
  }
  // a couple of sparks flying off
  for (let i = 0; i < 3; i++) {
    const spark = M(new THREE.SphereGeometry(0.018, 5, 4), 0xd8fbff, { transparent: true, opacity: 0.85 });
    spark.position.set((i - 1) * 0.22, CROWN + 0.62 + (i % 2) * 0.05, -0.06);
    g.add(spark);
  }

  return g;
}

// ---- SNORKELS / BREATHERS (side of the head, mouth to above the crown) ----
const BREATHER_SHAPES = {
  breather_koi:     (c) => pufferMask(),
  breather_kitsune: (c) => snorkel(0x2a9d8f, 0xf7c04a),
  breather_oni:     (c) => krakenMask(),
  breather_abyss:   (c) => abyssRebreather(),
  breather_standard: (c) => snorkel(c, 0xff5a3c),
  breather_snout:    (c) => snorkel(0x59b7e8, 0xfff1d6),
  breather_fanged:   (c) => snorkel(0x2c2620, 0xe2574c),
  breather_puffer:   (c) => pufferMask(),
  breather_turtle:   (c) => snorkel(0x2a9d8f, 0xf7c04a),
  breather_kraken:   (c) => krakenMask(),
  breather_scuba:    (c) => scubaMask(),
  breather_bubble:   (c) => bubbleHelm(),
};
function snorkel(tubeC, tipC) {
  const g = new THREE.Group();
  const tube = M(new THREE.CylinderGeometry(0.045, 0.045, 0.52, 8), tubeC);
  tube.position.set(-0.26, 0.60, 0.10);
  tube.rotation.z = 0.22;
  const tip = M(new THREE.CylinderGeometry(0.055, 0.055, 0.10, 8), tipC);
  tip.position.set(-0.31, 0.86, 0.10);
  const mouth = M(new THREE.BoxGeometry(0.10, 0.06, 0.10), tubeC);
  mouth.position.set(-0.18, 0.40, 0.20);
  g.add(tube, tip, mouth);
  return g;
}
function pufferMask() {
  const g = new THREE.Group();
  const body = M(new THREE.SphereGeometry(0.16, 10, 8), 0xf7c04a);
  body.position.set(0, 0.40, FACE_Z + 0.06);
  g.add(body);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const spine = M(new THREE.ConeGeometry(0.02, 0.07, 4), 0xff5a3c);
    spine.position.set(Math.cos(a) * 0.16, 0.40 + Math.sin(a) * 0.16, FACE_Z + 0.08);
    spine.rotation.x = -Math.PI / 2;
    g.add(spine);
  }
  return g;
}
function krakenMask() {
  const g = new THREE.Group();
  const base = M(new THREE.SphereGeometry(0.17, 10, 8), 0x6e3d4e);
  base.position.set(0, 0.42, FACE_Z + 0.04);
  g.add(base);
  for (let i = 0; i < 6; i++) {
    const a = -0.6 + (i / 5) * 1.2;
    const tent = M(new THREE.CylinderGeometry(0.02, 0.035, 0.22, 5), 0x8a4a5e);
    tent.position.set(Math.sin(a) * 0.14, 0.30, FACE_Z + 0.10);
    tent.rotation.x = 0.5;
    tent.rotation.z = a * 0.6;
    g.add(tent);
  }
  return g;
}
function scubaMask() {
  const g = new THREE.Group();
  const lens = M(new THREE.BoxGeometry(0.34, 0.16, 0.06), 0x59b7e8, { transparent: true, opacity: 0.7 });
  lens.position.set(0, 0.50, FACE_Z + 0.04);
  const frame = M(new THREE.BoxGeometry(0.38, 0.20, 0.03), 0x1c1712);
  frame.position.set(0, 0.50, FACE_Z + 0.01);
  const reg = M(new THREE.CylinderGeometry(0.05, 0.05, 0.08, 8), 0x2c2620);
  reg.position.set(0, 0.36, FACE_Z + 0.06);
  reg.rotation.x = Math.PI / 2;
  g.add(frame, lens, reg);
  return g;
}
function bubbleHelm() {
  const g = new THREE.Group();
  const bub = M(new THREE.SphereGeometry(0.36, 14, 12), 0xbfe6f7, { transparent: true, opacity: 0.35 });
  bub.position.y = 0.48;
  g.add(bub);
  return g;
}

// ---- SCARVES (neck, with a tail streaming back) ----
// ============================================================================
// The pieces the sets needed and didn't have. Twenty-five wearables had no mesh
// at all — they fell through to a generic blob, so "Tiki Torch", "Golden Oar" and
// "Storm Harpoon" all looked identical. An item that doesn't look like its name
// is worse than no item: it teaches the player that the store is lying.
// ============================================================================

// TIKI KING — a burning torch, carved and wrapped
function tikiTorch() {
  const g = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 1.35, 7), toon(0x8a5f33));
  shaft.position.y = 0.35;
  g.add(shaft);
  // the carved bands
  for (let i = 0; i < 3; i++) {
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.065, 0.02, 5, 9), toon(0x5f3f22));
    band.position.y = 0.05 + i * 0.28;
    band.rotation.x = Math.PI / 2;
    g.add(band);
  }
  // the bowl, and the flame
  const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.10, 0.18, 8), toon(0x5f3f22));
  bowl.position.y = 1.05;
  g.add(bowl);
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.36, 7), toon(0xff8c42));
  flame.position.y = 1.28;
  g.add(flame);
  const core = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.22, 6), toon(0xffe08a));
  core.position.y = 1.24;
  g.add(core);
  // mount on the rear deck, where the kart carries its gear
  g.position.set(-0.50, 0.62, -0.92);
  g.rotation.z = 0.22;
  g.scale.setScalar(0.62);
  return g;
}

// STORM CHASER — a harpoon with a live tip
function stormHarpoon() {
  const g = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.55, 6), toon(0x3a4048));
  shaft.position.y = 0.3;
  g.add(shaft);
  const head = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.34, 6), toon(0xd8dde3));
  head.position.y = 1.2;
  g.add(head);
  // the barbs
  for (const s of [-1, 1]) {
    const barb = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.20, 5), toon(0xd8dde3));
    barb.position.set(s * 0.09, 1.0, 0);
    barb.rotation.z = s * 2.5;
    g.add(barb);
  }
  // the crackle at the tip
  const spark = new THREE.Mesh(new THREE.SphereGeometry(0.08, 7, 6), toon(0x59b7e8));
  spark.position.y = 1.4;
  g.add(spark);
  // mount on the rear deck, where the kart carries its gear
  g.position.set(-0.50, 0.62, -0.92);
  g.rotation.z = 0.22;
  g.scale.setScalar(0.62);
  return g;
}

// GOLDEN HOUR — an oar, gilded
function goldenOar() {
  const g = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.045, 1.5, 7), toon(0xf5a623));
  shaft.position.y = 0.3;
  g.add(shaft);
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.55, 0.04), toon(0xffc83d));
  blade.position.y = 1.22;
  g.add(blade);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.055, 0.022, 5, 9), toon(0xfff1d6));
  rim.position.y = 0.94;
  rim.rotation.x = Math.PI / 2;
  g.add(rim);
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.18, 7), toon(0xfff1d6));
  grip.position.y = -0.42;
  g.add(grip);
  // mount on the rear deck, where the kart carries its gear
  g.position.set(-0.50, 0.62, -0.92);
  g.rotation.z = 0.22;
  g.scale.setScalar(0.62);
  return g;
}

// GOLDEN HOUR — a parasol, but the good one
function sunbrella() {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.4, 6), toon(0xfff1d6));
  pole.position.y = 0.3;
  g.add(pole);
  const canopy = new THREE.Mesh(new THREE.ConeGeometry(0.55, 0.34, 10), toon(0xf5a623));
  canopy.position.y = 1.12;
  g.add(canopy);
  // alternating gores
  for (let i = 0; i < 5; i++) {
    const gore = new THREE.Mesh(
      new THREE.ConeGeometry(0.555, 0.345, 10, 1, true, (i / 5) * Math.PI * 2, Math.PI / 5),
      toon(0xfff1d6)
    );
    gore.position.y = 1.12;
    g.add(gore);
  }
  const finial = new THREE.Mesh(new THREE.SphereGeometry(0.06, 7, 6), toon(0xffc83d));
  finial.position.y = 1.34;
  g.add(finial);
  // mount on the rear deck, where the kart carries its gear
  g.position.set(-0.50, 0.62, -0.92);
  g.rotation.z = 0.22;
  g.scale.setScalar(0.62);
  return g;
}

// STORM CHASER — a kite, straining on its line
function stormKite() {
  const g = new THREE.Group();
  const sail = new THREE.Mesh(diamondGeo(0.55, 0.75), toon(0x4a5763, { side: THREE.DoubleSide }));
  sail.position.y = 0.9;
  g.add(sail);
  const spar1 = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.02, 0.02), toon(0x2c2620));
  spar1.position.y = 0.9;
  const spar2 = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.75, 0.02), toon(0x2c2620));
  spar2.position.y = 0.9;
  g.add(spar1, spar2);
  // the tail
  for (let i = 0; i < 3; i++) {
    const bow = new THREE.Mesh(new THREE.PlaneGeometry(0.14, 0.08), toon(0x59b7e8, { side: THREE.DoubleSide }));
    bow.position.set(0, 0.48 - i * 0.16, 0);
    bow.rotation.z = (i % 2 ? 0.5 : -0.5);
    g.add(bow);
  }
  // mount on the rear deck, where the kart carries its gear
  g.position.set(-0.50, 0.62, -0.92);
  g.rotation.z = 0.22;
  g.scale.setScalar(0.62);
  return g;
}

// SURF PUNK / LIFEGUARD — a coil of rope
function ropeCoil(color) {
  // Positioned in WORLD space, on the kart's flank — not built at the origin and
  // then moved. The placement test diffs meshes by `geometryType|localPosition`,
  // so a coil built at the origin has the same signature as the kart's own parts
  // and vanishes from the diff — the test then measures the WHEELS instead (which
  // are also tori) and reports the coil as 1.5 metres wide. Build it where it goes.
  const g = new THREE.Group();
  for (let i = 0; i < 4; i++) {
    const loop = new THREE.Mesh(new THREE.TorusGeometry(0.13 - i * 0.018, 0.026, 6, 12), toon(color));
    loop.rotation.x = Math.PI / 2;
    loop.position.set(0.58, 0.46 + i * 0.032, -0.20);
    g.add(loop);
  }
  return g;
}

const SCARF_SHAPES = {
  bandana_wave:        () => scarf(0x2fa8d8, "long"),      // CORAL: Tidewrap
  bandana_palm:        () => scarf(0x2a9d8f, "short"),     // TIKI: Palm Print
  bandana_neon:        () => scarf(0xff5fa2, "long"),      // NEON: Neon Streamer
  bandana_kraken:      () => scarf(0x6e3d4e, "long"),      // CORAL: Kraken Wrap
  bandana_storm:       () => scarf(0x4a5763, "long"),      // STORM: Storm Scarf
  bandana_hachimaki:   (c) => headbandScarf(c),
  bandana_trailblazer: (c) => scarf(0xff5fa2, "long"),   // MYTHIC: Aurora Sash
  bandana_aurora:      (c) => scarf(0xb5f2ff, "long"),
  bandana_champion:    (c) => sashShape(),
  bandana_standard: (c) => scarf(c, "tail"),
  bandana_knot:     (c) => scarf(c, "knot"),
  bandana_tactical: (c) => scarf(c, "wrap"),
  bandana_storm:    (c) => scarf(0x2fe6c8, "long"),
  bandana_flame:    (c) => scarf(0xff5a3c, "long"),
  bandana_dust:     (c) => scarf(0xe8c98c, "wrap"),
  bandana_lei:      (c) => leiShape(),
  bandana_boa:      (c) => boaShape(),
  bandana_towel:    (c) => towelShape(c),
  bandana_medal:    (c) => medalShape(),
};
function scarf(col, kind) {
  const g = new THREE.Group();
  const ring = M(new THREE.TorusGeometry(0.17, kind === "wrap" ? 0.08 : 0.06, 8, 16), col);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = NECK_Y;
  g.add(ring);
  const len = kind === "long" ? 0.55 : kind === "knot" ? 0.26 : 0.34;
  const tail = M(new THREE.BoxGeometry(0.11, 0.04, len), col);
  tail.position.set(0.02, NECK_Y - 0.02, -0.10 - len / 2);
  tail.rotation.x = -0.25;
  g.add(tail);
  if (kind === "knot") {
    const k = M(new THREE.SphereGeometry(0.06, 8, 6), col);
    k.position.set(0.02, NECK_Y - 0.02, -0.16);
    g.add(k);
  }
  return g;
}
function leiShape() {
  const g = new THREE.Group();
  const cols = [0xff5fa2, 0xf7c04a, 0xfff1d6, 0xff9a4d];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const f = M(new THREE.SphereGeometry(0.05, 6, 5), cols[i % 4]);
    f.position.set(Math.cos(a) * 0.20, NECK_Y - 0.02, Math.sin(a) * 0.20);
    g.add(f);
  }
  return g;
}
function boaShape() {
  const g = new THREE.Group();
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    const puff = M(new THREE.SphereGeometry(0.07, 6, 5), 0xff9ec4);
    puff.position.set(Math.cos(a) * 0.19, NECK_Y + Math.sin(i * 2) * 0.03, Math.sin(a) * 0.19);
    g.add(puff);
  }
  return g;
}
function towelShape(c) {
  const g = new THREE.Group();
  const t = M(new THREE.BoxGeometry(0.40, 0.05, 0.30), c);
  t.position.set(0, NECK_Y + 0.02, -0.06);
  g.add(t);
  for (const s of [-1, 1]) {
    const end = M(new THREE.BoxGeometry(0.12, 0.04, 0.26), c);
    end.position.set(s * 0.15, NECK_Y - 0.06, 0.10);
    g.add(end);
  }
  return g;
}
function medalShape() {
  const g = new THREE.Group();
  for (const s of [-1, 1]) {
    const strap = M(new THREE.BoxGeometry(0.05, 0.22, 0.03), 0x2a9d8f);
    strap.position.set(s * 0.08, NECK_Y - 0.10, 0.14);
    strap.rotation.z = s * 0.25;
    g.add(strap);
  }
  const disc = M(new THREE.CylinderGeometry(0.09, 0.09, 0.025, 14), 0xf0c04a);
  disc.rotation.x = Math.PI / 2;
  disc.position.set(0, NECK_Y - 0.22, 0.16);
  g.add(disc);
  return g;
}

// ---- FLOATIES (the ring behind the seat — CAR space, not driver space) ----
const FLOATY_SHAPES = {
  tank_canister: (c) => floatyTwin(),
  tank_jet:      (c) => floatyBall(),
  tank_sakura:   (c) => floatyPetal(),
  tank_dragon:   (c) => floatyThunder(),
  tank_standard: (c) => floaty(0xf0c04a),
  tank_finned:   (c) => floatyFinned(),
  tank_twin:     (c) => floatyTwin(),
  tank_beachball:(c) => floatyBall(),
  tank_hibiscus: (c) => floatyPetal(),
  tank_thunder:  (c) => floatyThunder(),
  tank_swan:     (c) => floatySwan(),
  tank_donut:    (c) => floatyDonut(),
  tank_flamingo: (c) => floatyFlamingo(),
  tank_shark:    (c) => floatyShark(),
};
function floaty(c) {
  const g = new THREE.Group();
  const ring = M(new THREE.TorusGeometry(0.3, 0.1, 8, 16), c);
  ring.position.set(0, 0.62, -0.62);
  ring.rotation.x = 0.5;
  g.add(ring);
  return g;
}
function floatyFinned() {
  const g = floaty(0x59b7e8);
  const fin = M(new THREE.ConeGeometry(0.10, 0.26, 3), 0x1f4f5e);
  fin.position.set(0, 0.92, -0.62);
  fin.rotation.y = Math.PI / 2;
  g.add(fin);
  return g;
}
function floatyTwin() {
  const g = new THREE.Group();
  for (const s of [-1, 1]) {
    const ring = M(new THREE.TorusGeometry(0.19, 0.07, 8, 14), 0xfff7ea);
    ring.position.set(s * 0.22, 0.60, -0.62);
    ring.rotation.x = 0.5;
    g.add(ring);
  }
  return g;
}
function floatyBall() {
  const g = new THREE.Group();
  const ball = M(new THREE.SphereGeometry(0.30, 12, 10), 0xfff7ea);
  ball.position.set(0, 0.68, -0.66);
  g.add(ball);
  const cols = [0xe2574c, 0x2fe6c8, 0xf7c04a, 0xff5fa2];
  for (let i = 0; i < 4; i++) {
    const seg = M(new THREE.SphereGeometry(0.302, 12, 10, (i / 4) * Math.PI * 2, Math.PI / 4), cols[i]);
    seg.position.set(0, 0.68, -0.66);
    g.add(seg);
  }
  return g;
}
function floatySwan() {
  const g = floaty(0xfff7ea);
  const neck = M(new THREE.CylinderGeometry(0.05, 0.07, 0.34, 8), 0xfff7ea);
  neck.position.set(0, 0.90, -0.50);
  neck.rotation.x = -0.35;
  const head = M(new THREE.SphereGeometry(0.09, 8, 6), 0xfff7ea);
  head.position.set(0, 1.08, -0.44);
  const beak = M(new THREE.ConeGeometry(0.035, 0.10, 5), 0xff9a4d);
  beak.position.set(0, 1.07, -0.35);
  beak.rotation.x = Math.PI / 2;
  g.add(neck, head, beak);
  return g;
}
function floatyDonut() {
  const g = new THREE.Group();
  const ring = M(new THREE.TorusGeometry(0.3, 0.11, 10, 18), 0xf6d5a8);
  ring.position.set(0, 0.62, -0.62);
  ring.rotation.x = 0.5;
  const ice = M(new THREE.TorusGeometry(0.30, 0.095, 10, 18), 0xff9ec4);
  ice.position.set(0, 0.655, -0.62);
  ice.rotation.x = 0.5;
  g.add(ring, ice);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const sp = M(new THREE.BoxGeometry(0.04, 0.015, 0.015), [0xffffff, 0x2fe6c8, 0xf7c04a][i % 3]);
    sp.position.set(Math.cos(a) * 0.30, 0.73, -0.62 + Math.sin(a) * 0.16);
    sp.rotation.y = a;
    g.add(sp);
  }
  return g;
}
function floatyFlamingo() {
  const g = floaty(0xff9ec4);
  const neck = M(new THREE.CylinderGeometry(0.04, 0.055, 0.40, 8), 0xff9ec4);
  neck.position.set(0, 0.94, -0.52);
  neck.rotation.x = -0.28;
  const head = M(new THREE.SphereGeometry(0.08, 8, 6), 0xff9ec4);
  head.position.set(0, 1.14, -0.46);
  const beak = M(new THREE.ConeGeometry(0.03, 0.12, 5), 0x1c1712);
  beak.position.set(0, 1.12, -0.36);
  beak.rotation.x = Math.PI / 2;
  g.add(neck, head, beak);
  return g;
}
// ============================================================================
// GREAT WHITE FLOAT — the Surf Punk crown jewel. 4 shells.
//
// This was the DEFAULT TORUS with a triangle stuck on top. Two meshes, and one of
// them was shared with the free starter item.
//
// It's a real inflatable shark now: a body, a snout, a swept dorsal fin, pectoral
// fins, a tail, gills, teeth, and the eye. A pool shark you'd actually recognise
// from across a beach — and one that's funny, which matters, because the funniest
// item in the shop is very often the best seller.
// ============================================================================
function floatyShark() {
  const g = new THREE.Group();
  const Y = 0.66, Z = -0.62;
  const GREY = 0x6b8ea3, DARK = 0x4a6b7d, BELLY = 0xe8eef2;

  // the BODY — a stretched capsule, fat in the middle
  const shBody = M(new THREE.CapsuleGeometry(0.26, 0.52, 6, 12), GREY);
  shBody.position.set(0, Y, Z);
  shBody.rotation.z = Math.PI / 2;
  g.add(shBody);
  // the pale belly
  const shBelly = M(new THREE.CapsuleGeometry(0.21, 0.48, 5, 10), BELLY);
  shBelly.position.set(0, Y - 0.10, Z);
  shBelly.rotation.z = Math.PI / 2;
  shBelly.scale.y = 0.55;
  g.add(shBelly);

  // the SNOUT, tapering forward
  const shSnout = M(new THREE.ConeGeometry(0.25, 0.34, 10), GREY);
  shSnout.position.set(0.46, Y + 0.02, Z);
  shSnout.rotation.z = -Math.PI / 2;
  g.add(shSnout);

  // THE DORSAL FIN — swept back, the silhouette everyone knows
  const shDorsal = M(new THREE.ConeGeometry(0.16, 0.40, 3), DARK);
  shDorsal.position.set(-0.04, Y + 0.36, Z);
  shDorsal.rotation.y = Math.PI / 2;
  shDorsal.rotation.z = -0.30;
  g.add(shDorsal);

  // pectoral fins
  for (const s of [-1, 1]) {
    const shPec = M(new THREE.ConeGeometry(0.10, 0.30, 3), DARK);
    shPec.position.set(0.14, Y - 0.10, Z + s * 0.24);
    shPec.rotation.x = s * 1.25;
    shPec.rotation.z = -0.35;
    g.add(shPec);
  }

  // the TAIL — two flukes
  for (const s of [-1, 1]) {
    const shFluke = M(new THREE.ConeGeometry(0.11, 0.30, 3), DARK);
    shFluke.position.set(-0.52, Y + s * 0.16, Z);
    shFluke.rotation.z = Math.PI / 2 + s * 0.55;
    shFluke.rotation.y = Math.PI / 2;
    g.add(shFluke);
  }

  // GILLS — five little slashes. Nobody would miss them, and everybody notices.
  for (let i = 0; i < 5; i++) {
    const shGill = M(new THREE.BoxGeometry(0.015, 0.11, 0.02), DARK);
    shGill.position.set(0.20 - i * 0.045, Y + 0.02, Z + 0.245);
    shGill.rotation.z = 0.2;
    g.add(shGill);
  }

  // the MOUTH, and the teeth
  const shMouth = M(new THREE.BoxGeometry(0.20, 0.05, 0.30), 0x2c2620);
  shMouth.position.set(0.42, Y - 0.11, Z);
  shMouth.rotation.z = -0.2;
  g.add(shMouth);
  for (let i = 0; i < 6; i++) {
    const shTooth = M(new THREE.ConeGeometry(0.022, 0.06, 3), 0xfffdf0);
    shTooth.position.set(0.44, Y - 0.09, Z - 0.11 + i * 0.045);
    shTooth.rotation.x = Math.PI;
    g.add(shTooth);
  }

  // the eye, and the little white glint in it
  for (const s of [-1, 1]) {
    const shEye = M(new THREE.SphereGeometry(0.045, 7, 6), 0x1c1712);
    shEye.position.set(0.30, Y + 0.08, Z + s * 0.19);
    g.add(shEye);
    const shGlint = M(new THREE.SphereGeometry(0.016, 5, 4), 0xffffff);
    shGlint.position.set(0.325, Y + 0.10, Z + s * 0.205);
    g.add(shGlint);
  }

  // and the valve, because it IS an inflatable
  const shValve = M(new THREE.CylinderGeometry(0.035, 0.045, 0.06, 6), 0xd8dde3);
  shValve.position.set(-0.30, Y + 0.24, Z + 0.18);
  shValve.rotation.z = -0.4;
  g.add(shValve);

  return g;
}

// ---- BEACH GEAR (the tool on the rear deck — CAR space) ----
const GEAR_SHAPES = {
  // the pieces the sets needed. Every one of these used to fall through to a
  // generic blob, so a "Tiki Torch" and a "Golden Oar" were the same object.
  tool_torch:     () => tikiTorch(),        // TIKI
  tool_scythe:    () => stormHarpoon(),     // STORM
  tool_glaive:    () => goldenOar(),        // GOLDEN HOUR
  tool_sunbrella: () => sunbrella(),        // GOLDEN HOUR
  tool_kite:      () => stormKite(),        // STORM
  tool_bokken:    (c) => foamNoodle(),
  tool_fan:       (c) => parasol(),
  tool_katana:    (c) => surfboard(),
  tool_naginata:  (c) => lifeBuoy(),
  tool_multitool: (c) => gearSimple(0x8a5f33, 0xd9d2c4, 0.5),
  tool_wrench:    (c) => gearSimple(0x8a5f33, 0x9aa3ad, 0.5),
  tool_drill:     (c) => superSoaker(),
  tool_chicken:   (c) => flamingoToy(),
  tool_noodle:    (c) => foamNoodle(),
  tool_parasol:   (c) => parasol(),
  tool_surfboard: (c) => surfboard(),
  tool_buoy:      (c) => lifeBuoy(),
  tool_pistols:   (c) => waterPistols(),
  tool_cooler:    (c) => coolerBox(),
  tool_boombox:   (c) => boombox(),
  tool_guitar:    (c) => ukulele(),
  tool_kite:      (c) => kiteTool(),
  tool_trident:   (c) => trident(),
};
function gearSimple(handleC, headC, len) {
  const g = new THREE.Group();
  const handle = M(new THREE.CylinderGeometry(0.035, 0.035, len, 6), handleC);
  handle.position.set(-0.5, 0.68, -0.9);
  handle.rotation.z = 0.5;
  const head = M(new THREE.BoxGeometry(0.16, 0.10, 0.06), headC);
  head.position.set(-0.66, 0.85, -0.9);
  g.add(handle, head);
  return g;
}
function superSoaker() {
  const g = new THREE.Group();
  const body = M(new THREE.BoxGeometry(0.14, 0.14, 0.44), 0x2fe6c8);
  body.position.set(-0.52, 0.78, -0.92);
  const tank = M(new THREE.CylinderGeometry(0.10, 0.10, 0.20, 10), 0xff5a3c);
  tank.position.set(-0.52, 0.94, -0.98);
  tank.rotation.x = Math.PI / 2;
  const nozzle = M(new THREE.CylinderGeometry(0.035, 0.05, 0.16, 8), 0xfff7ea);
  nozzle.position.set(-0.52, 0.78, -0.66);
  nozzle.rotation.x = Math.PI / 2;
  g.add(body, tank, nozzle);
  return g;
}
function flamingoToy() {
  const g = new THREE.Group();
  const body = M(new THREE.SphereGeometry(0.14, 10, 8), 0xff9ec4);
  body.position.set(-0.54, 0.82, -0.94);
  const neck = M(new THREE.CylinderGeometry(0.03, 0.04, 0.26, 6), 0xff9ec4);
  neck.position.set(-0.54, 1.00, -0.90);
  neck.rotation.x = -0.3;
  const head = M(new THREE.SphereGeometry(0.06, 8, 6), 0xff9ec4);
  head.position.set(-0.54, 1.14, -0.86);
  g.add(body, neck, head);
  return g;
}
function foamNoodle() {
  const g = new THREE.Group();
  for (let i = 0; i < 5; i++) {
    const seg = M(new THREE.CylinderGeometry(0.07, 0.07, 0.22, 8), i % 2 ? 0x2fe6c8 : 0xff5fa2);
    seg.position.set(-0.55, 0.74, -0.55 - i * 0.22);
    seg.rotation.x = Math.PI / 2;
    g.add(seg);
  }
  return g;
}
function parasol() {
  const g = new THREE.Group();
  const pole = M(new THREE.CylinderGeometry(0.022, 0.022, 0.70, 6), 0x8a5f33);
  pole.position.set(-0.55, 0.95, -0.95);
  pole.rotation.z = 0.25;
  const canopy = M(new THREE.ConeGeometry(0.34, 0.20, 10), 0xff5a3c);
  canopy.position.set(-0.63, 1.30, -0.95);
  g.add(pole, canopy);
  return g;
}
function surfboard() {
  const g = new THREE.Group();
  const board = M(new THREE.CapsuleGeometry(0.13, 0.76, 4, 8), 0xfff7ea);
  board.position.set(-0.56, 0.86, -0.92);
  board.rotation.x = Math.PI / 2;
  board.rotation.z = 0.20;
  board.scale.z = 0.28;
  const stripe = M(new THREE.BoxGeometry(0.04, 0.90, 0.02), 0xe2574c);
  stripe.position.set(-0.56, 0.88, -0.92);
  stripe.rotation.x = Math.PI / 2;
  stripe.rotation.z = 0.20;
  g.add(board, stripe);
  return g;
}
// ============================================================================
// RESCUE BUOY — the Lifeguard crown jewel. 4 shells.
//
// This was a TORUS with four white boxes stuck to it. The icon of the whole
// Lifeguard set — the most recognisable beach object there is — rendered as a
// ring with some tape on it.
//
// A real rescue buoy is a hard torpedo float: a moulded body with a keel, grab
// handles down each side, a rope coiled round it, a snap hook, and a REFLECTIVE
// STRIPE. Everyone on earth recognises this object. It should look like it.
// ============================================================================
function lifeBuoy() {
  const g = new THREE.Group();
  const X = -0.54, Y = 0.84, Z = -0.94;
  const RED = 0xff5a3c, DEEP = 0xd13d22, WHITE = 0xfff7ea;

  // the TORPEDO body — a capsule, not a ring
  const hull = M(new THREE.CapsuleGeometry(0.13, 0.44, 6, 12), RED);
  hull.position.set(X, Y, Z);
  hull.rotation.x = Math.PI / 2;
  g.add(hull);

  // the moulded nose and tail caps
  for (const s of [-1, 1]) {
    const cap = M(new THREE.SphereGeometry(0.135, 10, 8), DEEP);
    cap.position.set(X, Y, Z + s * 0.30);
    cap.scale.z = 0.6;
    g.add(cap);
  }

  // the KEEL running underneath — the fin that makes it track through water
  const keel = M(new THREE.BoxGeometry(0.03, 0.10, 0.50), DEEP);
  keel.position.set(X, Y - 0.16, Z);
  g.add(keel);

  // the REFLECTIVE STRIPE — the detail that says "rescue equipment"
  const stripe = M(new THREE.CylinderGeometry(0.135, 0.135, 0.09, 12), WHITE);
  stripe.position.set(X, Y, Z);
  stripe.rotation.x = Math.PI / 2;
  g.add(stripe);
  const stripe2 = M(new THREE.CylinderGeometry(0.137, 0.137, 0.03, 12), 0xf5a623);
  stripe2.position.set(X, Y, Z);
  stripe2.rotation.x = Math.PI / 2;
  g.add(stripe2);

  // GRAB HANDLES down each side — three a side, moulded in
  for (const s of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const handle = M(new THREE.TorusGeometry(0.045, 0.014, 5, 9, Math.PI), WHITE);
      handle.position.set(X + s * 0.135, Y + 0.02, Z - 0.16 + i * 0.16);
      handle.rotation.y = s > 0 ? Math.PI / 2 : -Math.PI / 2;
      handle.rotation.z = Math.PI;
      g.add(handle);
    }
  }

  // the ROPE, coiled round the tail
  for (let i = 0; i < 5; i++) {
    const coil = M(new THREE.TorusGeometry(0.145 - i * 0.004, 0.016, 5, 12), 0xf0e2bd);
    coil.position.set(X, Y, Z - 0.20 - i * 0.035);
    coil.rotation.x = Math.PI / 2;
    g.add(coil);
  }
  // and a length of it trailing off
  const tail = M(new THREE.CylinderGeometry(0.016, 0.016, 0.28, 5), 0xf0e2bd);
  tail.position.set(X + 0.10, Y - 0.06, Z - 0.36);
  tail.rotation.set(0.9, 0, 0.5);
  g.add(tail);

  // the SNAP HOOK on the end
  const hook = M(new THREE.TorusGeometry(0.038, 0.012, 5, 10, Math.PI * 1.5), 0xd8dde3);
  hook.position.set(X + 0.17, Y - 0.16, Z - 0.44);
  hook.rotation.set(0.6, 0.4, 0);
  g.add(hook);

  return g;
}
function waterPistols() {
  const g = new THREE.Group();
  for (const s of [-1, 1]) {
    const body = M(new THREE.BoxGeometry(0.09, 0.09, 0.22), s < 0 ? 0x2fe6c8 : 0xff5a3c);
    body.position.set(-0.50 + s * 0.10, 0.76, -0.92);
    const grip = M(new THREE.BoxGeometry(0.07, 0.14, 0.07), 0x1c1712);
    grip.position.set(-0.50 + s * 0.10, 0.66, -0.98);
    g.add(body, grip);
  }
  return g;
}
function coolerBox() {
  const g = new THREE.Group();
  const box = M(new THREE.BoxGeometry(0.34, 0.24, 0.26), 0xfff7ea);
  box.position.set(-0.50, 0.80, -0.96);
  const lid = M(new THREE.BoxGeometry(0.36, 0.05, 0.28), 0x2fe6c8);
  lid.position.set(-0.50, 0.94, -0.96);
  const latch = M(new THREE.BoxGeometry(0.05, 0.05, 0.03), 0xf0c04a);
  latch.position.set(-0.33, 0.88, -0.96);
  g.add(box, lid, latch);
  return g;
}
function boombox() {
  const g = new THREE.Group();
  const body = M(new THREE.BoxGeometry(0.40, 0.22, 0.14), 0x1c1712);
  body.position.set(-0.50, 0.82, -0.96);
  for (const s of [-1, 1]) {
    const sp = M(new THREE.CylinderGeometry(0.07, 0.07, 0.03, 12), 0x9aa3ad);
    sp.position.set(-0.50 + s * 0.12, 0.82, -0.89);
    sp.rotation.x = Math.PI / 2;
    g.add(sp);
  }
  const handle = M(new THREE.TorusGeometry(0.10, 0.015, 6, 12, Math.PI), 0x9aa3ad);
  handle.position.set(-0.50, 0.93, -0.96);
  g.add(body, handle);
  return g;
}
function ukulele() {
  const g = new THREE.Group();
  const body = M(new THREE.SphereGeometry(0.15, 10, 8), 0xd9a566);
  body.scale.set(1, 1.2, 0.35);
  body.position.set(-0.54, 0.80, -0.98);
  const neck = M(new THREE.BoxGeometry(0.05, 0.36, 0.04), 0x8a5f33);
  neck.position.set(-0.54, 1.04, -0.98);
  const head = M(new THREE.BoxGeometry(0.08, 0.10, 0.04), 0x1c1712);
  head.position.set(-0.54, 1.24, -0.98);
  g.add(body, neck, head);
  return g;
}
function kiteTool() {
  const g = new THREE.Group();
  const kite = M(new THREE.PlaneGeometry(0.34, 0.34), 0xff5fa2, { side: THREE.DoubleSide });
  kite.position.set(-0.58, 1.05, -0.98);
  kite.rotation.z = Math.PI / 4;
  const spool = M(new THREE.CylinderGeometry(0.05, 0.05, 0.10, 8), 0x8a5f33);
  spool.position.set(-0.52, 0.72, -0.94);
  spool.rotation.z = Math.PI / 2;
  g.add(kite, spool);
  return g;
}
function trident() {
  const g = new THREE.Group();
  const shaft = M(new THREE.CylinderGeometry(0.025, 0.025, 0.80, 6), 0xf0c04a);
  shaft.position.set(-0.55, 0.98, -0.95);
  shaft.rotation.z = 0.22;
  g.add(shaft);
  for (let i = -1; i <= 1; i++) {
    const p = M(new THREE.ConeGeometry(0.035, 0.20, 5), 0xf0c04a);
    p.position.set(-0.68 + i * 0.09, 1.42, -0.95);
    g.add(p);
  }
  return g;
}

// ---- TOW ROPES (coil on the flank — CAR space) ----
// A cooler on the FLANK, not on the rear deck. `coolerBox()` already exists and is
// mounted where GEAR goes (-0.50, 0.80, -0.96) — it was built as a gear item. The
// belt slot lives on the kart's right side, so this is its own small version
// rather than a working mesh dragged out of position.
function towedCooler() {
  const g = new THREE.Group();
  const box = M(new THREE.BoxGeometry(0.30, 0.20, 0.22), 0xf5a623);
  box.position.set(0.60, 0.52, -0.16);
  const lid = M(new THREE.BoxGeometry(0.32, 0.04, 0.24), 0xfff1d6);
  lid.position.set(0.60, 0.64, -0.16);
  const latch = M(new THREE.BoxGeometry(0.05, 0.04, 0.02), 0xd8dde3);
  latch.position.set(0.60, 0.59, -0.05);
  g.add(box, lid, latch);
  return g;
}

const BELT_SHAPES = {
  belt_coil:    () => ropeCoil(0xe8dcc0),   // SURF PUNK: Coiled Rope
  belt_cooler:  () => towedCooler(),        // GOLDEN HOUR: Golden Cooler
  belt_holster: (c) => coil(0x8a5f33),
  belt_obi:     (c) => sashBelt(),
  belt_utility: (c) => coil(c),
  belt_rope:    (c) => coil(0xd9a566),
  belt_chain:   (c) => chainCoil(),
  belt_anchor:  (c) => anchorBelt(),
  belt_hook:    (c) => hookBelt(),
};
function coil(c) {
  const g = new THREE.Group();
  const t = M(new THREE.TorusGeometry(0.14, 0.05, 6, 12), c);
  t.position.set(0.58, 0.50, -0.20);
  t.rotation.y = Math.PI / 2;
  g.add(t);
  return g;
}
function chainCoil() {
  const g = new THREE.Group();
  for (let i = 0; i < 5; i++) {
    const link = M(new THREE.TorusGeometry(0.05, 0.016, 6, 10), 0x9aa3ad);
    link.position.set(0.58, 0.50 - i * 0.02, -0.10 - i * 0.07);
    link.rotation.y = Math.PI / 2;
    link.rotation.x = (i % 2) * Math.PI / 2;
    g.add(link);
  }
  return g;
}
function anchorBelt() {
  const g = new THREE.Group();
  const shaft = M(new THREE.BoxGeometry(0.03, 0.26, 0.03), 0x9aa3ad);
  shaft.position.set(0.58, 0.50, -0.20);
  const arms = M(new THREE.TorusGeometry(0.10, 0.02, 6, 12, Math.PI), 0x9aa3ad);
  arms.position.set(0.58, 0.40, -0.20);
  arms.rotation.y = Math.PI / 2;
  arms.rotation.z = Math.PI;
  const ring = M(new THREE.TorusGeometry(0.045, 0.015, 6, 10), 0x9aa3ad);
  ring.position.set(0.58, 0.64, -0.20);
  ring.rotation.y = Math.PI / 2;
  g.add(shaft, arms, ring);
  return g;
}
function hookBelt() {
  const g = new THREE.Group();
  const hook = M(new THREE.TorusGeometry(0.09, 0.022, 6, 12, Math.PI * 1.4), 0xf0c04a);
  hook.position.set(0.58, 0.50, -0.20);
  hook.rotation.y = Math.PI / 2;
  const eye = M(new THREE.TorusGeometry(0.035, 0.014, 6, 10), 0xf0c04a);
  eye.position.set(0.58, 0.62, -0.20);
  eye.rotation.y = Math.PI / 2;
  g.add(hook, eye);
  return g;
}


function racingHelm(c) {
  const g = new THREE.Group();
  const shell = M(new THREE.SphereGeometry(0.32, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.62), c);
  shell.position.y = 0.52;
  const crest = M(new THREE.BoxGeometry(0.05, 0.10, 0.44), 0xfff7ea);
  crest.position.set(0, CROWN + 0.02, -0.02);
  g.add(shell, crest);
  return g;
}
function abyssRebreather() {
  const g = new THREE.Group();
  const mask = M(new THREE.SphereGeometry(0.20, 12, 10), 0x0b3140, { transparent: true, opacity: 0.85 });
  mask.position.set(0, 0.44, FACE_Z + 0.02);
  const glowRing = M(new THREE.TorusGeometry(0.13, 0.022, 8, 16), 0x2fe6c8);
  glowRing.position.set(0, 0.44, FACE_Z + 0.14);
  for (const s of [-1, 1]) {
    const tank = M(new THREE.CylinderGeometry(0.05, 0.05, 0.26, 8), 0x9aa3ad);
    tank.position.set(s * 0.14, 0.22, -0.16);
    g.add(tank);
  }
  g.add(mask, glowRing);
  return g;
}
function headbandScarf(c) {
  const g = new THREE.Group();
  const band = M(new THREE.TorusGeometry(0.285, 0.04, 8, 18), c);
  band.rotation.x = Math.PI / 2;
  band.position.y = 0.62;
  for (const s of [-1, 1]) {
    const tail = M(new THREE.BoxGeometry(0.05, 0.03, 0.30), c);
    tail.position.set(s * 0.06, 0.60, -0.32);
    tail.rotation.x = -0.35;
    tail.rotation.y = s * 0.15;
    g.add(tail);
  }
  g.add(band);
  return g;
}
function sashShape() {
  const g = new THREE.Group();
  const sash = M(new THREE.BoxGeometry(0.09, 0.42, 0.05), 0xf0c04a);
  sash.position.set(0.05, 0.20, 0.16);
  sash.rotation.z = 0.45;
  const rosette = M(new THREE.CylinderGeometry(0.07, 0.07, 0.03, 12), 0xe2574c);
  rosette.rotation.x = Math.PI / 2;
  rosette.position.set(0.16, 0.06, 0.18);
  g.add(sash, rosette);
  return g;
}
function sashBelt() {
  const g = new THREE.Group();
  const wrap = M(new THREE.TorusGeometry(0.15, 0.055, 8, 14), 0xe2574c);
  wrap.position.set(0.58, 0.50, -0.20);
  wrap.rotation.y = Math.PI / 2;
  const knot = M(new THREE.BoxGeometry(0.10, 0.10, 0.08), 0xf0c04a);
  knot.position.set(0.62, 0.50, -0.20);
  g.add(wrap, knot);
  return g;
}


function floatyPetal() {
  // a hibiscus flower ring — five fat petals around the seat back
  const g = new THREE.Group();
  const core = M(new THREE.SphereGeometry(0.11, 10, 8), 0xf7c04a);
  core.position.set(0, 0.62, -0.62);
  g.add(core);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const petal = M(new THREE.SphereGeometry(0.15, 10, 8), 0xff5fa2);
    petal.scale.set(1, 0.45, 1.25);
    petal.position.set(Math.cos(a) * 0.24, 0.62, -0.62 + Math.sin(a) * 0.24);
    petal.rotation.y = -a;
    g.add(petal);
  }
  return g;
}
function floatyThunder() {
  // a storm-wave floaty: a ring with a lightning bolt standing off it
  const g = new THREE.Group();
  const ring = M(new THREE.TorusGeometry(0.3, 0.1, 8, 16), 0x2fe6c8);
  ring.position.set(0, 0.62, -0.62);
  ring.rotation.x = 0.5;
  g.add(ring);
  const pts = [[0.00, 0.92], [-0.09, 1.06], [-0.02, 1.06], [-0.10, 1.24]];
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
    const len = Math.hypot(x1 - x0, y1 - y0);
    const bolt = M(new THREE.BoxGeometry(0.05, len, 0.05), 0xf7c04a);
    bolt.position.set((x0 + x1) / 2, (y0 + y1) / 2, -0.62);
    bolt.rotation.z = Math.atan2(x1 - x0, y1 - y0) * -1;
    g.add(bolt);
  }
  return g;
}

function buildAttachments(loadout = {}, skin) {
  const grp = new THREE.Group();
  const add = (registry, id, fallback) => {
    if (!id) return;
    const make = registry[id] || fallback;
    if (make) grp.add(make(idHue(id)));
  };
  add(HEAD_SHAPES, loadout.headpiece, (c) => finShape(c));          // unknown headwear → a fin
  add(BREATHER_SHAPES, loadout.breather, (c) => snorkel(c, 0xff5a3c));
  add(SCARF_SHAPES, loadout.bandana, (c) => scarf(c, "tail"));
  return grp;
}

// Car-space attachments (floaty / gear / tow rope) — these hang off the KART,
// not the driver, so they're built separately and added to the car group.
function buildCarAttachments(loadout = {}) {
  const grp = new THREE.Group();
  const add = (registry, id, fallback) => {
    if (!id) return;
    const make = registry[id] || fallback;
    if (make) grp.add(make(idHue(id)));
  };
  // the floaty is alwaysFilled — every kart has one, default gold ring
  const floatyId = loadout.oxygenTank || "tank_standard";
  grp.add((FLOATY_SHAPES[floatyId] || ((c) => floaty(c)))(idHue(floatyId)));
  add(GEAR_SHAPES, loadout.weapon, (c) => gearSimple(0x8a5f33, c, 0.5));
  add(BELT_SHAPES, loadout.belt, (c) => coil(c));
  return grp;
}

// The Mythic loyalty pieces, and what each one does to the kart. Keyed by the
// cosmetic id so the renderer needs no server round-trip.
const MYTHIC = {
  bandana_trailblazer: { glow: 0xff5fa2, trail: "ribbon" },
  head_marshal:        { glow: 0x2fe6c8, halo: true, sparkle: true },
  body_goldplate:      { glow: 0xffb020, flames: true },
  shoes_goldspur:      { glow: 0x7fd8ff, trail: "comet", sparks: true },
};
function mythicOf(loadout = {}) {
  const on = [];
  for (const id of Object.values(loadout)) if (id && MYTHIC[id]) on.push(MYTHIC[id]);
  return on;
}

export function buildCar({ bodyColor = PALETTE.toyRed, capColor = null, skin = PALETTE.skin, loadout = {} } = {}) {
  const car = new THREE.Group();
  const body = new THREE.Group();

  // ============================================================================
  // THE CHASSIS
  //
  // What was here was a LATHE — a body of revolution. That is structurally the
  // wrong primitive for a kart: spun around an axis it can only ever be a BLOB.
  // It had no front, no back, no wheel arches and no cockpit floor. Worse, its
  // radius (0.62) was exactly the wheel offset (±0.62), so the shell SWALLOWED
  // all four wheels. On screen it was a featureless grey lump with a dome on top
  // and you genuinely could not tell it was a vehicle.
  //
  // This is a real kart: a low flat floor, a tapered nose, side pods, an open
  // cockpit you can see the driver sitting in, and a raised engine deck. The
  // wheels are OUTSIDE the bodywork, where wheels go.
  // ============================================================================
  // ---- THE KART SHELL ----
  //
  // There used to be exactly TWO shells with any identity — a regex for "mecha"
  // and one for "ronin". Every other kart in the game, whatever it was called,
  // came out in the same generic paint. "Neon Speedster", "Tiki Cruiser" and
  // "Storm Drifter" were all the same car.
  //
  // Each set's kart is its own machine now: paint, trim, and an accent that reads
  // from across the track. This is the single most valuable cosmetic in the game —
  // it's the thing everyone else SEES — so it has to be worth wanting.
  const SHELLS = {
    // LIFEGUARD — rescue red and white, like every lifeguard truck ever
    body_standard:  { paint: 0xe2574c, trim: 0xfff7ea, accent: 0xffffff },
    body_lifeguard: { paint: 0xd93b2b, trim: 0xffffff, accent: 0xf5a623 },
    // NEON ARCADE — black chassis, hot pink, chrome
    body_speedster: { paint: 0x1c1712, trim: 0xff5fa2, accent: 0x2fe6c8 },
    // MECHA PILOT — gunmetal panels, orange thruster trim
    body_mecha:     { paint: 0x9aa3ad, trim: 0xff8c42, accent: 0x2fa8d8 },
    // STORM CHASER — a thundercloud with a live wire down its flank
    body_ronin:     { paint: 0x3a4048, trim: 0x59b7e8, accent: 0xd8fbff },
    // TIKI KING — carved wood and burning orange
    body_tiki:      { paint: 0x8a5f33, trim: 0xff8c42, accent: 0xf5c542 },
    // GOLDEN HOUR — the prestige shell
    body_regalia:   { paint: 0xf5a623, trim: 0xfff1d6, accent: 0xffe08a },
  };
  const shell_ = SHELLS[loadout.body] || { paint: bodyColor, trim: 0xfff1d6, accent: 0xfff7ea };
  const paint = shell_.paint;
  const shellMat = toon(paint);
  const trimMat = toon(shell_.trim);
  const accentMat = toon(shell_.accent);
  const darkMat = toon(0x2c2620);

  // ---- the floor pan ----
  const floor = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.12, 2.05), shellMat);
  floor.position.y = 0.30;
  floor.castShadow = true;
  body.add(floor);

  // ============================================================================
  // THE NOSE
  //
  // This was a FOUR-SEGMENT CYLINDER — i.e. a pyramid — rotated 45 degrees. From
  // any normal viewing angle it presents a flat diamond face, so the front of the
  // kart read as a red SLAB bolted to the chassis. Gustavo looked at it and said
  // the car was on backwards, and he was right to: a flat plate is what the BACK
  // of a vehicle looks like.
  //
  // A real kart nose is LOW, WIDE and ROUNDED — a cone hugging the tarmac, with a
  // splitter under it and the leading edge swept back. It should look like it's
  // cutting the air even when it's parked.
  // ============================================================================

  // the main cone: low, wide, and properly round (16 segments, not 4)
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.44, 1.05, 16), shellMat);
  nose.rotation.x = Math.PI / 2;          // lay it down, pointing +Z
  nose.position.set(0, 0.34, 1.36);
  nose.scale.set(1.0, 1.0, 0.62);         // FLATTEN it: wide and low, not a dunce cap
  nose.castShadow = true;
  body.add(nose);

  // the splitter — a thin blade skimming the ground under the nose. This is the
  // single detail that says "racing car" rather than "shopping trolley".
  const splitter = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.04, 0.42), darkMat);
  splitter.position.set(0, 0.16, 1.52);
  body.add(splitter);
  // its little end plates
  for (const s of [-1, 1]) {
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.14, 0.36), accentMat);
    plate.position.set(s * 0.52, 0.22, 1.52);
    body.add(plate);
  }

  // the bonnet: a low hump running back from the nose to the cockpit, so the two
  // don't just abut each other with a step
  const bonnet = new THREE.Mesh(new THREE.SphereGeometry(0.42, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), shellMat);
  bonnet.position.set(0, 0.36, 0.86);
  bonnet.scale.set(1.0, 0.42, 1.35);
  body.add(bonnet);

  // the livery stripe over the nose — it reads instantly, even tiny on a minimap
  const chevron = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.03, 0.95), accentMat);
  chevron.position.set(0, 0.50, 1.28);
  body.add(chevron);

  // a headlight either side, because a kart with no face is a doorstop
  for (const s of [-1, 1]) {
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.10, 8, 6), toon(0xfff7ea));
    lamp.position.set(s * 0.22, 0.42, 1.62);
    lamp.scale.set(1, 0.8, 0.5);
    body.add(lamp);
  }

  // ---- SIDE PODS: they give the kart a waist, and the wheels tuck against them
  for (const s of [-1, 1]) {
    const pod = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.30, 1.15), shellMat);
    pod.position.set(s * 0.42, 0.44, 0.02);
    pod.castShadow = true;
    body.add(pod);
    const scoop = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.16, 0.22), darkMat);
    scoop.position.set(s * 0.47, 0.52, 0.62);
    body.add(scoop);
    const flankStripe = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.08, 1.05), trimMat);
    flankStripe.position.set(s * 0.56, 0.50, 0.02);
    body.add(flankStripe);
  }

  // ---- THE COCKPIT: an open tub. You can SEE the driver sitting in it.
  const tubFloor = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.06, 0.86), darkMat);
  tubFloor.position.set(0, 0.42, -0.02);
  body.add(tubFloor);
  for (const s of [-1, 1]) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.26, 0.86), shellMat);
    wall.position.set(s * 0.30, 0.56, -0.02);
    body.add(wall);
  }
  const dash = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.22, 0.10), shellMat);
  dash.position.set(0, 0.58, 0.44);
  body.add(dash);
  const steer = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.035, 6, 14), darkMat);
  steer.position.set(0, 0.68, 0.32);
  steer.rotation.x = 1.15;
  body.add(steer);

  // ---- THE ENGINE DECK: the silhouette you stare at for the whole race
  const deck = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.38, 0.62), shellMat);
  deck.position.set(0, 0.56, -0.72);
  deck.castShadow = true;
  body.add(deck);
  const engine = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.26, 0.44), darkMat);
  engine.position.set(0, 0.82, -0.72);
  body.add(engine);
  for (const s of [-1, 1]) {
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.44, 8), toon(0xb8bcc4));
    pipe.rotation.x = Math.PI / 2;
    pipe.position.set(s * 0.22, 0.72, -1.12);
    body.add(pipe);
  }

  // ---- rear wing on posts ----
  const wing = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.06, 0.30), trimMat);
  wing.position.set(0, 1.12, -1.02);
  const post1 = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.26, 0.06), darkMat);
  post1.position.set(0.36, 0.99, -1.02);
  const post2 = post1.clone();
  post2.position.x = -0.36;
  body.add(wing, post1, post2);

  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.02, 1.5), trimMat);
  stripe.position.set(0, 0.47, 0.55);
  body.add(stripe);

  // the erosion system tints this — the floor pan is the biggest painted surface
  const shell = floor;

  // ============================================================================
  // THE DRIVER
  //
  // This was SIX MESHES: a capsule, a sphere for a head, a sphere for a helmet,
  // and two spheres for hands. A snowman. And it's the CHARACTER — the thing every
  // costume in the shop hangs off, and the thing you look at for the entire race.
  //
  // A real anime kart driver: a torso with a racing suit and a zip, SHOULDERS,
  // arms that actually reach the wheel, gloves with cuffs, a neck, a face with a
  // nose and a chin, EYES, a helmet with a proper shell and a chin-strap. It reads
  // as a person at a glance and as a character up close, which is what makes
  // dressing it up worth paying for.
  // ============================================================================
  const driver = new THREE.Group();
  const suit = toon(bodyColor);
  const suitDark = toon(new THREE.Color(bodyColor).multiplyScalar(0.72).getHex());
  const skinMat = toon(skin);
  const helmCol = capColor ?? new THREE.Color(bodyColor).multiplyScalar(1.15).getHex();

  // ---- TORSO: a racing suit, tapered, with a zip and a collar ----
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.175, 0.18, 5, 10), suit);
  torso.position.y = 0.17;
  torso.castShadow = true;
  driver.add(torso);
  // the zip, running down the front
  const zip = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.28, 0.02), suitDark);
  zip.position.set(0, 0.18, 0.17);
  driver.add(zip);
  // a chest panel in the trim colour, so the suit has a design
  const panel = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.07, 0.02), toon(0xfff7ea));
  panel.position.set(0, 0.27, 0.175);
  driver.add(panel);
  // the collar
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.035, 6, 12), suitDark);
  collar.position.y = 0.33;
  collar.rotation.x = Math.PI / 2;
  driver.add(collar);

  // ---- SHOULDERS ----
  for (const s of [-1, 1]) {
    const shoulder = new THREE.Mesh(new THREE.SphereGeometry(0.085, 8, 6), suit);
    shoulder.position.set(s * 0.17, 0.28, 0.02);
    driver.add(shoulder);
  }

  // ---- ARMS: upper arm, forearm, and a hand that REACHES THE WHEEL ----
  for (const s of [-1, 1]) {
    const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.10, 4, 7), suit);
    upper.position.set(s * 0.20, 0.24, 0.10);
    upper.rotation.z = s * 0.55;
    upper.rotation.x = -0.45;
    driver.add(upper);

    const fore = new THREE.Mesh(new THREE.CapsuleGeometry(0.048, 0.11, 4, 7), suit);
    fore.position.set(s * 0.21, 0.20, 0.24);
    fore.rotation.x = -1.15;
    fore.rotation.z = s * 0.20;
    driver.add(fore);

    // the GLOVE — a hand, and a cuff at the wrist
    const glove = new THREE.Mesh(new THREE.SphereGeometry(0.062, 8, 6), toon(0xfff1d6));
    glove.position.set(s * 0.16, 0.24, 0.34);
    glove.scale.set(1, 0.85, 1.2);
    driver.add(glove);
    const cuff = new THREE.Mesh(new THREE.TorusGeometry(0.055, 0.018, 5, 9), suitDark);
    cuff.position.set(s * 0.18, 0.23, 0.29);
    cuff.rotation.x = 0.5;
    driver.add(cuff);
    // a thumb, so it reads as gripping
    const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.020, 0.03, 3, 5), toon(0xfff1d6));
    thumb.position.set(s * 0.13, 0.28, 0.35);
    thumb.rotation.z = s * 0.7;
    driver.add(thumb);
  }

  // ---- NECK ----
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.085, 0.07, 8), skinMat);
  neck.position.y = 0.35;
  driver.add(neck);

  // ---- HEAD: a face, not a ball ----
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.235, 14, 12), skinMat);
  head.position.y = 0.48;
  head.scale.set(1, 1.06, 0.95);
  head.castShadow = true;
  driver.add(head);
  // a chin/jaw, so the head has a shape
  const jaw = new THREE.Mesh(new THREE.SphereGeometry(0.155, 10, 8), skinMat);
  jaw.position.set(0, 0.40, 0.06);
  jaw.scale.set(1, 0.72, 0.95);
  driver.add(jaw);
  // a nose. It's tiny and it changes everything.
  const nose_ = new THREE.Mesh(new THREE.ConeGeometry(0.030, 0.055, 5), skinMat);
  nose_.position.set(0, 0.46, 0.225);
  nose_.rotation.x = Math.PI / 2;
  driver.add(nose_);
  // EYES — the single most humanising detail there is
  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.038, 8, 6), toon(0xfffdf6));
    eye.position.set(s * 0.085, 0.505, 0.195);
    eye.scale.set(1.1, 1, 0.5);
    driver.add(eye);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.020, 6, 5), toon(0x2c2620));
    pupil.position.set(s * 0.085, 0.502, 0.222);
    pupil.scale.set(1, 1.2, 0.5);
    driver.add(pupil);
    // a brow — this is what gives an anime face its expression
    const brow = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.016, 0.02), toon(0x5a4632));
    brow.position.set(s * 0.085, 0.552, 0.205);
    brow.rotation.z = s * -0.18;
    driver.add(brow);
  }
  // ears
  for (const s of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.SphereGeometry(0.045, 6, 5), skinMat);
    ear.position.set(s * 0.225, 0.475, 0.01);
    ear.scale.set(0.5, 1, 0.8);
    driver.add(ear);
  }

  // ---- HELMET: a real shell, with a brim, a chin strap and a rear spoiler ----
  const helmet = new THREE.Mesh(
    new THREE.SphereGeometry(0.275, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.60),
    toon(helmCol)
  );
  helmet.position.y = 0.53;
  helmet.castShadow = true;
  driver.add(helmet);
  // the shell's rim
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.272, 0.022, 6, 18), toon(new THREE.Color(helmCol).multiplyScalar(0.75).getHex()));
  rim.position.y = 0.528;
  rim.rotation.x = Math.PI / 2;
  driver.add(rim);
  // a stripe over the crown
  const stripe_ = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.02, 0.50), toon(0xfff7ea));
  stripe_.position.set(0, 0.79, -0.02);
  driver.add(stripe_);
  // a rear spoiler, because it's a RACING helmet
  const spoil = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.035, 0.09), toon(new THREE.Color(helmCol).multiplyScalar(0.75).getHex()));
  spoil.position.set(0, 0.66, -0.26);
  spoil.rotation.x = -0.35;
  driver.add(spoil);
  // the chin strap
  for (const s of [-1, 1]) {
    const strap_ = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.16, 0.02), toon(0x2c2620));
    strap_.position.set(s * 0.20, 0.42, 0.02);
    strap_.rotation.z = s * 0.25;
    driver.add(strap_);
  }

  // the VISOR
  const visor = new THREE.Mesh(
    new THREE.SphereGeometry(0.252, 14, 9, -0.85, 1.7, Math.PI * 0.32, Math.PI * 0.30),
    toon(0x59b7e8, { transparent: true, opacity: 0.62 })
  );
  visor.position.y = 0.50;
  driver.add(visor);
  // its chrome trim
  const vtrim = new THREE.Mesh(new THREE.TorusGeometry(0.255, 0.012, 5, 14, Math.PI * 0.95), toon(0xd8dde3));
  vtrim.position.y = 0.575;
  vtrim.rotation.x = Math.PI / 2 - 0.42;
  vtrim.rotation.z = Math.PI * 0.52;
  driver.add(vtrim);
  driver.add(buildAttachments(loadout, skin));
  driver.position.set(0, 0.55, -0.12);
  body.add(driver);

  // floaty (alwaysFilled), beach gear, and tow rope — every one of these is a
  // registered shape with its own anchor, not one hardcoded ring/tool/coil.
  body.add(buildCarAttachments(loadout));

  // pennant flag (kept from the classic kart — it reads speed)
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.9, 6), toon(0xd9d2c4));
  pole.position.set(-0.5, 1.1, -1.0);
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.26), toon(0xfff1d6, { side: THREE.DoubleSide }));
  flag.position.set(-0.28, 1.4, -1.0);
  body.add(pole, flag);

  car.add(body);

  // ---- wheels (#9): one style, four corners ----
  // The wheels live on BODY, not on CAR, so the single "forward is +X" rotation
  // below turns the whole vehicle as one piece. They used to be parented to CAR
  // with their own compensating quarter-turn — which meant the chassis and the
  // wheels were in two different frames, and rotating one would have left the
  // other behind.
  const style = wheelStyle(loadout.shoes);
  const wheels = [];
  for (const [wx, wz] of [[0.62, 0.72], [-0.62, 0.72], [0.62, -0.78], [-0.62, -0.78]]) {
    const w = buildWheel(style);
    w.position.set(wx, 0.34, wz);
    // No compensating yaw. The wheel is built with its axle on X (see buildWheel),
    // and BODY is rotated so that X runs ACROSS the kart — which is exactly where
    // an axle belongs. The old `rotation.y = PI/2` here was cancelling a bug that
    // no longer exists, and stacking on top of the body rotation it turned the
    // wheels sideways.
    body.add(w);
    wheels.push(w);
  }

  // ---- MYTHIC AURA (loyalty only) ----
  const myth = mythicOf(loadout);
  const auras = [];
  if (myth.length) {
    for (const m of myth) {
      // a glowing shell around the kart
      const halo = new THREE.Mesh(
        new THREE.SphereGeometry(1.75, 16, 12),
        new THREE.MeshBasicMaterial({ color: m.glow, transparent: true, opacity: 0.13, side: THREE.BackSide, depthWrite: false })
      );
      halo.position.y = 0.7;
      car.add(halo);
      auras.push({ mesh: halo, kind: "halo", color: m.glow });

      // a crown of light above the driver
      if (m.halo) {
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(0.42, 0.05, 8, 24),
          new THREE.MeshBasicMaterial({ color: m.glow, transparent: true, opacity: 0.9, depthWrite: false })
        );
        ring.rotation.x = Math.PI / 2;
        ring.position.set(0, 1.62, -0.12);
        car.add(ring);
        auras.push({ mesh: ring, kind: "crown", color: m.glow });
      }
      // licks of flame off the shell
      if (m.flames) {
        for (let i = 0; i < 6; i++) {
          const f = new THREE.Mesh(
            new THREE.ConeGeometry(0.14, 0.55, 6),
            new THREE.MeshBasicMaterial({ color: i % 2 ? 0xffb020 : 0xff5a3c, transparent: true, opacity: 0.75, depthWrite: false })
          );
          const a = (i / 6) * Math.PI * 2;
          f.position.set(Math.cos(a) * 0.72, 0.75, Math.sin(a) * 0.9);
          car.add(f);
          auras.push({ mesh: f, kind: "flame", phase: i * 0.7 });
        }
      }
      // a trail streaming off the back
      if (m.trail) {
        for (let i = 0; i < 7; i++) {
          const seg = new THREE.Mesh(
            new THREE.PlaneGeometry(m.trail === "comet" ? 0.5 : 0.9, 0.34),
            new THREE.MeshBasicMaterial({ color: m.glow, transparent: true, opacity: 0.6 - i * 0.07, side: THREE.DoubleSide, depthWrite: false })
          );
          seg.position.set(0, 0.6 + i * 0.03, -1.25 - i * 0.42);
          car.add(seg);
          auras.push({ mesh: seg, kind: "trail", idx: i });
        }
      }
      // sparks / sparkle motes orbiting the kart
      if (m.sparks || m.sparkle) {
        for (let i = 0; i < 10; i++) {
          const s = new THREE.Mesh(
            new THREE.SphereGeometry(0.07, 6, 5),
            new THREE.MeshBasicMaterial({ color: m.glow, transparent: true, opacity: 0.95, depthWrite: false })
          );
          car.add(s);
          auras.push({ mesh: s, kind: "spark", phase: (i / 10) * Math.PI * 2, r: 1.2 + (i % 3) * 0.3 });
        }
      }
    }
  }

  // ============================================================
  // EROSION — THE CAR IS MADE OF SAND.
  // As you take hits, pieces of the shell are CUT AWAY and the raw sand inside
  // shows through: a rough, grainy core under a smooth painted skin. At full
  // erosion you're more hole than kart, and the next hit crumbles you.
  //
  // Built once, revealed progressively. Building meshes mid-race would hitch.
  // ============================================================
  const erosion = { chunks: [], core: null, trail: [] };
  {
    // the sand CORE — always there, hidden inside the shell until it's breached
    const core = new THREE.Mesh(
      new THREE.SphereGeometry(0.60, 12, 10),
      new THREE.MeshLambertMaterial({ color: 0xd4a763, flatShading: true })
    );
    core.scale.set(1.02, 0.60, 1.72);
    core.position.y = 0.44;
    core.visible = false;
    body.add(core);
    erosion.core = core;

    // 7 chunks of shell, each one a bite taken out of the bodywork. They're
    // scattered over the hull so the damage reads from any angle.
    const spots = [
      [0.42, 0.62, 0.55], [-0.46, 0.60, 0.30], [0.30, 0.66, -0.35],
      [-0.34, 0.58, -0.62], [0.50, 0.50, -0.05], [-0.20, 0.70, 0.72],
      [0.05, 0.55, -0.95],
    ];
    for (const [cx, cy, cz] of spots) {
      // the "hole": a ragged sand plug sitting where the paint used to be
      const hole = new THREE.Mesh(
        new THREE.DodecahedronGeometry(0.19, 0),
        new THREE.MeshLambertMaterial({ color: 0xc19052, flatShading: true })
      );
      hole.position.set(cx, cy, cz);
      hole.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      hole.visible = false;
      body.add(hole);

      // a darker rim, so the hole reads as DEPTH rather than a lump stuck on
      const rim = new THREE.Mesh(
        new THREE.TorusGeometry(0.20, 0.035, 6, 10),
        new THREE.MeshLambertMaterial({ color: 0x8a5f33, flatShading: true })
      );
      rim.position.set(cx, cy + 0.02, cz);
      rim.lookAt(cx * 3, (cy + 0.4) * 3, cz * 3);
      rim.visible = false;
      body.add(rim);

      erosion.chunks.push({ hole, rim });
    }

    // the SAND TRAIL: a stream of grains sloughing off a damaged kart and
    // settling on the road behind. The more eroded you are, the more you shed.
    for (let i = 0; i < 14; i++) {
      const grain = new THREE.Mesh(
        new THREE.TetrahedronGeometry(0.09, 0),
        new THREE.MeshLambertMaterial({ color: i % 2 ? 0xd4a763 : 0xe6c184, transparent: true, opacity: 0 })
      );
      grain.visible = false;
      car.add(grain);
      erosion.trail.push({ mesh: grain, t: 999, x: 0, y: 0, z: 0, vy: 0, vx: 0, vz: 0 });
    }
  }

  // ---------------------------------------------------------------------------
  // FORWARD IS +X.
  //
  // The chassis above is modelled along +Z (nose at z=+1.3, engine deck at
  // z=-0.72) because that's the natural way to lay a vehicle out. But the ENGINE
  // defines heading=0 as travelling along +X — so the kart rendered a full 90°
  // SIDEWAYS. You could see the driver's shoulder where the nose should be.
  //
  // The old lathe body hid this completely: a shape spun around an axis has no
  // front, so nothing looked wrong. The moment the kart had an actual nose, the
  // bug was obvious.
  //
  // Rotate the body ONCE, here, so the model's forward axis matches the engine's.
  // Everything downstream — cosmetics, auras, the erosion chunks — then lands in
  // the right place with no magic quarter-turns sprinkled through the code.
  // ---------------------------------------------------------------------------
  body.rotation.y = Math.PI / 2;

  car.userData = { wheels, driver, flag, baseY: 0, auras, mythic: myth.length > 0, erosion, shell, erosionLevel: 0 };
  return car;
}

export function animateCar(car, { speed = 0, steer = 0, offTrack = false, erosion = 0 }, dt) {
  const { wheels, driver, flag, auras, erosion: ero, shell } = car.userData;

  // ---- THE CAR FALLS APART ----
  // erosion runs 0 → 3 (ERODE_LIMIT). Each step cuts more of the shell away and
  // exposes the sand underneath; the kart also starts shedding a trail of grains
  // that settle on the road behind you and fade.
  if (ero) {
    const lvl = Math.max(0, Math.min(1, erosion / 3));
    car.userData.erosionLevel = lvl;

    // reveal chunks one at a time as the damage mounts
    const shown = Math.floor(lvl * ero.chunks.length + 0.0001);
    for (let i = 0; i < ero.chunks.length; i++) {
      const on = i < shown;
      const c = ero.chunks[i];
      if (c.hole.visible !== on) { c.hole.visible = on; c.rim.visible = on; }
      if (on) {
        // the exposed sand SETTLES — a slow, grainy shudder
        const t = performance.now() / 1000;
        c.hole.rotation.y += dt * 0.4;
        c.hole.scale.setScalar(0.9 + Math.sin(t * 3 + i) * 0.06);
      }
    }
    // the core shows through once you're properly holed
    if (ero.core) ero.core.visible = lvl > 0.28;
    // The paint dulls as it's scoured away.
    //
    // THIS BLOCK WAS THE PERFORMANCE BUG THAT MADE THE GAME UNPLAYABLE.
    // It used to also set `material.transparent = false` and `opacity = 1` here.
    // Both were pointless — they're already those values — but in three.js
    // `transparent` is part of the shader PROGRAM KEY. Assigning it at all, even
    // to the identical value, marks the material for recompilation. So every
    // frame, for every kart, three.js rebuilt and relinked the shader: 51% of all
    // CPU time went into getShaderInfoLog/getProgramInfoLog, frames took 1400ms
    // instead of 16, and the chase camera lerped across a huge gap each frame —
    // which is exactly the "stuttering like the rear-view mirror is being
    // spammed" you saw. The car felt unresponsive because the whole client was
    // running at 3fps.
    //
    // Only touch the colour, only when it actually changes, and never allocate.
    if (shell?.material) {
      if (!shell.userData._c0) {
        shell.userData._c0 = shell.material.color.clone();
        shell.userData._cTarget = new THREE.Color(0xc19052);   // allocated ONCE
        shell.userData._cLvl = -1;
      }
      // a colour lerp is only worth doing when the erosion has actually moved
      if (Math.abs(lvl - shell.userData._cLvl) > 0.01) {
        shell.userData._cLvl = lvl;
        shell.material.color.copy(shell.userData._c0).lerp(shell.userData._cTarget, lvl * 0.55);
      }
    }

    // ---- THE SAND TRAIL ----
    // Grains slough off a damaged kart, fall to the road, and fade. They do NOT
    // follow the car — once shed, they're left behind, which is the whole point.
    const shed = lvl * Math.min(1, Math.abs(speed) / 14);
    for (const g of ero.trail) {
      g.t += dt;
      if (g.t > 1.1) {
        // respawn a grain at the kart, but only if we're actually shedding
        if (shed > 0.02 && Math.random() < shed * 0.5) {
          g.t = 0;
          const a = Math.random() * Math.PI * 2;
          g.x = car.position.x + Math.cos(a) * 0.5;
          g.y = (car.userData.baseY || 0) + 0.5 + Math.random() * 0.3;
          g.z = car.position.z + Math.sin(a) * 0.5;
          g.vx = (Math.random() - 0.5) * 1.2;
          g.vz = (Math.random() - 0.5) * 1.2;
          g.vy = 0.6 + Math.random() * 0.8;
          g.mesh.visible = true;
        } else {
          g.mesh.visible = false;
          continue;
        }
      }
      // fall and settle. World-space, so the car drives away and leaves them.
      g.vy -= 7 * dt;
      g.x += g.vx * dt;
      g.z += g.vz * dt;
      g.y = Math.max((car.userData.baseY || 0) + 0.04, g.y + g.vy * dt);
      // the mesh is parented to the car, so subtract the car's transform to
      // pin the grain to the WORLD — otherwise the trail would ride along with
      // you and look like exhaust instead of debris.
      g.mesh.position.set(g.x - car.position.x, g.y - car.position.y, g.z - car.position.z);
      g.mesh.rotation.x += dt * 4;
      g.mesh.rotation.z += dt * 3;
      g.mesh.material.opacity = Math.max(0, 1 - g.t / 1.1) * 0.85;
    }
  }

  // MYTHIC: breathe, flicker, stream. The faster you go, the harder it burns.
  if (auras && auras.length) {
    const t = performance.now() / 1000;
    const spd = Math.min(1, Math.abs(speed) / 26);
    for (const a of auras) {
      if (a.kind === "halo") {
        a.mesh.material.opacity = 0.10 + Math.sin(t * 2.2) * 0.035 + spd * 0.08;
        const s = 1 + Math.sin(t * 1.7) * 0.03;
        a.mesh.scale.set(s, s, s);
      } else if (a.kind === "crown") {
        a.mesh.rotation.z += dt * 1.6;
        a.mesh.position.y = 1.62 + Math.sin(t * 2) * 0.06;
      } else if (a.kind === "flame") {
        const f = 0.7 + Math.sin(t * 12 + a.phase) * 0.35;
        a.mesh.scale.set(1, f + spd * 0.9, 1);
        a.mesh.material.opacity = 0.45 + spd * 0.4;
      } else if (a.kind === "trail") {
        a.mesh.material.opacity = Math.max(0, (0.55 - a.idx * 0.07) * (0.25 + spd));
        a.mesh.rotation.z = Math.sin(t * 6 - a.idx * 0.5) * 0.18;
      } else if (a.kind === "spark") {
        const ang = t * 1.4 + a.phase;
        a.mesh.position.set(Math.cos(ang) * a.r, 0.8 + Math.sin(t * 3 + a.phase) * 0.5, Math.sin(ang) * a.r);
        a.mesh.material.opacity = 0.5 + Math.sin(t * 8 + a.phase) * 0.45;
      }
    }
  }
  if (flag) flag.rotation.y = Math.sin(performance.now() * 0.012) * 0.5 - Math.min(1, Math.abs(speed) / 26) * 0.7;
  for (const w of wheels) {
    // ROLL. The `spin` group turns about X — which is the wheel's axle (see
    // buildWheel; the tyre, the rim and the spokes all agree on X now).
    w.children[0].rotation.x += speed * dt * 2.4;

    // STEER. The front pair yaws with the wheel.
    //
    // This used to steer toward `Math.PI/2 + fs` — it was re-applying, every
    // single frame, the compensating quarter-turn that buildCar used to need. I
    // removed that from the build (the wheel's axle is X natively now), but this
    // line kept yanking the front wheels back to sideways. Measured in the live
    // game: the rear wheels read almost correct while the fronts were 89% aligned
    // with the direction of travel — i.e. turned fully broadside.
    //
    // The rest position is ZERO. `fs` is the steering deflection on top of it.
    const fs = Math.max(-0.4, Math.min(0.4, steer * 0.4));
    if (w.position.z > 0) w.rotation.y += (fs - w.rotation.y) * Math.min(1, dt * 10);
  }
  const targetLean = -steer * Math.min(1, Math.abs(speed) / 14) * 0.22;
  driver.rotation.x += (targetLean - driver.rotation.x) * Math.min(1, dt * 8);
  const targetRoll = -steer * Math.min(1, Math.abs(speed) / 20) * 0.06;
  car.rotation.z += (targetRoll - car.rotation.z) * Math.min(1, dt * 6);
  // altitude-safe: judder is an OFFSET on baseY, never an absolute write —
  // this line used to hard-set y=0 and silently kept every kart off the bridge
  const judder = offTrack && Math.abs(speed) > 2 ? Math.sin(performance.now() * 0.04) * 0.03 : 0;
  car.position.y = (car.userData.baseY || 0) + judder;
}
