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
function wheelStyle(shoeId) {
  const known = {
    shoes_boots:   { tire: 0x2c2620, rim: 0xd9d2c4, hub: "disc" },
    shoes_sandals: { tire: 0x3a2f24, rim: 0xf0c04a, hub: "star" },
    shoes_flippers:{ tire: 0x1f4f5e, rim: 0x59b7e8, hub: "star" },
    shoes_cleats:  { tire: 0x241f1a, rim: 0xe2574c, hub: "bolt" },
  };
  if (known[shoeId]) return known[shoeId];
  if (!shoeId) return { tire: 0x2c2620, rim: 0xcfc7b8, hub: "disc" };
  return { tire: 0x2c2620, rim: idHue(shoeId), hub: (shoeId.length % 2) ? "star" : "bolt" };
}

function buildWheel(style) {
  const g = new THREE.Group();
  const tire = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.16, 10, 18), toon(style.tire));
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.20, 12), toon(style.rim));
  rim.rotation.z = Math.PI / 2;
  g.add(tire, rim);
  if (style.hub === "star") {
    for (let k = 0; k < 5; k++) {
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.26, 0.06), toon(style.rim));
      spoke.rotation.x = (k / 5) * Math.PI * 2;
      g.add(spoke);
    }
  } else if (style.hub === "bolt") {
    const bolt = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), toon(0xfff7ea));
    bolt.position.x = 0.11;
    g.add(bolt);
  }
  const spin = new THREE.Group();
  spin.add(g);
  const holder = new THREE.Group();
  holder.add(spin);
  return holder;   // holder(y-steer) → spin(rolls) → visuals
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
  head_shellcrown:(c) => crownShape(0xff9ec4, true),
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
function visorShape(c) {
  const g = new THREE.Group();
  const band = M(new THREE.TorusGeometry(0.28, 0.04, 8, 18), c);
  band.rotation.x = Math.PI / 2;
  band.position.y = 0.60;
  const lens = M(new THREE.SphereGeometry(0.30, 14, 8, -0.9, 1.8, Math.PI * 0.34, Math.PI * 0.26), c, { transparent: true, opacity: 0.75 });
  lens.position.y = 0.52;
  g.add(band, lens);
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
function haloShape(c) {
  const g = new THREE.Group();
  const ring = M(new THREE.TorusGeometry(0.24, 0.03, 8, 18), c);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = CROWN + 0.24;
  g.add(ring);
  return g;
}
function pineappleHat() {
  const g = new THREE.Group();
  const body = M(new THREE.SphereGeometry(0.20, 10, 8), 0xf7c04a);
  body.scale.y = 1.25;
  body.position.y = CROWN + 0.14;
  g.add(body);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const leaf = M(new THREE.ConeGeometry(0.045, 0.20, 4), 0x2a9d8f);
    leaf.position.set(Math.cos(a) * 0.07, CROWN + 0.38, Math.sin(a) * 0.07);
    leaf.rotation.z = Math.cos(a) * 0.4;
    leaf.rotation.x = Math.sin(a) * 0.4;
    g.add(leaf);
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
function wingedHelm(c) {
  const g = new THREE.Group();
  for (const s of [-1, 1]) {
    const wing = M(new THREE.ConeGeometry(0.10, 0.30, 3), 0xfff7ea);
    wing.position.set(s * 0.30, CROWN - 0.02, -0.04);
    wing.rotation.z = s * 1.25;
    wing.rotation.y = s * 0.3;
    g.add(wing);
  }
  return g;
}
function hornsShape(c) {
  const g = new THREE.Group();
  for (const s of [-1, 1]) {
    const horn = M(new THREE.ConeGeometry(0.075, 0.28, 6), c);
    horn.position.set(s * 0.20, CROWN + 0.10, -0.03);
    horn.rotation.z = s * -0.5;
    g.add(horn);
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
const SCARF_SHAPES = {
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
function floatyShark() {
  const g = floaty(0x6b8ea3);
  const fin = M(new THREE.ConeGeometry(0.13, 0.34, 3), 0x4a6b7d);
  fin.position.set(0, 0.98, -0.62);
  fin.rotation.y = Math.PI / 2;
  const snout = M(new THREE.ConeGeometry(0.13, 0.28, 8), 0x6b8ea3);
  snout.position.set(0, 0.62, -0.30);
  snout.rotation.x = Math.PI / 2;
  g.add(fin, snout);
  return g;
}

// ---- BEACH GEAR (the tool on the rear deck — CAR space) ----
const GEAR_SHAPES = {
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
function lifeBuoy() {
  const g = new THREE.Group();
  const ring = M(new THREE.TorusGeometry(0.24, 0.07, 8, 16), 0xff5a3c);
  ring.position.set(-0.56, 0.86, -0.94);
  ring.rotation.y = Math.PI / 2;
  g.add(ring);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const band = M(new THREE.BoxGeometry(0.03, 0.10, 0.15), 0xfff7ea);
    band.position.set(-0.56, 0.86 + Math.cos(a) * 0.24, -0.94 + Math.sin(a) * 0.24);
    band.rotation.x = -a;
    g.add(band);
  }
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
const BELT_SHAPES = {
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
  const isMecha = /mecha/.test(loadout.body || "");
  const isRonin = /ronin/.test(loadout.body || "");
  const paint = isMecha ? 0x9aa3ad : isRonin ? 0x3a3038 : bodyColor;
  const shellMat = toon(paint);
  const trimMat = toon(isRonin ? 0xe2574c : 0xfff1d6);
  const darkMat = toon(0x2c2620);

  // ---- the floor pan ----
  const floor = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.12, 2.05), shellMat);
  floor.position.y = 0.30;
  floor.castShadow = true;
  body.add(floor);

  // ---- THE NOSE: a wedge that tapers to a point. This is what tells you which
  //      way a kart is pointing at 90mph. The blob had nothing like it.
  const nose = new THREE.Mesh(new THREE.CylinderGeometry(0.10, 0.46, 0.86, 4, 1), shellMat);
  nose.rotation.x = -Math.PI / 2;
  nose.rotation.y = Math.PI / 4;
  nose.position.set(0, 0.40, 1.30);
  nose.castShadow = true;
  body.add(nose);
  const chevron = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.05, 0.30), trimMat);
  chevron.position.set(0, 0.52, 1.22);
  chevron.rotation.y = Math.PI / 4;
  body.add(chevron);

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

  const driver = new THREE.Group();
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.16, 4, 8), toon(bodyColor));
  torso.position.y = 0.16;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 14, 12), toon(skin));
  head.position.y = 0.48;
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.29, 14, 12, 0, Math.PI * 2, 0, Math.PI * 0.62), toon(capColor ?? new THREE.Color(bodyColor).multiplyScalar(1.15).getHex()));
  helmet.position.y = 0.52;
  const visor = new THREE.Mesh(new THREE.SphereGeometry(0.245, 12, 8, -0.7, 1.4, Math.PI * 0.34, Math.PI * 0.3), toon(0x59b7e8, { transparent: true, opacity: 0.85 }));
  visor.position.y = 0.5;
  const mittL = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), toon(0xfff1d6));
  mittL.position.set(0.16, 0.26, 0.3);
  const mittR = mittL.clone(); mittR.position.x = -0.16;
  driver.add(torso, head, helmet, visor, mittL, mittR);
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
  const style = wheelStyle(loadout.shoes);
  const wheels = [];
  for (const [wx, wz] of [[0.62, 0.72], [-0.62, 0.72], [0.62, -0.78], [-0.62, -0.78]]) {
    const w = buildWheel(style);
    w.position.set(wx, 0.34, wz);
    w.rotation.y = Math.PI / 2;
    car.add(w);
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
    w.children[0].rotation.x += speed * dt * 2.4;                       // roll
    const fs = Math.max(-0.4, Math.min(0.4, steer * 0.4));
    if (w.position.z > 0) w.rotation.y += ((Math.PI / 2 + fs) - w.rotation.y) * Math.min(1, dt * 10);  // front wheels steer
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
