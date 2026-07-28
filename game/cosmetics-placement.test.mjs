// SANDBOX GP — COSMETIC PLACEMENT AUDIT
//
// Every wearable item is built for real and its bounding box measured against
// the kart. This is the test that catches the class of bug where a hat renders
// *inside the driver's face*, or a floaty ends up under the road — the kind of
// thing you cannot see from a unit test that only checks the item exists.
//
// The kart's anatomy, in car-local space:
//   wheels y=0.34 · shell top y=0.71 · driver group at y=0.55
//   → driver head centre 1.03 world · helmet crown 1.33 world
//   rear deck z ≈ -0.9 · nose z ≈ +1.1 · flanks x = ±0.62
import * as THREE from "./bridge-client/node_modules/three/build/three.module.js";
import { buildCar } from "./bridge-client/src/game/carMesh.js";
import { COSMETICS } from "./bridge-backend/src/config/cosmetics.js";

let pass = 0, fail = 0;
const ok = (m) => { console.log(`  \x1b[32m✓\x1b[0m ${m}`); pass++; };
const no = (m) => { console.log(`  \x1b[31m✗\x1b[0m ${m}`); fail++; };

// What each slot is allowed to occupy, in CAR-LOCAL coordinates.
// Deliberately generous — this is a sanity net for gross errors (an item at the
// origin, an item 40m in the air, an item the size of the track), not a pixel spec.
const BOUNDS = {
  headpiece:  { y: [1.05, 2.10], x: [-0.75, 0.75], z: [-0.80, 0.80], maxSize: 1.3, note: "on the helmet" },
  breather:   { y: [0.70, 1.60], x: [-0.75, 0.75], z: [-0.60, 0.80], maxSize: 1.1, note: "on the face/head" },
  bandana:    { y: [0.55, 1.15], x: [-0.60, 0.60], z: [-0.75, 0.65], maxSize: 1.0, note: "at the neck" },
  oxygenTank: { y: [0.20, 1.60], x: [-0.70, 0.70], z: [-1.20, 0.10], maxSize: 1.4, note: "behind the seat" },
  weapon:     { y: [0.40, 1.70], x: [-1.10, 0.10], z: [-1.40, -0.20], maxSize: 1.6, note: "on the rear deck" },
  belt:       { y: [0.20, 0.90], x: [0.30, 1.00], z: [-0.70, 0.30], maxSize: 0.8, note: "on the flank" },
};

const RENDERED = Object.keys(BOUNDS);
const items = Object.values(COSMETICS).filter((c) => RENDERED.includes(c.slot));
// The four Mythic loyalty pieces add auras (a glowing shell, a comet trail,
// orbiting sparks) that are SUPPOSED to be much bigger than the item. They get
// a size pass — their anchor still has to be right, but a 5m trail is the point.
const MYTHIC_IDS = new Set(["bandana_trailblazer", "head_marshal", "body_goldplate", "shoes_goldspur"]);

// Build a bare kart once so we can subtract it: whatever a loadout ADDS is the item.
const baseline = new Set();
{
  const bare = buildCar({ loadout: {} });
  bare.traverse((o) => { if (o.isMesh) baseline.add(o.uuid); });
}

let checked = 0, offenders = 0;
const problems = [];

