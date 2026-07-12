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

  burst(x, z, color, n = 12, color2 = null) {
    const grp = new THREE.Group();
    const mat = plastic(color, { transparent: true, opacity: 0.95 });
    const mat2 = color2 ? plastic(color2, { transparent: true, opacity: 0.95 }) : mat;
    const parts = [];
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(this._burstGeo, i % 3 === 0 ? mat2 : mat);
      const a = Math.random() * Math.PI * 2;
      const v = 3 + Math.random() * 5;
      parts.push({ m, vx: Math.cos(a) * v, vz: Math.sin(a) * v, vy: 3.5 + Math.random() * 4 });
      m.position.set(x, 0.6, z);
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
