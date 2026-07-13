// ============================================================
// SANDBOX GP — world builder. Everything static: sky, sun, the great sand
// plane, the packed-sand track ribbon (curbs, painted edges, checkered start
// line), and the oversized-toy scenery that sells the "you are tiny, this is
// a sandbox" scale.
// ============================================================
import * as THREE from "three";
import { PALETTE, paletteFor, plastic, makeSkyTexture, makeSandTexture, makeCheckerTexture } from "./palette.js";

export function buildWorld(scene, track) {
  // Every map is sand, but a DIFFERENT sand. Resolve the theme's palette once
  // and build the whole world from it — golden beach, Egyptian dust, white
  // shingle, or the pink lagoon.
  const P = paletteFor(track?.def?.theme || "beach");
  scene.background = makeSkyTexture();
  // Fog far enough that the Great Sandcastle reads from anywhere on the
  // 2km circuit — it's the orientation landmark, it must never vanish.
  scene.fog = new THREE.Fog(P.skyBottom, 160, 560);

  // --- light ---
  const hemi = new THREE.HemisphereLight(P.ambient, P.sandLight, 0.95);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(P.sunlight, 2.1);
  sun.position.set(60, 90, 30);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const S = 110;
  Object.assign(sun.shadow.camera, { left: -S, right: S, top: S, bottom: -S, near: 10, far: 260 });
  sun.shadow.bias = -0.0004;
  scene.add(sun);

  // --- the beach ---
  const sandTex = makeSandTexture();
  sandTex.repeat.set(60, 60);
  // On the pier the "ground" is THE PINK SEA. It sits just below the boards, it
  // shimmers, and it is the thing that ends your race.
  const isWater = !!track.def?.drownOffTrack;
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(620, 48),
    isWater
      ? new THREE.MeshLambertMaterial({ color: P.water, transparent: true, opacity: 0.95 })
      : new THREE.MeshLambertMaterial({ map: sandTex })
  );
  ground.rotation.x = -Math.PI / 2;
  if (isWater) ground.position.y = -0.6;         // the deck stands proud of the water
  ground.receiveShadow = true;
  scene.add(ground);
  if (isWater) {
    // a second, slightly darker sheet a touch lower reads as depth
    const deep = new THREE.Mesh(
      new THREE.CircleGeometry(620, 40),
      new THREE.MeshLambertMaterial({ color: P.stone })
    );
    deep.rotation.x = -Math.PI / 2;
    deep.position.y = -2.4;
    scene.add(deep);
  }

  // --- the track ribbon (triangle strip from centerline samples) ---
  scene.add(buildRibbon(track, track.width, P.sandDark, 0.02, true));       // packed sand
  scene.add(buildRibbon(track, track.width + 1.1, P.sandEdge, 0.01));       // painted outline under it
  // The pier has NO RAILS — that's the whole point of the map. Nothing catches
  // you: the boards end and the pink sea begins.
  if (!track.def?.noRails) scene.add(buildBumpers(track));
  scene.add(buildPilings(track));                                                 // the bridge stands on something
  // ---- HAZARDS ----
  // A hazard you can't see is a cheap shot. Every one of these reads at speed
  // from a long way out, because the whole point is that you get to CHOOSE
  // whether to risk it.
  for (const h of track.def.hazards || []) {
    scene.add(buildTrackHazard(h, P, track));
  }

  for (const d of track.def.decor || []) {
    if (d.kind === "sandcastle") scene.add(buildSandcastle(d));
    else if (d.kind === "sphinx") scene.add(buildSphinx(d, P));
    else if (d.kind === "obelisk") scene.add(buildObelisk(d, P));
    else if (d.kind === "lighthouse") scene.add(buildLighthouse(d, P));
    else if (d.kind === "tidepool") scene.add(buildTidepool(d, P));
    else if (d.kind === "pierlamp") scene.add(buildPierLamp(d, P));
    else if (d.kind === "buoy") scene.add(buildBuoy(d, P));
    else if (d.kind === "volcano") scene.add(buildVolcano(d, P));
    else if (d.kind === "lavarock") scene.add(buildLavaRock(d, P));
    else if (d.kind === "moonrock") scene.add(buildMoonRock(d, P));
    else if (d.kind === "glowpool") scene.add(buildGlowPool(d, P));
    else if (d.kind === "cactus") scene.add(buildCactus(d, P));
  }
  scene.add(buildCurbs(track));
  scene.add(buildStartLine(track));

  // --- toy scenery ---
  const deco = new THREE.Group();
  deco.add(beachBall(7, P.toyRed)).children.at(-1).position.set(78, 7, -34);
  deco.add(beachBall(5, P.toyBlue)).children.at(-1).position.set(-78, 5, 42);
  deco.add(sandcastle()).children.at(-1).position.set(-2, 0, 4);                  // castle in the infield
  deco.add(bucket(P.toyYellow)).children.at(-1).position.set(56, 0, 44);
  deco.add(shovel(P.toyGreen)).children.at(-1).position.set(-46, 0, -52);
  deco.add(starfish(P.toyOrange)).children.at(-1).position.set(30, 0.4, 62);
  deco.add(starfish(P.toyPink)).children.at(-1).position.set(-64, 0.4, -18);

  // horizon dunes: soft mounds ringing the play space so the world has a rim
  const duneMat = new THREE.MeshLambertMaterial({ map: makeSandTexture(P.sandLight, 128, 300) });
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2 + (i % 3) * 0.07;
    const r = 150 + (i % 5) * 22;
    const s = 26 + (i % 4) * 14;
    const dune = new THREE.Mesh(new THREE.SphereGeometry(s, 14, 10), duneMat);
    dune.scale.y = 0.24 + (i % 3) * 0.05;
    dune.position.set(Math.cos(a) * r, -s * 0.05, Math.sin(a) * r);
    dune.receiveShadow = true;
    deco.add(dune);
  }

  // lollipop palms scattered around the loop
  const palmSpots = [[62, 8], [44, -46], [-58, 36], [-30, 58], [-64, -34], [16, 70], [70, 40]];
  for (const [x, z] of palmSpots) deco.add(palm()).children.at(-1).position.set(x, 0, z);

  // a turquoise tide pool (water = the theme accent) with a shell beach
  const pool = new THREE.Group();
  const water = new THREE.Mesh(new THREE.CircleGeometry(16, 28), plastic(P.water));
  water.rotation.x = -Math.PI / 2; water.position.y = 0.06;
  const wet = new THREE.Mesh(new THREE.CircleGeometry(19, 28), plastic(P.sandDark));
  wet.rotation.x = -Math.PI / 2; wet.position.y = 0.03;
  pool.add(wet, water);
  pool.position.set(76, 0, -68);
  deco.add(pool);

  // start banner: two candy poles + a bunting bar over the checkered line
  deco.add(startBanner(track));

  scene.add(deco);
  return { sun };
}

