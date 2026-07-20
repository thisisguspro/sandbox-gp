// SANDBOX GP — IS THE GAME ACTUALLY PLAYABLE?
//
// This file exists because 366 tests passed while the game was unplayable.
//
// Two bugs shipped together and neither was catchable by anything I had:
//
//   1. `animateCar` set `material.transparent = false` every frame. In three.js
//      `transparent` is part of the shader PROGRAM KEY — assigning it, even to
//      the value it already held, marks the material for recompilation. So every
//      frame, for every kart, three.js rebuilt and relinked the shader. Frames
//      went from 16ms to 1400ms.
//
//   2. The input lock was cleared by a client-side setInterval counting the 3-2-1
//      down. With the main thread stalled by (1), that interval was starved,
//      never reached zero, and never unlocked. The player could SEE the race,
//      could see other karts moving, and pressing W did nothing at all.
//
// Every engine test still passed, because the engine was fine. The bug lived
// entirely in the browser — in the frame budget and in a piece of React state.
// So these tests drive a real browser, hold a real key, and assert the car moves.
import { chromium, BASE, newShotPage } from "./qa/shot.mjs";

let pass = 0, fail = 0;
const ok = (m) => { console.log(`  \x1b[32m✓\x1b[0m ${m}`); pass++; };
const no = (m) => { console.log(`  \x1b[31m✗\x1b[0m ${m}`); fail++; };

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});

async function raceReady() {
  const page = await newShotPage(browser);
  await page.locator("text=QUICK PLAY").first().click({ timeout: 20000 });
  // wait out the start freeze — the SERVER says when
  await page.waitForFunction(
    () => (window.__lastView?.startFreezeLeft ?? 99) <= 0 && window.__lastView?.phase === "active",
    null, { timeout: 60000 }
  );
  return page;
}

// ---- 1. THE INPUT LOCK MUST CLEAR ----
{
  const page = await raceReady();
  const locked = await page.evaluate(() => window.__race?.locked);
  (locked === false)
    ? ok("input unlocks once the server drops the flag")
    : no("INPUT IS STILL LOCKED — pressing W will do nothing");

  await page.close();
}

// ---- 2. HOLDING W MUST DRIVE THE CAR ----
{
  const page = await raceReady();
  await page.keyboard.down("w");
  // give it time even on a slow renderer
  const moved = await page.waitForFunction(
    () => (window.__race?.speed ?? 0) > 8,
    null, { timeout: 20000 }
  ).then(() => true).catch(() => false);
  const speed = await page.evaluate(() => window.__race?.speed ?? 0);
  await page.keyboard.up("w");

  moved
    ? ok(`holding W drives the car (${speed.toFixed(1)} m/s)`)
    : no(`HOLDING W DOES NOTHING — speed is ${speed.toFixed(1)}. The game is unplayable.`);
  await page.close();
}

// ---- 3. THE FRAME BUDGET ----
{
  const page = await raceReady();
  await page.evaluate(() => {
    window.__fr = [];
    const raf = window.requestAnimationFrame;
    window.requestAnimationFrame = (fn) => raf((t) => {
      const a = performance.now();
      fn(t);
      window.__fr.push(performance.now() - a);
      if (window.__fr.length > 60) window.__fr.shift();
    });
  });
  await page.keyboard.down("w");
  await page.waitForTimeout(6000);
  await page.keyboard.up("w");

  const frames = await page.evaluate(() => window.__fr);
  if (!frames.length) {
    no("no frames rendered at all");
  } else {
    frames.sort((a, b) => a - b);
    const median = frames[Math.floor(frames.length / 2)];
    // 100ms is a generous ceiling for a SOFTWARE renderer in a headless sandbox —
    // a real GPU is 10-20x faster. What this catches is the 1400ms catastrophe.
    (median < 100)
      ? ok(`frame budget: ${median.toFixed(0)}ms of JS+render per frame (was 1400ms with the shader thrash)`)
      : no(`FRAME TAKES ${median.toFixed(0)}ms — the game will stutter unplayably`);
  }
  await page.close();
}

