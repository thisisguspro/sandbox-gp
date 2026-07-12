// ============================================================
// SANDBOX GP — Race3D: the in-race screen.
//
// Renders the authoritative race from the server's per-player view stream:
//   • YOUR car: locally predicted with the SAME shared sim the server runs
//     (instant input response), then continuously pulled toward the server's
//     state so prediction can never drift from authority.
//   • OTHER cars: interpolated ~120ms behind the newest snapshot for smoothness.
//   • Input: keyboard → conn.raceInput at 15 Hz (plus instant-on-change).
//   • Camera: raised chase cam straight behind; hold Shift/B to look back.
//   • Rear-view mirror inset always on (scissor pass), as specced.
//   • R = the shovel reset (server teleports you to the centerline, dead stop).
// ============================================================
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { makeTrack } from "../game/shared/track.js";
import { stepCar, CAR } from "../game/shared/carSim.js";
import { buildWorld } from "../game/world.js";
import { buildCar, animateCar } from "../game/carMesh.js";
import { ItemBoxes3D, Rings3D, Ribbon3D } from "../game/challenges3d.js";
import { Effects3D } from "../game/items3d.js";
import { useI18n } from "../api/i18n.jsx";
import { initAudio, sfx } from "../api/audio.js";

const INPUT_HZ = 15;
const REMOTE_DELAY = 0.12; // seconds behind newest snapshot for interpolation