function ribbonPositions(track, width, y) {
  // y is a LIFT above the road surface (paint layers); the surface itself is
  // each sample's own altitude — the ribbon climbs the bridge with the road.
  const pos = [];
  const n = track.samples.length;
  for (let i = 0; i <= n; i++) {
    const p = track.at(i % n);
    const nx = -p.tz, nz = p.tx;
    const h = (p.y || 0) + y;
    pos.push(p.x + nx * width / 2, h, p.z + nz * width / 2);
    pos.push(p.x - nx * width / 2, h, p.z - nz * width / 2);
  }
  return pos;
}

function buildRibbon(track, width, color, y, shadows = false) {
  const pos = ribbonPositions(track, width, y);
  const idx = [];
  const rows = pos.length / 6;
  const n = track.samples.length;
  for (let i = 0; i < rows - 1; i++) {
    // a GAP is a hole in the world: emit no road triangles across it
    if (track.at(i % n).gap || track.at((i + 1) % n).gap) continue;
    const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color }));
  m.receiveShadow = shadows;
  return m;
}

// Candy-striped curbs on the OUTSIDE of tighter corners: alternating red/white
// blocks placed where the tangent swings fast.
// Wooden pilings under every stretch of elevated road — boardwalk style, so
// the bridge reads as BUILT, not floating.
function buildPilings(track) {
  const g = new THREE.Group();
  const post = new THREE.CylinderGeometry(0.55, 0.62, 1, 7);
  const wood = plastic(0x9a6b40);
  const brace = plastic(0x845a34);
  for (let i = 0; i < track.samples.length; i += 8) {
    const p = track.at(i);
    // On the pier every plank stands on pilings — the dock IS the track, so it
    // needs legs down into the water along its whole length, not just where the
    // road happens to be elevated.
    const pier = !!track.def?.drownOffTrack;
    const h = pier ? 3.2 : (p.y || 0);
    if ((!pier && h < 1.2) || p.gap) continue;
    for (const s of [1, -1]) {
      const px = p.x + (-p.tz * s) * (track.width / 2 - 0.9);
      const pz = p.z + (p.tx * s) * (track.width / 2 - 0.9);
      const m = new THREE.Mesh(post, wood);
      m.position.set(px, h / 2, pz);
      m.scale.y = h;
      g.add(m);
    }
    // cross-brace every other bay
    if ((i / 8) % 2 === 0 && h > 3) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(track.width - 1.2, 0.28, 0.28), brace);
      b.position.set(p.x, h * 0.55, p.z);
      b.rotation.y = -Math.atan2(p.tz, p.tx) + Math.PI / 2;
      g.add(b);
    }
  }
  return g;
}

