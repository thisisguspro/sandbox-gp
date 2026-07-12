// ============================================================
// SANDBOX GP — the kid car + chibi driver.
// The brief: ride-on toy car, no roof, driver comically big for it — big anime
// head, tiny body, hands reaching DOWN UNDER the dash to the wheel. Cute but
// deadly. Built from rounded primitives so it reads "molded plastic toy".
//
// Cosmetic hook: buildCar({ bodyColor, capColor, skin }) — colors come from the
// player's idColor / loadout. Geometry identical for everyone (THE rule).
// ============================================================
import * as THREE from "three";
import { PALETTE, plastic, bodyPlastic } from "./palette.js";

function rounded(w, h, d, r = 0.12, seg = 3) {
  // RoundedBox without the examples dep: a box with beveled look via
  // scaled sphere-capped capsule trick is overkill — a plain box with
  // slightly shrunk hard edges reads fine at toy scale; use Box + bevel illusion
  // from a 2% smaller dark underlayer when needed. Keep it simple: Box.
  return new THREE.BoxGeometry(w, h, d, seg, seg, seg);
}

export function buildCar({ bodyColor = PALETTE.toyRed, capColor = null, skin = PALETTE.skin } = {}) {
  const car = new THREE.Group();
  const bodyMat = bodyPlastic(bodyColor);
  const trimMat = plastic(0xfff7ea);
  const darkMat = plastic(0x35302c);

  // --- tub body (no roof — it's a ride-on) ---
  const hull = new THREE.Mesh(rounded(2.1, 0.62, 1.34), bodyMat);
  hull.position.y = 0.55;
  hull.castShadow = true;
  car.add(hull);

  // scooped cockpit: dark inner tub
  const tub = new THREE.Mesh(rounded(1.05, 0.3, 1.0), darkMat);
  tub.position.set(-0.28, 0.86, 0);
  car.add(tub);

  // hood bulge + cartoon nose
  const hood = new THREE.Mesh(rounded(0.9, 0.34, 1.1), bodyMat);
  hood.position.set(0.62, 0.86, 0);
  hood.castShadow = true;
  car.add(hood);
  // grinning grille bar instead of a rolling-pin nose
  const grille = new THREE.Mesh(rounded(0.14, 0.2, 0.9), plastic(0x35302c));
  grille.position.set(1.1, 0.68, 0);
  car.add(grille);

  // chunky bumpers
  for (const sx of [1.12, -1.12]) {
    const b = new THREE.Mesh(rounded(0.16, 0.24, 1.4), trimMat);
    b.position.set(sx, 0.5, 0);
    car.add(b);
  }

  // big goofy headlights
  for (const sz of [0.42, -0.42]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), plastic(0xfff9e8, { emissive: 0x777055 }));
    eye.position.set(1.14, 0.92, sz);
    car.add(eye);
  }

  // --- wheels: fat toy wheels with white hubs ---
  const wheels = [];
  const wheelGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.26, 14);
  const hubGeo = new THREE.CylinderGeometry(0.16, 0.16, 0.28, 10);
  for (const [x, z] of [[0.72, 0.72], [0.72, -0.72], [-0.72, 0.72], [-0.72, -0.72]]) {
    const w = new THREE.Group();
    const tire = new THREE.Mesh(wheelGeo, plastic(PALETTE.tire));
    tire.rotation.x = Math.PI / 2;
    tire.castShadow = true;
    const hub = new THREE.Mesh(hubGeo, plastic(PALETTE.hub));
    hub.rotation.x = Math.PI / 2;
    w.add(tire, hub);
    w.position.set(x, 0.34, z);
    car.add(w);
    wheels.push(w);
  }

  // --- the chibi driver (sized ~equal to the car, as ordered) ---
  const driver = new THREE.Group();
  const capC = capColor ?? bodyColor;

  // tiny torso hunched forward
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.26, 0.3, 4, 10), plastic(capC));
  torso.position.set(-0.32, 1.1, 0);
  torso.rotation.z = 0.35;
  torso.castShadow = true;
  driver.add(torso);

  // BIG head
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.46, 18, 14), plastic(skin));
  head.position.set(-0.18, 1.66, 0);
  head.castShadow = true;
  driver.add(head);

  // cap with brim (team color)
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.47, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), plastic(capC));
  cap.position.copy(head.position).y += 0.06;
  cap.rotation.x = -0.15;
  driver.add(cap);
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.07, 14, 1, false, -Math.PI / 2, Math.PI), plastic(capC));
  brim.position.set(head.position.x + 0.30, head.position.y + 0.26, 0);
  brim.rotation.z = -0.22;
  driver.add(brim);

  // little safety flag on a whippy pole — pure kid-car energy, and a strong
  // silhouette from behind (which is where everyone will see your cosmetics)
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.5, 6), trimMat);
  pole.position.set(-0.95, 1.3, -0.5);
  car.add(pole);
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.3), plastic(capC, { side: THREE.DoubleSide }));
  flag.position.set(-0.78, 1.9, -0.5);
  car.add(flag);
  car.userData.flag = flag;

  // simple face: two dot eyes + cheek blush (front = +x)
  for (const sz of [0.16, -0.16]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), plastic(0x2b2622));
    eye.position.set(head.position.x + 0.40, head.position.y + 0.05, sz);
    driver.add(eye);
    const blush = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6), plastic(0xf2a08c));
    blush.position.set(head.position.x + 0.37, head.position.y - 0.12, sz * 1.6);
    driver.add(blush);
  }

  // arms reaching DOWN under the dash to the hidden wheel
  for (const sz of [0.18, -0.18]) {
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.085, 0.42, 4, 8), plastic(capC));
    arm.position.set(0.02, 1.02, sz);
    arm.rotation.z = 1.15;
    driver.add(arm);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6), plastic(skin));
    hand.position.set(0.26, 0.86, sz);
    driver.add(hand);
  }

  car.add(driver);
  car.userData = { wheels, driver, head };
  return car;
}

// Per-frame car animation: wheel spin, driver lean into corners, sand tilt.
export function animateCar(car, { speed = 0, steer = 0, offTrack = false }, dt) {
  const { wheels, driver, flag } = car.userData;
  if (flag) flag.rotation.y = Math.sin(performance.now() * 0.012) * 0.5 - Math.min(1, Math.abs(speed) / 26) * 0.7;
  for (const w of wheels) w.children[0].rotation.y += speed * dt * 1.8;
  const targetLean = -steer * Math.min(1, Math.abs(speed) / 14) * 0.22;
  driver.rotation.x += (targetLean - driver.rotation.x) * Math.min(1, dt * 8);
  const targetRoll = -steer * Math.min(1, Math.abs(speed) / 20) * 0.06;
  car.rotation.z += (targetRoll - car.rotation.z) * Math.min(1, dt * 6);
  // sand judder
  car.position.y = offTrack && Math.abs(speed) > 2 ? Math.sin(performance.now() * 0.04) * 0.03 : 0;
}
