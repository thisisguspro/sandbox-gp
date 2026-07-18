// ============================================================================
// SANDBOX GP — ARENA RENDERING
//
// The track world is a ribbon: curbs, rails, a sandcastle. An arena is a bowl:
// a rim, walls you hide behind, hazards you avoid. Different geometry, different
// builder — but the SAME palette system, so a derby pit still reads as the same
// beach as the Sandcastle Grand Circuit.
//
// Also renders whatever the current mode puts in the world: flags, pearls, the
// closing ring, the wreckers, and the drawing on the sand.
// ============================================================================
import * as THREE from "three";
import { paletteFor, plastic, makeSandTexture, makeSkyTexture } from "./palette.js";

export function buildArena(scene, arena) {
  const P = paletteFor(arena.theme || "beach");

  scene.background = makeSkyTexture(P);
  scene.fog = new THREE.Fog(P.skyBottom, 120, 420);

  // Same dusk lighting rig as the circuits, so Derby/CTF/Tag don't look like a
  // different (older, brighter) game: violet fill, warm key, cyan rim.
  scene.add(new THREE.HemisphereLight(P.ambient, P.sandLight, 0.35));
  const sun = new THREE.DirectionalLight(0xffe4bc, 2.7);
  sun.position.set(60, 90, 30);
  sun.castShadow = true;
  scene.add(sun);
  const rim = new THREE.DirectionalLight(0xaac6e8, 0.35);
  rim.position.set(-60, 42, -80);
  scene.add(rim);

  // ---- the floor ----
  const isWater = arena.theme === "pier";
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(arena.radius, 64),
    isWater
      ? new THREE.MeshLambertMaterial({ color: P.sandLight })
      : new THREE.MeshLambertMaterial({ map: makeSandTexture() })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  // beyond the rim — the void you can't reach
  const beyond = new THREE.Mesh(
    new THREE.RingGeometry(arena.radius, arena.radius + 300, 64),
    new THREE.MeshLambertMaterial({ color: isWater ? P.water : P.sandDark })
  );
  beyond.rotation.x = -Math.PI / 2;
  beyond.position.y = isWater ? -0.5 : -0.15;
  scene.add(beyond);

  // ---- the rim wall ----
  // A bumper ring, so the arena reads as ENCLOSED. You can see the edge of the
  // world from anywhere in it, which is the point of an arena.
  const rimSegs = 48;
  for (let i = 0; i < rimSegs; i++) {
    const a = (i / rimSegs) * Math.PI * 2;
    const seg = new THREE.Mesh(
      new THREE.CylinderGeometry(1.1, 1.1, (arena.radius * 2 * Math.PI) / rimSegs + 0.6, 8),
      plastic(i % 2 ? P.curbRed : P.curbWhite)
    );
    seg.position.set(Math.cos(a) * arena.radius, 1.0, Math.sin(a) * arena.radius);
    seg.rotation.z = Math.PI / 2;
    // TANGENT, not radial. rotation.z = π/2 lays the cylinder along world X;
    // rotation.y then spins it about the vertical. `-a` alone pointed every
    // segment straight OUT from the centre like spokes (the "borders facing the
    // wrong way"). The rim runs ALONG the circle, so the axis must follow the
    // tangent (-sin a, cos a) — that's -a + π/2.
    seg.rotation.y = -a + Math.PI / 2;
    seg.castShadow = true;
    scene.add(seg);
  }

  // ---- the walls ----
  for (const w of arena.walls) {
    scene.add(buildWall(w, P, arena.theme));
  }

  // ---- the hazards ----
  for (const h of arena.hazards || []) {
    scene.add(buildHazard(h, P));
  }

  // ---- mode furniture that's part of the arena itself ----
  if (arena.canvas) {
    // the drawable disc: a lighter, raked circle of sand
    const c = new THREE.Mesh(
      new THREE.CircleGeometry(arena.canvas.r, 48),
      new THREE.MeshLambertMaterial({ color: 0xfff3dc })
    );
    c.rotation.x = -Math.PI / 2;
    c.position.set(arena.canvas.x, 0.03, arena.canvas.z);
    scene.add(c);
    // a rope border, so the drawer can see exactly where the canvas ends
    const rope = new THREE.Mesh(
      new THREE.TorusGeometry(arena.canvas.r, 0.16, 8, 48),
      plastic(0xd9a566)
    );
    rope.rotation.x = -Math.PI / 2;
    rope.position.set(arena.canvas.x, 0.16, arena.canvas.z);
    scene.add(rope);
  }
  if (arena.bases) {
    arena.bases.forEach((b, t) => {
      const pad = new THREE.Mesh(
        new THREE.CylinderGeometry(6, 6, 0.3, 24),
        plastic(t === 0 ? 0x2fe6c8 : 0xff5a3c, { transparent: true, opacity: 0.6 })
      );
      pad.position.set(b.x, 0.15, b.z);
      scene.add(pad);
    });
  }
}