// THE GREAT SANDCASTLE — dead-center landmark and compass. Three tiers of
// drum towers, crenellations, a gate, and a pennant tall enough to see from
// anywhere on the lap.
function buildSandcastle(d) {
  const g = new THREE.Group();
  const sand = plastic(0xe6c184);
  const sandDark = plastic(0xd4a763);
  const shadowSand = plastic(0xc19052);
  const cren = (r, y, n) => {
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      const c = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.3, 1.1), sandDark);
      c.position.set(Math.cos(a) * r, y, Math.sin(a) * r);
      c.rotation.y = -a;
      g.add(c);
    }
  };
  const drum = (r, h, y, mat) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.92, r, h, 18), mat);
    m.position.y = y + h / 2;
    m.castShadow = true;
    g.add(m);
    return y + h;
  };
  let top = drum(d.r * 0.66, 9, 0, sand);       cren(d.r * 0.62, top + 0.6, 18);
  top = drum(d.r * 0.42, 8, top, sandDark);     cren(d.r * 0.40, top + 0.6, 12);
  top = drum(d.r * 0.24, 8, top, sand);         cren(d.r * 0.23, top + 0.6, 8);
  // corner towers
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
    const t = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 3.1, 13, 10), shadowSand);
    t.position.set(Math.cos(a) * d.r * 0.72, 6.5, Math.sin(a) * d.r * 0.72);
    g.add(t);
    const cone = new THREE.Mesh(new THREE.ConeGeometry(3.2, 4, 10), plastic(0xff6a5e));
    cone.position.set(Math.cos(a) * d.r * 0.72, 15, Math.sin(a) * d.r * 0.72);
    g.add(cone);
  }
  // gate
  const gate = new THREE.Mesh(new THREE.BoxGeometry(5, 6, 2), plastic(0x6d4a24));
  gate.position.set(0, 3, d.r * 0.64);
  g.add(gate);
  // pennant pole
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, d.h - (top || 0) + 8, 6), plastic(0xfff7ea));
  pole.position.y = top + (d.h - top + 8) / 2;
  g.add(pole);
  const flag = new THREE.Mesh(new THREE.BoxGeometry(4.2, 2.2, 0.12), plastic(0x2a9d8f));
  flag.position.set(2.1, d.h + 6.5, 0);
  g.add(flag);
  g.position.set(d.x, 0, d.z);
  return g;
}

// ---- EGYPT ------------------------------------------------------------------
// The Great Sphinx: the infield landmark, same navigational job the sandcastle
// does on the beach — "sphinx on my right" tells you where you are.
function buildSphinx(d, P) {
  const g = new THREE.Group();
  const stone = plastic(P.stone || 0xd4b483);
  const dark = plastic(P.stoneDark || 0xa8834f);
  const body = new THREE.Mesh(new THREE.BoxGeometry(d.r * 1.7, d.h * 0.42, d.r * 0.9), stone);
  body.position.y = d.h * 0.21;
  const haunch = new THREE.Mesh(new THREE.BoxGeometry(d.r * 0.5, d.h * 0.5, d.r * 0.85), stone);
  haunch.position.set(-d.r * 0.62, d.h * 0.25, 0);
  // paws
  for (const s of [-1, 1]) {
    const paw = new THREE.Mesh(new THREE.BoxGeometry(d.r * 0.55, d.h * 0.12, d.r * 0.22), dark);
    paw.position.set(d.r * 0.62, d.h * 0.06, s * d.r * 0.26);
    g.add(paw);
  }
  // head + nemes headdress
  const head = new THREE.Mesh(new THREE.BoxGeometry(d.r * 0.42, d.h * 0.3, d.r * 0.42), stone);
  head.position.set(d.r * 0.6, d.h * 0.58, 0);
  const nemes = new THREE.Mesh(new THREE.BoxGeometry(d.r * 0.56, d.h * 0.16, d.r * 0.6), plastic(P.accent || 0xf0c04a));
  nemes.position.set(d.r * 0.58, d.h * 0.74, 0);
  g.add(body, haunch, head, nemes);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  g.position.set(d.x, 0, d.z);
  return g;
}

function buildObelisk(d, P) {
  const g = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(d.r * 0.5, d.r * 0.8, d.h, 4), plastic(P.stone || 0xd4b483));
  shaft.position.y = d.h / 2;
  shaft.rotation.y = Math.PI / 4;
  const cap = new THREE.Mesh(new THREE.ConeGeometry(d.r * 0.55, d.h * 0.14, 4), plastic(P.accent || 0xf0c04a));
  cap.position.y = d.h + d.h * 0.06;
  cap.rotation.y = Math.PI / 4;
  g.add(shaft, cap);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  g.position.set(d.x, 0, d.z);
  return g;
}

