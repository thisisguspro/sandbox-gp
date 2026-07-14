// ============================================================
// SANDBOX GP — Effects3D: everything the water-vs-sand layer looks like.
//
//   entities (from view.entities):
//     balloon    → wobbling red water balloon on a lobbed arc
//     squirt     → turquoise droplet jet from the shooter's nose
//     slickzone  → wet-sand puddle + tiny sprinkler fountain
//     wave       → a rolling turquoise wall with a foam lip
//     sandpile   → dark sand cone hazard (a crumbled racer's remains)
//   statuses (per player flags):
//     soaked / turbo / shield(bucket!) / kited(kite + string) / erosion tint
//   moments (from events):
//     balloon_pop / splash / crumble / pile_dissolved → particle bursts
//
// Water is ALWAYS the turquoise. Everything else stays warm.
// ============================================================
import * as THREE from "three";
import { PALETTE, plastic } from "./palette.js";

const WATER = PALETTE.water;

export class Effects3D {
  constructor(scene) {
    this.scene = scene;
    this.ent = new Map();      // entityId -> { grp, kind }
    this.status = new Map();   // playerId -> { bucket, kite, soakTint, streaks }
    this.bursts = [];          // transient particle bursts
    this._burstGeo = new THREE.SphereGeometry(0.16, 6, 5);
    this._waterMat = plastic(WATER, { transparent: true, opacity: 0.9 });
    this._sandMat = plastic(0xcfa25e);
  }

  // ---------- entities ----------
  syncEntities(list = []) {
    const seen = new Set();
    for (const e of list) {
      seen.add(e.id);
      let rec = this.ent.get(e.id);
      if (!rec) { rec = { kind: e.kind, grp: this._build(e) }; this.scene.add(rec.grp); this.ent.set(e.id, rec); }
      const g = rec.grp;
      g.position.x = e.x; g.position.z = e.z;
      if (e.kind === "balloon") g.position.y = e.y ?? 1;
      if (e.kind === "bouncer") {
        g.position.y = e.y ?? 1;
        g.rotation.x += 0.12;                    // it TUMBLES
        g.rotation.z += 0.07;
      }
      if (e.kind === "geyser") {
        const t = performance.now() / 500;
        g.scale.setScalar(1 + Math.sin(t) * 0.06);   // it breathes, so you can spot it
      }
      if (e.kind === "cloud") {
        const t = performance.now() / 1000;
        g.rotation.y = t * 0.3;
        g.children[0]?.children.forEach((c, i) => {
          if (i >= 5) c.position.y = 0.6 + ((t * 5 + i) % 3);   // rain falls
        });
      }
      if (e.kind === "homing") {
        g.position.y = e.y ?? 6;
        g.rotation.x += 0.2;
        g.rotation.y += 0.15;
      }
      if (e.kind === "squirt" && e.heading != null) g.rotation.y = -e.heading;
      if (e.kind === "wave") {
        // face along travel — server sends the authoritative heading (present
        // from frame 0, so the wall never spawns side-on); motion delta stays
        // as a fallback for older servers.
        if (e.heading != null) g.rotation.y = -e.heading;
        else if (rec.lastX != null) {
          const dx = e.x - rec.lastX, dz = e.z - rec.lastZ;
          if (Math.hypot(dx, dz) > 0.01) g.rotation.y = -Math.atan2(dz, dx);
        }
        rec.lastX = e.x; rec.lastZ = e.z;
      }
    }
    for (const [id, rec] of this.ent) {
      if (!seen.has(id)) {
        // entity gone → little pop where it was
        if (rec.kind === "balloon" || rec.kind === "wave") this.burst(rec.grp.position.x, rec.grp.position.z, WATER, 10);
        if (rec.kind === "sandpile") this.burst(rec.grp.position.x, rec.grp.position.z, 0xcfa25e, 14);
        this.scene.remove(rec.grp);
        this.ent.delete(id);
      }
    }
  }

