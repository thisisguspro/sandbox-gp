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
  constructor(scene, track = null) {
    this.scene = scene;
    this.track = track;                 // for road altitude under each box
    this.map = new Map(); // id -> { grp, base }
  }
  sync(boxes = []) {
    const track = this.track;
    for (const b of boxes) {
      let rec = this.map.get(b.id);
      if (!rec) {
        const grp = new THREE.Group();
        const i = this.map.size;
        // COLOUR = MINIGAME. The box you aim for is the game you'll play, so the
        // colour has to mean something: teal hoops, gold lane, coral key-drill.
        // (It used to be an arbitrary rotation, which told the player nothing.)
        const KIND_COLOR = { rings: 0x2fe6c8, ribbon: 0xf7c04a, keys: 0xff5a3c };
        // ---- A SANDCASTLE BUCKET, NOT A GIFT-WRAPPED CUBE ----
        //
        // These were a cube with two ribbons on it — a Christmas present, sitting on
        // a beach. It said nothing about the game and it looked like placeholder art.
        //
        // A bucket is a REAL TOY, it is unmistakably a beach object, and the shape
        // reads instantly at speed: tapered pail, rolled rim, a handle, and a
        // sandcastle turret packed on top. The colour still encodes the minigame
        // you'll get.
        const col = KIND_COLOR[b.kind] || BOX_COLORS[i % BOX_COLORS.length];

        // the pail: wider at the rim, narrower at the base, like every beach bucket
        const pail = new THREE.Mesh(new THREE.CylinderGeometry(0.78, 0.56, 1.15, 14), plastic(col));
        pail.castShadow = true;
        grp.add(pail);

        // the rolled rim — the single detail that makes it read as a BUCKET
        const rim = new THREE.Mesh(new THREE.TorusGeometry(0.78, 0.09, 8, 18), plastic(col));
        rim.rotation.x = Math.PI / 2;
        rim.position.y = 0.57;
        grp.add(rim);

        // a white stripe round the belly, the way cheap plastic buckets are moulded
        const stripe = new THREE.Mesh(new THREE.CylinderGeometry(0.70, 0.66, 0.18, 14), plastic(0xfff7ea));
        stripe.position.y = -0.10;
        grp.add(stripe);

        // the HANDLE: a wire hoop over the top
        const handle = new THREE.Mesh(
          new THREE.TorusGeometry(0.72, 0.045, 6, 16, Math.PI),
          plastic(0xe8e0d0)
        );
        handle.position.y = 0.57;
        handle.rotation.y = Math.PI / 2;
        grp.add(handle);

        // the SANDCASTLE turret packed on top — crenellations and all
        const turret = new THREE.Mesh(new THREE.CylinderGeometry(0.48, 0.56, 0.42, 12), plastic(0xe8c98c));
        turret.position.y = 0.82;
        turret.castShadow = true;
        grp.add(turret);
        for (let c = 0; c < 6; c++) {
          const a = (c / 6) * Math.PI * 2;
          const merlon = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.16), plastic(0xe8c98c));
          merlon.position.set(Math.cos(a) * 0.40, 1.06, Math.sin(a) * 0.40);
          merlon.rotation.y = -a;
          grp.add(merlon);
        }
        // a little flag on top, so it catches your eye from a long way out
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.34, 5), plastic(0x8a5f33));
        pole.position.y = 1.28;
        const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.16), plastic(col, { side: THREE.DoubleSide }));
        flag.position.set(0.13, 1.38, 0);
        grp.add(pole, flag);
        // Arena boxes carry no track `kind` and live on a flat bowl (y=0). Only
        // consult the track for altitude on real track boxes, or an arena box near
        // the origin could inherit some faraway sample's height and float.
        const arenaBox = !b.kind || String(b.id).startsWith("abox");
        const bi = (!arenaBox && track?.nearest) ? track.nearest(b.x, b.z, -1, 0) : -1;
        const by = bi >= 0 ? (track.at(bi).y || 0) : 0;
        grp.position.set(b.x, 1.15 + by, b.z);
        this.scene.add(grp);
        rec = { grp, baseY: 1.15 + by };
        this.map.set(b.id, rec);
      }
      rec.grp.visible = !!b.active;
    }
  }
  animate(t) {
    let k = 0;
    for (const { grp, baseY } of this.map.values()) {
      grp.rotation.y = t * 0.9 + k;
      grp.position.y = (baseY ?? 1.15) + Math.sin(t * 2.2 + k * 1.7) * 0.16;
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
    const track = this.track;
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
        // The server sends the gate's ALTITUDE now. This used to re-derive it with
        // `track.nearest(x, z, -1, 0)` — a search pinned to ground level — so a
        // hoop up on the bridge resolved against a ground-level sample and spawned
        // underneath the road. Trust the server; it made the gate, it knows.
        const gy = g.y ?? (track?.nearest ? (track.at(track.nearest(g.x, g.z, -1, 0)).y || 0) : 0);
        grp.position.set(g.x, g.r + 0.4 + gy, g.z);
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

      // BOUNDARY LINES: the lane needs edges you can actually aim at. A translucent
      // fill alone gives you nothing to steer against — you can't see where "out"
      // begins until you're already out.
      const lineGeo = () => {
        const lg = new THREE.BufferGeometry();
        lg.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array((this.SEGS + 1) * 3), 3));
        return lg;
      };
      const lineMat = () => new THREE.LineBasicMaterial({ color: 0xfff1d6, transparent: true, opacity: 0.95 });
      this.edgeL = new THREE.Line(lineGeo(), lineMat());
      this.edgeR = new THREE.Line(lineGeo(), lineMat());
      this.edgeL.renderOrder = 3; this.edgeR.renderOrder = 3;
      this.scene.add(this.edgeL, this.edgeR);
    }
    // in the lane = gold and calm; drifting out = the whole lane flashes red
    const inLane = ch.inLane !== false;
    this.mesh.material.color.setHex(inLane ? PALETTE.toyYellow : 0xe2574c);
    this.mesh.material.opacity = inLane ? 0.34 : 0.5;
    if (this.edgeL) {
      this.edgeL.material.color.setHex(inLane ? 0xfff1d6 : 0xffd9d4);
      this.edgeR.material.color.setHex(inLane ? 0xfff1d6 : 0xffd9d4);
    }
    // rebuild the strip from the player's position forward
    const pos = this.mesh.geometry.attributes.position.array;
    const t = this.track;
    let j = t.nearest(meState.x, meState.z, meState.sampleHint ?? -1);
    const step = this.LOOK / this.SEGS;
    let w = 0;
    const lp = this.edgeL.geometry.attributes.position.array;
    const rp = this.edgeR.geometry.attributes.position.array;
    let lw = 0, rw = 0;
    for (let i = 0; i <= this.SEGS; i++) {
      const p = t.at(j);
      const nx = -p.tz, nz = p.tx;
      const y = (p.y || 0) + 0.06;          // ride the road: the bridge has altitude
      const lx = p.x + nx * ch.halfWidth, lz = p.z + nz * ch.halfWidth;
      const rx = p.x - nx * ch.halfWidth, rz = p.z - nz * ch.halfWidth;
      pos[w++] = lx; pos[w++] = y; pos[w++] = lz;
      pos[w++] = rx; pos[w++] = y; pos[w++] = rz;
      lp[lw++] = lx; lp[lw++] = y + 0.02; lp[lw++] = lz;
      rp[rw++] = rx; rp[rw++] = y + 0.02; rp[rw++] = rz;
      let left = step;
      while (left > 0) { const a = t.at(j), b = t.at(j + 1); left -= Math.hypot(b.x - a.x, b.z - a.z); j++; }
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
    this.edgeL.geometry.attributes.position.needsUpdate = true;
    this.edgeR.geometry.attributes.position.needsUpdate = true;
  }
  animate(t) {
    if (this.mesh) this.mesh.material.opacity = (this.mesh.material.color.getHex() === 0xe2574c ? 0.46 : 0.30) + Math.sin(t * 4) * 0.06;
  }
  clear() {
    if (this.mesh) { this.scene.remove(this.mesh); this.mesh = null; }
    if (this.edgeL) { this.scene.remove(this.edgeL); this.edgeL = null; }
    if (this.edgeR) { this.scene.remove(this.edgeR); this.edgeR = null; }
  }
}