function buildWall(w, P, theme) {
  const g = new THREE.Group();
  const col = {
    pillar: P.stone || 0xd4b483,
    stone: P.stone || 0xd4b483,
    wreck: 0x8a5f33,
    bumper: P.curbRed,
    sandbar: P.sandLight,
  }[w.kind] || (P.stone || 0xd4b483);

  const body = new THREE.Mesh(new THREE.BoxGeometry(w.w, w.h, w.d), plastic(col));
  body.position.y = w.h / 2;
  body.castShadow = true;
  body.receiveShadow = true;
  g.add(body);

  if (w.kind === "pillar") {
    // a capital, so an Egyptian pillar reads as a pillar and not a crate
    const cap = new THREE.Mesh(new THREE.BoxGeometry(w.w * 1.3, 0.8, w.d * 1.3), plastic(P.accent || 0xf0c04a));
    cap.position.y = w.h + 0.4;
    g.add(cap);
    const base = new THREE.Mesh(new THREE.BoxGeometry(w.w * 1.25, 0.6, w.d * 1.25), plastic(P.stoneDark || 0xa8834f));
    base.position.y = 0.3;
    g.add(base);
  }
  if (w.kind === "wreck") {
    // a heap of broken karts — the derby's centrepiece
    for (let i = 0; i < 7; i++) {
      const chunk = new THREE.Mesh(
        new THREE.BoxGeometry(2 + Math.random() * 3, 1 + Math.random() * 2, 2 + Math.random() * 2),
        plastic([0xe2574c, 0x2fe6c8, 0xf7c04a, 0x9aa3ad][i % 4])
      );
      chunk.position.set((Math.random() - 0.5) * w.w, w.h + Math.random() * 1.6, (Math.random() - 0.5) * w.d);
      chunk.rotation.set(Math.random() * 2, Math.random() * 2, Math.random() * 2);
      g.add(chunk);
    }
  }
  if (w.kind === "bumper") {
    // candy stripes, same language as the track rails
    const stripes = Math.max(2, Math.round(Math.max(w.w, w.d) / 2));
    for (let i = 0; i < stripes; i++) {
      if (i % 2) continue;
      const s = new THREE.Mesh(
        new THREE.BoxGeometry(w.w > w.d ? w.w / stripes : w.w * 1.02, w.h * 1.02, w.w > w.d ? w.d * 1.02 : w.d / stripes),
        plastic(0xfff7ea)
      );
      s.position.set(
        w.w > w.d ? -w.w / 2 + (i + 0.5) * (w.w / stripes) : 0,
        w.h / 2,
        w.w > w.d ? 0 : -w.d / 2 + (i + 0.5) * (w.d / stripes)
      );
      g.add(s);
    }
  }

  g.position.set(w.x, 0, w.z);
  return g;
}