  _build(e) {
    const grp = new THREE.Group();
    // ---- the new entity kinds ----
    if (e.kind === "bouncer") {
      // ---- A REAL BEACH BALL ----
      // Six proper GORES running pole to pole, the way a beach ball is actually
      // made — alternating colour, with white caps at the top and bottom where the
      // panels meet, and a little valve stem. The old one was a white sphere with
      // four thin slivers stuck to it and it read as a bug, not a ball.
      const cols = [0xe2574c, 0xfff7ea, 0x2fe6c8, 0xfff7ea, 0xf7c04a, 0xfff7ea];
      const R = 0.9;
      for (let i = 0; i < 6; i++) {
        const gore = new THREE.Mesh(
          // a full pole-to-pole wedge: phiStart, phiLength across the whole theta
          new THREE.SphereGeometry(R, 12, 14, (i / 6) * Math.PI * 2, Math.PI * 2 / 6),
          plastic(cols[i])
        );
        gore.castShadow = true;
        grp.add(gore);
      }
      // the white caps where all six panels converge
      for (const s of [1, -1]) {
        const cap = new THREE.Mesh(
          new THREE.SphereGeometry(R * 1.005, 12, 6, 0, Math.PI * 2, s > 0 ? 0 : Math.PI * 0.86, Math.PI * 0.14),
          plastic(0xfff7ea)
        );
        grp.add(cap);
      }
      // the valve stem — the detail that makes it a TOY and not a sphere
      const valve = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.10, 8), plastic(0xe8e0d0));
      valve.position.set(R * 0.72, R * 0.62, 0);
      valve.rotation.z = -0.7;
      grp.add(valve);
      return grp;
    }
    if (e.kind === "geyser") {
      // ---- A BURIED WHOOPEE CUSHION ----
      // Was a torus and a translucent ball. It's a TRAP, so it should look like
      // one you'd actually plant on a beach: a rubber bladder half-buried in the
      // sand, its pinched spout sticking up, with a ring of damp sand around it
      // where someone patted it down. Cartoon-obvious once you know what it is,
      // and easy to miss at speed — which is the whole point.
      const R = e.r || 2.4;

      // the ring of patted-down damp sand that gives it away
      const patch = new THREE.Mesh(new THREE.CircleGeometry(R, 22), plastic(PALETTE.sandDark, { transparent: true, opacity: 0.55 }));
      patch.rotation.x = -Math.PI / 2;
      patch.position.y = 0.04;
      grp.add(patch);
      const ridge = new THREE.Mesh(new THREE.TorusGeometry(R, 0.13, 8, 22), plastic(PALETTE.sandLight));
      ridge.rotation.x = -Math.PI / 2;
      ridge.position.y = 0.10;
      grp.add(ridge);

      // the BLADDER: a squashed rubber dome, mostly under the sand
      const bladder = new THREE.Mesh(new THREE.SphereGeometry(0.62, 12, 9, 0, Math.PI * 2, 0, Math.PI / 2), plastic(0xe0407f));
      bladder.scale.y = 0.48;
      bladder.position.y = 0.06;
      bladder.castShadow = true;
      grp.add(bladder);

      // the SPOUT — a pinched rubber neck poking up, waiting to be trodden on
      const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.14, 0.26, 8), plastic(0xc42d68));
      spout.position.set(0.28, 0.26, 0.12);
      spout.rotation.z = -0.34;
      grp.add(spout);
      const lip = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.03, 6, 10), plastic(0xc42d68));
      lip.position.set(0.32, 0.38, 0.12);
      lip.rotation.x = Math.PI / 2;
      lip.rotation.z = -0.34;
      grp.add(lip);

      // a highlight, so the rubber reads as rubber
      const shine = new THREE.Mesh(
        new THREE.SphereGeometry(0.16, 8, 6),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.28 })
      );
      shine.position.set(-0.18, 0.30, 0.20);
      shine.scale.set(1.5, 0.4, 0.9);
      grp.add(shine);

      return grp;
    }
    if (e.kind === "cloud") {
      // ---- A PROPER CARTOON RAIN CLOUD ----
      // Was five grey spheres in a ring at head height with box "rain". A rain
      // cloud has a FLAT BOTTOM and a lumpy top — that silhouette is the whole
      // reason you recognise one instantly. It hangs low over the victim, it's
      // dark underneath and bright on top where the sun still hits it, and the
      // rain falls in taut little teardrops.
      const g = new THREE.Group();
      const H = 3.5;

      // the lumpy top: overlapping puffs of different sizes
      const puffs = [
        [0, 0.15, 0, 1.15], [-1.15, 0.0, 0.1, 0.9], [1.2, 0.05, -0.1, 0.95],
        [-0.55, 0.42, -0.5, 0.7], [0.6, 0.38, 0.5, 0.75], [0, 0.5, 0.6, 0.6],
      ];
      for (const [x, y, z, r] of puffs) {
        const puff = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 9), plastic(0x8a97a3));
        puff.position.set(x, H + y, z);
        puff.castShadow = true;
        g.add(puff);
      }
      // THE FLAT BOTTOM — a dark, heavy slab. This is what says "rain cloud".
      const belly = new THREE.Mesh(new THREE.CylinderGeometry(1.55, 1.7, 0.42, 18), plastic(0x4a5763));
      belly.position.y = H - 0.42;
      g.add(belly);
      // a bright rim on top where the sun catches it
      const lit = new THREE.Mesh(new THREE.SphereGeometry(1.02, 12, 8), plastic(0xc4cdd6));
      lit.position.set(-0.15, H + 0.62, -0.1);
      lit.scale.set(1.1, 0.6, 1.0);
      g.add(lit);

      // THE RAIN: teardrops, not boxes — a stretched drop with a pointed top
      for (let i = 0; i < 18; i++) {
        const drop = new THREE.Mesh(
          new THREE.SphereGeometry(0.07, 6, 5),
          plastic(0x59b7e8, { transparent: true, opacity: 0.8 })
        );
        drop.scale.set(1, 3.4, 1);            // stretched by falling
        drop.position.set(
          (Math.random() - 0.5) * 2.7,
          0.6 + Math.random() * 2.4,
          (Math.random() - 0.5) * 2.7
        );
        g.add(drop);
      }
      // a puddle forming under it
      const puddle = new THREE.Mesh(
        new THREE.CircleGeometry(1.5, 20),
        plastic(0x2a7fa8, { transparent: true, opacity: 0.32 })
      );
      puddle.rotation.x = -Math.PI / 2;
      puddle.position.y = 0.05;
      g.add(puddle);

      grp.add(g);
      return grp;
    }
    if (e.kind === "homing") {
      // ---- A ROCKET-POWERED RUBBER DUCK ----
      //
      // This was a burning METEOR — a lump of space rock with a fire cone. On a
      // beach. In a game about pool toys. It made no sense and it was three
      // primitives.
      //
      // A homing weapon in a toy war should be the silliest thing on the track:
      // a bath duck with a firework strapped to it, screaming across the sand
      // after the leader. The duck is the READABLE part — you know instantly
      // what's coming for you.
      const duck = new THREE.Group();

      // the body: a fat yellow blob
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 10), plastic(0xffd93d));
      body.scale.set(1.15, 0.95, 1.0);
      body.castShadow = true;
      duck.add(body);

      // the tail, kicked up at the back
      const tail = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.34, 6), plastic(0xffd93d));
      tail.position.set(-0.42, 0.16, 0);
      tail.rotation.z = 1.9;
      duck.add(tail);

      // the head on a stubby neck
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 10, 8), plastic(0xffd93d));
      head.position.set(0.36, 0.34, 0);
      duck.add(head);

      // THE BEAK — the single detail that makes it a duck at a glance
      const beak = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.24, 6), plastic(0xff8c1a));
      beak.position.set(0.58, 0.30, 0);
      beak.rotation.z = -Math.PI / 2;
      duck.add(beak);

      // eyes
      for (const s of [-1, 1]) {
        const eye = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 5), plastic(0x1c1712));
        eye.position.set(0.44, 0.42, s * 0.14);
        duck.add(eye);
      }

      grp.add(duck);

      // THE FIREWORK, gaffer-taped to its back
      const rocket = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.62, 8), plastic(0xe2574c));
      rocket.position.set(-0.14, 0.34, 0);
      rocket.rotation.z = Math.PI / 2;
      grp.add(rocket);
      const nose = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.20, 8), plastic(0xfff7ea));
      nose.position.set(0.24, 0.34, 0);
      nose.rotation.z = -Math.PI / 2;
      grp.add(nose);
      // fins
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        const fin = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.02, 0.14), plastic(0xfff7ea));
        fin.position.set(-0.40, 0.34 + Math.sin(a) * 0.12, Math.cos(a) * 0.12);
        fin.rotation.x = a;
        grp.add(fin);
      }

      // the EXHAUST plume out the back
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.20, 0.9, 8), plastic(0xffb020, { transparent: true, opacity: 0.9 }));
      flame.position.set(-0.86, 0.34, 0);
      flame.rotation.z = Math.PI / 2;
      grp.add(flame);
      const flameCore = new THREE.Mesh(new THREE.ConeGeometry(0.10, 0.55, 6), plastic(0xfff2b0));
      flameCore.position.set(-0.72, 0.34, 0);
      flameCore.rotation.z = Math.PI / 2;
      grp.add(flameCore);

      // a smoke trail behind it
      for (let i = 0; i < 4; i++) {
        const puff = new THREE.Mesh(
          new THREE.SphereGeometry(0.14 + i * 0.06, 6, 5),
          plastic(0xc4cdd6, { transparent: true, opacity: 0.32 - i * 0.06 })
        );
        puff.position.set(-1.2 - i * 0.36, 0.34 + (i % 2) * 0.08, (i % 2 ? 0.06 : -0.06));
        grp.add(puff);
      }

      grp.userData.duck = duck;
      return grp;
    }
    if (e.kind === "balloon") {
      // ---- A REAL WATER BALLOON ----
      // Not a sphere with a lump on it. A water balloon is a TEARDROP: fat and
      // heavy at the bottom where the water pools, tapering up to a pinched neck
      // and a knotted tie. It's translucent — you can see the water sloshing
      // inside — and it WOBBLES, because it's a bag of liquid.
      const skin = new THREE.MeshLambertMaterial({
        color: PALETTE.toyRed,
        transparent: true,
        opacity: 0.82,
      });
      // the teardrop: a sphere squashed low and pulled up at the neck
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.42, 14, 12), skin);
      body.scale.set(1.02, 0.92, 1.02);
      body.castShadow = true;
      grp.add(body);

      // the water INSIDE it — a smaller, darker, denser sphere sitting low
      const water = new THREE.Mesh(
        new THREE.SphereGeometry(0.33, 10, 8),
        new THREE.MeshLambertMaterial({ color: 0x2a7fa8, transparent: true, opacity: 0.7 })
      );
      water.position.y = -0.10;
      water.scale.set(1, 0.8, 1);
      grp.add(water);

      // the NECK: a short pinched cone rising off the top
      const neck = new THREE.Mesh(
        new THREE.CylinderGeometry(0.055, 0.16, 0.20, 8),
        plastic(PALETTE.toyRed)
      );
      neck.position.y = 0.42;
      grp.add(neck);

      // the KNOT: a little twisted tie, slightly off-axis so it looks tied by hand
      const knot = new THREE.Mesh(new THREE.TorusGeometry(0.055, 0.032, 6, 10), plastic(PALETTE.toyRed));
      knot.position.y = 0.52;
      knot.rotation.x = 0.5;
      knot.rotation.z = 0.3;
      grp.add(knot);

      // a highlight, so it reads as WET rubber rather than matte plastic
      const gloss = new THREE.Mesh(
        new THREE.SphereGeometry(0.12, 8, 6),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 })
      );
      gloss.position.set(-0.16, 0.16, 0.28);
      gloss.scale.set(1.6, 1, 0.4);
      grp.add(gloss);

      grp.userData.wobble = body;
      grp.userData.water = water;
    }
    else if (e.kind === "squirt") {
      // ---- A WATER-PISTOL JET ----
      // Was nine identical dabs floating in a line. A real jet has SHAPE: a tight
      // coherent stream at the nozzle that breaks up into fat wobbling droplets
      // as it flies, with a bright core and a spray of mist around it. It should
      // read as WATER LEAVING A TOY GUN, not as beads on a string.
      const jet = new THREE.Group();

      // the coherent stream, right at the muzzle
      const stream = new THREE.Mesh(
        new THREE.CylinderGeometry(0.10, 0.15, 1.1, 8),
        plastic(0x7fd0cc, { transparent: true, opacity: 0.88 })
      );
      stream.rotation.z = -Math.PI / 2;
      stream.position.x = 0.55;
      jet.add(stream);
      // a bright core inside it
      const core = new THREE.Mesh(
        new THREE.CylinderGeometry(0.05, 0.07, 1.0, 6),
        plastic(0xd8fbff, { transparent: true, opacity: 0.9 })
      );
      core.rotation.z = -Math.PI / 2;
      core.position.x = 0.55;
      jet.add(core);

      // then it BREAKS UP: fat droplets, getting fatter and more scattered
      for (let i = 0; i < 9; i++) {
        const f = i / 8;
        const d = new THREE.Mesh(
          new THREE.SphereGeometry(0.09 + f * 0.11, 7, 6),
          plastic(0x59b7e8, { transparent: true, opacity: 0.85 - f * 0.25 })
        );
        d.scale.set(1 + f * 0.5, 1, 1);       // stretched along flight
        d.userData.k = i;
        jet.add(d);
      }

      // and a mist of fine spray around the whole thing
      for (let i = 0; i < 7; i++) {
        const m = new THREE.Mesh(
          new THREE.SphereGeometry(0.05, 5, 4),
          plastic(0xd8fbff, { transparent: true, opacity: 0.4 })
        );
        m.position.set(
          0.9 + Math.random() * 1.4,
          (Math.random() - 0.5) * 0.5,
          (Math.random() - 0.5) * 0.5
        );
        jet.add(m);
      }

      grp.add(jet);
      grp.userData.jet = jet;
    }
    else if (e.kind === "slickzone") {
      // ---- A GARDEN SPRINKLER ----
      // Was a brown circle with a white cylinder on it. This is the actual toy: a
      // spiked base pushed into the sand, a stubby body, and a spinning arm with
      // nozzles flicking water out in an arc. You've seen one on every lawn.
      const R = e.r || 2.6;

      // the wet patch it's made
      const wet = new THREE.Mesh(new THREE.CircleGeometry(R, 22), plastic(PALETTE.sandDark));
      wet.rotation.x = -Math.PI / 2; wet.position.y = 0.045;
      const gloss = new THREE.Mesh(new THREE.CircleGeometry(R * 0.72, 22), plastic(WATER, { transparent: true, opacity: 0.42 }));
      gloss.rotation.x = -Math.PI / 2; gloss.position.y = 0.055;
      grp.add(wet, gloss);

      // the SPIKE, driven into the ground
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.5, 6), plastic(0x2a7f3a));
      spike.position.y = -0.1;
      spike.rotation.x = Math.PI;
      grp.add(spike);

      // the body: a squat green plastic base
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.30, 0.38, 0.24, 12), plastic(0x2a7f3a));
      base.position.y = 0.14;
      base.castShadow = true;
      grp.add(base);

      // the SPINNING ARM with two nozzles — the thing that makes it a sprinkler
      const arm = new THREE.Group();
      const bar = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.07, 0.09), plastic(0xfff7ea));
      arm.add(bar);
      for (const s of [-1, 1]) {
        const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.16, 6), plastic(0x1c5f2a));
        nozzle.position.set(s * 0.5, 0.06, 0);
        nozzle.rotation.z = s * -0.5;          // angled up and out
        arm.add(nozzle);
      }
      arm.position.y = 0.34;
      grp.add(arm);
      grp.userData.sprinklerArm = arm;

      // the water arcing out of it
      const drops = new THREE.Group();
      for (let i = 0; i < 14; i++) {
        const d = new THREE.Mesh(this._burstGeo, this._waterMat);
        d.userData.k = i;
        drops.add(d);
      }
      grp.add(drops);
      grp.userData.drops = drops;
    }
    else if (e.kind === "wave") {
      // ---- A BREAKING WAVE ----
      // Was a leaning half-cylinder with a torus balanced on top. A wave that's
      // ABOUT TO BREAK has a green translucent face, a lip curling forward over
      // it, a chaotic white crest, and spray flying off the top. That curl is the
      // silhouette — it's why you can tell a breaking wave from a swell.
      // A straight-sided face, not a taper. The old one flared at the base
      // (radiusTop 2.6, radiusBottom 3.0), which meant the bottom's centre of mass
      // sat further out than the top's — so however you leaned it, the geometry
      // still measured as tipping BACKWARD. A wave face is near-vertical anyway;
      // the drama comes from the CURL, not from a cone.
      const wall = new THREE.Mesh(
        new THREE.CylinderGeometry(2.7, 2.7, 2.4, 20, 1, true, 0, Math.PI),
        plastic(WATER, { transparent: true, opacity: 0.82, side: THREE.DoubleSide })
      );
      // THE CREST LEANS FORWARD, into travel.
      //
      // A cylinder's top is +Y, and rotating about Z by a POSITIVE angle swings +Y
      // toward -X — i.e. BACKWARD. So `rotation.z = +0.28` (what was here) tipped
      // the wave AWAY from you: it looked like it was falling over backwards
      // instead of about to break on your head.
      wall.rotation.z = -0.30;   // axis tips toward +X: the face falls TOWARD you
      wall.position.y = 1.2;
      grp.add(wall);

      // THE CURL: a lip of water pitching forward over the face
      const curl = new THREE.Mesh(
        new THREE.TorusGeometry(2.55, 0.42, 8, 20, Math.PI),
        plastic(0x7fd0cc, { transparent: true, opacity: 0.9 })
      );
      curl.rotation.x = Math.PI / 2;
      curl.rotation.z = -Math.PI / 2;
      curl.position.set(0.72, 2.20, 0);      // out over the forward-leaning face
      curl.rotation.y = 0.22;                // pitched over
      grp.add(curl);

      // the WHITE CREST breaking along the top — lumpy, not a clean ring
      for (let i = 0; i < 9; i++) {
        const f = (i / 8) - 0.5;
        const foam = new THREE.Mesh(
          new THREE.SphereGeometry(0.34 + (i % 3) * 0.12, 8, 6),
          plastic(0xfff7ea)
        );
        foam.position.set(
          0.55 + Math.sin(i * 1.7) * 0.18,
          2.35 + Math.cos(i * 2.1) * 0.14,
          f * 5.0
        );
        foam.scale.set(1, 0.8, 1.2);
        grp.add(foam);
      }

      // SPRAY flying off the crest
      for (let i = 0; i < 10; i++) {
        const drop = new THREE.Mesh(
          new THREE.SphereGeometry(0.09, 6, 5),
          plastic(0xfff7ea, { transparent: true, opacity: 0.75 })
        );
        drop.position.set(
          0.9 + Math.random() * 0.8,
          2.6 + Math.random() * 1.1,
          (Math.random() - 0.5) * 5.2
        );
        grp.add(drop);
      }

      // the foam SKIRT washing along the sand at its base
      const skirt = new THREE.Mesh(
        new THREE.CylinderGeometry(3.2, 3.4, 0.16, 20, 1, true, 0, Math.PI),
        plastic(0xfff7ea, { transparent: true, opacity: 0.55, side: THREE.DoubleSide })
      );
      skirt.position.y = 0.08;
      grp.add(skirt);

      grp.userData.wave = wall;
    }
    else if (e.kind === "sandpile") {
      // ---- A COLLAPSED SANDCASTLE ----
      // Was a smooth cone with one wheel stuck in it. A kart that crumbles into
      // sand should look like a bucket-castle that a wave went through: a slumped
      // heap with the last turret still half-standing, a fallen bucket, a shovel
      // stuck in at an angle, and bits of the kart poking out.
      const R = e.r || 2.3;

      // the heap — several overlapping lumps, not one clean cone
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        const lump = new THREE.Mesh(
          new THREE.SphereGeometry(R * (0.42 + (i % 3) * 0.10), 10, 8),
          this._sandMat
        );
        lump.position.set(Math.cos(a) * R * 0.34, 0.30 + (i % 2) * 0.14, Math.sin(a) * R * 0.34);
        lump.scale.y = 0.62;
        lump.castShadow = lump.receiveShadow = true;
        grp.add(lump);
      }
      // the centre mound
      const mound = new THREE.Mesh(new THREE.SphereGeometry(R * 0.62, 12, 9), this._sandMat);
      mound.position.y = 0.42;
      mound.scale.y = 0.72;
      mound.castShadow = mound.receiveShadow = true;
      grp.add(mound);

      // the last TURRET, still standing out of the wreck — crenellations and all
      const turret = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.42, 0.62, 10), this._sandMat);
      turret.position.set(-R * 0.24, 0.92, R * 0.18);
      turret.rotation.z = 0.22;                 // leaning, about to go
      turret.castShadow = true;
      grp.add(turret);
      for (let c = 0; c < 5; c++) {
        const a = (c / 5) * Math.PI * 2;
        const merlon = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.12), this._sandMat);
        merlon.position.set(
          -R * 0.24 + Math.cos(a) * 0.28,
          1.24,
          R * 0.18 + Math.sin(a) * 0.28
        );
        grp.add(merlon);
      }

      // the BUCKET that made it, tipped over on its side
      const bucket = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.28, 0.55, 12, 1, true), plastic(0xe2574c, { side: THREE.DoubleSide }));
      bucket.position.set(R * 0.62, 0.30, -R * 0.34);
      bucket.rotation.set(1.4, 0.4, 0.3);
      bucket.castShadow = true;
      grp.add(bucket);

      // a SPADE stabbed into the heap
      const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.05, 6), plastic(0x2fa8d8));
      handle.position.set(R * 0.16, 0.95, R * 0.42);
      handle.rotation.z = -0.42;
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.32, 0.05), plastic(0x2fa8d8));
      blade.position.set(R * 0.16 + 0.22, 0.48, R * 0.42);
      blade.rotation.z = -0.42;
      grp.add(handle, blade);

      // and a wheel from the kart, half-buried — "this WAS a car"
      const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.30, 0.12, 8, 12), plastic(PALETTE.tire));
      wheel.position.set(-R * 0.52, 0.34, -R * 0.30);
      wheel.rotation.set(1.1, 0.3, 0.5);
      wheel.castShadow = true;
      grp.add(wheel);
    }
    return grp;
  }

  // ---------- per-player statuses ----------
  // carRecs: Map(playerId -> { mesh, info }) from Race3D
  syncStatuses(carRecs) {
    for (const [pid, rec] of carRecs) {
      const info = rec.info || {};
      let st = this.status.get(pid);
      if (!st) { st = {}; this.status.set(pid, st); }

      // bucket shield: an upside-down bucket riding above the driver
      if (info.shield && !st.bucket) {
        const b = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.75, 1.1, 14, 1, true), plastic(PALETTE.toyYellow, { side: THREE.DoubleSide, transparent: true, opacity: 0.92 }));
        b.rotation.z = Math.PI; b.position.y = 2.35;
        rec.mesh.add(b);
        st.bucket = b;
      } else if (!info.shield && st.bucket) { rec.mesh.remove(st.bucket); st.bucket = null; }

      // beach kite: diamond + string, dragging behind the victim
      if (info.kited && !st.kite) {
        const kite = new THREE.Group();
        const sail = new THREE.Mesh(diamondGeo(1.5, 2.0), plastic(PALETTE.toyPink, { side: THREE.DoubleSide }));
        const tail1 = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.18), plastic(PALETTE.toyYellow, { side: THREE.DoubleSide }));
        tail1.position.y = -1.3;
        const tail2 = tail1.clone(); tail2.position.y = -1.7; tail2.rotation.z = 0.6;
        kite.add(sail, tail1, tail2);
        kite.position.set(-2.6, 3.4, 0);
        kite.rotation.z = -0.5;
        const stringGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-0.9, 1.1, 0), new THREE.Vector3(-2.6, 3.4, 0)]);
        const string = new THREE.Line(stringGeo, new THREE.LineBasicMaterial({ color: 0x5a4632 }));
        rec.mesh.add(kite, string);
        st.kite = kite; st.kiteString = string;
      } else if (!info.kited && st.kite) {
        rec.mesh.remove(st.kite); rec.mesh.remove(st.kiteString);
        st.kite = null; st.kiteString = null;
      }

      // Soaked darkens the body; erosion lets the sand show through.
      //
      // This used to allocate THREE Color objects every frame, for every player:
      // a clone() plus two `new THREE.Color(...)`. Eight karts = 1,440 throwaway
      // objects a second, all of it garbage for the collector to chase. Scratch
      // colours are built once and reused.
      const body = rec.mesh.children[0];
      if (body?.material) {
        if (!st.baseColor) {
          st.baseColor = body.material.color.clone();
          st.target = new THREE.Color();
          st.soakCol = new THREE.Color(0x3a5f66);
          st.sandCol = new THREE.Color(PALETTE.sandDark);
        }
        st.target.copy(st.baseColor);
        if (info.soaked) st.target.lerp(st.soakCol, 0.45);
        const ero = Math.min(1, (info.erosion || 0) / 3);
        if (ero > 0.05) st.target.lerp(st.sandCol, ero * 0.65);
        body.material.color.lerp(st.target, 0.25);
      }

      // turbo streaks
      if (info.turbo && !st.streaks) {
        const s = new THREE.Group();
        for (let i = 0; i < 5; i++) {
          const line = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.05, 0.05), plastic(0xfff7ea, { transparent: true, opacity: 0.8 }));
          line.position.set(-1.6 - Math.random() * 0.6, 0.5 + Math.random() * 0.9, (Math.random() - 0.5) * 1.2);
          s.add(line);
        }
        rec.mesh.add(s);
        st.streaks = s;
      } else if (!info.turbo && st.streaks) { rec.mesh.remove(st.streaks); st.streaks = null; }

      // ---- TURBO FLAMES: streaks alone are too polite for a turbo. Real
      //      exhaust flames off the back, licking harder the faster you go.
      if (info.turbo && !st.flames) {
        const f = new THREE.Group();
        for (let i = 0; i < 5; i++) {
          const flame = new THREE.Mesh(
            new THREE.ConeGeometry(0.20 - i * 0.025, 0.55 + i * 0.18, 7),
            plastic([0xfff7ea, 0xf7c04a, 0xff9a4d, 0xff5a3c, 0xe2574c][i], { transparent: true, opacity: 0.85 - i * 0.1 })
          );
          flame.rotation.x = -Math.PI / 2;
          flame.position.set((i % 2 ? 0.22 : -0.22), 0.55, -1.3 - i * 0.22);
          f.add(flame);
        }
        rec.mesh.add(f);
        st.flames = f;
      } else if (!info.turbo && st.flames) { rec.mesh.remove(st.flames); st.flames = null; }
      if (st.flames) {
        const t = performance.now() / 1000;
        st.flames.children.forEach((c, i) => {
          c.scale.z = 0.8 + Math.sin(t * 22 + i * 1.3) * 0.35;
          c.material.opacity = (0.85 - i * 0.1) * (0.75 + Math.sin(t * 18 + i) * 0.25);
        });
      }

      // ---- SHIELD DOME: the bucket says "I have a shield", but a real energy
      //      dome says "you cannot touch me". Both, because the bucket is the joke.
      if (info.shield && !st.dome) {
        const d = new THREE.Mesh(
          new THREE.SphereGeometry(1.9, 16, 12),
          new THREE.MeshBasicMaterial({ color: 0x2fe6c8, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false })
        );
        d.position.y = 0.7;
        rec.mesh.add(d);
        // a hex-ish shimmer band around the equator
        const band = new THREE.Mesh(
          new THREE.TorusGeometry(1.9, 0.05, 8, 24),
          new THREE.MeshBasicMaterial({ color: 0xbfffef, transparent: true, opacity: 0.7, depthWrite: false })
        );
        band.rotation.x = Math.PI / 2;
        band.position.y = 0.7;
        rec.mesh.add(band);
        st.dome = d; st.domeBand = band;
      } else if (!info.shield && st.dome) {
        rec.mesh.remove(st.dome); rec.mesh.remove(st.domeBand);
        st.dome = null; st.domeBand = null;
      }
      if (st.dome) {
        const t = performance.now() / 1000;
        st.dome.material.opacity = 0.13 + Math.sin(t * 3) * 0.05;
        st.domeBand.rotation.z += 0.02;
        st.domeBand.position.y = 0.7 + Math.sin(t * 2) * 0.25;   // the band SWEEPS the dome
      }

      // ---- HYPERNOVA: the kart becomes a comet. This is the payoff for the
      //      rarest item in the game and it needs to look completely unfair.
      if (info.hypernova && !st.nova) {
        const g = new THREE.Group();
        const core = new THREE.Mesh(
          new THREE.SphereGeometry(2.3, 16, 12),
          new THREE.MeshBasicMaterial({ color: 0xb5f2ff, transparent: true, opacity: 0.22, side: THREE.BackSide, depthWrite: false })
        );
        core.position.y = 0.7;
        g.add(core);
        for (let i = 0; i < 3; i++) {
          const ring = new THREE.Mesh(
            new THREE.TorusGeometry(2.0 + i * 0.35, 0.06, 8, 26),
            new THREE.MeshBasicMaterial({ color: [0xb5f2ff, 0xff5fa2, 0xffb020][i], transparent: true, opacity: 0.75, depthWrite: false })
          );
          ring.position.y = 0.7;
          ring.rotation.x = Math.PI / 2 + i * 0.5;
          g.add(ring);
        }
        for (let i = 0; i < 12; i++) {
          const spark = new THREE.Mesh(
            new THREE.TetrahedronGeometry(0.13, 0),
            new THREE.MeshBasicMaterial({ color: [0xb5f2ff, 0xffb020, 0xff5fa2][i % 3], depthWrite: false })
          );
          g.add(spark);
        }
        rec.mesh.add(g);
        st.nova = g;
      } else if (!info.hypernova && st.nova) { rec.mesh.remove(st.nova); st.nova = null; }
      if (st.nova) {
        const t = performance.now() / 1000;
        st.nova.children.forEach((c, i) => {
          if (i === 0) {                                  // the glowing core
            const s = 1 + Math.sin(t * 5) * 0.08;
            c.scale.setScalar(s);
            c.material.opacity = 0.20 + Math.sin(t * 7) * 0.08;
          } else if (i <= 3) {                            // the rings
            c.rotation.z += 0.03 * i;
            c.rotation.y += 0.02;
          } else {                                        // orbiting sparks
            const k = i - 4;
            const a = t * 2.2 + (k / 12) * Math.PI * 2;
            const r = 2.2 + (k % 3) * 0.3;
            c.position.set(Math.cos(a) * r, 0.7 + Math.sin(t * 4 + k) * 0.8, Math.sin(a) * r);
            c.rotation.x += 0.2; c.rotation.y += 0.15;
          }
        });
      }

      // ---- BLINDED: sand caked all over the kart, so everyone can see you
      //      just took one in the face.
      if (info.blinded && !st.sandy) {
        const g = new THREE.Group();
        for (let i = 0; i < 10; i++) {
          const clod = new THREE.Mesh(
            new THREE.DodecahedronGeometry(0.13 + Math.random() * 0.08, 0),
            plastic(0xd4a763)
          );
          const a = Math.random() * Math.PI * 2;
          clod.position.set(Math.cos(a) * 0.6, 0.5 + Math.random() * 0.9, Math.sin(a) * 0.9 + 0.3);
          g.add(clod);
        }
        rec.mesh.add(g);
        st.sandy = g;
      } else if (!info.blinded && st.sandy) { rec.mesh.remove(st.sandy); st.sandy = null; }
    }
  }

  // ---------- moments ----------
  onEvents(events = [], carRecs) {
    for (const ev of events) {
      if (ev.type === "balloon_pop") this.burst(ev.x, ev.z, WATER, 14);
      else if (ev.type === "pile_dissolved") this.burst(ev.x, ev.z, 0xcfa25e, 12, WATER);
      else if (ev.type === "crumble") {
        const rec = carRecs?.get(ev.playerId);
        if (rec) this.burst(rec.mesh.position.x, rec.mesh.position.z, 0xcfa25e, 26);
      }
      else if (ev.type === "splash") {
        const rec = carRecs?.get(ev.playerId);
        if (rec) this.burst(rec.mesh.position.x, rec.mesh.position.z, WATER, 10);
      }
    }
  }

  // Takedown eruption: ~46 sand chunks in two tones + a fast expanding dust
  // ring + a persistent SAND PILE (mound + toppled wheel + little flag) that
  // stands where the kart died for `holdSec`. This is the moment both the
  // victim and the attacker are looking at — it has to read from 60m away.
  sandsplosion(x, z, y0 = 0, holdSec = 4.0) {
    this.burst(x, z, 0xcfa25e, 26, 0xe6c184, y0);
    this.burst(x, z, 0xb98a4f, 20, 0xfff1d6, y0);
    // dust ring
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.4, 1.0, 24),
      new THREE.MeshBasicMaterial({ color: 0xe6c184, transparent: true, opacity: 0.85, side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, 0.25 + y0, z);
    this.scene.add(ring);
    // the pile itself
    const pile = new THREE.Group();
    const mound = new THREE.Mesh(new THREE.ConeGeometry(1.5, 1.5, 9), plastic(0xd4a763));
    mound.position.y = 0.75;
    const mound2 = new THREE.Mesh(new THREE.ConeGeometry(0.9, 0.9, 8), plastic(0xc19052));
    mound2.position.set(0.8, 0.45, 0.4);
    const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.13, 8, 14), plastic(0x2c2620));
    wheel.position.set(-0.9, 0.34, -0.5);
    wheel.rotation.x = Math.PI / 2.3;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.4, 5), plastic(0xfff7ea));
    pole.position.set(0.1, 1.6, 0); pole.rotation.z = 0.35;
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.45), plastic(0xff6a5e, { side: THREE.DoubleSide }));
    flag.position.set(0.45, 2.05, 0); flag.rotation.z = 0.35;
    pile.add(mound, mound2, wheel, pole, flag);
    pile.position.set(x, y0, z);
    pile.scale.setScalar(0.01);
    this.scene.add(pile);
    this.bursts.push({ grp: ring, parts: [], t: 0, ttl: 0.7, kind: "dustring" });
    this.bursts.push({ grp: pile, parts: [], t: 0, ttl: holdSec, kind: "sandpileFx" });
    return pile;
  }

  // ============================================================
  // THE ANIME LAYER — impacts you can feel from the back of the room.
  //
  // The rules I'm working to:
  //   • SPEED LINES converge on the point of impact
  //   • a hard-edged SHOCK RING that snaps outward, not a soft puff
  //   • a bright FLASH on frame one, gone by frame three
  //   • and for the big stuff: a pillar, a column, a screen-filling wall
  // ============================================================

  // A hard shock ring: flat, bright, expands FAST and dies. The single most
  // useful anime tell — it says "something just happened HERE".
  shockRing(x, z, y0 = 0, color = 0xfff7ea, maxR = 8, life = 0.42) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.5, 0.85, 28),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthWrite: false })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, y0 + 0.3, z);
    this.scene.add(ring);
    this.bursts.push({ grp: ring, parts: [], t: 0, ttl: life, kind: "shockring", maxR });
    return ring;
  }

  // A vertical flash column — the "the sky just opened" beat.
  pillar(x, z, y0 = 0, color = 0xbfe6f7, h = 16, life = 0.55) {
    const col = new THREE.Mesh(
      new THREE.CylinderGeometry(1.1, 2.2, h, 12, 1, true),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.75, side: THREE.DoubleSide, depthWrite: false })
    );
    col.position.set(x, y0 + h / 2, z);
    this.scene.add(col);
    this.bursts.push({ grp: col, parts: [], t: 0, ttl: life, kind: "pillar" });
    return col;
  }

  // Radial SPEED LINES converging on a point. Pure anime punctuation.
  speedLines(x, z, y0 = 0, color = 0xfff7ea, n = 16, life = 0.35) {
    const g = new THREE.Group();
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const len = 3 + Math.random() * 5;
      const line = new THREE.Mesh(
        new THREE.BoxGeometry(0.10, 0.10, len),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false })
      );
      const r = 4 + Math.random() * 3;
      line.position.set(Math.cos(a) * r, 0.6 + Math.random() * 1.4, Math.sin(a) * r);
      line.rotation.y = -a + Math.PI / 2;
      g.add(line);
    }
    g.position.set(x, y0, z);
    this.scene.add(g);
    this.bursts.push({ grp: g, parts: [], t: 0, ttl: life, kind: "speedlines" });
    return g;
  }

  // One frame of white. Cheap, and it makes everything else land harder.
  flash(x, z, y0 = 0, color = 0xffffff, r = 3.5) {
    const f = new THREE.Mesh(
      new THREE.SphereGeometry(r, 10, 8),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false })
    );
    f.position.set(x, y0 + 1.0, z);
    this.scene.add(f);
    this.bursts.push({ grp: f, parts: [], t: 0, ttl: 0.16, kind: "flash" });
    return f;
  }

  // ---- the composed moves, by tier ----
  fxSplash(x, z, y0 = 0, big = false) {
    this.burst(x, z, 0x59b7e8, big ? 24 : 12, 0xbfe6f7, y0);
    this.shockRing(x, z, y0, 0xbfe6f7, big ? 7 : 4, 0.36);
    if (big) this.flash(x, z, y0, 0xdff3ff, 2.4);
  }
  fxHeavyBomb(x, z, y0 = 0, r = 5.5) {
    this.flash(x, z, y0, 0xffffff, r * 0.7);
    this.burst(x, z, 0x59b7e8, 40, 0xfff7ea, y0);
    this.shockRing(x, z, y0, 0xfff7ea, r * 1.6, 0.5);
    this.shockRing(x, z, y0, 0x59b7e8, r * 2.4, 0.7);
    this.speedLines(x, z, y0, 0xbfe6f7, 14, 0.4);
  }
  fxGeyser(x, z, y0 = 0) {
    this.pillar(x, z, y0, 0xbfe6f7, 18, 0.7);
    this.burst(x, z, 0x59b7e8, 34, 0xfff7ea, y0);
    this.shockRing(x, z, y0, 0xbfe6f7, 9, 0.5);
  }
  fxSandclod(x, z, y0 = 0) {
    this.burst(x, z, 0xd4a763, 30, 0xe6c184, y0);
    this.shockRing(x, z, y0, 0xd4a763, 5, 0.4);
  }
  fxTsunami(x, z, y0 = 0) {
    this.flash(x, z, y0, 0xdff3ff, 6);
    this.pillar(x, z, y0, 0x59b7e8, 22, 0.9);
    this.speedLines(x, z, y0, 0xbfe6f7, 22, 0.55);
    for (let i = 0; i < 3; i++) {
      setTimeout(() => this.shockRing(x, z, y0, i % 2 ? 0xfff7ea : 0x59b7e8, 14 + i * 6, 0.8), i * 90);
    }
    this.burst(x, z, 0x59b7e8, 54, 0xfff7ea, y0);
  }
  fxKraken(x, z, y0 = 0) {
    this.flash(x, z, y0, 0xff5fa2, 4);
    this.shockRing(x, z, y0, 0x8a4a5e, 12, 0.7);
    this.burst(x, z, 0x6e3d4e, 40, 0xff5fa2, y0);
    this.speedLines(x, z, y0, 0xff5fa2, 18, 0.5);
  }
  fxMeteor(x, z, y0 = 0, r = 6) {
    this.flash(x, z, y0, 0xffffff, r);
    this.pillar(x, z, y0, 0xffb020, 20, 0.6);
    this.burst(x, z, 0xff5a3c, 50, 0xffb020, y0);
    this.shockRing(x, z, y0, 0xffb020, r * 2, 0.6);
    this.shockRing(x, z, y0, 0xff5a3c, r * 3, 0.85);
    this.speedLines(x, z, y0, 0xffb020, 24, 0.5);
  }
  fxHypernova(x, z, y0 = 0) {
    this.flash(x, z, y0, 0xffffff, 7);
    for (let i = 0; i < 4; i++) {
      setTimeout(() => this.shockRing(x, z, y0, [0xb5f2ff, 0xff5fa2, 0xffb020, 0x2fe6c8][i], 10 + i * 7, 0.7), i * 70);
    }
    this.speedLines(x, z, y0, 0xb5f2ff, 26, 0.6);
    this.burst(x, z, 0xb5f2ff, 46, 0xffb020, y0);
    this.pillar(x, z, y0, 0xb5f2ff, 26, 0.9);
  }

  burst(x, z, color, n = 12, color2 = null, y0 = 0) {
    const grp = new THREE.Group();
    const mat = plastic(color, { transparent: true, opacity: 0.95 });
    const mat2 = color2 ? plastic(color2, { transparent: true, opacity: 0.95 }) : mat;
    const parts = [];
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(this._burstGeo, i % 3 === 0 ? mat2 : mat);
      const a = Math.random() * Math.PI * 2;
      const v = 3 + Math.random() * 5;
      parts.push({ m, vx: Math.cos(a) * v, vz: Math.sin(a) * v, vy: 3.5 + Math.random() * 4 });
      m.position.set(x, 0.6 + y0, z);
      grp.add(m);
    }
    this.scene.add(grp);
    this.bursts.push({ grp, parts, t: 0, mat });
  }

  animate(t, dt) {
    for (const rec of this.ent.values()) {
      const u = rec.grp.userData;
      if (u.wobble) {
        // a bag of liquid: it squashes on one axis as it stretches on the other
        u.wobble.scale.x = 1.02 + Math.sin(t * 14) * 0.09;
        u.wobble.scale.z = 1.02 - Math.sin(t * 14) * 0.09;
        u.wobble.scale.y = 0.92 + Math.cos(t * 14) * 0.05;
      }
      if (u.water) {
        // and the water SLOSHES inside it, half a beat behind the skin
        u.water.position.x = Math.sin(t * 14 - 0.6) * 0.05;
        u.water.position.z = Math.cos(t * 14 - 0.6) * 0.05;
        u.water.position.y = -0.10 + Math.sin(t * 9) * 0.03;
      }

      // THE SPRINKLER ARM SPINS. It's the only thing that makes a sprinkler read
      // as a sprinkler rather than a garden gnome.
      if (u.sprinklerArm) {
        u.sprinklerArm.rotation.y += dt * 5.5;
      }

      // The sprinkler's water: droplets flung outward and up, falling in an arc.
      // These were built and then never touched — they just hung in the air.
      if (u.drops) {
        const spin = u.sprinklerArm ? u.sprinklerArm.rotation.y : 0;
        u.drops.children.forEach((d, i) => {
          const k = d.userData.k ?? i;
          const phase = (t * 1.6 + k * 0.28) % 1;           // 0..1 along its flight
          const a = spin + (k % 2 ? 0 : Math.PI) + k * 0.14; // fired off the arm
          const reach = 0.5 + phase * 2.3;
          d.position.set(
            Math.cos(a) * reach,
            0.45 + Math.sin(phase * Math.PI) * 1.05,          // up, then down
            Math.sin(a) * reach
          );
          d.scale.setScalar(1 - phase * 0.45);
          if (d.material) d.material.opacity = 0.9 * (1 - phase * 0.7);
        });
      }

      // The water-pistol jet: droplets fly out along the barrel and break up.
      if (u.jet) {
        u.jet.children.forEach((d) => {
          const k = d.userData?.k;
          if (k == null) return;                              // the stream/core/mist
          const phase = ((t * 2.4 + k * 0.11) % 1);
          d.position.x = 1.0 + phase * 2.6;
          d.position.y = Math.sin(phase * 2.2) * 0.12 - phase * 0.22;   // droops
          d.position.z = Math.sin(k * 2.1 + t * 5) * (0.06 + phase * 0.18);
          if (d.material) d.material.opacity = 0.85 * (1 - phase * 0.55);
        });
      }
      if (u.jet) {
        u.jet.children.forEach((d) => {
          const k = d.userData.k;
          const f = ((t * 3 + k / 9) % 1);
          d.position.set(1.5 + f * 11, 0.9 + Math.sin(f * Math.PI) * 0.5, (Math.sin(k * 7) * 0.35) * f);
          d.scale.setScalar(1 - f * 0.5);
        });
      }
      if (u.drops) {
        u.drops.children.forEach((d) => {
          const k = d.userData.k;
          const f = ((t * 1.4 + k / 10) % 1);
          const a = k * 0.63;
          d.position.set(Math.cos(a) * f * 2.2, 0.3 + Math.sin(f * Math.PI) * 1.4, Math.sin(a) * f * 2.2);
        });
      }
      if (u.wave) { u.wave.rotation.y = Math.sin(t * 6) * 0.06; }
    }
    // bursts: simple ballistic fade
    for (const b of this.bursts.slice()) {
      b.t += dt;
      if (b.kind === "shockring") {
        const k = b.t / b.ttl;
        const s = 1 + k * (b.maxR || 8);
        b.grp.scale.set(s, s, s);
        b.grp.material.opacity = Math.max(0, 0.95 * (1 - k * k));   // snaps out, then vanishes
        if (b.t > b.ttl) { this.scene.remove(b.grp); this.bursts.splice(this.bursts.indexOf(b), 1); }
        continue;
      }
      if (b.kind === "pillar") {
        const k = b.t / b.ttl;
        b.grp.scale.set(1 + k * 0.8, 1 + k * 0.35, 1 + k * 0.8);
        b.grp.material.opacity = Math.max(0, 0.8 * (1 - k));
        if (b.t > b.ttl) { this.scene.remove(b.grp); this.bursts.splice(this.bursts.indexOf(b), 1); }
        continue;
      }
      if (b.kind === "speedlines") {
        const k = b.t / b.ttl;
        b.grp.scale.setScalar(1 - k * 0.75);          // they converge INWARD
        b.grp.children.forEach((c) => { c.material.opacity = Math.max(0, 0.9 * (1 - k)); });
        if (b.t > b.ttl) { this.scene.remove(b.grp); this.bursts.splice(this.bursts.indexOf(b), 1); }
        continue;
      }
      if (b.kind === "flash") {
        const k = b.t / b.ttl;
        b.grp.scale.setScalar(1 + k * 1.6);
        b.grp.material.opacity = Math.max(0, 0.9 * (1 - k * 1.6));
        if (b.t > b.ttl) { this.scene.remove(b.grp); this.bursts.splice(this.bursts.indexOf(b), 1); }
        continue;
      }
      if (b.kind === "dustring") {
        const s = 1 + b.t * 14;
        b.grp.scale.set(s, s, s);
        b.grp.material.opacity = Math.max(0, 0.85 - b.t * 1.3);
        if (b.t > b.ttl) { this.scene.remove(b.grp); this.bursts.splice(this.bursts.indexOf(b), 1); }
        continue;
      }
      if (b.kind === "sandpileFx") {
        // pop up fast, breathe, then sink away at the end of the death window
        const grow = Math.min(1, b.t * 5);
        const fade = Math.max(0, 1 - Math.max(0, b.t - (b.ttl - 0.5)) * 2);
        b.grp.scale.setScalar(Math.max(0.01, grow * fade));
        if (b.t > b.ttl) { this.scene.remove(b.grp); this.bursts.splice(this.bursts.indexOf(b), 1); }
        continue;
      }
      for (const p of b.parts) {
        p.vy -= 12 * dt;
        p.m.position.x += p.vx * dt;
        p.m.position.y = Math.max(0.08, p.m.position.y + p.vy * dt);
        p.m.position.z += p.vz * dt;
      }
      b.mat.opacity = Math.max(0, 0.95 - b.t * 1.4);
      if (b.t > 0.75) { this.scene.remove(b.grp); this.bursts.splice(this.bursts.indexOf(b), 1); }
    }
  }
}

function diamondGeo(w, h) {
  const g = new THREE.BufferGeometry();
  const v = new Float32Array([0, h / 2, 0, -w / 2, 0, 0, 0, -h / 2, 0, w / 2, 0, 0]);
  g.setAttribute("position", new THREE.BufferAttribute(v, 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  g.computeVertexNormals();
  return g;
}
