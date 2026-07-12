// ============================================================
// SANDBOX GP — 3D for the item/challenge layer.
//   • ItemBoxes3D  — beach presents that bob + spin; hidden while respawning
//   • Rings3D      — YOUR five gates; next one pulses gold, hits pop away
//   • Ribbon3D     — YOUR narrowed lane, drawn ahead of you as a golden strip
// Everything here renders exclusively from the server view (authority), and
// challenge visuals only ever exist for the local player — nobody else's
// gauntlet is in your world.
// ============================================================
import * as THREE from "three";
import { PALETTE, plastic } from "./palette.js";

const BOX_COLORS = [PALETTE.toyBlue, PALETTE.toyYellow, PALETTE.toyGreen, PALETTE.toyOrange, PALETTE.toyPink];

export class ItemBoxes3D {
  constructor(scene) {
    this.scene = scene;
    this.map = new Map(); // id -> { grp, base }
  }
  sync(boxes = []) {
    for (const b of boxes) {
      let rec = this.map.get(b.id);
      if (!rec) {
        const grp = new THREE.Group();
        const i = this.map.size;
        const body = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.5, 1.5), plastic(BOX_COLORS[i % BOX_COLORS.length]));
        body.castShadow = true;
        const ribbonA = new THREE.Mesh(new THREE.BoxGeometry(1.56, 1.56, 0.3), plastic(0xfff7ea));
        const ribbonB = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.56, 1.56), plastic(0xfff7ea));
        const knot = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), plastic(0xfff7ea));
        knot.position.y = 0.85;
        grp.add(body, ribbonA, ribbonB, knot);
        grp.position.set(b.x, 1.15, b.z);
        this.scene.add(grp);
        rec = { grp };
        this.map.set(b.id, rec);
      }
      rec.grp.visible = !!b.active;
    }
  }
  animate(t) {
    let k = 0;
    for (const { grp } of this.map.values()) {
      grp.rotation.y = t * 0.9 + k;
      grp.position.y = 1.15 + Math.sin(t * 2.2 + k * 1.7) * 0.16;
      k++;
    }
  }
}

export class Rings3D {
  constructor(scene, track) {
    this.scene = scene;
    this.track = track;
    this.group = null;
    this.gates = [];
  }
  sync(ch) {
    if (!ch || ch.type !== "rings") { this.clear(); return; }
    if (!this.group) {
      this.group = new THREE.Group();
      this.scene.add(this.group);
      this.gates = ch.gates.map((g, i) => {
        const yaw = this._yawAt(g.x, g.z);
        const grp = new THREE.Group();
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(g.r, 0.22, 10, 26),
          plastic(PALETTE.toyYellow, { emissive: 0x6b4e08 })
        );
        ring.castShadow = true;
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 1.2, 8), plastic(0xfff7ea));
        post.position.y = -g.r - 0.0;
        grp.add(ring, post);
        grp.position.set(g.x, g.r + 0.4, g.z);
        grp.rotation.y = yaw;
        this.group.add(grp);
        return grp;
      });
    }
    // state pass: hits pop, passed fade, next pulses
    ch.gates.forEach((g, i) => {
      const grp = this.gates[i];
      if (!grp) return;
      if (g.hit) {
        grp.scale.multiplyScalar(0.86);
        if (grp.scale.x < 0.1) grp.visible = false;
      } else if (i < ch.next) {
        grp.visible = false; // missed
      }
    });
    this._next = ch.next;
  }
  animate(t) {
    if (!this.group) return;
    const nxt = this.gates[this._next];
    if (nxt && nxt.visible) {
      const s = 1 + Math.sin(t * 6) * 0.07;
      nxt.scale.set(s, s, s);
    }
  }
  _yawAt(x, z) {
    const i = this.track.nearest(x, z, -1);
    const p = this.track.at(i);
    return -Math.atan2(p.tz, p.tx) + Math.PI / 2;
  }
  clear() {
    if (this.group) { this.scene.remove(this.group); this.group = null; this.gates = []; }
  }
}

export class Ribbon3D {
  constructor(scene, track) {
    this.scene = scene;
    this.track = track;
    this.mesh = null;
    this.SEGS = 40;      // strip resolution
    this.LOOK = 55;      // meters of lane drawn ahead
  }
  sync(ch, meState) {
    if (!ch || ch.type !== "ribbon") { this.clear(); return; }
    if (!this.mesh) {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array((this.SEGS + 1) * 2 * 3), 3));
      const idx = [];
      for (let i = 0; i < this.SEGS; i++) {
        const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
        idx.push(a, b, c, b, d, c);
      }
      g.setIndex(idx);
      this.mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
        color: PALETTE.toyYellow, transparent: true, opacity: 0.34, depthWrite: false,
      }));
      this.mesh.renderOrder = 2;
      this.scene.add(this.mesh);
    }
    // rebuild the strip from the player's position forward
    const pos = this.mesh.geometry.attributes.position.array;
    const t = this.track;
    let j = t.nearest(meState.x, meState.z, meState.sampleHint ?? -1);
    const step = this.LOOK / this.SEGS;
    let w = 0;
    for (let i = 0; i <= this.SEGS; i++) {
      const p = t.at(j);
      const nx = -p.tz, nz = p.tx;
      pos[w++] = p.x + nx * ch.halfWidth; pos[w++] = 0.06; pos[w++] = p.z + nz * ch.halfWidth;
      pos[w++] = p.x - nx * ch.halfWidth; pos[w++] = 0.06; pos[w++] = p.z - nz * ch.halfWidth;
      let left = step;
      while (left > 0) { const a = t.at(j), b = t.at(j + 1); left -= Math.hypot(b.x - a.x, b.z - a.z); j++; }
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
  }
  animate(t) {
    if (this.mesh) this.mesh.material.opacity = 0.3 + Math.sin(t * 4) * 0.06;
  }
  clear() {
    if (this.mesh) { this.scene.remove(this.mesh); this.mesh = null; }
  }
}