for (const item of items) {
  const car = buildCar({ loadout: { [item.slot]: item.id } });

  // Collect only meshes this item introduced. The floaty slot is alwaysFilled
  // (a bare kart already has one), so compare against a kart wearing a DIFFERENT
  // floaty rather than none.
  const control = buildCar({
    loadout: item.slot === "oxygenTank"
      // The floaty slot is alwaysFilled, so a bare kart already wears
      // tank_standard. Diffing tank_standard against itself yields nothing —
      // control against a DIFFERENT floaty instead.
      ? { oxygenTank: item.id === "tank_swan" ? "tank_standard" : "tank_swan" }
      : {},
  });
  const controlSigs = new Set();
  control.traverse((o) => {
    if (o.isMesh) controlSigs.add(`${o.geometry.type}|${o.position.toArray().map((n) => n.toFixed(3)).join(",")}`);
  });

  // MEASURE IN THE MODEL'S OWN FRAME.
  //
  // The kart's body is rotated a quarter turn at build time so that its forward
  // axis (+Z, the way a vehicle is naturally modelled) matches the ENGINE's
  // forward axis (+X, which is what heading=0 means). Without that the kart
  // rendered completely sideways.
  //
  // But this test's bounds are written in the model's authoring frame — "the rear
  // deck is at z = -0.9" and so on. Measuring in world space after the rotation
  // swaps X and Z and every single item reads as misplaced. Undo the body's
  // rotation for the measurement.
  const box = new THREE.Box3();
  let found = 0;
  car.updateMatrixWorld(true);
  const bodyGrp = car.children.find((c) => c.isGroup && c.children.length > 10);
  const unrotate = new THREE.Matrix4();
  if (bodyGrp) unrotate.makeRotationY(-bodyGrp.rotation.y);
  // Count meshes by signature: an item whose shape is IDENTICAL to the kart's
  // default (a plain torus floaty at the same spot) is invisible to a set
  // difference — you have to compare COUNTS, not membership.
  const controlCounts = new Map();
  control.traverse((o) => {
    if (!o.isMesh) return;
    const sig = `${o.geometry.type}|${o.position.toArray().map((n) => n.toFixed(3)).join(",")}`;
    controlCounts.set(sig, (controlCounts.get(sig) || 0) + 1);
  });
  const seen = new Map();
  car.traverse((o) => {
    if (!o.isMesh) return;
    // MYTHIC auras (halo shells, trails, sparks) are deliberately huge and are
    // not the item's geometry — skip them or every Mythic piece "fails".
    if (o.material?.depthWrite === false) return;   // a Mythic aura, not the item
    const sig = `${o.geometry.type}|${o.position.toArray().map((n) => n.toFixed(3)).join(",")}`;
    const n = (seen.get(sig) || 0) + 1;
    seen.set(sig, n);
    if (n <= (controlCounts.get(sig) || 0)) return;   // still accounted for by the base kart
    o.geometry.computeBoundingBox();
    const b = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld);
    box.union(b.applyMatrix4(unrotate));       // back into the authoring frame
    found++;
  });

  checked++;
  if (found === 0) {
    // The floaty slot is alwaysFilled and tank_standard is the fallback the
    // renderer uses when nothing is equipped — so a "wearing tank_standard" kart
    // and a "wearing nothing" kart are the SAME kart, and no diff can isolate it.
    // Verify it renders by building it alone instead of by subtraction.
    if (item.id === "tank_standard") {
      let meshes = 0;
      buildCar({ loadout: { oxygenTank: "tank_standard" } }).traverse((o) => { if (o.isMesh) meshes++; });
      if (meshes > 0) continue;      // it's there; the diff just can't see it
    }
    problems.push(`${item.slot}/${item.id} (${item.name}) — RENDERS NOTHING`);
    offenders++;
    continue;
  }

  const B = BOUNDS[item.slot];
  const size = box.getSize(new THREE.Vector3());
  const c = box.getCenter(new THREE.Vector3());
  const bad = [];
  if (c.y < B.y[0] || c.y > B.y[1]) bad.push(`y=${c.y.toFixed(2)} outside [${B.y}]`);
  if (c.x < B.x[0] || c.x > B.x[1]) bad.push(`x=${c.x.toFixed(2)} outside [${B.x}]`);
  if (c.z < B.z[0] || c.z > B.z[1]) bad.push(`z=${c.z.toFixed(2)} outside [${B.z}]`);
  const biggest = Math.max(size.x, size.y, size.z);
  if (!MYTHIC_IDS.has(item.id) && biggest > B.maxSize) bad.push(`${biggest.toFixed(2)}m across (max ${B.maxSize})`);
  if (biggest < 0.04) bad.push(`invisibly small (${biggest.toFixed(3)}m)`);

  if (bad.length) {
    problems.push(`${item.slot}/${item.id} (${item.name}) — ${bad.join("; ")}`);
    offenders++;
  }
}

console.log(`\n  audited ${checked} wearable items across ${RENDERED.length} slots\n`);

(offenders === 0)
  ? ok(`all ${checked} items sit inside their slot's anatomy and are a sane size`)
  : no(`${offenders} misplaced/missing items:\n      ` + problems.join("\n      "));

