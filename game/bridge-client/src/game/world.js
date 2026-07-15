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

  // --- LIGHT ---
  //
  // What was here made everything look like a washed-out beige photocopy:
  //
  //   • ambient at 0.95 — so strong it drowned the sun and killed every shadow
  //     and every bit of shape. Nothing had a lit side and a dark side.
  //   • the sun's shadow camera was a fixed 110-unit box at the WORLD ORIGIN. The
  //     track is 400 units across, so the moment you drove away from the middle
  //     your kart cast no shadow at all — it just floated on the sand.
  //
  // Ambient is now a fill, not a flood. The shadow camera FOLLOWS THE PLAYER
  // (see updateSunShadow, called each frame), so you always have a shadow under
  // you — which is the single biggest thing that makes a 3D object look like it's
  // actually ON the ground rather than pasted over it.
  const hemi = new THREE.HemisphereLight(P.ambient, P.sandLight, 0.42);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(P.sunlight, 2.4);
  sun.position.set(60, 90, 30);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  // a TIGHT box that travels with you: crisp shadows instead of a blurry 110-unit
  // smear that only worked at the origin
  const S = 46;
  Object.assign(sun.shadow.camera, { left: -S, right: S, top: S, bottom: -S, near: 1, far: 220 });
  sun.shadow.bias = -0.0008;
  sun.shadow.normalBias = 0.02;
  scene.add(sun);
  scene.add(sun.target);
  scene.userData.sun = sun;

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

  // ---- THE EMBANKMENT ----
  //
  // The ground is a single FLAT plane at y=0. The road is not flat: Moonlit Dunes
  // climbs to 13 metres, Pharaoh and Obsidian Shore dip four metres below zero.
  // So the road was HANGING IN MID-AIR over the sand on the climbs, and BURIED
  // under it in the dips. That's the "street disappearing and going through the
  // floor" — it wasn't the road, it was the world having no terrain under it.
  //
  // Build a skirt of sand on each side that runs from the road's edge down to the
  // ground plane. Now there is always something holding the road up.
  //
  // ---- WHY THIS IS A GRID AND NOT A ROW OF QUADS ----
  //
  // The first version made ONE FLAT QUAD per road segment, running from the kerb
  // straight down to the ground. Three things went wrong, and together they turned
  // the hillside into a STAIRCASE:
  //
  //   1. `if (Math.abs(ay) < 0.15) continue` — the skirt only existed where the road
  //      was raised. So it APPEARED and VANISHED, leaving a hard step at every
  //      boundary between flat and climbing road.
  //   2. A single quad from top to bottom is a RAMP with a sharp crease at each end.
  //      Real ground doesn't do that: it eases out of the flat and eases into it.
  //   3. Every quad had its own vertices, so `computeVertexNormals()` gave each one
  //      its own FLAT normal — and adjacent quads shaded as separate facets. That's
  //      the terracing in the screenshot.
  //
  // So: a proper GRID. It runs the WHOLE lap (no gaps to step over), it has several
  // rows across the slope with a smoothstep profile (so it rounds out of the road
  // and into the sand), and the vertices are SHARED between neighbouring cells — so
  // the normals average and the whole thing shades as one continuous surface.
  {
    const n = track.samples.length;
    const SKIRT = 34;                 // how far out the embankment reaches
    const ROWS = 6;                   // rows across the slope: more = smoother profile
    const inner = track.width / 2 + 1.2;

    for (const side of [1, -1]) {
      // Build a (n+1) x (ROWS+1) vertex grid, then index it. Shared vertices are the
      // whole point: they're what let three.js average the normals across cells.
      const verts = [];
      const uvs = [];

      for (let i = 0; i <= n; i++) {
        const p = track.at(i % n);
        const py = p.y || 0;
        const nx = -p.tz * side, nz = p.tx * side;

        for (let r = 0; r <= ROWS; r++) {
          const f = r / ROWS;                      // 0 at the road, 1 out on the sand
          // SMOOTHSTEP the height, so the slope eases out of the road and into the
          // ground instead of creasing at both ends
          const ease = f * f * (3 - 2 * f);
          const h = py * (1 - ease) - 0.05;
          const out = inner + f * SKIRT;
          verts.push(p.x + nx * out, h, p.z + nz * out);
          uvs.push(p.s * 0.02, f * 2);
        }
      }

      const idx = [];
      const stride = ROWS + 1;
      for (let i = 0; i < n; i++) {
        // never bridge the jump
        if (track.at(i % n).gap || track.at((i + 1) % n).gap) continue;
        for (let r = 0; r < ROWS; r++) {
          const a = i * stride + r;
          const b = a + 1;
          const c = (i + 1) * stride + r;
          const d = c + 1;
          if (side > 0) idx.push(a, c, d, a, d, b);
          else idx.push(a, d, c, a, b, d);        // wind the other way on the far side
        }
      }

      if (idx.length) {
        const eg = new THREE.BufferGeometry();
        eg.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
        eg.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
        eg.setIndex(idx);
        eg.computeVertexNormals();                // now the normals AVERAGE, because
                                                  // the vertices are shared
        const embank = new THREE.Mesh(
          eg,
          plastic(0xffffff, { map: sandTex, side: THREE.DoubleSide })
        );
        embank.receiveShadow = true;
        scene.add(embank);
      }
    }

    // ---- THE UNDERSIDE ----
    //
    // The road ribbon is a ONE-SIDED strip. Stand on the beach beneath the climb
    // and look up and you see straight through it — or, worse, at the black inside
    // of it. That is the brown "ceiling" in Gustavo's screenshot: he wasn't under
    // the world, he was standing at ground level looking at the UNDERBELLY of an
    // 8.9-metre-high road that has no underbelly.
    //
    // So give it one: a deck soffit, and PILLARS holding it up, so that from below
    // it reads as a raised causeway you're driving under — a structure, not a
    // rendering error.
    {
      const un = [];
      const n2 = track.samples.length;
      for (let i = 0; i < n2; i++) {
        const a = track.at(i % n2);
        const b = track.at((i + 1) % n2);
        if (a.gap || b.gap) continue;
        const ay = a.y || 0, by = b.y || 0;
        if (ay < 0.6 && by < 0.6) continue;         // only where it's actually raised

        const anx = -a.tz, anz = a.tx;
        const bnx = -b.tz, bnz = b.tx;
        const w = track.width / 2 + 1.4;
        const DROP = 0.55;                          // deck thickness

        // the soffit: a flat underside a little below the road surface
        const p0 = [a.x + anx * w, ay - DROP, a.z + anz * w];
        const p1 = [b.x + bnx * w, by - DROP, b.z + bnz * w];
        const p2 = [b.x - bnx * w, by - DROP, b.z - bnz * w];
        const p3 = [a.x - anx * w, ay - DROP, a.z - anz * w];
        for (const [p, q, r] of [[p0, p1, p2], [p0, p2, p3]]) {
          un.push(p[0], p[1], p[2], q[0], q[1], q[2], r[0], r[1], r[2]);
        }
        // the fascia down each side, closing the deck's edge
        for (const s of [1, -1]) {
          const nx = s > 0 ? anx : -anx, nz = s > 0 ? anz : -anz;
          const mx = s > 0 ? bnx : -bnx, mz = s > 0 ? bnz : -bnz;
          const t0 = [a.x + nx * w, ay + 0.02, a.z + nz * w];
          const t1 = [b.x + mx * w, by + 0.02, b.z + mz * w];
          const u0 = [a.x + nx * w, ay - DROP, a.z + nz * w];
          const u1 = [b.x + mx * w, by - DROP, b.z + mz * w];
          for (const [p, q, r] of [[t0, t1, u1], [t0, u1, u0]]) {
            un.push(p[0], p[1], p[2], q[0], q[1], q[2], r[0], r[1], r[2]);
          }
        }
      }
      if (un.length) {
        const ug = new THREE.BufferGeometry();
        ug.setAttribute("position", new THREE.Float32BufferAttribute(un, 3));
        ug.computeVertexNormals();
        const under = new THREE.Mesh(
          ug,
          new THREE.MeshLambertMaterial({ color: P.sandDark, side: THREE.DoubleSide })
        );
        under.receiveShadow = true;
        scene.add(under);
      }

      // PILLARS. A raised causeway with nothing holding it up looks like a bug;
      // with pillars it looks like a bridge you're driving under.
      for (let i = 0; i < n2; i += 14) {
        const a = track.at(i % n2);
        const ay = a.y || 0;
        if (a.gap || ay < 1.6) continue;
        for (const s of [-1, 1]) {
          const px = a.x + (-a.tz * s) * (track.width / 2 + 0.6);
          const pz = a.z + (a.tx * s) * (track.width / 2 + 0.6);
          const pillar = new THREE.Mesh(
            new THREE.CylinderGeometry(0.42, 0.55, ay, 8),
            plastic(P.stone || 0xc9a86a)
          );
          pillar.position.set(px, ay / 2 - 0.3, pz);
          pillar.castShadow = true;
          pillar.receiveShadow = true;
          scene.add(pillar);
          // a footing, so it doesn't just sprout out of the sand
          const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.82, 0.24, 8), plastic(P.stoneDark || 0xa8834f));
          foot.position.set(px, 0.10, pz);
          scene.add(foot);
        }
      }
    }
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

  // Ground height at an arbitrary (x,z): the nearest track sample's altitude,
  // faded to zero across the embankment skirt. Props built to stand on the
  // surface get their whole group lifted to this, so a post no longer stabs up
  // through an elevated deck (or floats above sloped ground) by assuming y=0.
  const groundAt = (x, z) => {
    let near = track.samples[0], nd = Infinity;
    for (const q of track.samples) { const dd = Math.hypot(q.x - x, q.z - z); if (dd < nd) { nd = dd; near = q; } }
    const pier = !!track.def?.drownOffTrack;
    if (pier) return near.y || 0;   // the whole dock is up on its pilings
    const SKIRT_START = track.width / 2 + 1.2, SKIRT_LEN = 34;
    const f = Math.max(0, Math.min(1, (nd - SKIRT_START) / SKIRT_LEN));
    const ease = f * f * (3 - 2 * f);
    return (near.y || 0) * (1 - ease);
  };
  // Which decor kinds stand ON the surface (so they must sit at ground height).
  // Big landmarks with their own authored footprints are left alone.
  const SURFACE_DECOR = new Set(["pierlamp", "buoy", "cactus", "lavarock", "moonrock"]);

  for (const d of track.def.decor || []) {
    let obj = null;
    if (d.kind === "sandcastle") obj = buildSandcastle(d);
    else if (d.kind === "sphinx") obj = buildSphinx(d, P);
    else if (d.kind === "obelisk") obj = buildObelisk(d, P);
    else if (d.kind === "lighthouse") obj = buildLighthouse(d, P);
    else if (d.kind === "tidepool") obj = buildTidepool(d, P);
    else if (d.kind === "pierlamp") obj = buildPierLamp(d, P);
    else if (d.kind === "buoy") obj = buildBuoy(d, P);
    else if (d.kind === "volcano") obj = buildVolcano(d, P);
    else if (d.kind === "lavarock") obj = buildLavaRock(d, P);
    else if (d.kind === "moonrock") obj = buildMoonRock(d, P);
    else if (d.kind === "glowpool") obj = buildGlowPool(d, P);
    else if (d.kind === "cactus") obj = buildCactus(d, P);
    if (!obj) continue;
    if (SURFACE_DECOR.has(d.kind) && typeof d.x === "number" && typeof d.z === "number") {
      obj.position.y += groundAt(d.x, d.z) - 0.05;   // sit it on the surface
    }
    scene.add(obj);
  }
  scene.add(buildCurbs(track));
  scene.add(buildStartLine(track));

  // --- toy scenery ---
  const deco = new THREE.Group();

  // These props were pinned at hardcoded coordinates. A circuit loops back on
  // itself, so a point that's "infield" on one map lands ON THE ROAD of another
  // — which is how a beach ball ended up sitting in the middle of the track. And
  // pinning y by hand (7, 5, 0…) floated some of them above sloped ground.
  //
  // placeProp() fixes both: it shoves any spot that overlaps the racing line
  // straight out until it clears, then plants it at the real ground height there
  // (same skirt curve the scattered scenery uses). yBase is the prop's own
  // resting offset (a ball's radius, a flat starfish ~0.4).
  const placeProp = (group, x, z, yBase = 0) => {
    const CLEAR = track.width / 2 + 12;
    const onRoad = (px, pz) => {
      for (const q of track.samples) if (Math.hypot(q.x - px, q.z - pz) < CLEAR) return true;
      return false;
    };
    // push outward from the origin (the infield centre) until clear of the road
    let fx = x, fz = z, guard = 0;
    const len = Math.hypot(x, z) || 1;
    const ux = x / len, uz = z / len;
    while (onRoad(fx, fz) && guard++ < 60) { fx += ux * 4; fz += uz * 4; }
    // ground height at the final spot: nearest track sample's altitude, faded to
    // zero across the embankment skirt (matches the terrain)
    let near = track.samples[0], nd = Infinity;
    for (const q of track.samples) { const d = Math.hypot(q.x - fx, q.z - fz); if (d < nd) { nd = d; near = q; } }
    const SKIRT_START = track.width / 2 + 1.2, SKIRT_LEN = 34;
    const f = Math.max(0, Math.min(1, (nd - SKIRT_START) / SKIRT_LEN));
    const ease = f * f * (3 - 2 * f);
    const groundY = (near.y || 0) * (1 - ease) - 0.05;
    group.children.at(-1).position.set(fx, groundY + yBase, fz);
    return group;
  };

  deco.add(beachBall(7, P.toyRed)); placeProp(deco, 78, -34, 7);
  deco.add(beachBall(5, P.toyBlue)); placeProp(deco, -78, 42, 5);
  deco.add(sandcastle()); placeProp(deco, -2, 4, 0);                  // castle in the infield
  deco.add(bucket(P.toyYellow)); placeProp(deco, 56, 44, 0);
  deco.add(shovel(P.toyGreen)); placeProp(deco, -46, -52, 0);
  deco.add(starfish(P.toyOrange)); placeProp(deco, 30, 62, 0.4);
  deco.add(starfish(P.toyPink)); placeProp(deco, -64, -18, 0.4);

  // ---- HORIZON DUNES ----
  //
  // These were placed on a fixed ring of radius 150-238 with radii up to 68 units
  // — while the track itself spans roughly ±190. So the dunes landed ON TOP OF THE
  // ROAD: enormous sand mounds sitting across the racing line, blocking the view
  // of the corner you were about to take. You could drive straight into one.
  //
  // Now every candidate is tested against the actual track before it's placed: if
  // any part of the mound would come within a safe margin of the road, it doesn't
  // get built. The horizon is scenery, and scenery must never be in the way.
  const duneMat = new THREE.MeshLambertMaterial({ map: makeSandTexture(P.sandLight, 128, 300) });
  {
    // how far out does the track actually go?
    let trackR = 0;
    for (const p of track.samples) trackR = Math.max(trackR, Math.hypot(p.x, p.z));

    const CLEAR = track.width / 2 + 26;     // the road, its shoulder, and breathing room

    for (let i = 0; i < 34; i++) {
      const a = (i / 34) * Math.PI * 2 + (i % 3) * 0.07;
      const s = 26 + (i % 4) * 14;
      // push the ring out past the furthest point of the track, plus the mound's
      // own radius, so it can never reach in
      const r = trackR + s + 30 + (i % 5) * 26;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;

      // belt and braces: check this specific mound against every track sample
      let hitsRoad = false;
      for (const p of track.samples) {
        if (Math.hypot(p.x - x, p.z - z) < s + CLEAR) { hitsRoad = true; break; }
      }
      if (hitsRoad) continue;

      const dune = new THREE.Mesh(new THREE.SphereGeometry(s, 14, 10), duneMat);
      dune.scale.y = 0.24 + (i % 3) * 0.05;
      dune.position.set(x, -s * 0.05, z);
      dune.receiveShadow = true;
      deco.add(dune);
    }
  }

  // ---- ROADSIDE DRESSING ----
  //
  // There used to be SEVEN palm trees, hand-placed in a 70-unit box, on a track
  // 400 units across. Drive anywhere but that one corner and the world was an
  // empty beige plain — which is exactly what it looked like.
  //
  // Now: scatter dressing ALONG THE TRACK, on both sides, all the way round. This
  // is the single biggest thing that makes a circuit feel like a place rather than
  // a stripe in a void — you get a sense of speed from things flicking past, and
  // corners become recognisable because they have landmarks.
  {
    const n = track.samples.length;
    const rnd = (() => { let s = 20250713; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();

    // ---- TWO PASSES: COLLECT, THEN INSTANCE ----
    //
    // This used to build a FRESH MESH for every piece of dressing — about two
    // hundred of them, most of them multi-part groups (a palm is a trunk plus five
    // fronds plus two coconuts). Add the crowd, the kerbs and the pillars and the
    // scene hit 3,051 meshes and 816 draw calls, and a single render took 71ms.
    //
    // They're the same handful of objects, repeated. That is exactly what
    // InstancedMesh exists for: collect every position first, then draw each TYPE
    // in ONE call regardless of how many there are.
    const spots = { palm: [], parasol: [], towel: [], rock: [], ball: [], wood: [] };

    for (let i = 0; i < n; i += 5) {
      const p = track.at(i);
      if (p.gap) continue;

      for (const side of [-1, 1]) {
        if (rnd() > 0.72) continue;              // gaps, so it isn't a corridor

        const off = (track.width / 2) + 16 + rnd() * 30;
        const x = p.x + (-p.tz) * off * side;
        const z = p.z + (p.tx) * off * side;
        const y = p.y || 0;

        // never on the road — a circuit loops back on itself, so a palm sixteen
        // metres off one straight can land in the middle of a different one
        const CLEAR = track.width / 2 + 11;
        let onRoad = false;
        for (const q of track.samples) {
          if (Math.hypot(q.x - x, q.z - z) < CLEAR) { onRoad = true; break; }
        }
        if (onRoad) continue;

        // ---- STAND ON THE GROUND ----
        //
        // The old code planted everything at the ROAD's height — so beside an 8.9m
        // climb, a palm forty metres out hung nine metres in the air.
        //
        // The fix after that was a LINEAR ramp from road-height down to zero. But the
        // embankment itself uses a SMOOTHSTEP profile (it has to, or the hillside
        // creases at both ends and shades as terraces). So the scenery was standing
        // on a straight line while the ground curved away beneath it — and near the
        // top of the slope, where smoothstep is flattest, the gap was metres. That's
        // the beach ball hanging in the sky.
        //
        // Use the SAME curve the ground uses. There is exactly one formula for the
        // surface, and everything that stands on it must use that formula.
        const SKIRT_START = track.width / 2 + 1.2;
        const SKIRT_LEN = 34;
        const distOut = Math.hypot(x - p.x, z - p.z);
        const f = Math.max(0, Math.min(1, (distOut - SKIRT_START) / SKIRT_LEN));
        const ease = f * f * (3 - 2 * f);            // the exact same smoothstep
        const groundY = y * (1 - ease) - 0.05;

        const roll = rnd();
        const rot = rnd() * Math.PI * 2;
        const scale = 0.8 + rnd() * 0.6;
        const tint = (rnd() * 4) | 0;

        if (roll < 0.30)      spots.palm.push({ x, y: groundY, z, rot, scale });
        else if (roll < 0.50) spots.parasol.push({ x, y: groundY, z, rot, scale: 1, tint });
        else if (roll < 0.66) spots.towel.push({ x, y: groundY, z, rot, scale: 1, tint });
        else if (roll < 0.80) spots.rock.push({ x, y: groundY, z, rot, scale: 0.7 + rnd() * 1.4 });
        else if (roll < 0.92) spots.ball.push({ x, y: groundY, z, rot, scale: 1 });
        else                  spots.wood.push({ x, y: groundY, z, rot, scale: 1 });
      }
    }

    // ---- ONE DRAW CALL PER TYPE ----
    const mkInstanced = (geo, mat, list, yOff = 0, tintCols = null) => {
      if (!list.length) return;
      const im = new THREE.InstancedMesh(geo, mat, list.length);
      im.castShadow = true;
      im.receiveShadow = true;
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const pos = new THREE.Vector3();
      const scl = new THREE.Vector3();
      const col = new THREE.Color();
      list.forEach((s, k) => {
        pos.set(s.x, s.y + yOff * s.scale, s.z);
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), s.rot);
        scl.setScalar(s.scale);
        m.compose(pos, q, scl);
        im.setMatrixAt(k, m);
        if (tintCols) im.setColorAt(k, col.setHex(tintCols[s.tint % tintCols.length]));
      });
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      deco.add(im);
    };

    const TOY = [0xe2574c, 0x2fe6c8, 0xf7c04a, 0xff5fa2];

    // PALMS — the trunk and the crown, as two instanced meshes
    mkInstanced(new THREE.CylinderGeometry(0.28, 0.40, 6.2, 7), plastic(0x8a5f33), spots.palm, 3.1);
    if (spots.palm.length) {
      const frond = new THREE.InstancedMesh(
        new THREE.SphereGeometry(1.7, 8, 5),
        plastic(0x2a8256),
        spots.palm.length
      );
      frond.castShadow = true;
      const m = new THREE.Matrix4(), q = new THREE.Quaternion();
      const pv = new THREE.Vector3(), sv = new THREE.Vector3();
      spots.palm.forEach((s, k) => {
        pv.set(s.x, s.y + 6.3 * s.scale, s.z);
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), s.rot);
        sv.set(s.scale, s.scale * 0.42, s.scale);
        m.compose(pv, q, sv);
        frond.setMatrixAt(k, m);
      });
      frond.instanceMatrix.needsUpdate = true;
      deco.add(frond);
    }

    // PARASOLS — a pole and a canopy
    mkInstanced(new THREE.CylinderGeometry(0.08, 0.08, 3.2, 6), plastic(0xfff7ea), spots.parasol, 1.6);
    mkInstanced(new THREE.ConeGeometry(2.2, 1.0, 10), plastic(0xffffff), spots.parasol, 3.3, TOY);

    // TOWELS, ROCKS, BEACH BALLS, DRIFTWOOD
    mkInstanced(new THREE.BoxGeometry(2.2, 0.08, 1.3), plastic(0xffffff), spots.towel, 0.05, TOY);
    mkInstanced(new THREE.DodecahedronGeometry(1.0, 0), plastic(0xc0aa8a), spots.rock, 0.4);
    mkInstanced(new THREE.SphereGeometry(0.8, 10, 8), plastic(0xfff7ea), spots.ball, 0.8);
    mkInstanced(new THREE.CylinderGeometry(0.22, 0.3, 3.2, 6), plastic(0x9a8266), spots.wood, 0.3);

    // ---- CROWD STANDS on the main straight: the thing that makes a circuit feel
    //      like a RACE rather than a drive on an empty beach.
    const crowdSpots = [];
    const standXforms = [];
    for (let k = 0; k < 3; k++) {
      const si = k;
      const i = (Math.floor(n * 0.02) + k * 6) % n;
      const p = track.at(i);
      const off = (track.width / 2) + 11;
      const stand = new THREE.Group();
      // tiered seating
      for (let row = 0; row < 4; row++) {
        const tier = new THREE.Mesh(new THREE.BoxGeometry(9, 0.7, 1.5), plastic(row % 2 ? 0xfff7ea : 0xe6d3b0));
        tier.position.set(0, 0.6 + row * 0.7, -row * 1.4);
        stand.add(tier);
        // THE CROWD.
        //
        // This built a SEPARATE MESH for every spectator: 3 stands x 4 rows x 7
        // people = 84 individual draw calls, just for coloured dots. Add the
        // roadside dressing and the scene hit 1,003 draw calls and 1,722 meshes —
        // and a single render took 809ms.
        //
        // They're all the same sphere. That's exactly what InstancedMesh is for:
        // ONE draw call for the whole crowd, with a per-instance colour.
        crowdSpots.push({ row, standIdx: si });
      }
      // FACE THE TRACK. The tiers are built along X and step back along -Z, so the
      // stand's "front" is -Z. It was rotated to sit SIDE-ON to the road, which is
      // why the crowd looked like a row of sideways platforms with the spectators
      // staring off into the desert. They should be looking at the race.
      // Same floating problem: `p.y` is the ROAD's height, and a stand beside a
      // raised section would hover. Sit it on the embankment surface instead.
      const sOff = off;
      const sSkirtStart = track.width / 2 + 1.2;
      const sSkirtEnd = sSkirtStart + 34;
      const sf = Math.max(0, Math.min(1, (sOff - sSkirtStart) / (sSkirtEnd - sSkirtStart)));
      const standY = (p.y || 0) > 0.15 && sOff < sSkirtEnd ? (p.y || 0) * (1 - sf) : 0;
      stand.position.set(p.x + (-p.tz) * off, standY, p.z + (p.tx) * off);

      // ---- FACE THE TRACK ----
      //
      // The tiers are built along X (a 9-unit-wide box) and step BACK along -Z, so
      // the stand's "front" — the side the crowd is looking out of — is -Z.
      //
      // To make that front point at the road, the stand's -Z must line up with the
      // vector pointing from the stand back TOWARD the centreline. That inward
      // vector is (+tz, -tx) on this side. A three.js Y-rotation of `a` maps -Z to
      // (-sin a, -cos a) — so we need -sin(a) = tz and -cos(a) = -tx, i.e.
      // a = atan2(-tz, tx).
      //
      // The old line used atan2(-tx, tz), which is that angle rotated ninety
      // degrees: the stands ended up SIDE-ON, with the spectators staring off along
      // the road instead of at it. Gustavo saw them facing north-south on an
      // east-west straight, which is exactly a 90-degree error.
      stand.rotation.y = Math.atan2(-p.tz, p.tx);
      deco.add(stand);
      stand.updateMatrixWorld(true);
      standXforms.push(stand.matrixWorld.clone());
    }

    // ---- ONE DRAW CALL FOR THE ENTIRE CROWD ----
    if (crowdSpots.length) {
      const PER_ROW = 7;
      const count = crowdSpots.length * PER_ROW;
      const crowd = new THREE.InstancedMesh(
        new THREE.SphereGeometry(0.28, 6, 5),
        plastic(0xffffff),
        count
      );
      const COLS = [0xe2574c, 0x2fe6c8, 0xf7c04a, 0xff5fa2, 0x59b7e8];
      const m = new THREE.Matrix4();
      const col = new THREE.Color();
      let idx = 0;
      for (const spot of crowdSpots) {
        for (let c = 0; c < PER_ROW; c++) {
          m.makeTranslation(-3.6 + c * 1.2, 1.2 + spot.row * 0.7, -spot.row * 1.4);
          m.premultiply(standXforms[spot.standIdx]);
          crowd.setMatrixAt(idx, m);
          crowd.setColorAt(idx, col.setHex(COLS[(idx * 7) % COLS.length]));
          idx++;
        }
      }
      crowd.instanceMatrix.needsUpdate = true;
      if (crowd.instanceColor) crowd.instanceColor.needsUpdate = true;
      deco.add(crowd);
    }
  }

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
    // A HAZARD MUST LOOK LIKE A HAZARD.
    //
    // These were brown dodecahedrons — the SAME shape and colour as the roadside
    // scenery rocks. So a deliberate obstacle in the racing line read as "somebody
    // dumped rocks on the track". A hazard you can't distinguish from decoration
    // isn't a hazard, it's a trap.
    //
    // Dark volcanic stone with a WARNING SPLASH of paint on the road under it, a
    // hazard chevron, and dust still settling — you see it coming and you get to
    // CHOOSE which side to take.

    // the warning paint on the road
    const warn = new THREE.Mesh(
      new THREE.CircleGeometry(h.r * 1.25, 20),
      plastic(0xf5a623, { transparent: true, opacity: 0.35 })
    );
    warn.rotation.x = -Math.PI / 2;
    warn.position.y = 0.05;
    g.add(warn);
    // hazard chevrons round it
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      const chev = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.03, 0.9), plastic(k % 2 ? 0x1c1712 : 0xf5a623));
      chev.position.set(Math.cos(a) * h.r * 1.15, 0.06, Math.sin(a) * h.r * 1.15);
      chev.rotation.y = -a;
      g.add(chev);
    }

    // the rocks themselves — DARK, jagged, obviously not beach stone
    for (let k = 0; k < 6; k++) {
      const rock = new THREE.Mesh(
        new THREE.DodecahedronGeometry(h.r * (0.28 + Math.random() * 0.30), 0),
        plastic(k % 2 ? 0x3a3038 : 0x2a2228)
      );
      const a = (k / 6) * Math.PI * 2 + Math.random() * 0.6;
      const rr = Math.random() * h.r * 0.55;
      rock.position.set(Math.cos(a) * rr, h.r * 0.22, Math.sin(a) * rr);
      rock.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      rock.castShadow = true;
      g.add(rock);
    }
    // and a crown of dust still hanging in the air — it JUST fell
    for (let k = 0; k < 5; k++) {
      const dust = new THREE.Mesh(
        new THREE.SphereGeometry(h.r * 0.22, 7, 5),
        plastic(0xc9a86a, { transparent: true, opacity: 0.28 })
      );
      const a = Math.random() * Math.PI * 2;
      dust.position.set(Math.cos(a) * h.r * 0.7, h.r * 0.55 + Math.random() * 0.5, Math.sin(a) * h.r * 0.7);
      g.add(dust);
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

// Keep the sun's shadow box centred on the player. Without this the shadow camera
// sits at the origin forever and your kart loses its shadow the moment you drive
// away from the middle of the map.
export function updateSunShadow(scene, x, z) {
  const sun = scene.userData?.sun;
  if (!sun) return;
  sun.position.set(x + 60, 90, z + 30);
  sun.target.position.set(x, 0, z);
  sun.target.updateMatrixWorld();
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
  // ============================================================================
  // THE TRACK EDGE — 100% of it, both sides, every track.
  //
  // What was here marked almost nothing:
  //   • `if (Math.abs(turn) < 0.06) continue;` — kerbs ONLY EXISTED ON TURNS.
  //     Every straight had no edge marking at all: on Sandcastle that was a
  //     QUARTER of the entire circuit with nothing telling you where the road
  //     ended.
  //   • Even on turns they were separate boxes every 3rd sample, so the "kerb"
  //     was a dashed line of disconnected blocks with gaps.
  //   • The "painted outline" was a ribbon laid FLAT at y=0.01 and drawn UNDER
  //     the road — a half-unit sliver nobody could see.
  //
  // A racing line is only a decision if you can SEE the edge you're flirting
  // with. So: a continuous kerb, unbroken, all the way round, on both sides.
  //
  // PERFORMANCE. The obvious version — one mesh per band — is 600+ wedges plus
  // 600 line segments, i.e. 1,200 extra draw calls, and it took the frame from
  // 24ms to 1,541ms. (The playability test caught it immediately, which is the
  // whole reason that test exists.) Everything is baked into FOUR merged meshes:
  // red kerb, white kerb, and the two lane lines. Four draw calls, not 1,200.
  // ============================================================================
  const grp = new THREE.Group();
  const n = track.samples.length;
  const BAND = 2.6;                     // metres per red/white band
  const half = track.width / 2;

  // vertex buffers we fill by hand, then hand to three.js as one geometry each
  const buf = {
    red: { pos: [], norm: [] },
    white: { pos: [], norm: [] },
    line: { pos: [], norm: [] },
  };

  // one banded wedge: road-side low, outside high. Emitted as raw triangles into
  // whichever buffer this band belongs to.
  const KERB_W = 1.15, KERB_H = 0.22, RAMP = 0.18;
  const pushQuad = (b, a1, a2, b2, b1) => {
    // two triangles, CCW
    for (const [p, q, r] of [[a1, a2, b2], [a1, b2, b1]]) {
      b.pos.push(p[0], p[1], p[2], q[0], q[1], q[2], r[0], r[1], r[2]);
      // flat-ish normal, good enough for a toon-lit kerb
      b.norm.push(0, 1, 0, 0, 1, 0, 0, 1, 0);
    }
  };

  for (const side of [1, -1]) {
    let i = 0;
    let band = 0;

    while (i < n) {
      const a = track.samples[i % n];

      // Step BAND metres along the spline.
      //
      // A single sample step on these tracks is already ~4.3m, so a loop that
      // only advances whole samples can never produce a 2.6m band — it just
      // emitted one band per sample of whatever length that sample happened to
      // be, and the red/white stripes came out uneven. track.at() interpolates,
      // so ask IT for the point 2.6m along instead of walking the raw array.
      let travelled = 0;
      let j = i;
      while (travelled < BAND && j < i + n) {
        const p0 = track.samples[j % n], p1 = track.samples[(j + 1) % n];
        travelled += Math.hypot(p1.x - p0.x, p1.z - p0.z);
        j++;
      }
      const b = track.samples[j % n];

      // Never bridge a gap in the road (the jump). This used to walk every sample
      // between i and j calling track.at() — a spline evaluation each time — which
      // made the whole build O(n²) and cost SECONDS on load. The gap flags are
      // already on the raw samples; just read them.
      let spansGap = false;
      for (let k = i; k <= j && !spansGap; k++) {
        if (track.samples[k % n]?.gap) spansGap = true;
      }

      if (!spansGap) {
        // the road-side edge of the kerb, at both ends of the band
        const anx = -a.tz * side, anz = a.tx * side;
        const bnx = -b.tz * side, bnz = b.tx * side;
        const ay = a.y || 0, by = b.y || 0;

        // HEIGHTS. The road ribbon is drawn at y = 0.02. The kerb's inner edge was
        // at y = 0.01 — BELOW the road surface — so its whole road-side face was
        // buried in the tarmac and z-fighting with the sand. Nothing showed. Every
        // vertex now sits clearly ABOVE the road, and the outer edge is high enough
        // to catch the light and cast a readable silhouette.
        const Y_ROAD = 0.05;              // just proud of the ribbon at 0.02
        const A0 = [a.x + anx * half, ay + Y_ROAD, a.z + anz * half];
        const B0 = [b.x + bnx * half, by + Y_ROAD, b.z + bnz * half];
        // the outer, raised edge
        const A1 = [a.x + anx * (half + KERB_W), ay + KERB_H, a.z + anz * (half + KERB_W)];
        const B1 = [b.x + bnx * (half + KERB_W), by + KERB_H, b.z + bnz * (half + KERB_W)];
        // the little ramp lip, just inside the road edge, so it reads as RIDEABLE
        const A2 = [a.x + anx * (half + RAMP), ay + Y_ROAD + 0.05, a.z + anz * (half + RAMP)];
        const B2 = [b.x + bnx * (half + RAMP), by + Y_ROAD + 0.05, b.z + bnz * (half + RAMP)];

        const target = (band++ % 2) ? buf.red : buf.white;
        pushQuad(target, A0, B0, B2, A2);   // the ramp
        pushQuad(target, A2, B2, B1, A1);   // the sloped top face

        // ---- THE WHITE LANE LINE ----
        // A crisp painted line just INSIDE the kerb. This is the actual "am I in
        // the lane" reference — the thing your eye tracks — and it runs unbroken
        // regardless of the red/white banding above it.
        // the painted lane line, sitting ON the road (0.02) — not in it
        const L_IN = half - 0.40, L_OUT = half - 0.06;
        const Y_LINE = 0.045;
        pushQuad(buf.line,
          [a.x + anx * L_IN, ay + Y_LINE, a.z + anz * L_IN],
          [b.x + bnx * L_IN, by + Y_LINE, b.z + bnz * L_IN],
          [b.x + bnx * L_OUT, by + Y_LINE, b.z + bnz * L_OUT],
          [a.x + anx * L_OUT, ay + Y_LINE, a.z + anz * L_OUT]
        );
      }

      i = j;
      if (j >= n) break;
    }
  }

  // three merged meshes: red kerb, white kerb, the lane line. THREE draw calls.
  const mk = (b, mat) => {
    if (!b.pos.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(b.pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(b.norm, 3));
    const m = new THREE.Mesh(g, mat);
    m.receiveShadow = true;
    return m;
  };
  const red = mk(buf.red, plastic(PALETTE.curbRed, { side: THREE.DoubleSide }));
  const white = mk(buf.white, plastic(PALETTE.curbWhite, { side: THREE.DoubleSide }));
  const line = mk(buf.line, plastic(0xfffdf2, { side: THREE.DoubleSide }));
  if (red) grp.add(red);
  if (white) grp.add(white);
  if (line) grp.add(line);

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
