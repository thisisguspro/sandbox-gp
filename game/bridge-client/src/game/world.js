// ============================================================
// SANDBOX GP — world builder. Everything static: sky, sun, the great sand
// plane, the packed-sand track ribbon (curbs, painted edges, checkered start
// line), and the oversized-toy scenery that sells the "you are tiny, this is
// a sandbox" scale.
// ============================================================
import * as THREE from "three";
import { PALETTE, plastic, makeSkyTexture, makeSandTexture, makeCheckerTexture } from "./palette.js";

export function buildWorld(scene, track) {
  scene.background = makeSkyTexture();
  scene.fog = new THREE.Fog(PALETTE.skyBottom, 90, 260);

  // --- light ---
  const hemi = new THREE.HemisphereLight(PALETTE.ambient, PALETTE.sandLight, 0.95);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(PALETTE.sunlight, 2.1);
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
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(400, 48),
    new THREE.MeshLambertMaterial({ map: sandTex })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // --- the track ribbon (triangle strip from centerline samples) ---
  scene.add(buildRibbon(track, track.width, PALETTE.sandDark, 0.02, true));       // packed sand
  scene.add(buildRibbon(track, track.width + 1.1, PALETTE.sandEdge, 0.01));       // painted outline under it
  scene.add(buildCurbs(track));
  scene.add(buildStartLine(track));

  // --- toy scenery ---
  const deco = new THREE.Group();
  deco.add(beachBall(7, PALETTE.toyRed)).children.at(-1).position.set(78, 7, -34);
  deco.add(beachBall(5, PALETTE.toyBlue)).children.at(-1).position.set(-78, 5, 42);
  deco.add(sandcastle()).children.at(-1).position.set(-2, 0, 4);                  // castle in the infield
  deco.add(bucket(PALETTE.toyYellow)).children.at(-1).position.set(56, 0, 44);
  deco.add(shovel(PALETTE.toyGreen)).children.at(-1).position.set(-46, 0, -52);
  deco.add(starfish(PALETTE.toyOrange)).children.at(-1).position.set(30, 0.4, 62);
  deco.add(starfish(PALETTE.toyPink)).children.at(-1).position.set(-64, 0.4, -18);

  // horizon dunes: soft mounds ringing the play space so the world has a rim
  const duneMat = new THREE.MeshLambertMaterial({ map: makeSandTexture(PALETTE.sandLight, 128, 300) });
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
  const water = new THREE.Mesh(new THREE.CircleGeometry(16, 28), plastic(PALETTE.water));
  water.rotation.x = -Math.PI / 2; water.position.y = 0.06;
  const wet = new THREE.Mesh(new THREE.CircleGeometry(19, 28), plastic(PALETTE.sandDark));
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
  const pos = [];
  const n = track.samples.length;
  for (let i = 0; i <= n; i++) {
    const p = track.at(i % n);
    const nx = -p.tz, nz = p.tx;
    pos.push(p.x + nx * width / 2, y, p.z + nz * width / 2);
    pos.push(p.x - nx * width / 2, y, p.z - nz * width / 2);
  }
  return pos;
}

function buildRibbon(track, width, color, y, shadows = false) {
  const pos = ribbonPositions(track, width, y);
  const idx = [];
  const rows = pos.length / 6;
  for (let i = 0; i < rows - 1; i++) {
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
function buildCurbs(track) {
  const grp = new THREE.Group();
  const n = track.samples.length;
  const red = plastic(PALETTE.curbRed), white = plastic(PALETTE.curbWhite);
  const box = new THREE.BoxGeometry(2.4, 0.34, 1.0);
  let toggle = 0;
  for (let i = 0; i < n; i += 3) {
    const a = track.at(i), b = track.at(i + 6);
    const turn = a.tx * b.tz - a.tz * b.tx;              // signed curvature-ish
    if (Math.abs(turn) < 0.09) continue;
    const side = Math.sign(turn);                         // outside of the bend
    const nx = -a.tz * -side, nz = a.tx * -side;
    const mesh = new THREE.Mesh(box, (toggle++ % 2) ? red : white);
    mesh.position.set(a.x + nx * (track.width / 2 + 0.7), 0.17, a.z + nz * (track.width / 2 + 0.7));
    mesh.rotation.y = -Math.atan2(a.tz, a.tx);
    mesh.castShadow = mesh.receiveShadow = true;
    grp.add(mesh);
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
