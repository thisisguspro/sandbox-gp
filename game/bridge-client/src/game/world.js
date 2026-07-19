// ============================================================
// SANDBOX GP — world builder. Everything static: sky, sun, the great sand
// plane, the packed-sand track ribbon (curbs, painted edges, checkered start
// line), and the oversized-toy scenery that sells the "you are tiny, this is
// a sandbox" scale.
// ============================================================
import * as THREE from "three";
import { PALETTE, paletteFor, plastic, neon, makeSkyTexture, makeSandTexture, makeCheckerTexture, makeGroundMaps } from "./palette.js";
import { Sky } from "three/examples/jsm/objects/Sky.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

export function buildWorld(scene, track) {
  __qaList = (typeof window !== "undefined" && new URLSearchParams(location.search).has("dev_auto")) ? [] : null;
  __qaTunnelRuns = null;
  // Every map is sand, but a DIFFERENT sand. Resolve the theme's palette once
  // and build the whole world from it — golden beach, Egyptian dust, white
  // shingle, or the pink lagoon.
  const P = paletteFor(track?.def?.theme || "beach");
  // ---- THE ATMOSPHERE ----
  // A physical sky (Preetham model) with a real sun position per theme. This is
  // not decoration: the same sun direction drives the key light, and
  // initEnvironment() bakes this sky into the scene's IBL, so every PBR
  // material is lit by the weather it is standing in.
  const sky = new Sky();
  sky.scale.setScalar(560);   // must sit INSIDE the camera far plane (600)
  // Themes may ask for their own sun, but NOTHING gets a noon floodlight: the
  // physical sky's radiance grows fast with elevation, and the bleached themes
  // (egypt, shingle, pier) were washing the whole frame out. Cap it.
  const sunReq = P.sun || { elevation: 22, azimuth: 225 };
  const sunDeg = { elevation: (sunReq.elevation ?? 22) > 34 ? 18 : Math.min(sunReq.elevation ?? 22, 26), azimuth: sunReq.azimuth ?? 225 };
  const sunDir = new THREE.Vector3().setFromSphericalCoords(
    1,
    THREE.MathUtils.degToRad(90 - sunDeg.elevation),
    THREE.MathUtils.degToRad(sunDeg.azimuth)
  );
  const U = sky.material.uniforms;
  U.turbidity.value = Math.min(P.haze ?? 4, 5.5);   // cap: high haze made the circumsolar glow a white wall
  U.rayleigh.value = sunDeg.elevation < 12 ? 1.15 : 1.2;  // the sun-facing half of the dome was clipping white — thin the scatter
  U.mieCoefficient.value = 0.0022;   // shrink the sun's glow blob further
  U.mieDirectionalG.value = 0.72;    // tighter — no more half-sky halo
  U.sunPosition.value.copy(sunDir);
  scene.add(sky);
  scene.userData.sky = sky;
  {
    // themes that asked for a NOON sun (egypt's 52°) also run bleached, high-
    // albedo ground — under ACES that pairing blows the whole sand plane past
    // white. They get a harder exposure cut than everyone else.
    const expBase = Math.min(P.exposure ?? 0.88, 0.84);
    scene.userData.exposure = (sunReq.elevation ?? 22) > 34 ? Math.min(expBase, 0.74)
                            : sunDeg.elevation < 12 ? Math.min(expBase, 0.70)
                            : expBase;
  }
  // Fog far enough that the Great Sandcastle reads from anywhere on the
  // 2km circuit — it's the orientation landmark, it must never vanish.
  scene.fog = new THREE.Fog(P.fogColor ?? P.skyBottom, 160, 560);

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
  const hemi = new THREE.HemisphereLight(P.ambient, P.sandLight, 0.30);
  scene.add(hemi);

  // THE RIM. A cool counter-light from opposite the sun so every kart and prop
  // catches a cyan edge against the dusk — with the glossy Phong sheen this is
  // the "stylised racer" pop: a hot warm key on one side, an electric cold line
  // on the other. No shadows from it; it's a light for edges, not for the world.
  // sky bounce from the opposite quarter — a soft cool fill, not a neon rim
  const rim = new THREE.DirectionalLight(0xaac6e8, 0.35);
  rim.position.set(-sunDir.x * 80, 46, -sunDir.z * 80);
  scene.add(rim);

  // sun temperature follows its height, like the real thing
  const sunCol = sunDeg.elevation < 9 ? 0xffb27a : sunDeg.elevation < 24 ? 0xffdcae : 0xfff3e0;
  const sun = new THREE.DirectionalLight(sunCol, sunDeg.elevation < 12 ? 1.8 : 1.7);
  sun.position.copy(sunDir).multiplyScalar(140);
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
  const groundMaps = makeGroundMaps(P.sandLight, 256, 4021, 2.0);
  groundMaps.map.repeat.set(60, 60);
  groundMaps.normalMap.repeat.set(60, 60);
  groundMaps.roughnessMap.repeat.set(60, 60);
  let ground;
  if (isWater) {
    ground = new THREE.Mesh(
      new THREE.CircleGeometry(620, 48),
      new THREE.MeshStandardMaterial({ color: new THREE.Color(P.water).multiplyScalar(0.85), roughness: 0.6, metalness: 0, envMapIntensity: 0.5, transparent: true, opacity: 0.96 })   // glossy, not a MIRROR: the 0.06 sheet bounced the low sun straight into the camera as a white wall
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.6;                    // the deck stands proud of the water
  } else {
    // ---- THE TERRAIN GRID ----
    // The ground used to be ONE FLAT SHEET at y=0. On maps that dip (Pharaoh
    // sinks 4.5m) the sunken road ran BELOW that sheet — the flat sand
    // literally covered the ramp from above, which is the "ramps going below
    // the graphics" bug. And on the crests the sheet had nothing to say at
    // all. So the ground is now a displaced grid whose height is THE SAME
    // skirt function the embankment, the props and the physics all use: dips
    // carve a real trench, crests rise to meet the road, and there is no
    // second opinion anywhere about where the world's surface is.
    const SEG = 200, EXT = 1250;   // finer grid: 6m cells so grades render true near the track
    const verts = [], uvs = [], idx = [];
    for (let iy = 0; iy <= SEG; iy++) {
      for (let ix = 0; ix <= SEG; ix++) {
        const x = (ix / SEG - 0.5) * EXT;
        const z = (iy / SEG - 0.5) * EXT;
        verts.push(x, terrainHeightAt(track, x, z) - 0.03, z);
        uvs.push((ix / SEG) * 60, (iy / SEG) * 60);
      }
    }
    for (let iy = 0; iy < SEG; iy++) {
      for (let ix = 0; ix < SEG; ix++) {
        const a = iy * (SEG + 1) + ix, b = a + 1, c = a + SEG + 1, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    const gg = new THREE.BufferGeometry();
    gg.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
    gg.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    gg.setIndex(idx);
    gg.computeVertexNormals();
    ground = new THREE.Mesh(
      gg,
      new THREE.MeshStandardMaterial({ map: groundMaps.map, normalMap: groundMaps.normalMap, roughnessMap: groundMaps.roughnessMap, roughness: 1.0 })
    );
  }
  ground.receiveShadow = true;
  scene.add(ground);
  if (isWater) {
    // a second, slightly darker sheet a touch lower reads as depth
    const deep = new THREE.Mesh(
      new THREE.CircleGeometry(620, 40),
      new THREE.MeshStandardMaterial({ color: P.stone, roughness: 0.5 })
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
    // Start the skirt flush WITH the road edge (a hair under it), not 1.2 units
    // out. That 1.2-unit gap was a strip of nothing at the kerb line where you
    // saw straight through to the flat ground far below — which read as the road,
    // the kerbs, the cars and everything on them FLOATING. The skirt now tucks
    // right under the road edge, so the surface is continuous from tyre to sand.
    const inner = track.width / 2 - 0.7;   // tuck DEEPER under the road: no visible lip on the climbs

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
          // SMOOTHSTEP the height so the slope eases out of the road and into the
          // ground. It eases down to ~ground level (NOT to a fraction of road
          // height): keeping it high made the embankment of a raised section bulge
          // sideways OVER the neighbouring lower/turning road and hide it. The
          // fix for "everything floating" was the flush inner edge below, not a
          // raised outer edge.
          const ease = f * f * (3 - 2 * f);
          const h = (p.y || 0) * (1 - ease) - 0.02;
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
          plastic(0xffffff, { map: sandTex, side: THREE.DoubleSide, roughness: 0.95 })
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

      // Ground height at an arbitrary (x,z), computed the SAME way the prop and
      // embankment code does further down (that helper isn't in scope yet, so we
      // repeat the curve here). A pillar has to stand on the real beach floor —
      // which on maps that dip below zero (Pharaoh, Obsidian Shore) is NOT y=0 —
      // and rise to meet the deck. Seating both ends by hand at 0 was the "posts
      // through the floor" bug: the base floated over a dip or stabbed through a
      // rise instead of touching the terrain.
      const groundHeightAt = (x, z) => {
        let near = track.samples[0], nd = Infinity;
        for (const q of track.samples) {
          const dd = Math.hypot(q.x - x, q.z - z);
          if (dd < nd) { nd = dd; near = q; }
        }
        if (track.def?.drownOffTrack) return near.y || 0;   // pier: all up on pilings
        const SKIRT_START = track.width / 2 - 0.4, SKIRT_LEN = 34;
        const f = Math.max(0, Math.min(1, (nd - SKIRT_START) / SKIRT_LEN));
        const ease = f * f * (3 - 2 * f);
        return (near.y || 0) * (1 - ease);
      };
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
          new THREE.MeshStandardMaterial({ color: P.sandDark, side: THREE.DoubleSide, roughness: 0.9 })
        );
        under.receiveShadow = true;
        scene.add(under);
      }

      // Does another, LOWER road segment pass under point (x,z)? Used to (a) keep
      // deck pillars from being planted in the middle of the road you cross over,
      // and (b) know where to build a tunnel instead. Returns the lower sample or
      // null. `myY` is the height of the deck asking.
      const lowerRoadUnder = (x, z, myY) => {
        for (let j = 0; j < n2; j += 2) {
          const q = track.samples[j];
          if (q.gap) continue;
          const qy = q.y || 0;
          if (myY - qy < 2.2) continue;                  // must be well below the deck
          if (Math.hypot(q.x - x, q.z - z) < track.width / 2 + 2.5) return q;
        }
        return null;
      };

      // PILLARS. A raised causeway with nothing holding it up looks like a bug;
      // with pillars it looks like a bridge you're driving under. BUT never plant
      // one where the road crosses over ANOTHER road — that's the pole-in-the-
      // middle-of-the-lane bug. There we build a tunnel wall instead (below).
      for (let i = 0; i < n2; i += 14) {
        const a = track.at(i % n2);
        const ay = a.y || 0;
        if (a.gap || ay < 1.6) continue;
        for (const s of [-1, 1]) {
          const px = a.x + (-a.tz * s) * (track.width / 2 + 0.6);
          const pz = a.z + (a.tx * s) * (track.width / 2 + 0.6);
          if (overAnyLowerLane(track, px, pz, ay, 26)) continue;   // whole trestle zone clear — the bridge hangs
          if (piercesRoad(track, px, pz, ay - 0.55)) continue;   // and never up through a nearby roadbed
          if (!nearLowerRoad(track, px, pz, ay, 26)) {
            // hillside-flank exposure cull only — inside the trestle zone the
            // pillars are the bridge's legs and always stand
            let near = track.samples[0], nd = Infinity;
            for (const q of track.samples) { const dd = Math.hypot(q.x - px, q.z - pz); if (dd < nd) { nd = dd; near = q; } }
            const SK0 = track.width / 2 - 0.7, SKL = 34;
            const f = Math.max(0, Math.min(1, (nd - SK0) / SKL));
            const ease = f * f * (3 - 2 * f);
            if ((near.y || 0) * (1 - ease) < ay - 1.4) continue;
          }
          if (typeof window !== "undefined" && new URLSearchParams(location.search).has("dev_auto")) {
            (window.__qa_posts = window.__qa_posts || []).push({ x: px, z: pz, y: ay });
          }

          // The deck's soffit here is (ay - DROP); the beach below is groundY.
          // Build the pillar to fill exactly that gap — no floating, no stabbing.
          const DECK_DROP = 0.55;
          const groundY = groundHeightAt(px, pz);
          const top = ay - DECK_DROP;                    // underside of the deck
          const h = top - groundY;
          if (h < 0.4) continue;                         // deck sits right on the sand here
          const pillar = new THREE.Mesh(
            new THREE.CylinderGeometry(0.42, 0.55, h, 8),
            plastic(P.stone || 0xc9a86a)
          );
          pillar.position.set(px, groundY + h / 2, pz);  // centre between ground and soffit
          pillar.castShadow = true;
          pillar.receiveShadow = true;
          scene.add(pillar);
          qaReg("pillar", px, pz, 0.55, groundY, top);
          // a footing planted ON the terrain, not on an assumed y=0 plane
          const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.82, 0.24, 8), plastic(P.stoneDark || 0xa8834f));
          foot.position.set(px, groundY + 0.12, pz);
          scene.add(foot);
        }
      }

      // ---- THE TUNNEL, PROPERLY ----
      // v1 only CLEARED the corridor — legal, but you still drove through a
      // colonnade of legal-but-cluttered posts with the blown-out world
      // strobing between them. v2 builds the thing that was asked for: a solid
      // BORE. Everywhere the lower road runs through the causeway's support
      // zone it now gets continuous solid walls, its own ceiling, warm lamps
      // down the crown, cyan/pink guide lights, and a framed neon mouth at
      // each end. Solid walls also end the slit-gap glare: inside the tunnel
      // the outside world simply isn't visible except through the mouths.
      const SUPPORT_ZONE = track.width / 2 + 12;   // how far the piling forest reaches
      const covered = [];
      for (let j = 0; j < n2; j += 2) {
        const q = track.samples[j];
        if (q.gap) continue;
        const qy = q.y || 0;
        for (let i = 0; i < n2; i += 2) {
          const d = track.samples[i];
          if (d.gap) continue;
          if ((d.y || 0) - qy < 2.2) continue;
          if (Math.hypot(d.x - q.x, d.z - q.z) < SUPPORT_ZONE) { covered.push(j); break; }
        }
      }
      // contiguous runs (with wraparound join)
      const runs = [];
      if (covered.length) {
        let run = [covered[0]];
        for (let k = 1; k < covered.length; k++) {
          if (covered[k] - covered[k - 1] <= 10) run.push(covered[k]);
          else { runs.push(run); run = [covered[k]]; }
        }
        runs.push(run);
        if (runs.length > 1) {
          const first = runs[0], last = runs[runs.length - 1];
          if (first[0] + n2 - last[last.length - 1] <= 10) { runs[0] = last.concat(first); runs.pop(); }
        }
      }
      // ceiling height for a sample: kart headroom, but always under any deck
      const ceilAt = (q) => {
        const qy = q.y || 0;
        let h = qy + 4.6;
        for (let i = 0; i < n2; i += 2) {
          const d = track.samples[i];
          if (d.gap) continue;
          if ((d.y || 0) - qy < 2.2) continue;
          if (Math.hypot(d.x - q.x, d.z - q.z) < track.width / 2 + 2.5) h = Math.min(h, (d.y || 0) - 0.75);
        }
        return Math.max(qy + 3.6, h);
      };
      __qaTunnelRuns = runs.map((r) => [...r]);
      // ---- THE TOY SUSPENSION BRIDGE ----
      // The enclosed bore is GONE: no walls, no ceiling, no portals, no sand
      // mound. Wherever the circuit crosses itself, the upper deck now hangs
      // from bucket-stack towers on candy cables — and underneath there is
      // NOTHING but the lower track and open air.
      const BUCKET_A = plastic(0xff5a4c);
      const BUCKET_B = plastic(0x2fb9c9);
      const RIM = plastic(0xffd24d);
      const CABLE = plastic(0xe23d4e, { roughness: 0.5 });
      for (const run of runs) {
        // the stretch of UPPER road this run passes beneath
        const overIdx = [];
        for (let i = 0; i < n2; i += 2) {
          const d = track.samples[i];
          if (d.gap) continue;
          for (const j of run) {
            const q = track.samples[j];
            if ((d.y || 0) - (q.y || 0) < 2.2) continue;
            if (Math.hypot(d.x - q.x, d.z - q.z) < SUPPORT_ZONE) { overIdx.push(i); break; }
          }
        }
        if (overIdx.length < 2) continue;
        overIdx.sort((a, b) => a - b);
        for (const s of [1, -1]) {
          // a tower at each end of the span, walked outward until its base is
          // clear of EVERY lane below — nothing stands in the underpass
          const towers = [];
          [[overIdx[0], -2], [overIdx[overIdx.length - 1], 2]].forEach(([e0, dir]) => {
            let ti = e0;
            for (let tries = 0; tries < 14; tries++, ti += dir) {
              const d = track.at(ti);
              if (d.gap) continue;
              const tx = d.x + (-d.tz * s) * (track.width / 2 + 1.7);
              const tz2 = d.z + (d.tx * s) * (track.width / 2 + 1.7);
              if (!overAnyLowerLane(track, tx, tz2, (d.y || 0) + 3)) {
                towers.push({ x: tx, z: tz2, deckY: d.y || 0 });
                return;
              }
            }
          });
          if (towers.length < 2) continue;
          const topY = Math.max(towers[0].deckY, towers[1].deckY) + 5.4;
          for (const t of towers) {
            const gy = terrainHeightAt(track, t.x, t.z);
            const totalH = Math.max(3, topY - gy);
            const nB = Math.max(3, Math.ceil(totalH / 2.3));
            const bh = totalH / nB;
            for (let b = 0; b < nB; b++) {
              const bucket = new THREE.Mesh(new THREE.CylinderGeometry(0.78, 0.98, bh, 10), b % 2 ? BUCKET_B : BUCKET_A);
              bucket.position.set(t.x, gy + bh * (b + 0.5), t.z);
              bucket.castShadow = true;
              scene.add(bucket);
              const rim = new THREE.Mesh(new THREE.TorusGeometry(0.92, 0.09, 6, 14), RIM);
              rim.rotation.x = Math.PI / 2;
              rim.position.set(t.x, gy + bh * (b + 1) - 0.05, t.z);
              scene.add(rim);
            }
            qaReg("btower", t.x, t.z, 1.05, gy, topY + 0.4);
          }
          // main cable sagging to the deck mid, hangers down to the deck edge
          const dm = track.at(overIdx[Math.floor(overIdx.length / 2)]);
          const mid = new THREE.Vector3(
            dm.x + (-dm.tz * s) * (track.width / 2 + 1.15),
            (dm.y || 0) + 1.15,
            dm.z + (dm.tx * s) * (track.width / 2 + 1.15)
          );
          const curve = new THREE.CatmullRomCurve3([
            new THREE.Vector3(towers[0].x, topY, towers[0].z),
            mid,
            new THREE.Vector3(towers[1].x, topY, towers[1].z),
          ]);
          scene.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 40, 0.16, 6, false), CABLE));
          for (let k = 0; k < overIdx.length; k += 2) {
            const d = track.at(overIdx[k]);
            const t01 = overIdx.length === 1 ? 0.5 : k / (overIdx.length - 1);
            const cp = curve.getPoint(Math.min(1, Math.max(0, t01)));
            const ey = (d.y || 0) + 0.15;
            const hh = Math.max(0.3, cp.y - ey);
            const hang = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, hh, 5), RIM);
            hang.position.set(cp.x, ey + hh / 2, cp.z);
            scene.add(hang);
          }
        }
      }
    }
  }

  // --- the track ribbon (triangle strip from centerline samples) ---
    const roadMaps = makeGroundMaps(0xffffff, 256, 991, 1.1);
  scene.add(buildRibbon(track, track.width, P.sandDark, 0.02, true, roadMaps));  // packed grit
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
    const SKIRT_START = track.width / 2 - 0.4, SKIRT_LEN = 34;
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
    // buoys FLOAT — on a dock map the "ground" is the deck 3.2m up, and a buoy
    // hovering at deck height over open water is nonsense. Water level for them.
    if (d.kind === "buoy" && track.def?.drownOffTrack) {
      obj.position.y = -0.35;
    } else if (SURFACE_DECOR.has(d.kind) && typeof d.x === "number" && typeof d.z === "number") {
      obj.position.y += groundAt(d.x, d.z) - 0.05;   // sit it on the surface
    }
    if (typeof d.x === "number" && typeof d.z === "number") {
      // AUTHORED-BUT-INTRUDING landmarks get pushed out. A decor def written
      // for the old flat world can end up with its footprint across the lane
      // once elevation moved the road — the volcano's lava rock sat 4m off the
      // centreline with a 7m radius. Slide it away along the nearest-sample
      // normal until the whole footprint clears the corridor.
      const fp = d.r || 3;
      let near = track.samples[0], nd = Infinity;
      for (const q of track.samples) {
        if (q.gap) continue;
        const dd = Math.hypot(q.x - d.x, q.z - d.z);
        if (dd < nd) { nd = dd; near = q; }
      }
      const needed = track.width / 2 + fp + 0.8;
      if (nd < needed && Math.abs((near.y || 0) - obj.position.y) < (d.h || 10)) {
        const ux = (d.x - near.x) / (nd || 1), uz = (d.z - near.z) / (nd || 1);
        const nx2 = near.x + ux * needed, nz2 = near.z + uz * needed;
        obj.position.x = nx2; obj.position.z = nz2;
        if (SURFACE_DECOR.has(d.kind)) obj.position.y = groundAt(nx2, nz2) - 0.05 + (obj.position.y - (groundAt(d.x, d.z) - 0.05));
        qaReg("decor:" + d.kind, nx2, nz2, fp, obj.position.y, obj.position.y + (d.h || 10));
      } else {
        qaReg("decor:" + d.kind, d.x, d.z, fp, obj.position.y, obj.position.y + (d.h || 10));
      }
    }
    scene.add(obj);
  }
  scene.add(buildCurbs(track));
  // ---- THE NEON RACING LINE ----
  // Cyan tube down the left edge, pink down the right, unbroken for the whole
  // lap. At speed the road is a glowing corridor, and which way round the
  // circuit goes is legible from colour alone — even mid-air, even blinded by
  // dusk. This plus the dark racing surface IS the new look.
  scene.add(buildNeonTrim(track, P));
  // painted road furniture: a dashed centre line down every lap (the urban
  // street read), glowing chevron boards on the outside of real corners, and
  // strings of party lights across the straights — the local light that makes
  // a night circuit read as a PLACE with electricity, not a void with a road.
  scene.add(buildCenterLine(track, P));
  scene.add(buildChevrons(track, P));
  scene.add(buildStringLights(track, P));
  // ---- THE HORIZON, IN THEME ----
  // The dark neon skyline is gone: each map's horizon now matches ITS OWN
  // theme — dunes everywhere, plus sandcastle keeps, pyramids, sea stacks,
  // parasols or volcano cones depending on where you're racing.
  scene.add(buildHorizonRing(P, track));
  // ---- ROADSIDE TOKYO-WASTELAND KIT ----
  // Kana billboards on scrap scaffolds, neon torii, striped barricades and
  // glowing lamp heads scattered down the verges — plus one big neon torii
  // gate over the start straight.
  scene.add(buildNeonSignage(track, P));
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
    const SKIRT_START = track.width / 2 - 0.4, SKIRT_LEN = 34;
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
        // metres off one straight can land in the middle of a different one.
        // The old check tested only the STORED samples; on a fast curve the true
        // road edge bulges out between two samples, so a ball whose centre cleared
        // every sample could still overhang the tarmac (the pre-check-said-clean
        // bug). Test against interpolated sub-samples too, and pad by the widest
        // prop radius so nothing OVERHANGS the road even if its centre is off it.
        const PROP_R = 1.4;                                  // widest half-extent we place
        const CLEAR = track.width / 2 + 11 + PROP_R;
        let onRoad = false;
        const S = track.samples;
        for (let qi = 0; qi < S.length && !onRoad; qi++) {
          const q = S[qi], r = S[(qi + 1) % S.length];
          // check the sample AND two points interpolated toward the next one
          for (let t = 0; t <= 1; t += 0.5) {
            const cx = q.x + (r.x - q.x) * t;
            const cz = q.z + (r.z - q.z) * t;
            if (Math.hypot(cx - x, cz - z) < CLEAR) { onRoad = true; break; }
          }
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
        const SKIRT_START = track.width / 2 - 0.4;
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

    // A final, authoritative on-road test run against the ACTUAL world position
    // each instance will occupy — not the spot object, the composed matrix's
    // translation. This is the "inspect the live instanced matrices" step: even
    // if a spot slipped through collection, it is culled here before it can be
    // drawn, so a ball can never end up sitting on the tarmac.
    const onRoadWorld = (wx, wz, radius = 0) => {
      const reach = track.width / 2 + radius + 1.5;
      const S = track.samples;
      for (let qi = 0; qi < S.length; qi++) {
        const q = S[qi], r = S[(qi + 1) % S.length];
        for (let t = 0; t <= 1; t += 0.5) {
          const cx = q.x + (r.x - q.x) * t;
          const cz = q.z + (r.z - q.z) * t;
          if (Math.hypot(cx - wx, cz - wz) < reach) return true;
        }
      }
      return false;
    };

    // ---- ONE DRAW CALL PER TYPE ----
    // radius = the instance's world footprint, used for the live on-road cull.
    const mkInstanced = (geo, mat, list, yOff = 0, tintCols = null, radius = 0, tag = "scenery") => {
      if (!list.length) return;
      // Build the surviving set by reading each instance's real placement.
      const keep = [];
      for (const s of list) {
        if (radius > 0 && onRoadWorld(s.x, s.z, radius * (s.scale || 1))) continue;
        keep.push(s);
        if (radius > 0) qaReg(tag, s.x, s.z, radius * (s.scale || 1), s.y, s.y + 2.4 * (s.scale || 1));
      }
      if (!keep.length) return;
      const im = new THREE.InstancedMesh(geo, mat, keep.length);
      im.castShadow = true;
      im.receiveShadow = true;
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const pos = new THREE.Vector3();
      const scl = new THREE.Vector3();
      const col = new THREE.Color();
      keep.forEach((s, k) => {
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

    // TOWELS, ROCKS, BEACH BALLS, DRIFTWOOD — the solid ones carry a radius so
    // the live-matrix cull keeps them off the road even if collection missed.
    mkInstanced(new THREE.BoxGeometry(2.2, 0.08, 1.3), plastic(0xffffff), spots.towel, 0.05, TOY, 1.3, "towel");
    mkInstanced(new THREE.DodecahedronGeometry(1.0, 0), plastic(0xc0aa8a), spots.rock, 0.4, null, 1.4, "rock");
    mkInstanced(new THREE.SphereGeometry(0.8, 10, 8), plastic(0xfff7ea), spots.ball, 0.8, null, 0.8, "ball");
    mkInstanced(new THREE.CylinderGeometry(0.22, 0.3, 3.2, 6), plastic(0x9a8266), spots.wood, 0.3, null, 0.3, "wood");

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
      const sSkirtStart = track.width / 2 - 0.4;
      const sSkirtEnd = sSkirtStart + 34;
      const sf = Math.max(0, Math.min(1, (sOff - sSkirtStart) / (sSkirtEnd - sSkirtStart)));
      const sEase = sf * sf * (3 - 2 * sf);
      const standY = (p.y || 0) * (1 - sEase);
      stand.position.set(p.x + (-p.tz) * off, standY, p.z + (p.tx) * off);

      // ---- FACE THE TRACK ----
      //
      // The tiers step BACK along -Z (row 0 at z=0, the back row at z=-4.2), so
      // the crowd sits on the steps looking OUT over the front edge — the +Z side,
      // NOT -Z. (The earlier note had this backwards, which is why on some maps the
      // whole stand faced away from the road into the dunes.)
      //
      // A three.js Y-rotation of `a` maps local +Z to world (sin a, cos a) in
      // (x,z). We want that to point from the stand back toward the centreline —
      // the inward vector on this side is (p.tz, -p.tx). So sin a = p.tz and
      // cos a = -p.tx, i.e. a = atan2(p.tz, -p.tx).
      stand.rotation.y = Math.atan2(p.tz, -p.tx);
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
  // publish the audit surface
  if (__qaList && typeof window !== "undefined") {
    window.__worldQA = {
      placed: __qaList,
      width: track.width,
      samples: track.samples.map((sm) => ({ x: sm.x, z: sm.z, y: sm.y || 0, gap: !!sm.gap })),
      tunnelRuns: __qaTunnelRuns || [],
      terrainAt: (x, z) => terrainHeightAt(track, x, z),
    };
  }
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

function buildRibbon(track, width, color, y, shadows = false, maps = null) {
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
  // UVs run 0..1 across the road and tile along it, so the packed-grit maps
  // read as a continuous groomed surface instead of one flat paint.
  const uv = [];
  for (let i = 0; i < rows; i++) { uv.push(0, i * 0.22, 1, i * 0.22); }
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const mat = maps
    ? new THREE.MeshStandardMaterial({ color, map: maps.map, normalMap: maps.normalMap, roughnessMap: maps.roughnessMap, roughness: 1.0 })
    : new THREE.MeshStandardMaterial({ color, roughness: 0.85 });
  const m = new THREE.Mesh(g, mat);
  m.receiveShadow = shadows;
  return m;
}

// Candy-striped curbs on the OUTSIDE of tighter corners: alternating red/white
// blocks placed where the tangent swings fast.
// Wooden pilings under every stretch of elevated road — boardwalk style, so
// the bridge reads as BUILT, not floating.
// Is (x,z) inside the corridor of a road segment running at least `drop` BELOW
// the given height? Every under-deck builder (pilings, braces, deck pillars)
// asks this before planting anything, so nothing ever stands in the lane you
// drive through down there — the tunnel stays a tunnel.
// Is (x,z) inside the corridor of any road stretch running below `aboveY` at
// all? Used to keep EVERY support structure (posts, pillars, braces) out of
// any lane beneath it — drop=0.5 so even the near-level merge zones count.
function overAnyLowerLane(track, x, z, aboveY, margin = 3.5) {
  const S = track.samples;
  for (let j = 0; j < S.length; j++) {
    const q = S[j];
    if (q.gap) continue;
    if (aboveY - (q.y || 0) < 0.5) continue;
    if (Math.hypot(q.x - x, q.z - z) < track.width / 2 + margin) return true;
  }
  return false;
}

function nearLowerRoad(track, x, z, aboveY, margin = 2.0, drop = 2.2) {
  const S = track.samples;
  for (let j = 0; j < S.length; j += 2) {
    const q = S[j];
    if (q.gap) continue;
    if (aboveY - (q.y || 0) < drop) continue;
    if (Math.hypot(q.x - x, q.z - z) < track.width / 2 + margin) return true;
  }
  return false;
}

// ---- WORLD QA REGISTRY ----
// When ?dev_auto is on, every builder registers what it placed and where. The
// audit harness then checks the ENTIRE lap mathematically against the real
// constructed scene: nothing in the driving corridor, terrain never above the
// road, edges never floating. This is how "check the whole map" is actually
// done — not by eyeballing two screenshots.
let __qaList = null;
let __qaTunnelRuns = null;
function qaReg(kind, x, z, r, baseY, topY) {
  if (__qaList) __qaList.push({ kind, x, z, r, baseY, topY });
}

// THE surface function. One formula for "how high is the world at (x,z)":
// the nearest sample's altitude, faded to zero across the embankment skirt.
// The terrain grid, the embankment, the props and the audits all call THIS,
// so nothing can disagree about where the ground is.

// Would a post standing at (x,z) with this top height rise THROUGH any road
// surface? Ramps fold back near themselves: a support leg under the high part
// must never come up through the low part's roadbed.
function piercesRoad(track, x, z, topY, margin = 0.8) {
  for (const q of track.samples) {
    if (q.gap) continue;
    const qy = q.y || 0;
    if (qy + 0.1 >= topY) continue;        // road is above the post's top — fine
    if (qy < -0.5 && topY < qy) continue;
    if (Math.hypot(q.x - x, q.z - z) < track.width / 2 + margin) return true;
  }
  return false;
}

function terrainHeightAt(track, x, z) {
  let near = track.samples[0], nd = Infinity;
  for (let j = 0; j < track.samples.length; j++) {
    const q = track.samples[j];
    const dd = Math.hypot(q.x - x, q.z - z);
    if (dd < nd) { nd = dd; near = q; }
  }
  if (track.def?.drownOffTrack) return near.y || 0;
  // THE CUT ALWAYS WINS. At a crossing, the plain nearest-sample rule flips to
  // the UPPER road just past the lower road's edge and raises an 8-metre sand
  // cliff ACROSS the tunnel — the buried-mouth bug. If a road runs well below
  // the nearest sample within cutting distance, the ground here belongs to the
  // LOWER road; the hill over the bore is the overburden mesh, not terrain.
  let low = null, lowD = Infinity;
  for (let j = 0; j < track.samples.length; j++) {
    const q = track.samples[j];
    if (q.gap) continue;
    if ((near.y || 0) - (q.y || 0) < 2.2) continue;
    const dd = Math.hypot(q.x - x, q.z - z);
    if (dd < lowD) { lowD = dd; low = q; }
  }
  const SKIRT_START = track.width / 2 - 0.7, SKIRT_LEN = 34;
  const f = Math.max(0, Math.min(1, (nd - SKIRT_START) / SKIRT_LEN));
  const ease = f * f * (3 - 2 * f);
  const natural = (near.y || 0) * (1 - ease);
  // THE GRADED CUTTING. The old version was a hard switch: inside 8.5m of the
  // lower road the ground was lane-level, one step outside it was the full
  // hillside — a vertical sand wall on a boundary the terrain mesh's big
  // triangles then interpolated ACROSS, slicing sand faces through the lane.
  // Now the bank is a continuous grade: near a lower road the ground may only
  // rise at ~29° starting past the shoulder, so the hill always climbs AWAY
  // from the lane, the mesh has no cliff to bridge, and nothing can render
  // through the corridor. min() means it can only ever LOWER the natural
  // skirt — the upper road's own embankment is untouched everywhere else.
  if (low) {
    // THE TRESTLE ZONE. Wherever a lower road runs near elevated track, the
    // ground is simply FLAT at the lower road's level for a full 30 metres —
    // no graded bank, no hillside mass. The upper road crosses that open zone
    // as a BRIDGE on its pilings; the hills only begin again well beyond.
    // (Every previous patch tried to keep a hill there to shoulder the upper
    // road — that hill was the beige mass in the box. It's gone.)
    const allowed = (low.y || 0) + Math.max(0, lowD - 30) * 0.6;
    return Math.min(natural, allowed);
  }
  return natural;
}

function buildPilings(track) {
  const g = new THREE.Group();
  const post = new THREE.CylinderGeometry(0.55, 0.62, 1, 7);
  const wood = plastic(0x9a6b40);
  const brace = plastic(0x845a34);
  const qaPosts = [];
  for (let i = 0; i < track.samples.length; i += 8) {
    const p = track.at(i);
    // On the pier every plank stands on pilings — the dock IS the track, so it
    // needs legs down into the water along its whole length, not just where the
    // road happens to be elevated.
    const pier = !!track.def?.drownOffTrack;
    const h = pier ? 3.2 : (p.y || 0);
    if ((!pier && h < 1.2) || p.gap) continue;
    for (const s of [1, -1]) {
      // Just OUTSIDE the road edge. At width/2 - 0.9 the posts stood 0.9 units
      // INSIDE the deck and poked straight up through the road surface — the poles
      // sticking out of the pink pier. Move them to the edge so they support the
      // deck from beneath its rim instead.
      const postOff = pier ? (track.width / 2 + 0.4) : (track.width / 2 - 0.9);
      const px = p.x + (-p.tz * s) * postOff;
      const pz = p.z + (p.tx * s) * postOff;
      // NEVER in the underpass. These legs used to march straight through the
      // middle of the lower road — the forest of poles you got stuck in when
      // the circuit sent you under its own causeway.
      if (!pier && overAnyLowerLane(track, px, pz, h, 26)) continue;   // the whole trestle zone: the deck hangs, nothing stands under it
      if (!pier && piercesRoad(track, px, pz, h)) continue;
      if (!pier && !nearLowerRoad(track, px, pz, h, 26)) {
        // pure hillside flank (no lower road anywhere near): a post whose
        // ground is far below its top would stand exposed on the slope — skip.
        // Inside the trestle zone this never fires: those posts are the
        // bridge's LEGS, and legs are supposed to show.
        let near = track.samples[0], nd = Infinity;
        for (const q of track.samples) { const dd = Math.hypot(q.x - px, q.z - pz); if (dd < nd) { nd = dd; near = q; } }
        const SK0 = track.width / 2 - 0.7, SKL = 34;
        const f = Math.max(0, Math.min(1, (nd - SK0) / SKL));
        const ease = f * f * (3 - 2 * f);
        const hillY = (near.y || 0) * (1 - ease);
        if (hillY < h - 1.4) continue;
      }
      const m = new THREE.Mesh(post, wood);
      m.position.set(px, h / 2, pz);
      m.scale.y = h;
      g.add(m);
      qaPosts.push({ x: px, z: pz, y: h });
      qaReg("piling", px, pz, 0.62, 0, h);
    }
    // cross-brace every other bay — but never a beam across the tunnel's ceiling
    if ((i / 8) % 2 === 0 && h > 3 && !(!pier && nearLowerRoad(track, p.x, p.z, h, 5.5))) {
      if (overAnyLowerLane(track, p.x, p.z, h, 26)) continue;
      const b = new THREE.Mesh(new THREE.BoxGeometry(track.width - 1.2, 0.28, 0.28), brace);
      qaReg("brace", p.x, p.z, (track.width - 1.2) / 2, h * 0.55 - 0.14, h * 0.55 + 0.14);
      b.position.set(p.x, h * 0.55, p.z);
      b.rotation.y = -Math.atan2(p.tz, p.tx) + Math.PI / 2;
      g.add(b);
    }
  }
  if (typeof window !== "undefined" && new URLSearchParams(location.search).has("dev_auto")) {
    window.__qa_posts = (window.__qa_posts || []).concat(qaPosts);
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
  // The rail sits 6.4 units out from the skirt's inner edge, which is PART-WAY
  // DOWN the embankment slope — not at full road height. Seating it at the road's
  // centreline height (p.y) left it floating on elevated turns with its whole
  // underside and posts on show. Seat it on the skirt surface at its own offset.
  const railSkirtF = Math.max(0, Math.min(1, (6.4) / 34));
  const railEase = railSkirtF * railSkirtF * (3 - 2 * railSkirtF);
  const railGround = (yy) => (yy || 0) * (1 - railEase);
  const n = track.samples.length;
  for (let i = 0; i < track.samples.length; i += step) {
    const a = track.at(i), b = track.at(i + step);
    if (a.gap || b.gap) continue;                 // no rails across thin air
    for (const s of [1, -1]) {
      const ax = a.x + (-a.tz * s) * rail, az = a.z + (a.tx * s) * rail;
      const bx = b.x + (-b.tz * s) * rail, bz = b.z + (b.tx * s) * rail;
      // THE LOOP-BACK CHECK (same discipline as the chevrons and light poles,
      // which the rails never got): 6 units outside THIS pass can be the middle
      // of ANOTHER pass where the circuit folds — and the hills that used to
      // bury those stray segments are gone now. If any part of this segment
      // lands inside a different same-level stretch, skip it: a short gap in
      // the rail beats a rail lying across the lane.
      {
        let clash = false;
        const mx = (ax + bx) / 2, mz = (az + bz) / 2;
        const my = ((a.y || 0) + (b.y || 0)) / 2;
        for (const [px, pz, py] of [[ax, az, a.y || 0], [bx, bz, b.y || 0], [mx, mz, my]]) {
          for (let j = 0; j < n; j++) {
            const dcirc = Math.min(Math.abs(j - i), n - Math.abs(j - i));
            if (dcirc <= 10) continue;
            const q = track.samples[j];
            if (q.gap) continue;
            if (Math.abs((q.y || 0) - py) > 2.0) continue;
            if (Math.hypot(q.x - px, q.z - pz) < track.width / 2 + 0.6) { clash = true; break; }
          }
          if (clash) break;
        }
        if (clash) continue;
      }
      const len = Math.hypot(bx - ax, bz - az);
      const ay = railGround(a.y), by = railGround(b.y);
      const seg = new THREE.Mesh(noodleGeo, ((i / step) % 2 === 0) ? matA : matB);
      seg.position.set((ax + bx) / 2, 0.55 + (ay + by) / 2, (az + bz) / 2);
      seg.scale.y = len;
      seg.rotation.z = Math.PI / 2;
      seg.rotation.y = -Math.atan2(bz - az, bx - ax);
      g.add(seg);
      // a short post under each segment so the rail reads as MOUNTED, not floating
      const midy = (ay + by) / 2;
      if (midy > 0.4) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, midy + 0.6, 6), matB);
        post.position.set((ax + bx) / 2, (midy + 0.6) / 2 - 0.1, (az + bz) / 2);
        g.add(post);
      }
    }
  }
  return g;
}

// ============================================================
// TOKYO NEON WASTELAND — the dressing kit.
// Everything below is unlit MeshBasic/additive: neon is not FOR lighting the
// world, it's for being seen THROUGH the dusk. fog stays ON for the skyline
// (distance should haze it) and OFF for the tubes (glow never fades).
// ============================================================

// The two edge tubes: cyan left of the direction of travel, pink right. Built
// as per-segment quads so the track's gap sections just break the tube and it
// resumes on the far side. Each side gets a tight bright core and a wide soft
// halo underneath it — the halo is the fake bloom.
function buildNeonTrim(track, P) {
  // Real circuit furniture: embedded LED edge markers, DASHED, not a continuous
  // tube — white down the left of travel, red down the right (the convention
  // every road user already knows). The bloom pass supplies the halo; here they
  // are just small emitters set into the surface.
  const g = new THREE.Group();
  const n = track.samples.length;
  const mkSide = (side, colorHex) => {
    const verts = [];
    for (let i = 0; i < n; i += 3) {                     // one marker every 3rd sample
      const a = track.at(i % n), b = track.at((i + 1) % n);
      if (a.gap || b.gap) continue;
      const half = 0.09;
      const ay = (a.y || 0) + 0.05, by = (b.y || 0) + 0.05;
      const off = track.width / 2;
      const a0x = a.x + (-a.tz * side) * (off - half), a0z = a.z + (a.tx * side) * (off - half);
      const a1x = a.x + (-a.tz * side) * (off + half), a1z = a.z + (a.tx * side) * (off + half);
      const b0x = b.x + (-b.tz * side) * (off - half), b0z = b.z + (b.tx * side) * (off - half);
      const b1x = b.x + (-b.tz * side) * (off + half), b1z = b.z + (b.tx * side) * (off + half);
      verts.push(a0x, ay, a0z, b0x, by, b0z, b1x, by, b1z, a0x, ay, a0z, b1x, by, b1z, a1x, ay, a1z);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, neon(colorHex, { intensity: 2.6, side: THREE.DoubleSide }));
    m.renderOrder = 2;
    g.add(m);
  };
  mkSide(1, P.ledWhite);    // left of travel
  mkSide(-1, P.ledRed);     // right of travel
  return g;
}

// The themed horizon: a ring of soft dunes with the map's own landmarks —
// readable, bright, and matching the world instead of fighting it.
function buildHorizonRing(P, track) {
  const g = new THREE.Group();
  const R = 430;
  const theme = track?.def?.theme || "beach";
  const duneMat = new THREE.MeshStandardMaterial({ color: P.sandLight, roughness: 1 });
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2 + 0.12;
    const s = 34 + ((i * 37) % 30);
    const dune = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 7), duneMat);
    dune.scale.set(s * 1.9, s * 0.5, s);
    dune.position.set(Math.cos(a) * (R + 40 + (i % 3) * 40), -4, Math.sin(a) * (R + 40 + (i % 3) * 40));
    g.add(dune);
  }
  const put = (mesh, a, r, y = 0) => { mesh.position.set(Math.cos(a) * r, y, Math.sin(a) * r); g.add(mesh); };
  if (theme === "egypt") {
    const mat = new THREE.MeshStandardMaterial({ color: 0xd9b078, roughness: 0.95 });
    for (let i = 0; i < 4; i++) {
      const size = 56 + (i % 2) * 22;
      const pyr = new THREE.Mesh(new THREE.ConeGeometry(size, size * 0.86, 4), mat);
      pyr.rotation.y = 0.4 + i;
      put(pyr, (i / 4) * Math.PI * 2 + 0.6, R + 70 + (i % 2) * 60, size * 0.42);
    }
  } else if (theme === "shingle") {
    const mat = new THREE.MeshStandardMaterial({ color: 0x8fa2ad, roughness: 0.95 });
    for (let i = 0; i < 5; i++) {
      const st = new THREE.Mesh(new THREE.DodecahedronGeometry(26 + (i % 3) * 9, 0), mat);
      st.scale.y = 2.1;
      put(st, (i / 5) * Math.PI * 2 + 1.1, R + 60, 16);
    }
  } else if (theme === "volcano") {
    const mat = new THREE.MeshStandardMaterial({ color: 0x4a3a38, roughness: 1 });
    for (let i = 0; i < 2; i++) {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(90, 120, 9), mat);
      put(cone, i * 2.6 + 0.9, R + 130, 44);
      const ember = new THREE.Mesh(new THREE.SphereGeometry(9, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff7a3c, fog: false }));
      put(ember, i * 2.6 + 0.9, R + 130, 106);
    }
  } else if (theme === "pier") {
    for (let i = 0; i < 6; i++) {
      const grp = new THREE.Group();
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.6, 34, 6), new THREE.MeshStandardMaterial({ color: 0xfff7ea }));
      pole.position.y = 17;
      const canopy = new THREE.Mesh(new THREE.ConeGeometry(22, 10, 9), new THREE.MeshStandardMaterial({ color: [0xff9db8, 0x7de0e6, 0xffd479][i % 3], roughness: 0.8 }));
      canopy.position.y = 36;
      grp.add(pole, canopy);
      put(grp, (i / 6) * Math.PI * 2 + 0.35, R + 50, 0);
    }
  } else {
    // beach / sandcastle: castle keeps on the dunes
    const wallMat = new THREE.MeshStandardMaterial({ color: P.sandLight, roughness: 0.95 });
    const roofMat = new THREE.MeshStandardMaterial({ color: 0xff5a4c, roughness: 0.85 });
    for (let i = 0; i < 5; i++) {
      const keep = new THREE.Group();
      const h = 34 + (i % 3) * 10;
      const tower = new THREE.Mesh(new THREE.CylinderGeometry(11, 13, h, 9), wallMat);
      tower.position.y = h / 2;
      const roof = new THREE.Mesh(new THREE.ConeGeometry(13.5, 12, 9), roofMat);
      roof.position.y = h + 6;
      keep.add(tower, roof);
      put(keep, (i / 5) * Math.PI * 2 + 0.85, R + 55 + (i % 2) * 45, 0);
    }
  }
  return g;
}