function buildHazard(h, P) {
  const g = new THREE.Group();
  if (h.kind === "tar") {
    const pit = new THREE.Mesh(
      new THREE.CircleGeometry(h.r, 28),
      new THREE.MeshLambertMaterial({ color: 0x3a2f24 })
    );
    pit.rotation.x = -Math.PI / 2;
    pit.position.y = 0.04;
    g.add(pit);
    // bubbles, so it's obviously a hazard and not a shadow
    for (let i = 0; i < 6; i++) {
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.3 + Math.random() * 0.3, 8, 6), plastic(0x1c1712));
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * h.r * 0.7;
      b.position.set(Math.cos(a) * r, 0.2, Math.sin(a) * r);
      g.add(b);
    }
  }
  if (h.kind === "sink") {
    const hole = new THREE.Mesh(
      new THREE.CircleGeometry(h.r, 24),
      new THREE.MeshLambertMaterial({ color: 0x6b4a28 })
    );
    hole.rotation.x = -Math.PI / 2;
    hole.position.y = 0.03;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(h.r, 0.4, 8, 24), plastic(0xc19052));
    rim.rotation.x = -Math.PI / 2;
    rim.position.y = 0.2;
    g.add(hole, rim);
  }
  if (h.kind === "deep") {
    const water = new THREE.Mesh(
      new THREE.CircleGeometry(h.r, 32),
      new THREE.MeshLambertMaterial({ color: P.water || 0xe86a9a, transparent: true, opacity: 0.9 })
    );
    water.rotation.x = -Math.PI / 2;
    water.position.y = 0.05;
    g.add(water);
  }
  g.position.set(h.x, 0, h.z);
  return g;
}

// ============================================================================
// MODE WORLD — the things a mode puts in the arena, updated every frame.
// ============================================================================
export class ModeWorld3D {
  constructor(scene) {
    this.scene = scene;
    this.flags = new Map();
    this.pearls = new Map();
    this.wreckers = new Map();
    this.ring = null;
    this.strokes = [];
    this.props = [];
    this.strokeGeo = new THREE.SphereGeometry(0.45, 6, 5);
    this.strokeMat = new THREE.MeshLambertMaterial({ color: 0x3a7f9a });
  }