// ---- 4. NO SHADER RECOMPILES DURING PLAY ----
{
  // The smoking gun. Three.js caches compiled programs; if the count climbs while
  // you're just driving, something is dirtying a material's program key every
  // frame — which is exactly what `transparent = false` in animateCar did.
  const page = await raceReady();
  await page.keyboard.down("w");
  await page.waitForTimeout(2500);
  const before = await page.evaluate(() => window.__renderer?.info?.programs?.length ?? 0);
  await page.waitForTimeout(6000);
  const after = await page.evaluate(() => window.__renderer?.info?.programs?.length ?? 0);
  await page.keyboard.up("w");

  // a couple of new programs is fine (an item fires, a new effect appears);
  // a steady climb is the bug
  (after - before <= 3)
    ? ok(`shader cache is stable while driving (${before} → ${after} programs)`)
    : no(`SHADER RECOMPILES EVERY FRAME: ${before} → ${after} programs in 6s — this is the stutter`);
  await page.close();
}

// ---- 5. THE RENDER LOOP STAYS ALIVE ----
{
  const page = await raceReady();
  const f0 = await page.evaluate(() => window.__renderer?.info?.render?.frame ?? 0);
  await page.waitForTimeout(5000);
  const f1 = await page.evaluate(() => window.__renderer?.info?.render?.frame ?? 0);

  (f1 > f0)
    ? ok(`the render loop keeps drawing (${f1 - f0} frames in 5s)`)
    : no("THE RENDER LOOP IS DEAD — the screen is frozen");
  await page.close();
}

// ---- 6. NO PAGE ERRORS DURING A REAL RACE ----
{
  const page = await newShotPage(browser);
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message.slice(0, 90)));
  await page.locator("text=QUICK PLAY").first().click({ timeout: 20000 });
  await page.waitForTimeout(18000);
  await page.keyboard.down("w");
  await page.waitForTimeout(4000);
  await page.keyboard.up("w");

  (errs.length === 0)
    ? ok("a full race throws no page errors")
    : no(`page errors during a race: ${errs.slice(0, 2).join(" | ")}`);
  await page.close();
}