// The skyline texture: dark towers, sparse lit windows, the odd vertical neon
// slab, red warning dots on the tallest roofs. Transparent above the rooflines
// so the painted dusk shows through.
function makeSkylineTexture(P) {
  const c = document.createElement("canvas");
  c.width = 1024; c.height = 256;
  const g = c.getContext("2d");
  let s = 1337;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const NEON = ["#ff2d78", "#22e6ff", "#ffe14d", "#b44dff"];
  let x = 0;
  while (x < 1024) {
    const w = 24 + rnd() * 52;
    const h = 46 + rnd() * 168;
    g.fillStyle = "#130a22";
    g.fillRect(x, 256 - h, w, h);
    // windows: sparse warm/cold dots
    for (let wy = 256 - h + 6; wy < 250; wy += 8) {
      for (let wx = x + 3; wx < x + w - 3; wx += 6) {
        if (rnd() < 0.16) {
          g.fillStyle = rnd() < 0.62 ? "rgba(255,215,106,0.9)" : (rnd() < 0.6 ? "rgba(34,230,255,0.85)" : "rgba(255,45,120,0.85)");
          g.fillRect(wx, wy, 2, 3);
        }
      }
    }
    // occasionally a big vertical neon slab down the tower's face
    if (rnd() < 0.34 && h > 90) {
      const col = NEON[(rnd() * NEON.length) | 0];
      g.save();
      g.shadowColor = col; g.shadowBlur = 14;
      g.fillStyle = col;
      g.fillRect(x + w * 0.32, 256 - h + 14, 8, Math.min(84, h * 0.5));
      g.restore();
    }
    // aircraft-warning dot on the tallest
    if (h > 170) { g.fillStyle = "#ff3b3b"; g.fillRect(x + w / 2 - 1.5, 256 - h - 3, 3, 3); }
    x += w + 2 + rnd() * 10;
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.repeat.set(6, 1);
  return t;
}

function buildSkylineRing(P) {
  const geo = new THREE.CylinderGeometry(430, 430, 110, 72, 1, true);
  const mat = new THREE.MeshBasicMaterial({
    map: makeSkylineTexture(P),
    transparent: true,
    side: THREE.BackSide,     // we're inside the ring, looking out
    depthWrite: false,
  });
  const m = new THREE.Mesh(geo, mat);
  m.position.y = 34;          // roots below the dust line, roofs into the dusk
  m.renderOrder = -1;
  return m;
}

// A vertical kana sign: dark panel, glowing stacked characters, romaji footer.
// One canvas per sign text/colour combo, cached, so eight signs cost four
// textures.
const _signTexCache = new Map();
function makeNeonSignTexture(text, hex, sub) {
  const key = text + hex;
  if (_signTexCache.has(key)) return _signTexCache.get(key);
  const c = document.createElement("canvas");
  c.width = 128; c.height = 384;
  const g = c.getContext("2d");
  g.fillStyle = "#0d0716"; g.fillRect(0, 0, 128, 384);
  g.strokeStyle = hex; g.lineWidth = 4;
  g.globalAlpha = 0.9; g.strokeRect(6, 6, 116, 372); g.globalAlpha = 1;
  g.save();
  g.shadowColor = hex; g.shadowBlur = 22;
  g.fillStyle = hex;
  g.font = '900 74px "Reggae One", "Yuji Mai", sans-serif';
  g.textAlign = "center"; g.textBaseline = "middle";
  const chars = [...text];
  const step = 330 / chars.length;
  chars.forEach((ch, i) => g.fillText(ch, 64, 42 + step * (i + 0.5)));
  g.restore();
  g.fillStyle = "rgba(255,242,232,0.8)";
  g.font = '700 15px "Rajdhani", sans-serif';
  g.textAlign = "center";
  g.fillText(sub, 64, 372);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  _signTexCache.set(key, t);
  return t;
}

// The kit itself: signs, torii, barricades, lamp heads — scattered down the
// verges with the same "check EVERY sample" road-clearance discipline the
// scenery uses (a sign in the racing line would be worse than no sign at all).
function buildNeonSignage(track, P) {
  const g = new THREE.Group();
  const n = track.samples.length;
  let s = 424242;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;

  // ground height, self-contained (same skirt curve as everything else)
  const groundAt = (x, z) => {
    let near = track.samples[0], nd = Infinity;
    for (const q of track.samples) { const d = Math.hypot(q.x - x, q.z - z); if (d < nd) { nd = d; near = q; } }
    if (track.def?.drownOffTrack) return near.y || 0;
    const SKIRT_START = track.width / 2 - 0.4, SKIRT_LEN = 34;
    const f = Math.max(0, Math.min(1, (nd - SKIRT_START) / SKIRT_LEN));
    const ease = f * f * (3 - 2 * f);
    return (near.y || 0) * (1 - ease);
  };
  const clearOfRoad = (x, z, margin) => {
    for (let qi = 0; qi < n; qi++) {
      const q = track.samples[qi], r = track.samples[(qi + 1) % n];
      for (let t = 0; t <= 1; t += 0.5) {
        const cx = q.x + (r.x - q.x) * t, cz = q.z + (r.z - q.z) * t;
        if (Math.hypot(cx - x, cz - z) < track.width / 2 + margin) return false;
      }
    }
    return true;
  };


  // a soft pool of light spilled on the ground under a fixture — the cheap
  // wet-street read: the fixture's colour, additive, flat on the dust
  const mkPool = (col, r = 1.8, op = 0.15) => {
    const d = new THREE.Mesh(new THREE.CircleGeometry(r, 20), neon(col, { opacity: op, side: THREE.DoubleSide }));
    d.rotation.x = -Math.PI / 2;
    d.position.y = 0.03;
    return d;
  };

  const KANA = [
    ["爆走", "BAKUSO", P.neonPink],
    ["全開", "FULL THROTTLE", P.neonCyan],
    ["危険", "DANGER", P.neonYellow],
    ["夜行", "NIGHT RUN", P.neonPurple],
    ["砂嵐", "SANDSTORM", P.neonCyan],
    ["覇者", "CHAMPION", P.neonPink],
  ];

  const hexStr = (h) => "#" + h.toString(16).padStart(6, "0");

  const mkSign = () => {
    const [txt, sub, col] = KANA[(rnd() * KANA.length) | 0];
    const grp = new THREE.Group();
    // scrap scaffold: two rusty legs, slightly off-plumb — the Mad Max half
    for (const lx of [-0.7, 0.7]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 5.2, 6), plastic(0x6e4a33));
      leg.position.set(lx, 2.6, 0.12);
      leg.rotation.z = (rnd() - 0.5) * 0.06;
      grp.add(leg);
    }
    const frame = new THREE.Mesh(new THREE.BoxGeometry(1.7, 4.4, 0.16), plastic(0x1b1420));
    frame.position.y = 4.3;
    grp.add(frame);
    // a BACKLIT panel: the artwork is also the emissive map, so the sign is a
    // real light source the bloom pass can catch — a lightbox, like the street
    const signTex = makeNeonSignTexture(txt, hexStr(col), sub);
    const face = new THREE.Mesh(
      new THREE.PlaneGeometry(1.5, 4.2),
      new THREE.MeshStandardMaterial({ map: signTex, emissive: 0xffffff, emissiveMap: signTex, emissiveIntensity: 1.25, roughness: 0.5 })
    );
    face.position.set(0, 4.3, 0.09);
    grp.add(face);
    // a little lamp bar over the top
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.08, 0.08), neon(col, { intensity: 2.8 }));
    lamp.position.set(0, 6.6, 0.1);
    grp.add(lamp);
    return grp;
  };

  const mkTorii = (span = 4.2, tubeR = 0.14, glow = P.neonPink) => {
    const grp = new THREE.Group();
    const mat = neon(glow, { intensity: 2.4 });
    for (const px of [-span / 2, span / 2]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(tubeR, tubeR * 1.15, 5.6, 8), mat);
      post.position.set(px, 2.8, 0);
      grp.add(post);
    }
    const top = new THREE.Mesh(new THREE.BoxGeometry(span + 1.6, tubeR * 2.4, tubeR * 2.4), mat);
    top.position.y = 5.6;
    top.rotation.z = 0.02;
    grp.add(top);
    const bar = new THREE.Mesh(new THREE.BoxGeometry(span + 0.4, tubeR * 1.8, tubeR * 1.8), mat);
    bar.position.y = 4.6;
    grp.add(bar);
    grp.add(mkPool(glow, span * 0.7, 0.10));
    return grp;
  };

  const mkBarricade = () => {
    const grp = new THREE.Group();
    // hazard-striped plate on two drums — wasteland furniture
    const stripe = (() => {
      const c = document.createElement("canvas");
      c.width = 64; c.height = 16;
      const gg = c.getContext("2d");
      for (let i = 0; i < 8; i++) { gg.fillStyle = i % 2 ? "#ffe14d" : "#181018"; gg.fillRect(i * 8, 0, 8, 16); }
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    })();
    for (const dx of [-0.9, 0.9]) {
      const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.9, 10), plastic(0x241c22));
      drum.position.set(dx, 0.45, 0);
      grp.add(drum);
    }
    const plate = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.5, 0.1), new THREE.MeshPhongMaterial({ map: stripe, specular: 0x333344, shininess: 20 }));
    plate.position.y = 0.95;
    plate.rotation.y = (rnd() - 0.5) * 0.14;
    grp.add(plate);
    const tube = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.07, 0.07), neon(P.neonOrange, { intensity: 2.4 }));
    tube.position.y = 1.26;
    grp.add(tube);
    return grp;
  };

  const mkLamp = (col) => {
    const grp = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 4.4, 6), plastic(0x2a2230));
    pole.position.y = 2.2;
    grp.add(pole);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 10, 8), neon(col, { intensity: 3.0 }));
    head.position.y = 4.5;
    grp.add(head);

    return grp;
  };

  // scatter down the verges
  let placed = 0, lampFlip = 0;
  for (let i = 0; i < n && placed < 26; i += 26 + ((rnd() * 14) | 0)) {
    const p = track.at(i);
    if (p.gap) continue;
    const side = rnd() < 0.5 ? -1 : 1;
    const off = track.width / 2 + 7.5 + rnd() * 7;
    const x = p.x + (-p.tz * side) * off;
    const z = p.z + (p.tx * side) * off;
    if (!clearOfRoad(x, z, 6.2)) continue;
    const roll = rnd();
    const obj = roll < 0.42 ? mkSign()
              : roll < 0.64 ? mkBarricade()
              : roll < 0.80 ? mkTorii(3.6 + rnd() * 1.4, 0.12, rnd() < 0.5 ? P.neonPink : P.neonOrange)
              : mkLamp((lampFlip++ % 2) ? P.neonPink : P.neonCyan);
    obj.position.set(x, groundAt(x, z), z);
    // face the road it belongs to
    obj.rotation.y = Math.atan2(p.x - x, p.z - z);
    g.add(obj);
    qaReg("roadside", x, z, 1.8, obj.position.y, obj.position.y + 7);
    placed++;
  }

  // THE GATE: one big neon torii spanning the start straight, just past the
  // line — every lap begins by driving through it. Posts sit outside the road
  // edge; the crossbar clears any kart with metres to spare.
  {
    const p = track.at(6);
    if (!p.gap) {
      const gate = mkTorii(track.width + 3.4, 0.22, P.neonPink);
      gate.scale.setScalar(1.45);
      gate.position.set(p.x, (p.y || 0), p.z);
      // span axis must run ACROSS the road: local +X onto the lateral normal
      gate.rotation.y = Math.atan2(-p.tx, -p.tz);
      const gHalf = ((track.width + 3.4) / 2) * 1.45;
      for (const gs of [1, -1]) qaReg("gate", p.x - p.tz * (gs * gHalf), p.z + p.tx * (gs * gHalf), 0.4, p.y || 0, (p.y || 0) + 8.5);
      g.add(gate);
    }
  }
  return g;
}

