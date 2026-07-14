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
    const drove = await page.waitForFunction(
      () => (window.__race?.speed ?? 0) > 12, null, { timeout: 90000 }
    ).then(() => true).catch(() => false);
    await page.waitForTimeout(6000);
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
  await page.waitForFunction(() => (window.__race?.speed ?? 0) > 12, null, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(2000);

  const dot = await page.evaluate(() => {
    const S = window.__scene, me = window.__race;
    let kart = null;
    S.traverse((o) => { if (o.userData?.wheels && o.userData?.driver) kart = o; });
    if (!kart) return null;
    kart.updateMatrixWorld(true);
    let nose = null, deck = null;
    kart.traverse((o) => {
      if (o.isMesh && o.geometry?.type === "CylinderGeometry" && o.geometry.parameters?.radialSegments === 4) nose = o;
      if (o.isMesh && o.geometry?.type === "BoxGeometry" && Math.abs(o.geometry.parameters.width - 0.78) < 0.01) deck = o;
    });
    if (!nose || !deck) return null;
    const V = kart.position.constructor;
    const np = nose.getWorldPosition(new V());
    const dp = deck.getWorldPosition(new V());
    const fx = np.x - dp.x, fz = np.z - dp.z;
    const len = Math.hypot(fx, fz) || 1;
    const vx = Math.cos(me.heading ?? 0), vz = Math.sin(me.heading ?? 0);
    return (fx / len) * vx + (fz / len) * vz;   // 1 = nose points where we're going
  });
  await page.keyboard.up("w");

  (dot != null && dot > 0.9)
    ? ok(`the kart faces the way it's driving (alignment ${dot.toFixed(2)})`)
    : no(`THE KART IS SIDEWAYS — nose/travel alignment is ${dot?.toFixed(2)} (want 1.0)`);
  await page.close();
}

await browser.close();
console.log(`\n\x1b[1mResult:\x1b[0m ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