// ---- WHITE SHINGLE ----------------------------------------------------------
function buildLighthouse(d, P) {
  const g = new THREE.Group();
  const bands = 5;
  for (let i = 0; i < bands; i++) {
    const h = d.h / bands;
    const r0 = d.r * (1 - i * 0.11), r1 = d.r * (1 - (i + 1) * 0.11);
    const seg = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, h, 16), plastic(i % 2 ? 0xe2574c : 0xfff7ea));
    seg.position.y = h * i + h / 2;
    g.add(seg);
  }
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(d.r * 0.5, 10, 8), plastic(0xf7c04a));
  lamp.position.y = d.h + d.r * 0.3;
  const cap = new THREE.Mesh(new THREE.ConeGeometry(d.r * 0.62, d.r * 0.8, 12), plastic(0x2a6b74));
  cap.position.y = d.h + d.r * 0.95;
  g.add(lamp, cap);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  g.position.set(d.x, 0, d.z);
  return g;
}

function buildTidepool(d, P) {
  const g = new THREE.Group();
  const water = new THREE.Mesh(
    new THREE.CircleGeometry(d.r, 28),
    new THREE.MeshLambertMaterial({ color: P.water || 0x4aa8b8, transparent: true, opacity: 0.85 })
  );
  water.rotation.x = -Math.PI / 2;
  water.position.y = 0.04;
  // a ring of pebbles around the rim
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const s = 0.5 + Math.random() * 0.7;
    const rock = new THREE.Mesh(new THREE.SphereGeometry(s, 6, 5), plastic(P.stoneDark || 0x9a978e));
    rock.position.set(Math.cos(a) * d.r, s * 0.4, Math.sin(a) * d.r);
    rock.scale.y = 0.6;
    g.add(rock);
  }
  g.add(water);
  g.position.set(d.x, 0, d.z);
  return g;
}

// ---- ROSE LAGOON PIER -------------------------------------------------------
function buildPierLamp(d, P) {
  const g = new THREE.Group();
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.32, d.h, 8), plastic(P.stoneDark || 0x6e3d4e));
  post.position.y = d.h / 2;
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(1.0, 10, 8), plastic(0xfff1d6));
  lamp.position.y = d.h + 0.6;
  const hat = new THREE.Mesh(new THREE.ConeGeometry(1.4, 1.0, 8), plastic(0x6e3d4e));
  hat.position.y = d.h + 1.5;
  g.add(post, lamp, hat);
  g.position.set(d.x, 0, d.z);
  return g;
}

function buildBuoy(d, P) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.ConeGeometry(d.r * 0.6, d.h, 10), plastic(0xff5a3c));
  body.position.y = d.h / 2;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(d.r * 0.55, 0.16, 8, 14), plastic(0xfff7ea));
  ring.position.y = d.h * 0.45;
  ring.rotation.x = Math.PI / 2;
  g.add(body, ring);
  g.position.set(d.x, 0, d.z);
  return g;
}

// ---- VOLCANO: the cone, smoking, dead centre of the infield ----
function buildVolcano(d, P) {
  const g = new THREE.Group();
  const cone = new THREE.Mesh(new THREE.ConeGeometry(d.r, d.h, 16, 1, true), plastic(0x2a2228));
  cone.position.y = d.h / 2;
  g.add(cone);
  // the crater, glowing
  const crater = new THREE.Mesh(new THREE.CircleGeometry(d.r * 0.28, 14), plastic(0xff5a1c));
  crater.rotation.x = -Math.PI / 2;
  crater.position.y = d.h - 1;
  g.add(crater);
  // lava running down the flanks
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const flow = new THREE.Mesh(new THREE.BoxGeometry(1.6, d.h * 0.7, 0.6), plastic(i % 2 ? 0xff5a1c : 0xffb020));
    flow.position.set(Math.cos(a) * d.r * 0.42, d.h * 0.4, Math.sin(a) * d.r * 0.42);
    flow.rotation.z = Math.cos(a) * 0.25;
    flow.rotation.x = Math.sin(a) * 0.25;
    g.add(flow);
  }
  // smoke
  for (let i = 0; i < 4; i++) {
    const puff = new THREE.Mesh(
      new THREE.SphereGeometry(4 + i * 2.5, 8, 6),
      new THREE.MeshLambertMaterial({ color: 0x6a5a60, transparent: true, opacity: 0.4 - i * 0.07 })
    );
    puff.position.y = d.h + 6 + i * 8;
    puff.position.x = i * 2;
    g.add(puff);
  }
  g.position.set(d.x, 0, d.z);
  return g;
}
function buildLavaRock(d, P) {
  const g = new THREE.Group();
  const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(d.r, 0), plastic(0x1c1620));
  rock.position.y = d.h * 0.4;
  g.add(rock);
  // glowing cracks
  for (let i = 0; i < 4; i++) {
    const crack = new THREE.Mesh(new THREE.BoxGeometry(d.r * 1.4, 0.25, 0.25), plastic(0xff5a1c));
    crack.position.y = d.h * 0.4;
    crack.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    g.add(crack);
  }
  g.position.set(d.x, 0, d.z);
  return g;
}