// Dashed centre line: paint, not neon — it sits IN the road surface and reads
// as street furniture (double-length dashes, warm yellow, slightly lifted so
// it never z-fights the ribbon).
function buildCenterLine(track, P) {
  const verts = [];
  const n = track.samples.length;
  const HALF = 0.10;
  for (let i = 0; i < n; i += 6) {
    const a = track.at(i % n), b = track.at((i + 3) % n);
    if (a.gap || b.gap) continue;
    const ay = (a.y || 0) + 0.045, by = (b.y || 0) + 0.045;
    const a0x = a.x + (-a.tz) * HALF, a0z = a.z + (a.tx) * HALF;
    const a1x = a.x - (-a.tz) * HALF, a1z = a.z - (a.tx) * HALF;
    const b0x = b.x + (-b.tz) * HALF, b0z = b.z + (b.tx) * HALF;
    const b1x = b.x - (-b.tz) * HALF, b1z = b.z - (b.tx) * HALF;
    verts.push(a0x, ay, a0z, b0x, by, b0z, b1x, by, b1z, a0x, ay, a0z, b1x, by, b1z, a1x, ay, a1z);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xffd23d, side: THREE.DoubleSide }));
  m.renderOrder = 1;
  return m;
}

// Chevron boards: the "<<<" panels standing on the OUTSIDE of every genuine
// corner, arrows pointing the way the road bends, facing oncoming traffic.
// Curvature is measured over an 18-sample window; boards are rate-limited so a
// long sweeper gets one, not a picket fence.
const _chevTexCache = new Map();
function makeChevronTexture(left, hex) {
  const key = (left ? "L" : "R") + hex;
  if (_chevTexCache.has(key)) return _chevTexCache.get(key);
  const c = document.createElement("canvas");
  c.width = 256; c.height = 128;
  const g = c.getContext("2d");
  g.fillStyle = "#0d0716"; g.fillRect(0, 0, 256, 128);
  g.strokeStyle = hex; g.lineWidth = 5; g.globalAlpha = 0.9;
  g.strokeRect(5, 5, 246, 118); g.globalAlpha = 1;
  g.save();
  g.shadowColor = hex; g.shadowBlur = 18;
  g.strokeStyle = hex; g.lineWidth = 13; g.lineCap = "round"; g.lineJoin = "round";
  for (let k = 0; k < 3; k++) {
    const cx = left ? 196 - k * 62 : 60 + k * 62;
    const dir = left ? -1 : 1;
    g.beginPath();
    g.moveTo(cx - dir * 18, 26);
    g.lineTo(cx + dir * 18, 64);
    g.lineTo(cx - dir * 18, 102);
    g.stroke();
  }
  g.restore();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  _chevTexCache.set(key, t);
  return t;
}

