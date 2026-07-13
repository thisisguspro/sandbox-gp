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
      // a big beach ball, bouncing down the road ahead of you
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.9, 14, 12), plastic(0xfff7ea));
      ball.castShadow = true;
      grp.add(ball);
      const cols = [0xe2574c, 0x2fe6c8, 0xf7c04a, 0xff5fa2];
      for (let i = 0; i < 4; i++) {
        const seg = new THREE.Mesh(
          new THREE.SphereGeometry(0.905, 14, 12, (i / 4) * Math.PI * 2, Math.PI / 4),
          plastic(cols[i])
        );
        grp.add(seg);
      }
      return grp;
    }
    if (e.kind === "geyser") {
      // an armed mine: a ring of wet sand with a bubbling core you can just see
      const ring = new THREE.Mesh(new THREE.TorusGeometry(e.r || 2.4, 0.16, 8, 20), plastic(0x59b7e8, { transparent: true, opacity: 0.75 }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.12;
      const core = new THREE.Mesh(new THREE.SphereGeometry(0.4, 10, 8), plastic(0xbfe6f7, { transparent: true, opacity: 0.55 }));
      core.position.y = 0.25;
      grp.add(ring, core);
      return grp;
    }
    if (e.kind === "cloud") {
      // a rain cloud parked over the poor soul it's chasing
      const g = new THREE.Group();
      for (let i = 0; i < 5; i++) {
        const puff = new THREE.Mesh(new THREE.SphereGeometry(0.9 + Math.random() * 0.4, 10, 8), plastic(0x5a6b78, { transparent: true, opacity: 0.9 }));
        const a = (i / 5) * Math.PI * 2;
        puff.position.set(Math.cos(a) * 1.0, 3.4 + Math.sin(i) * 0.2, Math.sin(a) * 1.0);
        g.add(puff);
      }
      // the rain itself
      for (let i = 0; i < 14; i++) {
        const drop = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.5, 0.05), plastic(0x59b7e8, { transparent: true, opacity: 0.7 }));
        drop.position.set((Math.random() - 0.5) * 2.4, 1.2 + Math.random() * 2.0, (Math.random() - 0.5) * 2.4);
        g.add(drop);
      }
      grp.add(g);
      return grp;
    }
    if (e.kind === "homing") {
      // a meteor: a burning shell with a tail, screaming toward the leader
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.55, 0), plastic(0x6e3d4e));
      const fire = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.8, 8), plastic(0xffb020, { transparent: true, opacity: 0.85 }));
      fire.rotation.x = Math.PI / 2;
      fire.position.z = 1.1;
      const glow = new THREE.Mesh(new THREE.SphereGeometry(0.85, 10, 8), plastic(0xff5a3c, { transparent: true, opacity: 0.35 }));
      grp.add(rock, fire, glow);
      return grp;
    }
    if (e.kind === "balloon") {
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 10), plastic(PALETTE.toyRed));
      b.scale.y = 1.15; b.castShadow = true;
      const knot = new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 5), plastic(PALETTE.toyRed));
      knot.position.y = -0.45;
      grp.add(b, knot);
      grp.userData.wobble = b;
    }
    else if (e.kind === "squirt") {
      const jet = new THREE.Group();
      for (let i = 0; i < 9; i++) {
        const d = new THREE.Mesh(this._burstGeo, this._waterMat);
        d.userData.k = i;
        jet.add(d);
      }
      grp.add(jet);
      grp.userData.jet = jet;
    }
    else if (e.kind === "slickzone") {
      const wet = new THREE.Mesh(new THREE.CircleGeometry(e.r || 2.6, 20), plastic(PALETTE.sandDark));
      wet.rotation.x = -Math.PI / 2; wet.position.y = 0.045;
      const gloss = new THREE.Mesh(new THREE.CircleGeometry((e.r || 2.6) * 0.72, 20), plastic(WATER, { transparent: true, opacity: 0.45 }));
      gloss.rotation.x = -Math.PI / 2; gloss.position.y = 0.055;
      const head = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.5, 8), plastic(0xfff7ea));
      head.position.y = 0.25;
      const drops = new THREE.Group();
      for (let i = 0; i < 10; i++) { const d = new THREE.Mesh(this._burstGeo, this._waterMat); d.userData.k = i; drops.add(d); }
      grp.add(wet, gloss, head, drops);
      grp.userData.drops = drops;
    }
    else if (e.kind === "wave") {
      const wall = new THREE.Mesh(
        new THREE.CylinderGeometry(2.6, 3.0, 2.2, 18, 1, true, 0, Math.PI),
        plastic(WATER, { transparent: true, opacity: 0.85, side: THREE.DoubleSide })
      );
      wall.rotation.z = 0.28;                // crest tips INTO travel (local +X)
      wall.position.y = 1.1;
      const foam = new THREE.Mesh(new THREE.TorusGeometry(2.6, 0.28, 8, 18, Math.PI), plastic(0xfff7ea));
      // lay the half-ring flat and center its arc over the wall's +X half
      foam.rotation.x = Math.PI / 2;
      foam.rotation.z = -Math.PI / 2;
      foam.position.y = 2.15;
      foam.position.x = 0.32;                // ride the leaned crest
      grp.add(wall, foam);
      grp.userData.wave = wall;
    }
    else if (e.kind === "sandpile") {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(e.r || 2.3, 1.7, 12), this._sandMat);
      cone.position.y = 0.85; cone.castShadow = cone.receiveShadow = true;
      // a poking-out wheel sells "this WAS a car"
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.26, 12), plastic(PALETTE.tire));
      wheel.position.set(0.9, 1.1, 0.4); wheel.rotation.set(0.7, 0, 0.9);
      grp.add(cone, wheel);
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

      // soaked: darken the body briefly + droplets
      const body = rec.mesh.children[0];
      if (body?.material) {
        if (!st.baseColor) st.baseColor = body.material.color.clone();
        const target = st.baseColor.clone();
        if (info.soaked) target.lerp(new THREE.Color(0x3a5f66), 0.45);
        // erosion tint: the car IS sand — let it show through as armor erodes
        const ero = Math.min(1, (info.erosion || 0) / 3);
        if (ero > 0.05) target.lerp(new THREE.Color(PALETTE.sandDark), ero * 0.65);
        body.material.color.lerp(target, 0.25);
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
      if (u.wobble) { u.wobble.scale.x = 1 + Math.sin(t * 14) * 0.08; u.wobble.scale.z = 1 - Math.sin(t * 14) * 0.08; }
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