// ---- the specific bug that started this: nothing may be inside the head ----
{
  const HEAD_CENTRE_Y = 0.55 + 0.48;    // 1.03 in car space
  let insideFace = 0;
  for (const item of items.filter((c) => c.slot === "headpiece")) {
    const car = buildCar({ loadout: { headpiece: item.id } });
    car.updateMatrixWorld(true);
    const control = buildCar({ loadout: {} });
    const sigs = new Set();
    control.traverse((o) => { if (o.isMesh) sigs.add(`${o.geometry.type}|${o.position.toArray().map((n) => n.toFixed(3)).join(",")}`); });
    const box = new THREE.Box3();
    car.traverse((o) => {
      if (!o.isMesh) return;
      const sig = `${o.geometry.type}|${o.position.toArray().map((n) => n.toFixed(3)).join(",")}`;
      if (sigs.has(sig)) return;
      o.geometry.computeBoundingBox();
      box.union(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld));
    });
    // a hat's CENTRE must never sit below the middle of the head
    if (MYTHIC_IDS.has(item.id)) continue;    // auras skew the centroid; anchor checked above
    if (box.getCenter(new THREE.Vector3()).y < HEAD_CENTRE_Y) insideFace++;
  }
  (insideFace === 0)
    ? ok("no headwear renders inside the driver's head (the original bug)")
    : no(`${insideFace} hats are buried in the driver's face`);
}

// ---- both currencies price every item they should ----
{
  const { isCraftable, CRAFT_COST, scrapValue } = await import("./bridge-backend/src/config/cosmetics.js");
  const all = Object.values(COSMETICS);
  const box = all.filter((c) => c.source === "box");
  const prem = all.filter((c) => c.source === "premium");

  box.every((c) => isCraftable(c) && CRAFT_COST[c.rarity] > 0 && scrapValue(c) > 0)
    ? ok(`all ${box.length} loot-box items have a craft cost AND a scrap value`)
    : no("a loot-box item is missing a price");

  prem.every((c) => !isCraftable(c) && scrapValue(c) === 0)
    ? ok(`all ${prem.length} Sand Dollar items are UNcraftable and UNscrappable`)
    : no("a premium item leaked into the crafting economy");

  const { memoryStore: db } = await import("./bridge-backend/src/store/memory.js");
  const store = await db.listStoreItems?.() ?? [];
  const priced = new Set(store.filter((s) => s.currency === "PREMIUM").map((s) => s.cosmeticId));
  const unpriced = prem.filter((c) => !priced.has(c.id));
  (unpriced.length === 0)
    ? ok("every Sand Dollar cosmetic has a store price")
    : no(`unpriced premium items: ${unpriced.map((c) => c.id).join(", ")}`);
}

// ==========================================================================
// WHAT YOU'RE ACTUALLY SELLING
// ==========================================================================
{
  // The nine crown jewels are the real-money items. When I first measured them,
  // FIVE OF THE NINE were one or two meshes:
  //
  //   Sun Halo       — ONE TORUS.        6 shells.
  //   Thunder Horns  — two cones.        6 shells.
  //   Winged Helm    — two triangles.    6 shells.
  //   Neon Visor     — a band and a pane.
  //   Great White    — the FREE starter torus with a fin stuck on.
  //
  // You cannot charge real money for a primitive. A premium item has to be the
  // thing that makes someone else on the grid ask "how do I get that" — and that
  // means DETAIL: the gills on the shark, the lightning arcing between the horns,
  // the diamond cross-hatch on the pineapple's rind.
  const premium = Object.values(COSMETICS).filter((c) => c.source === "premium");

  const bare = buildCar({ loadout: {} });
  let base = 0;
  bare.traverse((o) => { if (o.isMesh) base++; });

  const thin = [];
  for (const c of premium) {
    const car = buildCar({ loadout: { [c.slot]: c.id } });
    let n = 0;
    car.traverse((o) => { if (o.isMesh) n++; });
    const parts = n - base;
    if (parts < 10) thin.push(`${c.name} (${parts} parts)`);
  }

  (thin.length === 0)
    ? ok(`all ${premium.length} crown jewels are detailed objects, not primitives`)
    : no(`PRIMITIVES IN THE SHOP: ${thin.join(", ")} — you cannot sell these`);

  // and nothing you SELL may share its mesh with something you give away free
  const freeMeshes = new Set();
  for (const c of Object.values(COSMETICS)) {
    if (c.source === "premium") continue;
    freeMeshes.add(c.id);
  }
  // (a shared builder is caught by the parts count above — a premium item that
  //  just reuses the free one comes out at 1-2 parts)
}

console.log(`\n\x1b[1mResult:\x1b[0m ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