function buildChevrons(track, P) {
  const g = new THREE.Group();
  const n = track.samples.length;
  const hexStr = (h) => "#" + h.toString(16).padStart(6, "0");
  let lastAt = -999;
  for (let i = 0; i < n; i += 6) {
    const a = track.at(i % n), b = track.at((i + 18) % n);
    if (a.gap || b.gap) continue;
    const dot = a.tx * b.tx + a.tz * b.tz;
    const turn = Math.acos(Math.max(-1, Math.min(1, dot)));
    if (turn < 0.55) continue;                 // not a real corner
    if (i - lastAt < 40) continue;             // one per corner, not a fence
    lastAt = i;
    // which way does it bend? y-component of tangent cross product
    const crossY = a.tz * b.tx - a.tx * b.tz;
    const turnsLeft = crossY > 0;
    // stand on the OUTSIDE of the bend, mid-corner, facing oncoming traffic
    const m = track.at((i + 9) % n);
    const side = turnsLeft ? -1 : 1;           // outside = opposite the bend
    const off = track.width / 2 + 3.4;
    const x = m.x + (-m.tz * side) * off;
    const z = m.z + (m.tx * side) * off;
    // THE LOOP-BACK CHECK. The outside of THIS corner can be the middle of a
    // completely different straight — the track folds over itself. Test the
    // stand against EVERY sample at a similar height before building it.
    {
      let clash = false;
      const my = m.y || 0;
      for (const q of track.samples) {
        if (q.gap) continue;
        if (Math.abs((q.y || 0) - my) > 2.0) continue;
        if (Math.hypot(q.x - x, q.z - z) < track.width / 2 + 2.2) { clash = true; break; }
      }
      if (clash) continue;
    }
    const grp = new THREE.Group();
    const legMat = plastic(0x2a2230);
    for (const lx of [-0.8, 0.8]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 1.4, 6), legMat);
      leg.position.set(lx, 0.7, 0);
      grp.add(leg);
    }
    const panel = new THREE.Mesh(
      new THREE.PlaneGeometry(2.3, 1.15),
      new THREE.MeshBasicMaterial({ map: makeChevronTexture(turnsLeft, hexStr(P.neonPink)), fog: false, side: THREE.DoubleSide })
    );
    panel.position.y = 1.85;
    grp.add(panel);
    grp.position.set(x, (m.y || 0), z);
    grp.rotation.y = Math.atan2(-m.tx, -m.tz);   // panel +Z faces back down the road
    qaReg("chevron", x, z, 1.25, (m.y || 0), (m.y || 0) + 2.6);
    g.add(grp);
  }
  return g;
}