export default function Race3D({ view, roomId, conn, inputLocked, onLeave, eventQueue }) {
  const mountRef = useRef(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  const lockRef = useRef(inputLocked);
  lockRef.current = inputLocked;
  const queueRef = useRef(eventQueue);
  queueRef.current = eventQueue;
  const [hud, setHud] = useState({ pos: 1, lap: 0, laps: 3, speed: 0, standings: [], heldItem: null, challenge: null });
  const [toast, setToast] = useState(null); // { kind, tier, text, until }
  const toastRef = useRef(null);
  useEffect(() => { toastRef.current = toast; }, [toast]);
  const fxQueue = useRef([]); // events forwarded to the 3D burst layer
  const sndRef = useRef({ lastCount: 0, lastRing: -1 });
  const miniRef = useRef(null);          // minimap <canvas>
  const miniPts = useRef(null);          // normalized track polyline (computed once)
  const wrongRef = useRef({ t: 0, on: false, chimed: false });
  const [wrongWay, setWrongWay] = useState(false);
  const lapClock = useRef({ startMs: 0, bestMs: 0, lastLap: -1 });
  const [roulette, setRoulette] = useState(null); // { until } while the item chip spins
  const prevPosRef = useRef(0);
  const [posFlash, setPosFlash] = useState(null); // { dir: 'up'|'down', until }
  const leaderRef = useRef(null);
  const [feed, setFeed] = useState([]);   // splash/crumble ticker, newest last

  useEffect(() => { initAudio(); }, []);

  // Item roulette: when a challenge grants an item, spin the chip briefly
  // before the reveal (the Mario Kart moment). Pure presentation — the item
  // is already decided server-side.
  useEffect(() => {
    if (hud.heldItem && !roulette) setRoulette({ until: Date.now() + 850 });
    if (!hud.heldItem && roulette) setRoulette(null);
  }, [hud.heldItem]);
  useEffect(() => {
    if (!roulette) return;
    const id = setInterval(() => {
      if (Date.now() >= roulette.until) { setRoulette(null); clearInterval(id); sfx.rouletteLand?.(); }
      else { setRoulette((r) => ({ ...r })); sfx.rouletteTick?.(); } // advance the spin
    }, 80);
    return () => clearInterval(id);
  }, [roulette?.until]);

  // Final lap sting + banner; per-lap clock with session best.
  useEffect(() => {
    const lc = lapClock.current;
    if (hud.lap !== lc.lastLap) {
      const now = Date.now();
      if (lc.lastLap >= 0 && lc.startMs) {
        const t = now - lc.startMs;
        if (!lc.bestMs || t < lc.bestMs) lc.bestMs = t;
      }
      lc.startMs = now;
      if (hud.lap === hud.laps - 1 && lc.lastLap >= 0) {
        setToast({ kind: "final", text: "FINAL LAP!", until: Date.now() + 2200 });
        sfx.finalLap?.();
      }
      lc.lastLap = hud.lap;
    }
  }, [hud.lap, hud.laps]);

  // Position-change flash on the badge (up = good, down = ouch).
  useEffect(() => {
    const prev = prevPosRef.current;
    if (prev && hud.pos && hud.pos !== prev) {
      setPosFlash({ dir: hud.pos < prev ? "up" : "down", until: Date.now() + 700 });
      setTimeout(() => setPosFlash(null), 720);
    }
    prevPosRef.current = hud.pos;
  }, [hud.pos]);

  // Leader-change ticker (announcer flavor): only when no other toast is live.
  useEffect(() => {
    const lead = hud.standings?.[0];
    if (!lead || lead.finished) return;
    const prev = leaderRef.current;
    leaderRef.current = lead.id;
    if (prev && prev !== lead.id && !toast) {
      setToast({ kind: "lead", text: lead.me ? "YOU TAKE THE LEAD!" : `${lead.name.toUpperCase()} TAKES THE LEAD!`, until: Date.now() + 1800 });
    }
  }, [hud.standings?.[0]?.id]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    // ---------- three setup ----------
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const trackId = viewRef.current?.map?.trackId || "sandcastle";
    const track = makeTrack(trackId);
    // minimap: normalize the centerline into unit space once
    {
      const xs = track.samples.map((s) => s.x), zs = track.samples.map((s) => s.z);
      const mnx = Math.min(...xs), mxx = Math.max(...xs), mnz = Math.min(...zs), mxz = Math.max(...zs);
      const span = Math.max(mxx - mnx, mxz - mnz) || 1;
      miniPts.current = {
        norm: (x, z) => [(x - mnx) / span, (z - mnz) / span],
        pts: track.samples.filter((_, i) => i % 3 === 0).map((s) => [(s.x - mnx) / span, (s.z - mnz) / span]),
        start: [(track.samples[0].x - mnx) / span, (track.samples[0].z - mnz) / span],
        aspectW: (mxx - mnx) / span, aspectH: (mxz - mnz) / span,
      };
    }
    buildWorld(scene, track);

    const boxes3d = new ItemBoxes3D(scene);
    const fx3d = new Effects3D(scene);
    const rings3d = new Rings3D(scene, track);
    const ribbon3d = new Ribbon3D(scene, track);

    const cam = new THREE.PerspectiveCamera(58, 1, 0.1, 600);
    const mirrorCam = new THREE.PerspectiveCamera(62, 3.4, 0.1, 400);

    const size = () => {
      const w = mount.clientWidth, h = mount.clientHeight;
      renderer.setSize(w, h);
      cam.aspect = w / h;
      cam.updateProjectionMatrix();
    };
    size();
    const ro = new ResizeObserver(size);
    ro.observe(mount);

    // ---------- car meshes, keyed by playerId ----------
    const meshes = new Map(); // id -> { mesh, snapA, snapB (remote interp), steerVis }
    function ensureMesh(p) {
      if (meshes.has(p.id)) return meshes.get(p.id);
      const mesh = buildCar({ bodyColor: new THREE.Color(p.idColor || "#e2574c").getHex() });
      mesh.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      scene.add(mesh);
      const rec = { mesh, snapA: null, snapB: null, steerVis: 0 };
      meshes.set(p.id, rec);
      return rec;
    }

    // ---------- input ----------
    const keys = {};
    const kd = (e) => { keys[e.code] = true; if (e.code === "KeyR") conn?.raceReset(roomId); if (e.code === "Space") conn?.raceUse(roomId); if (["ArrowUp","ArrowDown","ArrowLeft","ArrowRight","Space"].includes(e.code)) e.preventDefault(); };
    const ku = (e) => { keys[e.code] = false; };
    addEventListener("keydown", kd);
    addEventListener("keyup", ku);
    // Dev-only screenshot/QA aid: ?dev_auto=1 makes the local car self-drive
    // with the same pure-pursuit the server bots use. The server still
    // validates every input — this is a QA convenience, not a privileged path.
    const devAuto = new URLSearchParams(location.search).get("dev_auto") === "1"
      || sessionStorage.getItem("dev_auto") === "1"; // survives router URL rewrites
    const autoInput = () => {
      // Steer from the freshest SERVER state (20Hz regardless of render fps):
      // predicted state can be hundreds of ms stale on slow machines, and a
      // pursuit controller fed stale poses oscillates itself off the road.
      const v = viewRef.current;
      const srv = v?.players?.find((p) => p.id === v?.you?.id);
      if (!srv) return { throttle: 0, steer: 0 };
      let j = track.nearest(srv.x, srv.z, -1), left = 15;
      while (left > 0) { const a = track.at(j), b = track.at(j + 1); left -= Math.hypot(b.x - a.x, b.z - a.z); j++; }
      let tgt = track.at(j);
      // box magnet: collect item boxes when empty-handed (mirrors bot behavior)
      if (!v?.you?.heldItem && !v?.you?.challenge && v?.itemBoxes) {
        let best = null, bd = 26;
        for (const b of v.itemBoxes) {
          if (!b.active) continue;
          const d = Math.hypot(b.x - srv.x, b.z - srv.z);
          if (d < bd && d > 2) { bd = d; best = b; }
        }
        if (best) tgt = best;
      }
      let dh = Math.atan2(tgt.z - srv.z, tgt.x - srv.x) - srv.heading;
      while (dh > Math.PI) dh -= 2 * Math.PI;
      while (dh < -Math.PI) dh += 2 * Math.PI;
      let k = j, ahead = 18;
      while (ahead > 0) { const a = track.at(k), b = track.at(k + 1); ahead -= Math.hypot(b.x - a.x, b.z - a.z); k++; }
      const t0 = track.at(track.nearest(srv.x, srv.z, -1)), t1 = track.at(k);
      const turn = Math.abs(t0.tx * t1.tz - t0.tz * t1.tx);
      const targetSpeed = CAR.MAX_SPEED * 0.95 * (1 - 0.62 * turn);
      const rawSteer = Math.abs(dh) < 0.03 ? 0 : dh * 1.6;
      return { throttle: srv.speed < targetSpeed ? 1 : -0.35, steer: Math.max(-1, Math.min(1, rawSteer)) };
    };
    const readInput = () => {
      if (lockRef.current) return { throttle: 0, steer: 0 };
      if (devAuto && window.__gpAuto !== false) return autoInput();  // window flag can hand back the wheel mid-test
      const throttle = (keys.ArrowUp || keys.KeyW ? 1 : 0) + (keys.ArrowDown || keys.KeyS ? -1 : 0);
      const steer = (keys.ArrowLeft || keys.KeyA ? -1 : 0) + (keys.ArrowRight || keys.KeyD ? 1 : 0);
      return { throttle, steer };
    };
    let lastSent = { throttle: 9, steer: 9 }, lastSentAt = 0;
    let liveInp = { throttle: 0, steer: 0 };
    // Input pump: fixed 66ms cadence, independent of render fps. On weak
    // hardware the renderer can crawl — steering must not.
    const inputPump = setInterval(() => {
      liveInp = readInput();
      const tNow = performance.now() / 1000;
      if ((liveInp.throttle !== lastSent.throttle || liveInp.steer !== lastSent.steer || tNow - lastSentAt > 0.25) && conn) {
        conn.raceInput(roomId, liveInp.throttle, liveInp.steer);
        lastSent = { ...liveInp }; lastSentAt = tNow;
      }
    }, 66);

    // ---------- local prediction state (your car) ----------
    const me = { x: 0, z: 0, heading: 0, speed: 0, offTrack: false, sampleHint: -1, seeded: false };

    // remote snapshot bookkeeping
    let clockOffset = null; // serverNow - perfNow
    function noteSnapshots() {
      const v = viewRef.current;
      if (!v?.players) return;
      const tNow = performance.now() / 1000;
      if (v.serverNow != null) clockOffset = v.serverNow - tNow;
      for (const p of v.players) {
        const rec = ensureMesh(p);
        rec.snapA = rec.snapB;
        rec.snapB = { t: v.serverNow ?? tNow, x: p.x, z: p.z, heading: p.heading, speed: p.speed, offTrack: p.offTrack };
        rec.info = p;
        if (p.id === v.you?.id) {
          if (!me.seeded) { Object.assign(me, { x: p.x, z: p.z, heading: p.heading, speed: p.speed, seeded: true }); }
          rec.isMe = true;
        }
      }
      // despawn leavers
      for (const [id, rec] of meshes) {
        if (!v.players.find((p) => p.id === id)) { scene.remove(rec.mesh); meshes.delete(id); }
      }
    }

    // reconcile prediction toward authority (exponential pull, hard snap on big error)
    function reconcile(dt) {
      const v = viewRef.current;
      const meSrv = v?.players?.find((p) => p.id === v?.you?.id);
      if (!meSrv) return;
      const ex = meSrv.x - me.x, ez = meSrv.z - me.z;
      const err = Math.hypot(ex, ez);
      if (err > 6 || meSrv.resetting) { // teleport (reset scoop) — snap
        me.x = meSrv.x; me.z = meSrv.z; me.heading = meSrv.heading; me.speed = meSrv.speed; me.sampleHint = -1;
        return;
      }
      const pull = Math.min(1, dt * 4);
      me.x += ex * pull; me.z += ez * pull;
      let dh = meSrv.heading - me.heading;
      while (dh > Math.PI) dh -= 2 * Math.PI;
      while (dh < -Math.PI) dh += 2 * Math.PI;
      me.heading += dh * pull * 0.7;
      me.speed += (meSrv.speed - me.speed) * pull * 0.5;
    }

    // ---------- HUD sampling (cheap React state, 5 Hz) ----------
    let hudAt = 0;
    function sampleHud(tNow) {
      if (tNow - hudAt < 0.2) return;
      hudAt = tNow;
      const v = viewRef.current;
      const my = v?.players?.find((p) => p.id === v?.you?.id);
      const st = (v?.standings || []).slice(0, 4).map((p) => ({ id: p.id, name: p.name, pos: p.racePos, lap: p.lap, me: p.id === v?.you?.id, color: p.idColor, finished: p.finished }));
      setHud({
        pos: st.find((s) => s.me)?.pos ?? 1,
        lap: Math.min((my?.lap ?? 0) + 1, v?.map?.laps ?? 3),
        laps: v?.map?.laps ?? 3,
        speed: Math.round(Math.abs(me.speed) * 2.35), // m/s → toy mph
        standings: st,
        heldItem: v?.you?.heldItem || null,
        challenge: v?.you?.challenge || null,
        erosion: my?.erosion ?? 0,
        kited: !!my?.kited,
        kiteNeed: my?.kiteNeed ?? 0,
        shield: !!my?.shield,
      });
    }

    // ---------- main loop ----------
    let raf = 0, last = performance.now(), lastServerNow = -1;
    const lookBackHeld = () => keys.ShiftLeft || keys.ShiftRight || keys.KeyB;

    function frame(now) {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const tNow = now / 1000;
      const v = viewRef.current;

      // ingest new snapshot exactly once per server tick
      if (v && v.serverNow !== lastServerNow) { lastServerNow = v.serverNow; noteSnapshots(); }

      // predict own car with the SAME sim in FIXED substeps (accurate at any
      // render fps), then reconcile toward the server
      const inp = liveInp;
      const frozen = lockRef.current || (v?.startFreezeLeft ?? 0) > 0;
      const meSrv = v?.players?.find((p) => p.id === v?.you?.id);
      if (me.seeded && !frozen && !meSrv?.finished && !meSrv?.resetting) {
        let acc = dt;
        const STEP = 1 / 60;
        let guard = 8;
        while (acc > 1e-4 && guard-- > 0) { const h = Math.min(STEP, acc); stepCar(me, inp, h, track); acc -= h; }
      }
      reconcile(dt);

      // drive meshes
      const renderT = (clockOffset != null ? tNow + clockOffset : 0) - REMOTE_DELAY;
      for (const [id, rec] of meshes) {
        let x, z, heading, speed, offTrack, steerFor;
        if (rec.isMe && me.seeded) {
          ({ x, z, heading, speed, offTrack } = me);
          steerFor = inp.steer;
        } else if (rec.snapA && rec.snapB && rec.snapB.t > rec.snapA.t) {
          const f = Math.max(0, Math.min(1, (renderT - rec.snapA.t) / (rec.snapB.t - rec.snapA.t)));
          x = rec.snapA.x + (rec.snapB.x - rec.snapA.x) * f;
          z = rec.snapA.z + (rec.snapB.z - rec.snapA.z) * f;
          let dh = rec.snapB.heading - rec.snapA.heading;
          while (dh > Math.PI) dh -= 2 * Math.PI;
          while (dh < -Math.PI) dh += 2 * Math.PI;
          heading = rec.snapA.heading + dh * f;
          speed = rec.snapB.speed; offTrack = rec.snapB.offTrack;
          rec.steerVis += ((dh * 6) - rec.steerVis) * Math.min(1, dt * 6);
          steerFor = rec.steerVis;
        } else if (rec.snapB) {
          ({ x, z, heading, speed, offTrack } = rec.snapB);
          steerFor = 0;
        } else continue;
        rec.mesh.position.x = x;
        rec.mesh.position.z = z;
        rec.mesh.rotation.y = -heading;
        animateCar(rec.mesh, { speed, steer: steerFor || 0, offTrack }, dt);
      }

      // item boxes + YOUR challenge visuals (server-authoritative)
      boxes3d.sync(v?.itemBoxes);
      boxes3d.animate(tNow);
      fx3d.syncEntities(v?.entities);
      fx3d.syncStatuses(meshes);
      if (fxQueue.current.length) { fx3d.onEvents(fxQueue.current, meshes); fxQueue.current = []; }
      fx3d.animate(tNow, dt);
      rings3d.sync(v?.you?.challenge);
      rings3d.animate(tNow);
      ribbon3d.sync(v?.you?.challenge, me);
      ribbon3d.animate(tNow);

      // camera: chase (or full look-back while held)
      const flip = lookBackHeld() ? -1 : 1;
      const back = 7.2 * flip, up = 3.3;
      const cx = me.x - Math.cos(me.heading) * back;
      const cz = me.z - Math.sin(me.heading) * back;
      cam.position.lerp(new THREE.Vector3(cx, up, cz), Math.min(1, dt * 7));
      cam.lookAt(me.x + Math.cos(me.heading) * 6 * flip, 1.1, me.z + Math.sin(me.heading) * 6 * flip);
      mirrorCam.position.set(me.x, 2.1, me.z);
      mirrorCam.lookAt(me.x - Math.cos(me.heading) * 10, 1.5, me.z - Math.sin(me.heading) * 10);

      // render main + mirror inset
      const W = mount.clientWidth, H = mount.clientHeight;
      renderer.setScissorTest(false);
      renderer.setViewport(0, 0, W, H);
      renderer.render(scene, cam);
      const mw = Math.floor(Math.min(W * 0.24, 360)), mh = Math.floor(mw / 3.4);
      const mx = Math.floor((W - mw) / 2), my2 = H - mh - 16;
      renderer.setScissorTest(true);
      renderer.setScissor(mx, my2, mw, mh);
      renderer.setViewport(mx, my2, mw, mh);
      renderer.render(scene, mirrorCam);
      renderer.setScissorTest(false);

      // drain race events (queue semantics: nothing can be swallowed)
      const q = queueRef.current?.current;
      if (q?.length) {
        const myId = v?.you?.id;
        const nameOf = (id) => (v?.players || []).find((pp) => pp.id === id)?.name || "someone";
        const pushFeed = (text) => setFeed((f) => [...f.slice(-2), { id: Math.random(), text, until: Date.now() + 3500 }]);
        const sticky = toastRef.current && ["final", "kited"].includes(toastRef.current.kind) && Date.now() < toastRef.current.until;
        const say = (t) => { if (!sticky) setToast(t); };
        for (const ev of q.splice(0)) {
          fxQueue.current.push(ev);   // 3D layer gets every event too
          const mine = ev.playerId === myId;
          if (ev.type === "challenge_start") { say({ kind: "start", text: ev.challengeType === "rings" ? "THREAD THE RINGS!" : "HOLD THE LANE!", until: Date.now() + 2200 }); sfx.challenge?.(); }
          else if (ev.type === "challenge_end") { say({ kind: "tier", tier: ev.tier, text: `${ev.tier.toUpperCase()} TIER!`, until: Date.now() + 2600 }); sfx.tier?.(ev.tier); }
          else if (ev.type === "item_used" && mine) {
            say({ kind: "used", text: `${(ITEM_LABELS[ev.itemId] || "ITEM").toUpperCase()} AWAY!`, until: Date.now() + 1400 });
            if (ev.itemId === "juicebox") sfx.turbo?.(); else sfx.itemAway?.();
          }
          else if (ev.type === "kited") { say({ kind: "kited", text: "KITED! MASH SPACE!", until: Date.now() + 2600 }); sfx.kiteLatch?.(); }
          else if (ev.type === "kite_break") { say({ kind: "free", text: "BROKE FREE!", until: Date.now() + 1200 }); sfx.kiteBreak?.(); }
          else if (ev.type === "crumble") { if (mine) say({ kind: "crumble", text: "CRUMBLED!", until: Date.now() + 1800 }); sfx.crumble?.(); pushFeed(ev.by ? `💥 ${nameOf(ev.by)} crumbled ${nameOf(ev.playerId)}!` : `💥 ${nameOf(ev.playerId)} crumbled!`); }
          else if (ev.type === "shield_block") { say({ kind: "block", text: "BUCKET BLOCK!", until: Date.now() + 1400 }); sfx.block?.(); }
          else if (ev.type === "splash") { if (mine) sfx.splash?.(); pushFeed(`💦 ${nameOf(ev.by)} soaked ${nameOf(ev.playerId)}!`); }
          else if (ev.type === "balloon_pop") sfx.pop?.();
          else if (ev.type === "lap" && mine) sfx.lap?.();
        }
      }
      // Wrong-way detection, frame-rate independent: sampled once per SERVER
      // tick (20Hz), we compare the car's actual MOTION VECTOR over the last
      // ~0.4s against the local track tangent (full nearest scan — the hinted
      // one jitters in reverse; server progress is forward-clamped and can't
      // signal reverse at all). A 1s majority vote + hysteresis rides out both
      // low headless framerates and noisy segment picks off the ribbon.
      if (v && tNow - (wrongRef.current.lastSampleT || 0) > 0.05) {
        const w = wrongRef.current;
        w.lastSampleT = tNow;
        w.hist = w.hist || [];
        w.votes = w.votes || [];
        w.hist.push({ x: me.x, z: me.z });
        if (w.hist.length > 9) w.hist.shift();
        const a = w.hist[0], b = w.hist[w.hist.length - 1];
        const mvx = b.x - a.x, mvz = b.z - a.z;
        const dist = Math.hypot(mvx, mvz);
        let vote = 0; // -1 wrong, +1 fine, 0 abstain
        if (dist > 1.2 && (v?.startFreezeLeft ?? 0) <= 0) {
          const tg = track.at(track.nearest(me.x, me.z, -1));
          const dot = (mvx * tg.tx + mvz * tg.tz) / dist;
          vote = dot < -0.3 ? -1 : dot > 0.2 ? 1 : 0;
        }
        w.votes.push(vote);
        if (w.votes.length > 20) w.votes.shift();
        const neg = w.votes.filter((x) => x === -1).length;
        const pos = w.votes.filter((x) => x === 1).length;
        const on = w.on ? neg > 4 : (neg >= 10 && neg >= pos * 3);  // decided-majority + hysteresis
        if (on !== w.on) {
          w.on = on;
          setWrongWay(on);
          if (on && !w.chimed) { sfx.wrongWay?.(); w.chimed = true; }
          if (!on) w.chimed = false;
        }
      }
      // minimap: track outline + live player dots
      drawMiniMap(miniRef.current, miniPts.current, v, meshes);
      // countdown ticks (3-2-1) + GO stinger on freeze release + ring blips
      const fl = v?.startFreezeLeft ?? 0;
      const fi = Math.ceil(fl);
      if (fl > 0 && fi !== sndRef.current.lastCount) { sndRef.current.lastCount = fi; sfx.countTick?.(); }
      if (fl <= 0 && sndRef.current.lastCount > 0) { sndRef.current.lastCount = 0; sfx.drawStinger?.(); }
      const rn = v?.you?.challenge?.type === "rings" ? (v.you.challenge.next ?? 0) : -1;
      if (rn > 0 && rn > sndRef.current.lastRing) sfx.ring?.();
      sndRef.current.lastRing = rn;
      sampleHud(tNow);
      // dev/e2e peek at live race state (read-only)
      window.__gpState = {
        phase: v?.phase, lap: v?.you?.lap,
        challenge: v?.you?.challenge?.type || null,
        heldTier: v?.you?.heldItem?.tier || null,
        heldId: v?.you?.heldItem?.id || null,
        entities: v?.entities?.length || 0,
        wrongWay: wrongRef.current.on,
        wwNeg: (wrongRef.current.votes || []).filter((x) => x === -1).length,
        pos: v?.you?.racePos ?? 0,
        speed: Math.round(me.speed * 10) / 10,
      };
      // live debug tap for QA tooling (harmless in prod: plain object on window)
      window.__lastView = v;   // QA: raw view tap
      window.__race = { devAuto, seeded: me.seeded, locked: !!lockRef.current, inp, speed: me.speed, x: me.x, z: me.z, freeze: v?.startFreezeLeft ?? -1, phase: v?.phase };
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      clearInterval(inputPump);
      ro.disconnect();
      removeEventListener("keydown", kd);
      removeEventListener("keyup", ku);
      renderer.dispose();
      mount.removeChild(renderer.domElement);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), Math.max(0, toast.until - Date.now()));
    return () => clearTimeout(id);
  }, [toast]);

  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <div ref={mountRef} style={{ position: "absolute", inset: 0 }} />
      <RaceHud hud={hud} toast={toast} onLeave={onLeave}
        posFlash={posFlash} wrongWay={wrongWay} roulette={roulette}
        miniRef={miniRef} lapClock={lapClock} feed={feed} />
    </div>
  );
}