// ---- NIGHT: the moon rock, the glowing pools, the cacti ----
function buildMoonRock(d, P) {
  const g = new THREE.Group();
  const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(d.r, 1), plastic(0x6a6a88));
  rock.position.y = d.h * 0.35;
  rock.scale.y = 1.3;
  g.add(rock);
  // a rim of moonlight along the top
  const cap = new THREE.Mesh(new THREE.SphereGeometry(d.r * 0.5, 10, 8), plastic(0xd8e4ff));
  cap.position.y = d.h * 0.85;
  g.add(cap);
  g.position.set(d.x, 0, d.z);
  return g;
}
function buildGlowPool(d, P) {
  const g = new THREE.Group();
  const pool = new THREE.Mesh(
    new THREE.CircleGeometry(d.r, 28),
    new THREE.MeshBasicMaterial({ color: 0x2fe6c8, transparent: true, opacity: 0.55 })
  );
  pool.rotation.x = -Math.PI / 2;
  pool.position.y = 0.05;
  g.add(pool);
  // motes drifting off it — bioluminescence, the reason you look at this map
  for (let i = 0; i < 12; i++) {
    const mote = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 6, 5),
      new THREE.MeshBasicMaterial({ color: 0x9ffff0 })
    );
    const a = Math.random() * Math.PI * 2;
    const r = Math.random() * d.r;
    mote.position.set(Math.cos(a) * r, 0.6 + Math.random() * 3, Math.sin(a) * r);
    g.add(mote);
  }
  g.position.set(d.x, 0, d.z);
  return g;
}
function buildCactus(d, P) {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(d.r * 0.35, d.r * 0.4, d.h, 8), plastic(0x2a6b4a));
  trunk.position.y = d.h / 2;
  g.add(trunk);
  for (const s of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(d.r * 0.22, d.r * 0.22, d.h * 0.4, 7), plastic(0x2a6b4a));
    arm.position.set(s * d.r * 0.55, d.h * 0.62, 0);
    g.add(arm);
    const up = new THREE.Mesh(new THREE.CylinderGeometry(d.r * 0.22, d.r * 0.22, d.h * 0.3, 7), plastic(0x2a6b4a));
    up.position.set(s * d.r * 0.75, d.h * 0.78, 0);
    g.add(up);
  }
  g.position.set(d.x, 0, d.z);
  return g;
}

