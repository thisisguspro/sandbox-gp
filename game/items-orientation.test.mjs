#!/usr/bin/env node
/* SANDBOX GP — item ORIENTATION test.
 *
 * Instantiates the real client renderers (items3d) headless with three.js and
 * verifies, at four compass headings, that each directional item's geometry
 * actually faces its travel direction:
 *
 *  • squirt — the jet's droplet axis (local +X) must point along the shooter's
 *    heading in world space.
 *  • wave   — the wall (solid half of the half-pipe) must LEAD the travel
 *    direction; the open/concave side trails. We derive the wall's local
 *    direction from the built geometry itself (average vertex position of the
 *    curved surface), then check its world-space direction against travel.
 *
 * Non-directional items (balloon/slickzone/sandpile) are asserted to build
 * without errors and sit at their entity position. The car convention
 * (rotation.y = -heading, forward = local +X) is the reference frame.
 */
import * as THREE from "./bridge-client/node_modules/three/build/three.module.js";
import { Effects3D } from "./bridge-client/src/game/items3d.js";

let pass = 0, fail = 0;
const ok = (m) => { console.log(`  \x1b[32m✓\x1b[0m ${m}`); pass++; };
const no = (m) => { console.log(`  \x1b[31m✗\x1b[0m ${m}`); fail++; };
const deg = (r) => Math.round((r * 180) / Math.PI);
const angDiff = (a, b) => {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return Math.abs(d);
};

const scene = new THREE.Scene();
const fx = new Effects3D(scene);
const HEADINGS = [0, Math.PI / 2, Math.PI, -Math.PI / 2];

console.log("\n\x1b[1mSANDBOX GP item orientation (4 compass headings)\x1b[0m");

// ---------- squirt: droplet axis (+X local) must map to the heading ----------
for (const h of HEADINGS) {
  fx.syncEntities([{ id: `sq_${h}`, kind: "squirt", x: 10, z: 5, heading: h }]);
  const g = fx.ent.get(`sq_${h}`).grp;
  g.updateMatrixWorld(true);
  const tip = new THREE.Vector3(10, 0, 0).applyMatrix4(g.matrixWorld); // far droplet, local +X
  const dir = Math.atan2(tip.z - 5, tip.x - 10);
  const err = angDiff(dir, h);
  (err < 0.05) ? ok(`squirt @ ${deg(h)}° jets along heading (err ${deg(err)}°)`) : no(`squirt @ ${deg(h)}° off by ${deg(err)}°`);
}

// ---------- wave: derive the wall's local side from geometry, assert it leads travel ----------
{
  // build one wave to inspect its local geometry
  fx.syncEntities([{ id: "wav_probe", kind: "wave", x: 0, z: 0, heading: 0 }]);
  const g = fx.ent.get("wav_probe").grp;
  const wall = g.userData.wave;
  // average LOCAL vertex position of the curved wall = which local side is solid
  const pos = wall.geometry.getAttribute("position");
  const avg = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) avg.add(new THREE.Vector3().fromBufferAttribute(pos, i));
  avg.divideScalar(pos.count).applyEuler(wall.rotation); // account for the -0.28 lean
  const wallLocalAngle = Math.atan2(avg.z, avg.x);
  console.log(`  · wave wall occupies local angle ${deg(wallLocalAngle)}° (derived from geometry)`);

  for (const h of HEADINGS) {
    fx.syncEntities([{ id: `wav_${h}`, kind: "wave", x: 3, z: -7, heading: h }]);
    const wg = fx.ent.get(`wav_${h}`).grp;
    const worldWallAngle = wallLocalAngle + wg.rotation.y; // rotation.y adds in XZ (x=cos, z=-sin) → careful
    // compute properly via a probe point instead of angle algebra:
    wg.updateMatrixWorld(true);
    const probe = new THREE.Vector3(Math.cos(wallLocalAngle) * 3, 1.1, Math.sin(wallLocalAngle) * 3).applyMatrix4(wg.matrixWorld);
    const dir = Math.atan2(probe.z - (-7), probe.x - 3);
    const err = angDiff(dir, h);
    (err < 0.06) ? ok(`wave @ ${deg(h)}° wall leads travel (err ${deg(err)}°)`) : no(`wave @ ${deg(h)}° wall points ${deg(dir)}°, travel ${deg(h)}° (err ${deg(err)}°)`);
  }
}

// ---------- wave internals: foam crowns the wall, crest leans into travel ----------
{
  fx.syncEntities([{ id: "wav_probe", kind: "wave", x: 0, z: 0, heading: 0 }]);
  const g = fx.ent.get("wav_probe").grp;
  const wall = g.userData.wave;
  const foam = g.children.find((c) => c !== wall && c.geometry?.type === "TorusGeometry");
  if (!foam) no("wave foam ring not found");
  else {
    foam.updateMatrix();
    const fpos = foam.geometry.getAttribute("position");
    const favg = new THREE.Vector3();
    for (let i = 0; i < fpos.count; i++) favg.add(new THREE.Vector3().fromBufferAttribute(fpos, i));
    favg.divideScalar(fpos.count).applyEuler(foam.rotation);
    const foamAngle = Math.atan2(favg.z, favg.x);
    (angDiff(foamAngle, 0) < 0.4) ? ok(`wave foam crowns the wall side (foam local ${deg(foamAngle)}°)`) : no(`foam sits at ${deg(foamAngle)}°, wall at 0°`);
  }
  // CREST LEAN: the wall's own AXIS must tip forward, into travel.
  //
  // This used to average the X of every vertex above y=0.6 and below y=-0.6 and
  // subtract. On a HALF-cylinder all the vertices sit on one side, so the result was
  // dominated by which ones happened to cross the y threshold — the measured "lean"
  // flipped SIGN between rotation.z of 0.3 and 0.5, which is nonsense. It could not
  // measure the thing it claimed to.
  //
  // A cylinder's axis is its local +Y. Where that axis points after the rotation IS
  // the lean, unambiguously.
  const axis = new THREE.Vector3(0, 1, 0).applyEuler(wall.rotation);
  (axis.x > 0.15)
    ? ok(`wave crest leans into travel (axis tips +${axis.x.toFixed(2)} along X)`)
    : no(`crest tips the wrong way (axis x=${axis.x.toFixed(2)}) — the wave falls away from you`);
}

// ---------- non-directional items: build + sit at entity position ----------
for (const kind of ["balloon", "slickzone", "sandpile"]) {
  try {
    fx.syncEntities([{ id: `k_${kind}`, kind, x: -4, z: 9, y: 1.2, r: 2.4 }]);
    const g = fx.ent.get(`k_${kind}`).grp;
    (Math.abs(g.position.x - -4) < 0.001 && Math.abs(g.position.z - 9) < 0.001)
      ? ok(`${kind} builds and sits at its entity position`)
      : no(`${kind} misplaced: ${g.position.x},${g.position.z}`);
  } catch (e) { no(`${kind} build crashed: ${e.message.slice(0, 60)}`); }
}

console.log(`\n\x1b[1mResult:\x1b[0m ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