  sync(mw, modeId) {
    if (!mw) return;

    // ---- CTF: the flags ----
    if (mw.flags) {
      for (const f of mw.flags) {
        let rec = this.flags.get(f.team);
        if (!rec) {
          const g = new THREE.Group();
          const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 4, 6), plastic(0xfff7ea));
          pole.position.y = 2;
          const cloth = new THREE.Mesh(
            new THREE.PlaneGeometry(2.2, 1.4),
            plastic(f.team === 0 ? 0x2fe6c8 : 0xff5a3c, { side: THREE.DoubleSide })
          );
          cloth.position.set(1.1, 3.2, 0);
          g.add(pole, cloth);
          this.scene.add(g);
          rec = { grp: g, cloth };
          this.flags.set(f.team, rec);
        }
        rec.grp.position.set(f.x, 0, f.z);
        // a carried flag flies; a dropped one droops
        rec.cloth.rotation.y = f.carrier ? Math.sin(performance.now() / 120) * 0.5 : 0;
        rec.grp.rotation.y = f.carrier ? performance.now() / 400 : 0;
      }
    }

    // ---- PEARL RUSH: the field ----
    if (mw.pearls) {
      const seen = new Set();
      for (const p of mw.pearls) {
        seen.add(p.id);
        let m = this.pearls.get(p.id);
        if (!m) {
          m = new THREE.Mesh(
            new THREE.SphereGeometry(0.55, 10, 8),
            new THREE.MeshLambertMaterial({ color: 0xfff1f5, emissive: 0x553344 })
          );
          this.scene.add(m);
          this.pearls.set(p.id, m);
        }
        m.position.set(p.x, 0.9 + Math.sin(performance.now() / 400 + p.x) * 0.15, p.z);
        m.rotation.y += 0.02;
      }
      for (const [id, m] of this.pearls) {
        if (!seen.has(id)) { this.scene.remove(m); this.pearls.delete(id); }
      }
    }

    // ---- DERBY: the wreckers and the closing ring ----
    if (mw.wreckers) {
      for (const w of mw.wreckers) {
        let m = this.wreckers.get(w.id);
        if (!m) {
          const g = new THREE.Group();
          const body = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.4, 3.6), plastic(0x1c1712));
          body.position.y = 0.9;
          const blade = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.9, 0.5), plastic(0x9aa3ad));
          blade.position.set(0, 0.7, 2.0);
          const spike = new THREE.Mesh(new THREE.ConeGeometry(0.4, 1.2, 6), plastic(0xe2574c));
          spike.position.set(0, 1.9, 0);
          g.add(body, blade, spike);
          this.scene.add(g);
          m = g;
          this.wreckers.set(w.id, m);
        }
        m.position.set(w.x, 0, w.z);
        m.rotation.y = -w.heading + Math.PI / 2;
      }
    }
    if (mw.ring != null) {
      if (!this.ring) {
        this.ring = new THREE.Mesh(
          new THREE.TorusGeometry(1, 0.5, 8, 48),
          new THREE.MeshBasicMaterial({ color: 0xe2574c, transparent: true, opacity: 0.55 })
        );
        this.ring.rotation.x = -Math.PI / 2;
        this.scene.add(this.ring);
      }
      this.ring.scale.setScalar(mw.ring);
      this.ring.position.y = 1.2 + Math.sin(performance.now() / 300) * 0.3;
    }

    // ---- SAND ARTIST: the drawing ----
    // Water poured on sand. Each dab is a dark wet blob; they don't fade,
    // because a drawing that evaporates while you're drawing it is a cruel joke.
    if (mw.strokes) {
      while (this.strokes.length < mw.strokes.length) {
        const m = new THREE.Mesh(this.strokeGeo, this.strokeMat);
        m.scale.y = 0.2;
        this.scene.add(m);
        this.strokes.push(m);
      }
      while (this.strokes.length > mw.strokes.length) {
        const m = this.strokes.pop();
        this.scene.remove(m);
      }
      mw.strokes.forEach((s, i) => {
        this.strokes[i].position.set(s.x, 0.08, s.z);
      });
    }
    if (mw.props) {
      while (this.props.length < mw.props.length) {
        const i = this.props.length;
        const p = mw.props[i];
        const m = buildProp(p.kind);
        this.scene.add(m);
        this.props.push(m);
      }
      while (this.props.length > mw.props.length) {
        this.scene.remove(this.props.pop());
      }
      mw.props.forEach((p, i) => {
        this.props[i].position.set(p.x, 0.4, p.z);
        this.props[i].rotation.y += 0.005;
      });
    }
  }
}

// the five stampable props the artist gets on 1..5
function buildProp(kind) {
  const g = new THREE.Group();
  if (kind === 1) {   // shell
    const s = new THREE.Mesh(new THREE.SphereGeometry(0.7, 10, 8, 0, Math.PI), plastic(0xffc98a));
    s.rotation.x = -Math.PI / 2;
    g.add(s);
  } else if (kind === 2) {   // starfish
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const arm = new THREE.Mesh(new THREE.ConeGeometry(0.28, 1.1, 5), plastic(0xff9a4d));
      arm.position.set(Math.cos(a) * 0.5, 0.1, Math.sin(a) * 0.5);
      arm.rotation.z = Math.PI / 2;
      arm.rotation.y = -a;
      g.add(arm);
    }
  } else if (kind === 3) {   // pebble
    const p = new THREE.Mesh(new THREE.DodecahedronGeometry(0.6, 0), plastic(0x9aa3ad));
    g.add(p);
  } else if (kind === 4) {   // coral
    for (let i = 0; i < 4; i++) {
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.16, 1.0 + Math.random(), 6), plastic(0xff5fa2));
      b.position.set((Math.random() - 0.5) * 0.6, 0.5, (Math.random() - 0.5) * 0.6);
      b.rotation.z = (Math.random() - 0.5) * 0.6;
      g.add(b);
    }
  } else {   // seaweed
    for (let i = 0; i < 3; i++) {
      const w = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.6, 0.06), plastic(0x2a9d8f));
      w.position.set((Math.random() - 0.5) * 0.5, 0.8, (Math.random() - 0.5) * 0.5);
      w.rotation.z = (Math.random() - 0.5) * 0.5;
      g.add(w);
    }
  }
  return g;
}