// Strings of party lights across the straights: two poles, a sagging run of
// glowing bulbs between them, alternating pink/cyan/yellow. Only where the
// road runs straight and level, high enough that nothing ever clips them.
function buildStringLights(track, P) {
  const g = new THREE.Group();
  const n = track.samples.length;
  const COLS = [P.neonPink, P.neonCyan, P.neonYellow];
  let placed = 0, lastAt = -999;
  for (let i = 0; i < n && placed < 6; i += 8) {
    const a = track.at(i % n), b = track.at((i + 14) % n);
    if (a.gap || b.gap) continue;
    const dot = a.tx * b.tx + a.tz * b.tz;
    if (dot < 0.995) continue;                            // straights only
    if (Math.abs((a.y || 0) - (b.y || 0)) > 0.4) continue; // level only
    if (i - lastAt < 70) continue;
    const y0 = (a.y || 0);
    const span = track.width + 2.4;
    // the poles stand just off THIS straight — make sure that spot isn't the
    // middle of a DIFFERENT pass of the circuit (excluding our own samples)
    {
      let clash = false;
      for (const s2 of [-1, 1]) {
        const px = a.x + (-a.tz * s2) * (span / 2);
        const pz = a.z + (a.tx * s2) * (span / 2);
        for (let jj = 0; jj < n; jj++) {
          if (Math.abs(jj - i) < 8 || Math.abs(jj - i) > n - 8) continue;   // not our own stretch
          const q = track.samples[jj];
          if (q.gap) continue;
          if (Math.abs((q.y || 0) - y0) > 2.0) continue;
          if (Math.hypot(q.x - px, q.z - pz) < track.width / 2 + 0.9) { clash = true; break; }
        }
        if (clash) break;
      }
      if (clash) continue;
    }
    lastAt = i; placed++;
    const poleMat = plastic(0x2a2230);
    for (const s of [-1, 1]) {
      const px = a.x + (-a.tz * s) * (span / 2);
      const pz = a.z + (a.tx * s) * (span / 2);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.10, 5.4, 6), poleMat);
      pole.position.set(px, y0 + 2.7, pz);
      qaReg("slpole", px, pz, 0.12, y0, y0 + 5.4);
      g.add(pole);
    }
    // the bulbs, on a shallow catenary
    for (let k = 0; k <= 8; k++) {
      const t = k / 8;
      const lat = (t - 0.5) * span;
      const sag = Math.sin(t * Math.PI) * 0.7;
      const bx = a.x + (-a.tz) * lat;
      const bz = a.z + (a.tx) * lat;
      const bulb = new THREE.Mesh(
        new THREE.SphereGeometry(0.11, 8, 6),
        new THREE.MeshBasicMaterial({ color: COLS[k % COLS.length], transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })
      );
      bulb.position.set(bx, y0 + 5.3 - sag, bz);
      g.add(bulb);
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


// ============================================================
// initEnvironment(renderer, scene) — the IBL step. Called once per scene from
// Race3D after the world is built (it needs the renderer, which buildWorld
// never sees). Bakes the scene's own physical sky into a PMREM environment so
// every Standard/Physical material — car paint above all — reflects the
// weather it's standing in. Scenes without a Sky (arenas) get a neutral room.
// ============================================================
export function initEnvironment(renderer, scene) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  let env;
  const sky = scene.userData.sky;
  if (sky) {
    const tmp = new THREE.Scene();
    const s2 = new Sky();
    s2.scale.setScalar(60);     // inside the PMREM cube camera's far plane
    for (const k of ["turbidity", "rayleigh", "mieCoefficient", "mieDirectionalG"]) {
      s2.material.uniforms[k].value = sky.material.uniforms[k].value;
    }
    s2.material.uniforms.sunPosition.value.copy(sky.material.uniforms.sunPosition.value);
    tmp.add(s2);
    env = pmrem.fromScene(tmp, 0.04).texture;
  } else {
    env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  }
  scene.environment = env;
  if ('environmentIntensity' in scene) scene.environmentIntensity = 0.42;
  if (scene.userData.exposure) renderer.toneMappingExposure = scene.userData.exposure;
  pmrem.dispose();
}