function buildTrackHazard(h, P, track) {
  const g = new THREE.Group();
  const i = track.nearest(h.x, h.z, -1, 0);
  const y = (track.at(i).y || 0);

  if (h.kind === "oil") {
    // a dark, wet sheen. It keeps your speed and takes your STEERING, which is
    // far more frightening than something that just slows you down.
    const slick = new THREE.Mesh(
      new THREE.CircleGeometry(h.r, 26),
      new THREE.MeshLambertMaterial({ color: 0x2a3f44, transparent: true, opacity: 0.75 })
    );
    slick.rotation.x = -Math.PI / 2;
    slick.position.y = 0.04;
    g.add(slick);
    // a rainbow sheen ring, so it reads as WET and not as a shadow
    const sheen = new THREE.Mesh(
      new THREE.RingGeometry(h.r * 0.5, h.r * 0.85, 24),
      new THREE.MeshBasicMaterial({ color: 0x7fd8ff, transparent: true, opacity: 0.28, side: THREE.DoubleSide })
    );
    sheen.rotation.x = -Math.PI / 2;
    sheen.position.y = 0.05;
    g.add(sheen);
  } else if (h.kind === "quicksand") {
    const pit = new THREE.Mesh(
      new THREE.CircleGeometry(h.r, 24),
      new THREE.MeshLambertMaterial({ color: 0xc19052 })
    );
    pit.rotation.x = -Math.PI / 2;
    pit.position.y = 0.03;
    g.add(pit);
    // concentric ripples — it looks like it's pulling inward
    for (let k = 1; k <= 3; k++) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(h.r * (k / 3.4), 0.12, 6, 20),
        plastic(0x8a5f33)
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.08;
      g.add(ring);
    }
  } else if (h.kind === "crab") {
    // an actual crab, scuttling. Hitting it hurts, and it is exactly where you
    // wanted to brake.
    const body = new THREE.Mesh(new THREE.SphereGeometry(h.r * 0.55, 10, 8), plastic(0xe2574c));
    body.scale.y = 0.55;
    body.position.y = h.r * 0.4;
    g.add(body);
    for (const s of [-1, 1]) {
      const claw = new THREE.Mesh(new THREE.SphereGeometry(h.r * 0.28, 8, 6), plastic(0xc9402f));
      claw.position.set(s * h.r * 0.7, h.r * 0.35, h.r * 0.45);
      g.add(claw);
      for (let k = 0; k < 3; k++) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.05, h.r * 0.7, 5), plastic(0xc9402f));
        leg.position.set(s * h.r * 0.55, h.r * 0.2, -h.r * 0.2 * k);
        leg.rotation.z = s * 0.9;
        g.add(leg);
      }
    }
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(h.r * 0.12, 6, 5), plastic(0xffffff));
      eye.position.set(s * h.r * 0.2, h.r * 0.72, h.r * 0.3);
      g.add(eye);
    }
  } else if (h.kind === "rockfall") {
    for (let k = 0; k < 5; k++) {
      const rock = new THREE.Mesh(
        new THREE.DodecahedronGeometry(h.r * (0.3 + Math.random() * 0.35), 0),
        plastic(P.stoneDark || 0xa8834f)
      );
      const a = Math.random() * Math.PI * 2;
      const rr = Math.random() * h.r * 0.7;
      rock.position.set(Math.cos(a) * rr, h.r * 0.25, Math.sin(a) * rr);
      rock.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      rock.castShadow = true;
      g.add(rock);
    }
  } else if (h.kind === "lava") {
    // a glowing fissure. It has to LOOK like it will end your race, because it will.
    const crack = new THREE.Mesh(
      new THREE.CircleGeometry(h.r, 20),
      new THREE.MeshBasicMaterial({ color: 0xff5a1c })
    );
    crack.rotation.x = -Math.PI / 2;
    crack.position.y = 0.05;
    g.add(crack);
    const core = new THREE.Mesh(
      new THREE.CircleGeometry(h.r * 0.55, 16),
      new THREE.MeshBasicMaterial({ color: 0xffe08a })
    );
    core.rotation.x = -Math.PI / 2;
    core.position.y = 0.07;
    g.add(core);
    // a crust rim, cracked open
    const rim = new THREE.Mesh(new THREE.TorusGeometry(h.r, 0.4, 6, 20), plastic(0x1c1620));
    rim.rotation.x = -Math.PI / 2;
    rim.position.y = 0.2;
    g.add(rim);
  } else if (h.kind === "ash") {
    // a vent throwing ash across the road. You keep your speed and lose your eyes.
    for (let k = 0; k < 10; k++) {
      const puff = new THREE.Mesh(
        new THREE.SphereGeometry(h.r * (0.25 + Math.random() * 0.3), 8, 6),
        new THREE.MeshLambertMaterial({ color: 0x6a5a60, transparent: true, opacity: 0.5 })
      );
      const a = Math.random() * Math.PI * 2;
      const rr = Math.random() * h.r * 0.8;
      puff.position.set(Math.cos(a) * rr, 1 + Math.random() * 4, Math.sin(a) * rr);
      g.add(puff);
    }
    const vent = new THREE.Mesh(new THREE.CircleGeometry(h.r * 0.4, 14), plastic(0x2a2228));
    vent.rotation.x = -Math.PI / 2;
    vent.position.y = 0.04;
    g.add(vent);
  } else if (h.kind === "wave") {
    // a breaker washing over the boards. It SHOVES you — and on a dock with no
    // rails, that means the pink sea.
    const crest = new THREE.Mesh(
      new THREE.CylinderGeometry(h.r, h.r * 1.15, 1.1, 20, 1, true),
      new THREE.MeshLambertMaterial({
        color: P.water || 0xe86a9a, transparent: true, opacity: 0.55, side: THREE.DoubleSide,
      })
    );
    crest.position.y = 0.55;
    g.add(crest);
    const foam = new THREE.Mesh(
      new THREE.TorusGeometry(h.r, 0.35, 8, 24),
      new THREE.MeshBasicMaterial({ color: 0xfff7ea, transparent: true, opacity: 0.8 })
    );
    foam.rotation.x = -Math.PI / 2;
    foam.position.y = 1.05;
    g.add(foam);
    g.userData.pulse = true;
  }

  g.position.set(h.x, y, h.z);
  g.userData.hazard = h;
  return g;
}

