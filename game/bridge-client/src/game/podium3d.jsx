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
    const cam = new THREE.PerspectiveCamera(38, width / height, 0.1, 100);
    cam.position.set(0, 3.1, 7.4);
    cam.lookAt(0, 1.0, 0);
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
      kart.rotation.y = Math.PI * 0.12;
      kart.userData.baseY = s.h;
      world.add(kart);
      karts.push(kart);
    }

    let raf, t0 = performance.now();
    const loop = (t) => {
      const dt = Math.min(0.05, (t - t0) / 1000); t0 = t;
      world.rotation.y += dt * 0.28;
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