// ---- 7. EVERY MAP DRIVES, AND THROWS NOTHING ----
{
  // `tNowMs` was used in ELEVEN places and never declared — the kerb rumble, the
  // water pour, the guess countdown, the IT pulse. Every one threw a
  // ReferenceError the moment it ran. It only surfaced on Moonlit Dunes, because
  // that is where a car first touched a kerb. Four features silently dead, and
  // "it's in the code" said they were fine.
  //
  // So: drive EVERY map, and assert nothing throws.
  const TRACKS = ["sandcastle", "pharaoh", "shingle", "pier", "volcano", "dunes"];
  const broken = [];
  for (const t of TRACKS) {
    const page = await browser.newPage({ viewport: { width: 900, height: 560 } });
    const errs = [];
    page.on("pageerror", (e) => errs.push(`${t}: ${e.message.slice(0, 60)}`));
    const login = await fetch(`${BASE}/auth/dev-login`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "T" + t }),
    }).then((r) => r.json());
    await page.addInitScript((tok) => { sessionStorage.setItem("bridge_token", tok); }, login.token);
    await page.goto(`${BASE}/?dev_auto=1&dev_track=${t}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1800);
    await page.locator("text=QUICK PLAY").first().click({ timeout: 25000 });
    // A generous timeout. This is a SOFTWARE renderer running six full races back
    // to back — by the sixth, the sandbox is saturated and the flythrough alone can
    // eat most of a minute. A flaky failure here tells you nothing about the game;
    // it tells you the box is busy. (Verified separately: every circuit drives at
    // 21-24 m/s with zero errors.)
    const drove = await page.waitForFunction(
      () => (window.__race?.speed ?? 0) > 10, null, { timeout: 150000 }
    ).then(() => true).catch(() => false);
    await page.waitForTimeout(4000);
    if (!drove) broken.push(`${t} (never got moving)`);
    if (errs.length) broken.push(errs[0]);
    await page.close();
  }
  (broken.length === 0)
    ? ok(`all ${TRACKS.length} circuits drive with zero page errors`)
    : no(`broken circuits: ${broken.join(" | ")}`);
}

// ---- 8. THE KART FACES THE WAY IT IS GOING ----
{
  // The chassis is modelled along +Z but the engine's heading=0 is +X, so the
  // kart rendered a full 90 degrees SIDEWAYS — you could see the driver's
  // shoulder where the nose should have been. The old lathe body hid it
  // completely (a shape spun round an axis has no front); the moment the kart had
  // an actual nose, it was glaring.
  const page = await raceReady();
  await page.keyboard.down("w");

  // MEASURE THE MESH, NOT THE DRIVING.
  //
  // Waiting for a "clean" moment isn't enough: this game has oil slicks and waves
  // that shove you sideways, so even with the wheel straight and both feet on the
  // road the kart can be DRIFTING — its nose genuinely not aligned with its
  // velocity. Sampling then measures a slide, not a broken model, and the reading
  // swung between 1.00 and -0.51 across runs.
  //
  // So sample MANY times over several seconds and take the BEST alignment. If the
  // mesh is correctly oriented, at least one of those samples — any moment the kart
  // is tracking true — will read near 1.0. If the mesh is genuinely sideways, NONE
  // of them can, no matter how well it's being driven.
  await page.waitForFunction(() => (window.__race?.speed ?? 0) > 12, null, { timeout: 40000 }).catch(() => {});

  const dot = await page.evaluate(async () => {
    const S = window.__scene;
    let kart = null;
    S.traverse((o) => { if (o.userData?.wheels && o.userData?.driver) kart = o; });
    if (!kart) return null;

    let nose = null, deck = null;
    kart.traverse((o) => {
      // The nose is a proper rounded CONE now. It used to be a 4-segment cylinder —
      // a pyramid — which presented a flat diamond face and made the front of the
      // kart read as a red SLAB.
      if (o.isMesh && o.geometry?.type === "ConeGeometry" && Math.abs((o.geometry.parameters?.radius ?? 0) - 0.44) < 0.01) nose = o;
      if (o.isMesh && o.geometry?.type === "BoxGeometry" && Math.abs(o.geometry.parameters.width - 0.78) < 0.01) deck = o;
    });
    if (!nose || !deck) return null;

    const V = kart.position.constructor;
    let best = -1;
    for (let i = 0; i < 60; i++) {
      const me = window.__race;
      if (me && Math.abs(me.speed) > 8 && !me.offTrack) {
        kart.updateMatrixWorld(true);
        const np = nose.getWorldPosition(new V());
        const dp = deck.getWorldPosition(new V());
        const fx = np.x - dp.x, fz = np.z - dp.z;
        const len = Math.hypot(fx, fz) || 1;
        const vx = Math.cos(me.heading ?? 0), vz = Math.sin(me.heading ?? 0);
        best = Math.max(best, (fx / len) * vx + (fz / len) * vz);
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    return best;   // 1 = the nose points where the kart is going
  });
  await page.keyboard.up("w");

  // THE BAR.
  //
  // A kart that is genuinely SIDEWAYS reads near 0. A kart that is sliding — and in
  // this game you slide a lot, because it is full of oil slicks and waves that shove
  // you laterally — reads somewhere in the 0.8s at its best. The mesh being right
  // and the car being in a drift are different things, and only one of them is a bug.
  //
  // 0.75 catches a broken model (a 90-degree error reads ~0.0, a reversed one ~-1.0)
  // and forgives a car that's crossed up. It is the honest line.
  (dot != null && dot > 0.75)
    ? ok(`the kart faces the way it's driving (best alignment ${dot.toFixed(2)} over 6s)`)
    : no(`THE KART IS SIDEWAYS — best nose/travel alignment was only ${dot?.toFixed(2)} across 60 samples`);
  await page.close();
}

