// SANDBOX GP — the podium (goal #11): the top three, IN THEIR KARTS, on real
// steps, slowly rotating under warm light. Winners deserve a diorama, not a
// list. Pure presentation: karts are rebuilt from each racer's loadout +
// color, exactly as they appeared on track.
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { buildCar, animateCar } from "./carMesh.js";
import { PALETTE } from "./palette.js";

export default function Podium3D({ top3 = [], width = 460, height = 250 }) {
  const hostRef = useRef(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    // A FIXED, COMPOSED SHOT.
    //
    // The podium used to spin continuously, so half the time you were looking at
    // the back of three karts. It's framed once now — but a dead-on front view is
    // flat, so this is a slight three-quarter angle, a touch above eye level. The
    // karts get depth, the steps read as steps, and the winner is where your eye
    // lands first.
    const cam = new THREE.PerspectiveCamera(36, width / height, 0.1, 100);
    cam.position.set(2.6, 3.4, 7.6);
    cam.lookAt(0, 1.15, 0);
    scene.add(new THREE.AmbientLight(0xfff2dd, 0.75));
    const sun = new THREE.DirectionalLight(0xffe0b0, 1.15);
    sun.position.set(4, 7, 5);
    scene.add(sun);

    const world = new THREE.Group();
    scene.add(world);

    // steps: 2nd · 1st · 3rd
    const stepDefs = [
      { place: 2, x: -2.15, h: 1.05, color: 0xd9d2c4 },
      { place: 1, x: 0,     h: 1.6,  color: 0xf7c04a },
      { place: 3, x: 2.15,  h: 0.75, color: 0xcd8a55 },
    ];
    const mat = (c) => new THREE.MeshLambertMaterial({ color: c });
    for (const s of stepDefs) {
      const block = new THREE.Mesh(new THREE.BoxGeometry(1.9, s.h, 1.9), mat(s.color));
      block.position.set(s.x, s.h / 2, 0);
      world.add(block);
      const face = new THREE.Mesh(new THREE.BoxGeometry(1.9, s.h, 0.02), mat(0x0b3140));
      face.position.set(s.x, s.h / 2, 0.96);
      world.add(face);
    }
    // ground disc
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(4.6, 4.6, 0.12, 36), mat(0xf0d9a8));
    disc.position.y = -0.06;
    world.add(disc);

    const karts = [];
    for (const s of stepDefs) {
      const racer = top3.find((p) => p.place === s.place);
      if (!racer) continue;
      const kart = buildCar({
        bodyColor: new THREE.Color(racer.idColor || "#e2574c").getHex(),
        loadout: racer.loadout || {},
      });
      kart.position.set(s.x, s.h, 0);
      kart.scale.setScalar(0.86);
      // ---- FACE THE CAMERA ----
      //
      // The camera sits out at +Z looking back at the origin. A kart's FORWARD is
      // +X (that's what heading=0 means to the engine, and the chassis is rotated
      // at build time to match). So a kart at rotation.y = 0 presents its LEFT
      // FLANK to the camera — and rotation.y = 0.06 barely changed that. Gustavo
      // looked at the results screen and saw the back of the podium, because he
      // was looking at three karts side-on with their tails toward him.
      //
      // Turn each kart so its +X nose points at the camera's +Z, then a few degrees
      // off dead-on so it reads as a three-quarter hero shot rather than a mugshot.
      kart.rotation.y = -Math.PI / 2 + 0.22;
      kart.userData.baseY = s.h;
      world.add(kart);
      karts.push(kart);
    }

    // THE PODIUM DOES NOT SPIN.
    //
    // It used to rotate the whole scene continuously (`world.rotation.y += dt *
    // 0.28`), which meant you spent the results screen watching the winners slide
    // past instead of LOOKING at them — and for half of every revolution you were
    // staring at the back of three karts. A podium is a photograph, not a turntable.
    // It's framed once, and it stays framed.
    let raf, t0 = performance.now();
    const loop = (t) => {
      const dt = Math.min(0.05, (t - t0) / 1000); t0 = t;
      // the karts still breathe (idle bob, wheels settling) — just no orbit
      for (const k of karts) animateCar(k, { speed: 0, steer: 0, offTrack: false }, dt);
      renderer.render(scene, cam);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      renderer.dispose();
      host.removeChild(renderer.domElement);
    };
  }, [JSON.stringify(top3.map((p) => [p.place, p.idColor, p.loadout]))]);

  return <div ref={hostRef} style={{ width, height, margin: "0 auto" }} />;
}