function ordinal(n) { return `${n}${["st", "nd", "rd"][n - 1] || "th"}`; }

const TIER_COLORS = { bronze: "#b8763e", silver: "#a7b0b8", gold: "#e0a417", s: "#e2574c" };
// Top-down minimap: warm sand card, track ribbon, live racer dots.
// Drawn imperatively every frame — no React churn.
function drawMiniMap(canvas, mm, v, meshes) {
  if (!canvas || !mm || !v) return;
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height, PAD = 14;
  ctx.clearRect(0, 0, W, H);
  const sx = (nx) => PAD + nx * (W - PAD * 2);
  const sy = (nz) => PAD + nz * (H - PAD * 2);
  // track ribbon: dark outline under a cream core
  ctx.lineJoin = ctx.lineCap = "round";
  for (const [wpx, color] of [[9, "rgba(90,70,50,0.65)"], [5.5, "#fff3dd"]]) {
    ctx.beginPath();
    mm.pts.forEach(([x, z], i) => (i ? ctx.lineTo(sx(x), sy(z)) : ctx.moveTo(sx(x), sy(z))));
    ctx.closePath();
    ctx.lineWidth = wpx; ctx.strokeStyle = color; ctx.stroke();
  }
  // start line tick
  ctx.fillStyle = "#5a4632";
  ctx.beginPath(); ctx.arc(sx(mm.start[0]), sy(mm.start[1]), 3, 0, Math.PI * 2); ctx.fill();
  // racers: everyone small, YOU bigger with a white ring
  const youId = v.you?.id;
  for (const p of v.players || []) {
    const [nx, nz] = mm.norm(p.x, p.z);
    const isMe = p.id === youId;
    ctx.beginPath();
    ctx.arc(sx(nx), sy(nz), isMe ? 6 : 4.2, 0, Math.PI * 2);
    ctx.fillStyle = p.finished ? "rgba(90,70,50,0.4)" : (p.idColor || (isMe ? "#e2574c" : "#3aa6b9"));
    ctx.fill();
    if (isMe) { ctx.lineWidth = 2.4; ctx.strokeStyle = "#fff"; ctx.stroke(); }
  }
}