// The physical rails the shared sim clamps against (paint + BUMPER_SHOULDER on
// each side): fat candy-striped pool noodles on posts, so the boundary players
// FEEL in the physics is the boundary they SEE.
function buildBumpers(track) {
  const g = new THREE.Group();
  const rail = track.width / 2 + 6;             // mirrors CAR.BUMPER_SHOULDER
  const noodleGeo = new THREE.CylinderGeometry(0.45, 0.45, 1, 8, 1, true);
  const matA = plastic(0xff6a5e);               // coral
  const matB = plastic(0xfff7ea);               // foam white
  const step = 4;                               // one segment every 4 samples
  for (let i = 0; i < track.samples.length; i += step) {
    const a = track.at(i), b = track.at(i + step);
    if (a.gap || b.gap) continue;                 // no rails across thin air
    for (const s of [1, -1]) {
      const ax = a.x + (-a.tz * s) * rail, az = a.z + (a.tx * s) * rail;
      const bx = b.x + (-b.tz * s) * rail, bz = b.z + (b.tx * s) * rail;
      const len = Math.hypot(bx - ax, bz - az);
      const seg = new THREE.Mesh(noodleGeo, ((i / step) % 2 === 0) ? matA : matB);
      seg.position.set((ax + bx) / 2, 0.55 + ((a.y || 0) + (b.y || 0)) / 2, (az + bz) / 2);
      seg.scale.y = len;
      seg.rotation.z = Math.PI / 2;
      seg.rotation.y = -Math.atan2(bz - az, bx - ax);
      g.add(seg);
    }
  }
  return g;
}

function buildCurbs(track) {
  const grp = new THREE.Group();
  const n = track.samples.length;
  const red = plastic(PALETTE.curbRed), white = plastic(PALETTE.curbWhite);
  const box = new THREE.BoxGeometry(2.4, 0.34, 1.0);
  let toggle = 0;
  for (let i = 0; i < n; i += 3) {
    const a = track.at(i), b = track.at(i + 6);
    const turn = a.tx * b.tz - a.tz * b.tx;              // signed curvature-ish
    if (Math.abs(turn) < 0.06) continue;                  // (was 0.09: gentler bends now curbed too)
    if (a.gap || b.gap) continue;                         // nothing to stripe over thin air
    // BOTH SIDES of every turn. Curbs used to render only on the outside of the
    // bend, so half of every corner had no visual edge at all — you couldn't
    // read where the apex was, and the inside of a turn just faded into sand.
    for (const side of [1, -1]) {
      const nx = -a.tz * side, nz = a.tx * side;
      const mesh = new THREE.Mesh(box, (toggle++ % 2) ? red : white);
      mesh.position.set(a.x + nx * (track.width / 2 + 0.7), 0.17 + (a.y || 0), a.z + nz * (track.width / 2 + 0.7));
      mesh.rotation.y = -Math.atan2(a.tz, a.tx);
      mesh.castShadow = mesh.receiveShadow = true;
      grp.add(mesh);
    }
  }
  return grp;
}

function buildStartLine(track) {
  const p = track.at(0);
  const tex = makeCheckerTexture(8);
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(track.width, 3.2),
    new THREE.MeshLambertMaterial({ map: tex })
  );
  m.rotation.x = -Math.PI / 2;
  m.rotation.z = -Math.atan2(p.tz, p.tx) + Math.PI / 2;
  m.position.set(p.x, 0.03, p.z);
  return m;
}

// ------- toys (all oversized: the world is a sandbox, you are 1m tall) -------

function beachBall(r, accent) {
  const grp = new THREE.Group();
  const ball = new THREE.Group();
  const seg = 6;
  for (let i = 0; i < seg; i++) {
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(r, 24, 16, (i / seg) * Math.PI * 2, (1 / seg) * Math.PI * 2),
      plastic(i % 2 ? 0xfff7ea : accent)
    );
    m.castShadow = true;
    ball.add(m);
  }
  ball.rotation.z = 0.35;
  grp.add(ball);
  return grp;
}

function sandcastle() {
  const grp = new THREE.Group();
  const castle = new THREE.Group();
  const sand = new THREE.MeshLambertMaterial({ map: makeSandTexture(PALETTE.sandDark, 128, 380) });
  const tower = (x, z, r, h) => {
    const t = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.12, h, 14), sand);
    t.position.set(x, h / 2, z); t.castShadow = t.receiveShadow = true;
    const roof = new THREE.Mesh(new THREE.ConeGeometry(r * 1.25, r * 1.3, 14), sand);
    roof.position.set(x, h + r * 0.6, z); roof.castShadow = true;
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.0), plastic(PALETTE.toyRed, { side: THREE.DoubleSide }));
    flag.position.set(x + 0.8, h + r * 1.35, z);
    castle.add(t, roof, flag);
  };
  tower(-6, -5, 3.2, 9); tower(6, -5, 3.2, 9); tower(-6, 6, 3.2, 9); tower(6, 6, 3.2, 9);
  const keep = new THREE.Mesh(new THREE.BoxGeometry(11, 6.5, 10), sand);
  keep.position.y = 3.25; keep.castShadow = keep.receiveShadow = true;
  castle.add(keep);
  tower(0, 0, 4.2, 12);
  grp.add(castle);
  return grp;
}