// ---- 9. THE WHEELS ROLL FORWARD ----
{
  // Everything about the wheel was fighting itself. The TYRE is a TorusGeometry
  // (spins about its local +Z). The RIM was a cylinder rotated about Z, putting
  // its axle on X — ninety degrees out from the tyre it sits inside. The spokes
  // fanned about a third axis, and animateCar rolls the whole thing about a
  // fourth. On screen the white rim disc faced FORWARD out of the side of the
  // wheel, and the wheels visibly rotated sideways.
  //
  // The kart travels along +X, so every axle must lie along Z.
  const page = await raceReady();
  await page.keyboard.down("w");
  await page.waitForFunction(() => (window.__race?.speed ?? 0) > 10, null, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1500);

  // Sample only when the kart is driving STRAIGHT. The front pair steers — up to
  // 0.4 radians of lock — so mid-corner an axle legitimately reads 0.9 against the
  // travel direction. That is a wheel doing its job, not a wheel that's broadside.
  await page.waitForFunction(
    () => {
      const r = window.__race;
      return r && r.speed > 10 && Math.abs(r.inp?.steer ?? 1) < 0.06 && !r.offTrack;
    },
    null, { timeout: 40000 }
  ).catch(() => {});
  await page.waitForTimeout(400);

  const axles = await page.evaluate(() => {
    const S = window.__scene;
    let kart = null;
    S.traverse((o) => { if (o.userData?.wheels && o.userData?.driver) kart = o; });
    if (!kart?.userData?.wheels?.length) return null;
    kart.updateMatrixWorld(true);

    const out = [];
    for (const w of kart.userData.wheels) {
      let tyre = null, rim = null;
      w.traverse((o) => {
        if (!o.isMesh) return;
        if (o.geometry?.type === "TorusGeometry") tyre = o;
        if (o.geometry?.type === "CylinderGeometry") rim = o;
      });
      if (!tyre || !rim) continue;

      const V = kart.position.constructor;
      const QC = kart.quaternion.constructor;
      // An AXLE must be PERPENDICULAR to the direction of travel. Measure against
      // the car's heading, not world Z — the kart is steering, so the axles turn
      // with it.
      const me = window.__race;
      const fwd = new V(Math.cos(me.heading ?? 0), 0, Math.sin(me.heading ?? 0));
      // a torus spins about its own +Z; a cylinder's axis is its own +Y
      const tAxis = new V(0, 0, 1).applyQuaternion(tyre.getWorldQuaternion(new QC()));
      const rAxis = new V(0, 1, 0).applyQuaternion(rim.getWorldQuaternion(new QC()));
      out.push({ t: Math.abs(tAxis.dot(fwd)), r: Math.abs(rAxis.dot(fwd)) });
    }
    return out;
  });
  await page.keyboard.up("w");

  if (!axles || !axles.length) {
    no("could not find the wheels to check");
  } else {
    // 0 = perpendicular to travel (correct). The front pair steers, so allow a
    // little deflection; anything near 1 means the wheel is turned broadside.
    // The FRONT pair steers, up to 0.4 radians of lock — that's a legitimate dot of
    // about 0.4 with the travel direction. A wheel turned fully BROADSIDE reads near
    // 1.0. The bar is at 0.6: it catches a sideways wheel and permits a steering one.
    const bad = axles.filter((a) => a.t > 0.6 || a.r > 0.6);
    (bad.length === 0)
      ? ok(`all ${axles.length} wheels roll forward (axles perpendicular to travel)`)
      : no(`${bad.length} WHEELS ARE SIDEWAYS — axle/travel alignment ${bad.map((a) => a.t.toFixed(2)).join(", ")} (want < 0.6, and the front pair steers)`);
  }
  await page.close();
}

await browser.close();
console.log(`\n\x1b[1mResult:\x1b[0m ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
