// KART PREVIEW — the garage shows the thing you actually drive.
// Cosmetics are rendered by the SAME builder the race uses (carMesh.js), so
// what you see here is exactly what shows up on the grid: no second art
// pipeline to drift out of sync, and no 96MB of legacy sprite sheets.
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { buildCar, animateCar } from "../game/carMesh.js";

export default function KartPreview({ loadout = {}, idColor = "#e2574c", height = 260, spin = true }) {
  const hostRef = useRef(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const w = host.clientWidth || 320;
    const h = height;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const cam = new THREE.PerspectiveCamera(34, w / h, 0.1, 60);
    cam.position.set(3.0, 2.05, 3.9);
    cam.lookAt(0, 0.62, 0);
    scene.add(new THREE.AmbientLight(0xfff2dd, 0.8));
    const sun = new THREE.DirectionalLight(0xffe6c0, 1.15);
    sun.position.set(4, 7, 5);
    scene.add(sun);
    const rim = new THREE.DirectionalLight(0x8fd8ff, 0.35);
    rim.position.set(-5, 3, -4);
    scene.add(rim);

    // a little sand pad so the kart isn't floating in the void
    const pad = new THREE.Mesh(
      new THREE.CylinderGeometry(2.5, 2.5, 0.1, 32),
      new THREE.MeshLambertMaterial({ color: 0xf0d9a8 })
    );
    pad.position.y = -0.05;
    scene.add(pad);

    const turntable = new THREE.Group();
    scene.add(turntable);
    const kart = buildCar({ bodyColor: new THREE.Color(idColor).getHex(), loadout });
    kart.userData.baseY = 0;
    turntable.add(kart);

    let raf, t0 = performance.now();
    const loop = (t) => {
      const dt = Math.min(0.05, (t - t0) / 1000); t0 = t;
      if (spin) turntable.rotation.y += dt * 0.55;
      animateCar(kart, { speed: 0, steer: 0, offTrack: false }, dt);
      renderer.render(scene, cam);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      renderer.dispose();
      if (renderer.domElement.parentNode === host) host.removeChild(renderer.domElement);
    };
  }, [JSON.stringify(loadout), idColor, height, spin]);

  return <div ref={hostRef} style={{ width: "100%", height, display: "grid", placeItems: "center" }} />;
}