function bucket(color) {
  const grp = new THREE.Group();
  const b = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(5.5, 4.2, 8, 20, 1, true), plastic(color, { side: THREE.DoubleSide }));
  body.position.y = 4; body.castShadow = true;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(5.5, 0.5, 10, 24), plastic(color));
  rim.rotation.x = Math.PI / 2; rim.position.y = 8;
  b.add(body, rim);
  b.rotation.z = 0.5;                                   // tipped over, casual
  grp.add(b);
  return grp;
}

function shovel(color) {
  const grp = new THREE.Group();
  const s = new THREE.Group();
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 16, 10), plastic(color));
  handle.rotation.z = Math.PI / 2 - 0.25; handle.position.y = 1.4; handle.castShadow = true;
  const grip = new THREE.Mesh(new THREE.TorusGeometry(1.3, 0.45, 8, 16), plastic(color));
  grip.position.set(-8, 3.2, 0); grip.castShadow = true;
  const blade = new THREE.Mesh(new THREE.CylinderGeometry(3.3, 2.4, 5.5, 4, 1), plastic(color));
  blade.scale.z = 0.32; blade.rotation.y = Math.PI / 4;
  blade.position.set(8.5, 0.9, 0); blade.rotation.z = -0.35; blade.castShadow = true;
  s.add(handle, grip, blade);
  grp.add(s);
  return grp;
}

function starfish(color) {
  const grp = new THREE.Group();
  const star = new THREE.Group();
  for (let i = 0; i < 5; i++) {
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(1.0, 3.4, 4, 8), plastic(color));
    arm.rotation.z = Math.PI / 2;
    arm.rotation.y = (i / 5) * Math.PI * 2;
    arm.translateX?.(0);
    arm.position.set(Math.cos((i / 5) * Math.PI * 2) * 2.4, 0, Math.sin((i / 5) * Math.PI * 2) * 2.4);
    arm.rotation.set(Math.PI / 2, 0, -(i / 5) * Math.PI * 2);
    arm.scale.y = 0.5;
    arm.castShadow = true;
    star.add(arm);
  }
  const core = new THREE.Mesh(new THREE.SphereGeometry(1.6, 12, 10), plastic(color));
  core.scale.y = 0.5; core.castShadow = true;
  star.add(core);
  grp.add(star);
  return grp;
}


function palm() {
  const grp = new THREE.Group();
  const p = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.3, 14, 8), plastic(0xc98d5f));
  trunk.position.y = 7; trunk.rotation.z = 0.08; trunk.castShadow = true;
  p.add(trunk);
  for (let i = 0; i < 6; i++) {
    const leaf = new THREE.Mesh(new THREE.SphereGeometry(4.6, 10, 8), plastic(PALETTE.toyGreen));
    leaf.scale.set(1, 0.28, 0.42);
    const a = (i / 6) * Math.PI * 2;
    leaf.position.set(Math.cos(a) * 3.4, 14.2, Math.sin(a) * 3.4);
    leaf.rotation.y = -a;
    leaf.rotation.z = 0.42;
    leaf.castShadow = true;
    p.add(leaf);
  }
  const coco = new THREE.Mesh(new THREE.SphereGeometry(0.9, 8, 6), plastic(0x8a5a3a));
  coco.position.set(1.2, 13.2, 0.6); p.add(coco);
  grp.add(p);
  return grp;
}

function startBanner(track) {
  const grp = new THREE.Group();
  const p = track.at(0);
  const nx = -p.tz, nz = p.tx;
  const half = track.width / 2 + 1.6;
  const poleGeo = new THREE.CylinderGeometry(0.35, 0.35, 8.5, 10);
  for (const s of [1, -1]) {
    const pole = new THREE.Mesh(poleGeo, plastic(s > 0 ? PALETTE.curbRed : PALETTE.toyBlue));
    pole.position.set(p.x + nx * half * s, 4.25, p.z + nz * half * s);
    pole.castShadow = true;
    grp.add(pole);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.7, 10, 8), plastic(PALETTE.toyYellow));
    ball.position.set(p.x + nx * half * s, 8.8, p.z + nz * half * s);
    grp.add(ball);
  }
  const banner = new THREE.Mesh(new THREE.PlaneGeometry(half * 2, 1.7), new THREE.MeshLambertMaterial({ map: makeCheckerTexture(6), side: THREE.DoubleSide }));
  banner.position.set(p.x, 7.4, p.z);
  banner.rotation.y = -Math.atan2(p.tz, p.tx) + Math.PI / 2;
  grp.add(banner);
  return grp;
}