const ITEM_LABELS = {
  waterballoon: "Water Balloon", squirt: "Squirt Stream", sprinkler: "Sprinkler Patch",
  wave: "The Wave", kite: "Beach Kite", bucket: "Bucket Shield", juicebox: "Juice-Box Turbo",
};

// Small-screen awareness: below 1000px the HUD tightens (smaller chips,
// narrower mirror, minimap shrinks) so nothing collides on mobile-landscape.
function useCompactHud() {
  const [c, setC] = useState(typeof window !== "undefined" && window.innerWidth < 1000);
  useEffect(() => {
    const on = () => setC(window.innerWidth < 1000);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return c;
}

function RaceHud({ hud, toast, onLeave, posFlash, wrongWay, roulette, miniRef, lapClock, feed = [] }) {
  const compact = useCompactHud();
  const { t } = useI18n();
  const chip = {
    background: "rgba(255,247,234,0.92)", color: "#5a4632", borderRadius: 14,
    padding: "8px 14px", fontFamily: "var(--display, system-ui)", fontWeight: 800,
    boxShadow: "0 4px 14px rgba(90,70,50,0.25)",
  };
  return (
    <>
      {/* rear-view mirror frame (the scissor render sits inside this) */}
      <div data-qa="hud-mirror" style={{
        position: "absolute", top: 8, left: "50%", transform: "translateX(-50%)",
        width: compact ? "min(19%, 190px)" : "min(24%, 360px)", aspectRatio: "3.4", boxSizing: "content-box",
        border: "5px solid rgba(255,247,234,0.95)", borderRadius: 12,
        boxShadow: "0 5px 16px rgba(90,70,50,0.3)", pointerEvents: "none",
      }} />
      {/* position + lap, top-left */}
      <div data-qa="hud-chips" style={{ position: "absolute", left: 16, top: 14, display: "flex", gap: 10, alignItems: "center", pointerEvents: "none" }}>
        <div style={{
          ...chip, fontSize: compact ? 24 : 34, padding: compact ? "4px 10px" : "6px 16px",
          color: posFlash ? (posFlash.dir === "up" ? "#1f9d55" : "#e2574c") : hud.pos === 1 ? "#c98a12" : "#5a4632",
          transform: posFlash ? "scale(1.18)" : "scale(1)",
          transition: "transform 0.18s ease, color 0.18s ease",
        }}>{ordinal(hud.pos)}</div>
        <div style={{ ...chip, fontSize: compact ? 13 : 16 }}>LAP {hud.lap}/{hud.laps}</div>
        <div style={{ ...chip, fontSize: compact ? 10 : 12, opacity: 0.85 }}>
          ⏱ {((Date.now() - (lapClock.current.startMs || Date.now())) / 1000).toFixed(1)}s
          {lapClock.current.bestMs ? ` · BEST ${(lapClock.current.bestMs / 1000).toFixed(1)}s` : ""}
        </div>
      </div>
      {/* splash/crumble ticker, top-left under the chips */}
      <div data-qa="hud-feed" style={{ position: "absolute", left: 16, top: 64, display: "flex", flexDirection: "column", gap: 4, pointerEvents: "none" }}>
        {feed.filter((f) => Date.now() < f.until).map((f) => (
          <div key={f.id} style={{ ...chip, fontSize: 12, opacity: 0.92, padding: "4px 10px" }}>{f.text}</div>
        ))}
      </div>
      {/* minimap, bottom-left above the controls hint */}
      <div data-qa="hud-minimap" style={{ position: "absolute", left: 16, bottom: 64, pointerEvents: "none", background: "rgba(255,247,234,0.88)", border: "2px solid rgba(90,70,50,0.35)", borderRadius: 14, boxShadow: "0 4px 10px rgba(90,70,50,0.25)", padding: 4 }}>
        <canvas ref={miniRef} width={compact ? 118 : 164} height={compact ? 118 : 164} style={{ display: "block", borderRadius: 10 }} />
      </div>
      {/* wrong-way overlay */}
      {wrongWay && (
        <div style={{ position: "absolute", left: 0, right: 0, top: "26%", display: "flex", flexDirection: "column", alignItems: "center", pointerEvents: "none", animation: "gpPulse 0.35s infinite alternate" }}>
          <div style={{ fontSize: 64, lineHeight: 1, filter: "drop-shadow(0 4px 6px rgba(90,70,50,0.5))" }}>⤴️</div>
          <div style={{ ...chip, fontSize: 26, fontWeight: 900, color: "#fff", background: "#e2574c", border: "3px solid #fff3dd", letterSpacing: "0.06em" }}>
            WRONG WAY!
          </div>
        </div>
      )}
      {/* speed, bottom-right */}
      <div data-qa="hud-speed" style={{ position: "absolute", right: 18, bottom: 16, ...chip, fontSize: 22, pointerEvents: "none" }}>
        {hud.speed} <span style={{ fontSize: 12, opacity: 0.7 }}>mph</span>
      </div>
      {/* mini standings, top-right */}
      <div data-qa="hud-standings" style={{ position: "absolute", right: 16, top: 14, ...chip, padding: "10px 12px", pointerEvents: "none" }}>
        {hud.standings.map((s) => (
          <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, opacity: s.me ? 1 : 0.85, fontWeight: s.me ? 900 : 700 }}>
            <span style={{ width: 16 }}>{s.pos}</span>
            <span style={{ width: 9, height: 9, borderRadius: "50%", background: s.color, border: "1.5px solid rgba(90,70,50,0.4)" }} />
            <span style={{ maxWidth: 110, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}{s.me ? " (you)" : ""}{s.finished ? " ✓" : ""}</span>
          </div>
        ))}
      </div>
      {/* held item / live challenge, bottom-center */}
      <div data-qa="hud-item" style={{ position: "absolute", left: "50%", bottom: 16, transform: "translateX(-50%)", pointerEvents: "none" }}>
        {hud.kited && (
          <div style={{ ...chip, fontSize: 17, border: "3px solid #e2574c", background: "rgba(255,240,235,0.95)", animation: "gpPulse 0.4s infinite alternate" }}>
            🪁 MASH SPACE! · {hud.kiteNeed} to break free
          </div>
        )}
        {!hud.kited && hud.heldItem && (roulette ? (
          <div style={{ ...chip, fontSize: 15, border: "3px dashed #5a4632", minWidth: 220, textAlign: "center" }}>
            🎰 {Object.values(ITEM_LABELS)[Math.floor(Date.now() / 80) % 7]}…
          </div>
        ) : (
          <div style={{ ...chip, fontSize: 15, border: `3px solid ${TIER_COLORS[hud.heldItem.tier] || "#5a4632"}` }}>
            🎁 {(ITEM_LABELS[hud.heldItem.id] || "Item")} · {hud.heldItem.tier.toUpperCase()} — <span style={{ opacity: 0.75 }}>SPACE</span>
          </div>
        ))}
        {!hud.kited && !hud.heldItem && hud.challenge?.type === "rings" && (
          <div style={{ ...chip, fontSize: 14 }}>RINGS {Math.min(hud.challenge.next, 5)}/5</div>
        )}
        {!hud.kited && !hud.heldItem && hud.challenge?.type === "ribbon" && (
          <div style={{ ...chip, fontSize: 14 }}>HOLD THE LANE · {hud.challenge.left.toFixed(1)}s · {Math.round((hud.challenge.score || 0) * 100)}%</div>
        )}
      </div>
      {/* sand armor + shield, above the speedo (bottom-right) */}
      <div data-qa="hud-erosion" style={{ position: "absolute", right: 18, bottom: 74, display: "flex", gap: 5, alignItems: "center", pointerEvents: "none" }}>
        {hud.shield && <span style={{ fontSize: 20, filter: "drop-shadow(0 2px 2px rgba(90,70,50,0.4))" }}>🪣</span>}
        {[0, 1, 2].map((i) => (
          <div key={i} style={{
            width: 15, height: 15, borderRadius: 4, border: "2px solid rgba(90,70,50,0.55)",
            background: (hud.erosion ?? 0) > i + 0.5 ? "#cfa25e" : "rgba(255,247,234,0.9)",
            boxShadow: "0 2px 4px rgba(90,70,50,0.25)",
          }} title="sand armor" />
        ))}
      </div>
      {/* toast banner, upper-center under the mirror */}
      {toast && (
        <div style={{
          position: "absolute", left: "50%", top: "19%", transform: "translateX(-50%)",
          fontFamily: "var(--display, system-ui)", fontWeight: 900, fontSize: 42,
          color: toast.kind === "tier" ? (TIER_COLORS[toast.tier] || "#5a4632") : "#5a4632",
          textShadow: "0 3px 0 rgba(255,247,234,0.9), 0 6px 18px rgba(90,70,50,0.35)",
          pointerEvents: "none", letterSpacing: 1,
        }}>{toast.text}</div>
      )}
      {/* controls hint + reset + leave, bottom-left */}
      <div data-qa="hud-controls" style={{ position: "absolute", left: 16, bottom: 16, display: "flex", gap: 8, alignItems: "center" }}>
        <div style={{ ...chip, fontSize: 11.5, opacity: 0.92, pointerEvents: "none" }}>
          WASD / arrows · SPACE = use item · SHIFT = look back · R = shovel reset
        </div>
        <button className="btn" style={{ fontSize: 12 }} onClick={onLeave}>{t("play.hud.returnToLobby")}</button>
      </div>
    </>
  );
}
