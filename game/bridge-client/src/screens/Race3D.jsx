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
import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { makeTrack } from "../game/shared/track.js";
import { stepCar, stepCarFree, CAR } from "../game/shared/carSim.js";
import { buildArena, ModeWorld3D } from "../game/arena3d.js";
import { getArena, stepArena } from "../game/shared/arenas.js";
import { buildWorld, updateSunShadow, initEnvironment } from "../game/world.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { buildCar, animateCar } from "../game/carMesh.js";
import { ItemBoxes3D, Rings3D, Ribbon3D } from "../game/challenges3d.js";
import { Effects3D } from "../game/items3d.js";
import { useI18n } from "../api/i18n.jsx";
import { initAudio, sfx } from "../api/audio.js";
import Settings from "./Settings.jsx";

const INPUT_HZ = 15;
const REMOTE_DELAY = 0.12; // seconds behind newest snapshot for interpolation

export default function Race3D({ view, roomId, conn, inputLocked, onLeave, eventQueue }) {
  const mountRef = useRef(null);
  const speedlinesRef = useRef(null);   // anime speed-lines overlay, driven at render rate
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
  const [deathCam, setDeathCam] = useState(null);   // { x, z, y, until, by } — 4s wreck watch
  const [takedown, setTakedown] = useState(null);   // { text, victim, until, n } — attacker's moment
  const [ultimate, setUltimate] = useState(null);   // { name, color, until } — the S-tier name-card
  const specRef = useRef({ idx: 0 });               // who a spectator is watching
  const [paused, setPaused] = useState(false);      // ESC menu
  const [showOptions, setShowOptions] = useState(false); // full Settings, in-match
  const [showHelp, setShowHelp] = useState(false);  // TAB: how-to-play overlay
  const helpSeenRef = useRef(false);                // auto-shown once at match start
  const helpManualRef = useRef(false);              // player re-opened it via TAB
  const pausedRef = useRef(false);
  pausedRef.current = paused;
  const [confirmQuit, setConfirmQuit] = useState(false);
  const [, setPauseNonce] = useState(0);       // forces a re-render when mute toggles
  const [lapFlag, setLapFlag] = useState(null);     // { final, text, until }
  const [threat, setThreat] = useState(0);          // 0..1 incoming-danger intensity
  const takedownRef = useRef({ n: 0, until: 0 });
  const shakeRef = useRef(0);
  const threatRef = useRef({ last: 0, tickAt: 0, shown: 0 });   // `shown` mirrors the
  // React state INSIDE the render-loop closure — reading the state variable
  // itself there is a ReferenceError (the loop closes over its creation scope).
  const deathCamRef = useRef(null);
  const camSeededRef = useRef(false);
  const lightsRef = useRef({ fired: new Set() });
  deathCamRef.current = deathCam;
  const leaderRef = useRef(null);
  const [feed, setFeed] = useState([]);   // splash/crumble ticker, newest last
  const pushFeed = useCallback((text) => setFeed((f) => [...f.slice(-2), { id: Math.random(), text, until: Date.now() + 3500 }]), []);

  useEffect(() => { initAudio(); }, []);

  // Item roulette (goal #5): EXACTLY TWO SHUFFLES through the item wheel,
  // decelerating onto the server's roll. The outcome is already decided —
  // this is theatre with honest odds. Duds (kite) land the same way, flash
  // red, and are already latched onto you by the server.
  // The wheel shows the STAPLES plus whatever you actually rolled — so an S-tier
  // spin can land on TSUNAMI even though it's never in the base wheel.
  const ROULETTE_BASE = ["waterballoon", "squirt", "sprinkler", "wave", "kite", "bucket", "juicebox"];
  const ROULETTE_WHEEL = roulette?.itemId && !ROULETTE_BASE.includes(roulette.itemId)
    ? [...ROULETTE_BASE, roulette.itemId]
    : ROULETTE_BASE;
  useEffect(() => {
    if (!roulette) return;
    let step = 0;
    const target = Math.max(0, ROULETTE_WHEEL.indexOf(roulette.itemId));
    const totalSteps = ROULETTE_WHEEL.length * 2 + target;      // two full shuffles + settle
    const tick = () => {
      step++;
      const idx = step % ROULETTE_WHEEL.length;
      setRoulette((r) => r && { ...r, showing: ROULETTE_WHEEL[idx], step });
      sfx.rouletteTick?.();
      if (step >= totalSteps) {
        sfx.rouletteLand?.();
        setRoulette((r) => r && { ...r, landed: true, showing: roulette.itemId });
        setTimeout(() => setRoulette(null), roulette.negative ? 1300 : 700);
        return;
      }
      // decelerate: quick through the shuffles, dramatic into the landing
      const remain = totalSteps - step;
      setTimeout(tick, remain > 6 ? 60 : remain > 3 ? 120 : 210);
    };
    const id = setTimeout(tick, 60);
    return () => clearTimeout(id);
  }, [roulette?.startedAt]);

  // Start-light audio: one tone per stage, fired off the SERVER's freeze clock
  // so every player hears GO at the same instant they're allowed to move.
  useEffect(() => {
    const fl = view?.startFreezeLeft ?? 0;
    const f = lightsRef.current.fired;
    if (fl <= 0) { if (f.size) f.clear(); return; }
    const stage = fl > 3.0 ? null : fl > 2.4 ? "r1" : fl > 1.8 ? "r2" : fl > 1.2 ? "y" : "g";
    if (!stage || f.has(stage)) return;
    f.add(stage);
    if (stage === "r1" || stage === "r2") sfx.lightRed?.();
    else if (stage === "y") sfx.lightYellow?.();
    else if (stage === "g") sfx.lightGreen?.();
  }, [view?.startFreezeLeft]);

  // HOW-TO before the lights. The moment the pre-race freeze is running and we
  // haven't shown it yet this match, pop the help card so a newcomer reads the
  // rules before GO. They can dismiss it (or it hides itself when the flag drops).
  useEffect(() => {
    const fl = view?.startFreezeLeft ?? 0;
    if (fl > 0 && !helpSeenRef.current) {
      helpSeenRef.current = true;
      setShowHelp(true);
    }
    if (fl <= 0 && showHelp && helpSeenRef.current && !helpManualRef.current) {
      // auto-hide when the race actually starts (unless the player re-opened it)
      setShowHelp(false);
    }
  }, [view?.startFreezeLeft, showHelp]);

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
      // NOTE: the FINAL LAP announcement lives in the lap-event handler (the
      // authoritative signal). A second copy driven off HUD state used to fire
      // here too — two systems announcing the same thing meant one of them was
      // always subtly wrong (it compared against a default lap count).
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

  // Leader changes are MATCH EVENTS — they go in the left-side ticker with the
  // soaks and wipeouts, not splashed across the middle of the screen. The
  // centre stays reserved for things YOU must act on (wrong way, respawn,
  // your lives, your flag, your round).
  useEffect(() => {
    const lead = hud.standings?.[0];
    if (!lead || lead.finished) return;
    const prev = leaderRef.current;
    leaderRef.current = lead.id;
    if (prev && prev !== lead.id) {
      pushFeed(lead.me ? "🏁 You take the lead!" : `🏁 ${lead.name} takes the lead!`);
    }
  }, [hud.standings?.[0]?.id]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    // ---------- three setup ----------
    // preserveDrawingBuffer only under ?dev_shot=1 — it costs performance, but
    // without it headless screenshots read back an empty (black) buffer, which
    // makes visual regression checks lie about what the game looks like.
    const devShot = new URLSearchParams(location.search).get("dev_shot") === "1";
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: devShot });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    // TONE MAPPING. There was none — every colour was dumped to the screen raw,
    // which is why the whole game looked like a washed-out beige photocopy with
    // no contrast and no punch. ACES gives the highlights somewhere to go and
    // lets the saturated toy colours actually read as saturated.
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.95;
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
    // ---- ARENA OR TRACK ----
    // An arena mode has no ribbon: the world is a bowl with walls. The minimap
    // above is still built from the track (harmless — it just isn't drawn), and
    // the arena gets its own minimap projection below.
    const arenaDef = viewRef.current?.arena ? getArena(viewRef.current.arena.id) : null;
    if (arenaDef) {
      buildArena(scene, arenaDef);
      initEnvironment(renderer, scene);
      const R = arenaDef.radius;
      miniPts.current = {
        norm: (x, z) => [(x + R) / (2 * R), (z + R) / (2 * R)],
        pts: [],                       // no centerline to draw
        arena: arenaDef,
        start: [0.5, 0.5],
        aspectW: 1, aspectH: 1,
      };
    } else {
      buildWorld(scene, track);
      initEnvironment(renderer, scene);
    }
    const modeWorld = new ModeWorld3D(scene);

    const boxes3d = new ItemBoxes3D(scene, track);
    const fx3d = new Effects3D(scene);
    // AIM INDICATOR (goal #5): a coral chevron on the ground ~5m ahead of my
    // kart whenever a SHOT item is in hand — you always know where it's going.
    const aimGrp = new THREE.Group();
    {
      const mat = new THREE.MeshBasicMaterial({ color: 0xff6a5e, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false });
      const mk = (off) => {
        const s = new THREE.Shape();
        s.moveTo(-0.9, -0.5); s.lineTo(0, 0.5); s.lineTo(0.9, -0.5); s.lineTo(0.55, -0.5); s.lineTo(0, 0.12); s.lineTo(-0.55, -0.5); s.closePath();
        const m = new THREE.Mesh(new THREE.ShapeGeometry(s), mat);
        m.rotation.x = -Math.PI / 2; m.position.z = -off;
        return m;
      };
      aimGrp.add(mk(0), mk(1.3), mk(2.6));
      aimGrp.visible = false;
      scene.add(aimGrp);
    }
    const SHOT_ITEMS = new Set(["waterballoon", "squirt", "wave"]);
    const rings3d = new Rings3D(scene, track);
    const ribbon3d = new Ribbon3D(scene, track);

    const cam = new THREE.PerspectiveCamera(58, 1, 0.1, 600);
    const mirrorCam = new THREE.PerspectiveCamera(62, 3.4, 0.1, 400);

    // ---- POST: bloom on real emitters ----
    // The one post pass that pays for itself: sign lightboxes, LED markers,
    // lamp heads and brake glow bloom the way a camera sees them. Threshold
    // sits above diffuse white so only genuine emitters (emissive > 1) flare.
    // HDR chain: a half-float buffer keeps emissive values ABOVE 1.0 through
    // the pipeline, so a threshold of 1.05 selects only genuine light sources
    // (sign lightboxes, LED markers, lamps) — sunlit sand can hit 1.0 but can
    // never cross it, which is exactly the physical distinction we want.
    const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType }));
    composer.addPass(new RenderPass(scene, cam));
    const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.30, 0.40, 1.15);
    composer.addPass(bloom);
    const size = () => {
      const w = mount.clientWidth, h = mount.clientHeight;
      renderer.setSize(w, h);
      composer.setSize(w, h);
      bloom.setSize(Math.floor(w / 2), Math.floor(h / 2));   // half-res bloom: cheap
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
      const mesh = buildCar({ bodyColor: new THREE.Color(p.idColor || "#e2574c").getHex(), loadout: p.loadout || {} });
      mesh.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      scene.add(mesh);
      const rec = { mesh, snapA: null, snapB: null, steerVis: 0, teamMarker: null, teamOf: null };
      meshes.set(p.id, rec);
      return rec;
    }

    // ---------- overhead team markers ----------
    // In any team mode, every kart carries a spinning diamond over the driver's
    // head in its TEAM colour — same colours as the flags — so friend or foe
    // reads in a glance at any distance. Attached to the car mesh, so it
    // follows for free; removed the moment the player has no team.
    const TEAM_MARKER_COLORS = [0x2fe6c8, 0xff5a3c];
    function syncTeamMarker(rec, team) {
      if (team == null) {
        if (rec.teamMarker) { rec.mesh.remove(rec.teamMarker); rec.teamMarker = null; rec.teamOf = null; }
        return;
      }
      if (rec.teamMarker && rec.teamOf === team) return;
      if (rec.teamMarker) rec.mesh.remove(rec.teamMarker);
      const g = new THREE.Group();
      const core = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.34, 0),
        new THREE.MeshBasicMaterial({ color: TEAM_MARKER_COLORS[team] ?? 0xffffff, fog: false })
      );
      core.scale.y = 1.5;
      const halo = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.48, 0),
        new THREE.MeshBasicMaterial({ color: TEAM_MARKER_COLORS[team] ?? 0xffffff, transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })
      );
      halo.scale.y = 1.5;
      g.add(core, halo);
      g.position.y = 3.0;
      rec.mesh.add(g);
      rec.teamMarker = g;
      rec.teamOf = team;
    }

    // ---------- input ----------
    const keys = {};
    const kd = (e) => {
      // ESC: the pause menu. The race does NOT stop (it's multiplayer — you can't
      // freeze eight other people), but you get out of the driving seat and the
      // menu is there.
      if (e.code === "Escape") {
        e.preventDefault();
        setPaused((v) => !v);
        return;
      }
      // TAB: how-to-play. A quick reference to the current mode's rules and the
      // controls — toggle it any time. (It also pops up on its own before the
      // lights, so a first-timer sees the rules before GO.)
      if (e.code === "Tab") {
        e.preventDefault();
        helpManualRef.current = true;
        setShowHelp((v) => !v);
        return;
      }
      keys[e.code] = true;
      if (e.code === "KeyR") conn?.raceReset(roomId);
      // SPACE fires an item — EXCEPT in Sand Artist, where it's the paint key and
      // there are no items at all. Firing a no-op item on every paint stroke
      // would be a lot of pointless traffic.
      const _m = viewRef.current?.mode;
      const _mid = typeof _m === "string" ? _m : _m?.id;
      const _v = viewRef.current;
      const _spectating = _v?.you?.mode?.spectating || _v?.you?.eliminated;
      // SPECTATING: you guessed wrong (or got knocked out) and you're watching.
      // SPACE cycles whose kart the camera follows — otherwise you'd be stuck
      // staring at your own wreck for the rest of the round.
      if (e.code === "Space" && _spectating) {
        const living = (_v?.players || []).filter((p) => !p.eliminated && !p.spectating && p.id !== _v?.you?.id);
        if (living.length) {
          specRef.current.idx = (specRef.current.idx + 1) % living.length;
          e.preventDefault();
          return;
        }
      }
      if (e.code === "Space" && _mid !== "artist" && !_spectating) conn?.raceUse(roomId);
      if (["ArrowUp","ArrowDown","ArrowLeft","ArrowRight","Space"].includes(e.code)) e.preventDefault();
    };
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
      if (lockRef.current || pausedRef.current) return { throttle: 0, steer: 0, keys: { W:false, A:false, S:false, D:false, PAINT:false, PROP1:false, PROP2:false, PROP3:false, PROP4:false, PROP5:false } };
      if (devAuto && window.__gpAuto !== false) return autoInput();  // window flag can hand back the wheel mid-test
      const throttle = (keys.ArrowUp || keys.KeyW ? 1 : 0) + (keys.ArrowDown || keys.KeyS ? -1 : 0);
      const steer = (keys.ArrowLeft || keys.KeyA ? -1 : 0) + (keys.ArrowRight || keys.KeyD ? 1 : 0);
      // Raw WASD alongside the derived throttle/steer. The key drill needs to
      // know "is W physically down", which throttle can't tell you (it collapses
      // W and Up, and can't distinguish a hold from a fresh press).
      const raw = {
        W: !!keys.KeyW, A: !!keys.KeyA, S: !!keys.KeyS, D: !!keys.KeyD,
        // SAND ARTIST: hold SPACE to pour water (the drawing), 1..5 to stamp props
        PAINT: !!keys.Space,
        PROP1: !!keys.Digit1, PROP2: !!keys.Digit2, PROP3: !!keys.Digit3,
        PROP4: !!keys.Digit4, PROP5: !!keys.Digit5,
      };
      return { throttle, steer, keys: raw };
    };
    const KEY_FIELDS = ["W", "A", "S", "D", "PAINT", "PROP1", "PROP2", "PROP3", "PROP4", "PROP5"];
  const sameKeys = (a, b) => a && b && KEY_FIELDS.every((k) => !!a[k] === !!b[k]);
    let lastSent = { throttle: 9, steer: 9, keys: null }, lastSentAt = 0;
    let liveInp = { throttle: 0, steer: 0, keys: { W: false, A: false, S: false, D: false } };
    // Input pump: fixed 66ms cadence, independent of render fps. On weak
    // hardware the renderer can crawl — steering must not.
    const inputPump = setInterval(() => {
      liveInp = readInput();
      const tNow = performance.now() / 1000;
      if ((liveInp.throttle !== lastSent.throttle || liveInp.steer !== lastSent.steer
           || !sameKeys(liveInp.keys, lastSent.keys) || tNow - lastSentAt > 0.25) && conn) {
        conn.raceInput(roomId, liveInp.throttle, liveInp.steer, liveInp.keys);
        lastSent = { ...liveInp }; lastSentAt = tNow;
      }
    }, 66);

    // ---------- local prediction state (your car) ----------
    const me = { x: 0, z: 0, y: 0, vy: 0, airborne: false, heading: 0, speed: 0, offTrack: false, sampleHint: -1, seeded: false };

    // remote snapshot bookkeeping
    let clockOffset = null; // serverNow - perfNow
    function noteSnapshots() {
      const v = viewRef.current;
      if (!v?.players) return;
      const tNow = performance.now() / 1000;
      if (v.serverNow != null) clockOffset = v.serverNow - tNow;
      for (const p of v.players) {
        const rec = ensureMesh(p);
        syncTeamMarker(rec, p.team ?? null);
        rec.snapA = rec.snapB;
        rec.snapB = { t: v.serverNow ?? tNow, x: p.x, z: p.z, y: p.y, heading: p.heading, speed: p.speed, offTrack: p.offTrack, erosion: p.erosion || 0 };
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
    const camTarget = new THREE.Vector3();   // scratch: reused every frame
    const camYRef = { current: 0 };          // the camera's own, smoothed altitude
    const tiltRef = { current: 0 };          // smoothed horizontal-tilt roll

    // THE ENGINE. A whisper under everything — you should notice it only when it
    // stops. Its pitch follows your speed, so you can HEAR yourself accelerate.
    sfx.startEngine?.();
    const flyRef = { current: { seeded: false, lx: 0, ly: 0, lz: 0 } };
    let hudAt = 0;
    function sampleHud(tNow) {
      if (tNow - hudAt < 0.2) return;
      hudAt = tNow;
      const v = viewRef.current;
      const my = v?.players?.find((p) => p.id === v?.you?.id);
      const st = (v?.standings || []).slice(0, 4).map((p) => ({ id: p.id, name: p.name, pos: p.racePos, lap: p.lap, me: p.id === v?.you?.id, color: p.idColor, finished: p.finished, pearls: p.mode?.pearls ?? p.pearls ?? null }));
      // ?dev_fx staging for the minigame HUDs. This has to override HERE, not via
      // setHud() — the sampler runs every frame and would stomp anything set
      // from outside it.
      const FX_CHALLENGE = {
        keys:     { type: "keys", want: "A", idx: 2, total: 6, score: 2, armed: true, left: 1.4 },
        keyshold: { type: "keys", want: "W", idx: 0, total: 6, score: 0, armed: false, left: 1.8 },
        lane:     { type: "ribbon", halfWidth: 1.9, left: 6.2, score: 0.78, inLane: true },
        laneout:  { type: "ribbon", halfWidth: 1.9, left: 4.1, score: 0.51, inLane: false },
      }[window.__devFx];
      setHud({
        pos: st.find((s) => s.me)?.pos ?? 1,
        lap: Math.min((my?.lap ?? 0) + 1, v?.map?.laps ?? 3),
        laps: v?.map?.laps ?? 3,
        speed: Math.round(Math.abs(me.speed) * 2.35), // m/s → toy mph
        standings: st,
        lives: v?.you?.mode?.lives ?? null,
        pearlsMine: v?.you?.mode?.pearls ?? null,
        blinded: !!v?.you?.blinded,
        // where in the lane you are, so the indicator has something to indicate
        lanePos: my?.lanePos ?? 0,
        laneSide: my?.laneSide ?? 0,
        onCurb: !!my?.onCurb,
        offTrack: !!my?.offTrack,
        heldItem: FX_CHALLENGE ? null : v?.you?.heldItem || null,
        challenge: FX_CHALLENGE || v?.you?.challenge || null,
        erosion: my?.erosion ?? 0,
        kited: !!my?.kited,
        kiteNeed: my?.kiteNeed ?? 0,
        shield: !!my?.shield,
        // force-stopped off-track → prompt "Press R to respawn"
        needsReset: !!v?.you?.needsReset,
        // match countdown (all modes) + whether this mode counts laps
        timeLeft: v?.timeLeft ?? null,
        lapBased: v?.lapBased !== false,
      });
    }

    // ---------- main loop ----------
    let raf = 0, last = performance.now(), lastServerNow = -1;
    const lookBackHeld = () => keys.ShiftLeft || keys.ShiftRight || keys.KeyB;

    function frame(now) {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const tNow = now / 1000;
      // Milliseconds, for the audio rate-limiters. This was used in ELEVEN places
      // — the kerb rumble, the water pour, the guess countdown, the IT pulse — and
      // was NEVER DECLARED. Every one of those paths threw a ReferenceError the
      // moment it ran, which killed the frame. It only surfaced on Moonlit Dunes
      // because that is where a car first touched a kerb.
      const tNowMs = now;
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
        // Prediction MUST use the same physics the server does, or your kart
        // drifts away from the truth and gets snapped back every tick. In an
        // arena that means free driving plus the arena's containment.
        while (acc > 1e-4 && guard-- > 0) {
          const h = Math.min(STEP, acc);
          if (arenaDef) { stepCarFree(me, inp, h); stepArena(me, arenaDef, h, CAR); }
          else stepCar(me, inp, h, track);
          acc -= h;
        }
      }
      reconcile(dt);

      // drive meshes
      const renderT = (clockOffset != null ? tNow + clockOffset : 0) - REMOTE_DELAY;
      for (const [id, rec] of meshes) {
        if (rec.teamMarker) {
          rec.teamMarker.rotation.y += 0.05;
          rec.teamMarker.position.y = 3.0 + Math.sin(tNow * 2.4 + rec.teamMarker.rotation.y) * 0.12;
        }
        let x, z, heading, speed, offTrack, steerFor;
        if (rec.isMe && me.seeded) {
          ({ x, z, heading, speed, offTrack } = me);
          rec.yVis = me.y || 0;                       // predicted altitude, zero-lag
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
          {
            const ya = rec.snapA.y ?? 0, yb = rec.snapB.y ?? 0;
            const fy = yb < ya ? Math.min(1, f * 1.7) : f;   // descending: chase the road down, no hover
            rec.yVis = ya + (yb - ya) * fy;
          }
          rec.steerVis += ((dh * 6) - rec.steerVis) * Math.min(1, dt * 6);
          steerFor = rec.steerVis;
        } else if (rec.snapB) {
          ({ x, z, heading, speed, offTrack } = rec.snapB);
          rec.yVis = rec.snapB.y ?? 0;
          steerFor = 0;
        } else continue;
        rec.mesh.position.x = x;
        rec.mesh.position.z = z;
        rec.mesh.userData.baseY = (rec.yVis || 0) - 0.09;   // settled onto the tarmac, slopes included

        // ---- LINE OF SIGHT (CTF) ----
        // If the server says you can't see them, you can't see them. Hiding the
        // mesh client-side would be a lie a cheater could just turn off — the
        // AUTHORITY is the server's `visible` map, and this only draws it.
        const los = v?.you?.mode?.visible;
        if (los && !rec.isMe) {
          const canSee = los[id] !== false;
          if (rec.mesh.visible !== canSee) rec.mesh.visible = canSee;
        } else if (!rec.mesh.visible && !rec.hiddenByDeath) {
          rec.mesh.visible = true;
        }
        rec.mesh.rotation.y = -heading;
        // erosion drives the kart falling apart: chunks cut out of the shell,
        // sand showing through, a trail of grains left on the road
        const eroNow = rec.isMe
          ? (v?.you?.erosion ?? 0)
          : (rec.snapB?.erosion ?? rec.info?.erosion ?? 0);
        // turbo drives the afterburner + underglow surge on the mesh
        const turboNow = rec.isMe
          ? !!(v?.you?.turbo || v?.you?.hypernova)
          : !!(rec.snapB?.turbo || rec.info?.turbo || rec.snapB?.hypernova || rec.info?.hypernova);
        animateCar(rec.mesh, { speed, steer: steerFor || 0, offTrack, erosion: eroNow, turbo: turboNow }, dt);
      }

      // item boxes + YOUR challenge visuals (server-authoritative)
      boxes3d.sync(v?.itemBoxes);
      boxes3d.animate(tNow);
      // aim chevrons ride ~5m ahead of me while a shot item is held
      {
        const showAim = !!(v?.you?.heldItem && SHOT_ITEMS.has(v.you.heldItem.id)) && !deathCamRef.current;
        aimGrp.visible = showAim;
        if (showAim) {
          const ax = me.x + Math.cos(me.heading) * 5.2;
          const az = me.z + Math.sin(me.heading) * 5.2;
          aimGrp.position.set(ax, (me.y || 0) + 0.12, az);
          aimGrp.rotation.y = -me.heading - Math.PI / 2;
          const pulse = 0.85 + Math.sin(tNow * 7) * 0.12;
          aimGrp.scale.setScalar(pulse);
        }
      }
      modeWorld.sync(v?.modeWorld, typeof v?.mode === "string" ? v.mode : v?.mode?.id);

      // ---- SAND ARTIST: continuous audio ----
      // Pouring water and the 5-second guess countdown are STATES, not events —
      // they need a sound that runs while they're happening.
      {
        const my = v?.you?.mode;
        const art = sndRef.current;
        // the trickle of water while the paint is toggled ON (server-authoritative)
        if (my?.isDrawer && my?.painting && tNowMs > (art.pourAt ?? 0)) {
          sfx.waterPour?.();
          art.pourAt = tNowMs + 110;
        }
        // the countdown tick while you're locking in a guess — accelerating, so
        // the last second is frantic
        const gp = my?.guessProgress ?? 0;
        if (gp > 0 && gp < 1) {
          const gap = 460 - gp * 340;          // 460ms → 120ms as it fills
          if (tNowMs > (art.tickAt ?? 0)) {
            sfx.guessTick?.();
            art.tickAt = tNowMs + gap;
          }
        } else {
          art.tickAt = 0;
        }
        // the ominous pulse while you're IT
        if (my?.amIt && tNowMs > (art.itAt ?? 0)) {
          sfx.itPulse?.();
          art.itAt = tNowMs + 700;
        }

        // THE BIRDS. While you're dazed they circle your head and chirp — the gag
        // only lands if you can hear them.
        const dazed = !!(v?.you?.crumbledUntil || v?.you?.stunned);
        if (dazed) {
          if (!art.wasDazed) {
            art.wasDazed = true;
            sfx.dazedThud?.();
          }
          if (tNowMs > (art.chirpAt ?? 0)) {
            sfx.birdChirp?.();
            art.chirpAt = tNowMs + 380 + Math.random() * 320;
          }
        } else {
          art.wasDazed = false;
        }
      }
      fx3d.syncEntities(v?.entities);
      fx3d.syncStatuses(meshes);
      if (fxQueue.current.length) { fx3d.onEvents(fxQueue.current, meshes); fxQueue.current = []; }
      fx3d.animate(tNow, dt);
      rings3d.sync(v?.you?.challenge);
      rings3d.animate(tNow);
      ribbon3d.sync(v?.you?.challenge, me);
      ribbon3d.animate(tNow);

      // ?dev_fx=takedown|death|threat|lapflag|finalflag — stages each feel
      // moment for screenshots and tuning without needing a real hit
      if (window.__devFx === undefined) {
        window.__devFx = new URLSearchParams(window.location.search).get("dev_fx") || null;
        window.__devFxFrames = 0;
      }
      // Fire the staged effect after N RENDERED FRAMES, not after a wall-clock
      // timeout. A background/throttled tab can starve a setTimeout for a long
      // time while the race sits at "STAND BY" — the effect then never appears
      // and QA reports it as broken. Frames are the honest precondition.
      if (window.__devFx && !window.__devFxFired) {
        window.__devFxFrames++;
        // 3 frames is enough: by then the scene is built, the car is seeded, and
        // the countdown is ticking. A higher bar (12) needed ~28s on a software
        // renderer at 0.5fps — the effect never fired inside a QA window, and it
        // looked like the FEATURE was broken when only the threshold was.
        if (window.__devFxFrames > 3) {
          window.__devFxFired = true;
          const fx = window.__devFx;
          if (fx === "takedown") { setTakedown({ text: "DOUBLE TAKEDOWN!", victim: "Sandy", until: Date.now() + 60000, n: 2 }); sfx.takedownJingle?.(); fx3d.sandsplosion?.(me.x + 6, me.z, me.y || 0, 8); }
          if (fx === "death") { setDeathCam({ x: me.x, z: me.z, y: me.y || 0, until: Date.now() + 60000, by: "Coral" }); fx3d.sandsplosion?.(me.x, me.z, me.y || 0, 60); }
          if (fx === "threat") setThreat(0.8);
          if (fx === "buried") setDeathCam({ x: me.x, z: me.z, y: me.y || 0, until: Date.now() + 60000, by: null, cause: "sand" });
          if (fx === "roulette") setRoulette({ itemId: "juicebox", tier: "gold", negative: false, startedAt: Date.now(), showing: null, landed: false });
          if (fx === "dud") setRoulette({ itemId: "kite", tier: "bronze", negative: true, startedAt: Date.now(), showing: null, landed: false });
          if (fx === "lapflag") setLapFlag({ final: false, text: "2 LAPS TO GO", until: Date.now() + 60000 });
          if (fx === "finalflag") setLapFlag({ final: true, text: "FINAL LAP!", until: Date.now() + 60000 });
        }
      }

      // dead: no inputs leave this client during the wreck window
      const deadNow = deathCamRef.current && Date.now() < deathCamRef.current.until;
      if (deadNow) { inp.throttle = 0; inp.steer = 0; }

      // ---- THREAT TELEGRAPH: anything hostile closing on me raises the alarm ----
      {
        let danger = 0;
        const ents = v?.entities || [];
        for (const en of ents) {
          if (!en || en.by === (v?.you?.id)) continue;
          if (en.kind !== "balloon" && en.kind !== "wave") continue;
          const dx = me.x - en.x, dz = me.z - en.z;
          const d = Math.hypot(dx, dz);
          const reach = (v?.you?.perks || []).includes("TIDE_READER") ? 57 : 38;   // perk: Tide Reader
          if (d > reach) continue;
          const vx = en.vx ?? Math.cos(en.heading || 0) * (en.speed || 0);
          const vz = en.vz ?? Math.sin(en.heading || 0) * (en.speed || 0);
          const closing = (vx * dx + vz * dz) / (d || 1);
          if (closing <= 1) continue;
          danger = Math.max(danger, Math.min(1, (1 - d / reach) * 0.6 + Math.min(1, closing / 22) * 0.4));
        }
        const tNowMs = performance.now();
        threatRef.current.last += (danger - threatRef.current.last) * Math.min(1, dt * 8);
        const lvl = threatRef.current.last;
        if (lvl > 0.12 && tNowMs > threatRef.current.tickAt) {
          sfx.threatTick?.(lvl);
          threatRef.current.tickAt = tNowMs + Math.max(90, 380 - lvl * 300);  // ticks accelerate as it closes
        }
        const shownNow = lvl > 0.1 ? lvl : 0;
        if (Math.abs(shownNow - threatRef.current.shown) > 0.04) {
          threatRef.current.shown = shownNow;
          setThreat(shownNow);
        }
      }

      // ---- PRE-RACE FLYTHROUGH ----------------------------------------------
      // While the grid is frozen, sweep a camera along the circuit so everyone
      // sees the track they are about to drive — and so slower machines get a
      // few seconds to finish streaming the world before anyone can move.
      // The last stretch settles behind your kart for the light sequence.
      {
        const fl = v?.startFreezeLeft ?? 0;
        const FLY_END = 3.8;                    // hand back to the chase cam here
        if (fl > FLY_END && !arenaDef) {
          const total = Math.max(0.001, (v?.startFreezeTotal ?? 11) - FLY_END);
          const raw = 1 - (fl - FLY_END) / total;         // 0 -> 1 across the flight

          // SMOOTHNESS.
          //
          // This used to hard-SET the camera to a new spline sample every frame,
          // with no interpolation of any kind — so on a machine that drops even a
          // few frames it juddered horribly, and the "sweep" was really a series
          // of teleports. Two fixes:
          //
          //   1. ease the parameter (smoothstep), so it accelerates in and decays
          //      out instead of running at a constant crank
          //   2. LERP the camera toward the target rather than snapping to it, so
          //      a dropped frame costs you a little smoothing, not a jolt
          //
          // It doesn't matter that you no longer see the whole lap. A smooth
          // partial flight is worth far more than a complete stuttering one.
          const k = raw * raw * (3 - 2 * raw);            // smoothstep
          const n = track.samples.length;

          // travel a chunk of the lap, high and wide, easing down toward the grid
          const idx = Math.floor(k * n * 0.55) % n;
          const s = track.at(idx);
          const look = track.at((idx + 30) % n);

          const lift = 22 - k * 13;                       // start high, descend
          const side = Math.sin(k * Math.PI) * 10;        // a lazy arc, not a wobble

          const tx = s.x + (-s.tz) * side;
          const ty = (s.y || 0) + lift;
          const tz = s.z + (s.tx) * side;

          if (!flyRef.current.seeded) {
            cam.position.set(tx, ty, tz);
            flyRef.current.seeded = true;
            flyRef.current.lx = look.x;
            flyRef.current.ly = (look.y || 0) + 1.2;
            flyRef.current.lz = look.z;
          } else {
            // lerp both the eye AND the look-at point — a snapping look-at is just
            // as jarring as a snapping position
            const kp = Math.min(1, dt * 3.2);
            cam.position.lerp(camTarget.set(tx, ty, tz), kp);
            flyRef.current.lx += (look.x - flyRef.current.lx) * kp;
            flyRef.current.ly += (((look.y || 0) + 1.2) - flyRef.current.ly) * kp;
            flyRef.current.lz += (look.z - flyRef.current.lz) * kp;
          }
          cam.lookAt(flyRef.current.lx, flyRef.current.ly, flyRef.current.lz);

          camSeededRef.current = false;                  // let the chase cam snap in after
          composer.render();
          raf = requestAnimationFrame(frame);            // KEEP THE LOOP ALIVE
          return;
        }
        flyRef.current.seeded = false;
      }

      // dev orbit camera (?dev_orbit=cx,cz,r,h): circles a point for visual QA
      if (window.__devOrbit === undefined) {
        const q = new URLSearchParams(window.location.search).get("dev_orbit");
        window.__devOrbit = q ? q.split(",").map(Number) : null;
      }
      if (window.__devOrbit) {
        const [ocx = 0, ocz = 0, orad = 120, oh = 60] = window.__devOrbit;
        const oa = tNow * 0.12;
        cam.position.set(ocx + Math.cos(oa) * orad, oh, ocz + Math.sin(oa) * orad);
        cam.lookAt(ocx, 6, ocz);
        composer.render();
        raf = requestAnimationFrame(frame);
        return;
      }
      // death cam: 4 seconds orbiting your own wreck — the price of a takedown
      const dc = deathCamRef.current;
      if (dc && Date.now() < dc.until) {
        const k = 1 - (dc.until - Date.now()) / 4000;
        const ang = -Math.PI / 2 + k * 1.5;
        const r = 9 - k * 2.5;
        cam.position.lerp(camTarget.set(dc.x + Math.cos(ang) * r, (dc.y || 0) + 4.2 - k * 1.4, dc.z + Math.sin(ang) * r), Math.min(1, dt * 5));
        cam.lookAt(dc.x, (dc.y || 0) + 0.9, dc.z);
        composer.render();
        raf = requestAnimationFrame(frame);
        return;
      }

      // ---- SPECTATOR CAMERA ----
      // Dead or eliminated: follow someone who's still playing. Cycle with SPACE.
      {
        const spectating = v?.you?.mode?.spectating || v?.you?.eliminated;
        if (spectating) {
          const living = (v?.players || []).filter((p) => !p.eliminated && !p.spectating && p.id !== v?.you?.id);
          if (living.length) {
            const target = living[specRef.current.idx % living.length];
            const rec = meshes.get(target.id);
            if (rec?.mesh) {
              const tx = rec.mesh.position.x, tz = rec.mesh.position.z, ty = rec.mesh.position.y;
              const h = target.heading ?? 0;
              const cx = tx - Math.cos(h) * 9;
              const cz = tz - Math.sin(h) * 9;
              cam.position.lerp(camTarget.set(cx, ty + 4.5, cz), Math.min(1, dt * 5));
              cam.lookAt(tx, ty + 1.0, tz);
              composer.render();
              raf = requestAnimationFrame(frame);
              return;
            }
          }
        }
      }

      // camera: chase (or full look-back while held)
      const flip = lookBackHeld() ? -1 : 1;
      const meY = me.y || 0;
      // CAMERA. It sat 7.2 units back and 3.3 up, which for a 2-unit kart put you
      // way out and high, staring DOWN at a toy on a beach. A kart racer wants you
      // low and close — right on the engine deck — so the kart fills the frame, you
      // feel the speed, and the road rushes at you instead of scrolling under you.
      // It also pulls back and rises slightly with speed, which is the oldest trick
      // there is for making fast feel fast.
      const spd01 = Math.min(1, Math.abs(me.speed) / 26);
      // TURBO is a camera event, not just a physics one. The server's status
      // flags ride on the view; the local `me` doesn't carry them.
      const boosted = !!(viewRef.current?.you?.turbo || viewRef.current?.you?.hypernova);
      const back = (3.9 + spd01 * 1.1 + (boosted ? 0.6 : 0)) * flip;

      // ---- THE CAMERA'S HEIGHT MUST BE SMOOTHED ----
      //
      // This was `2.1 + meY` — the camera's altitude bolted DIRECTLY to the car's.
      //
      // Two problems, and together they are the "ramp acting like stairs":
      //
      //   1. The server sends `y` ROUNDED TO TWO DECIMALS, twenty times a second.
      //      The camera inherited every one of those quantisation steps.
      //   2. On a 16% grade at race pace the car climbs 0.24m per tick — a real,
      //      correct number, but bolting the camera to it means the whole VIEW
      //      lurches upward in 24-centimetre jerks.
      //
      // The car is fine. The camera was the judder. Follow the height with a lag,
      // so the view rises like a camera on a crane rather than one nailed to the
      // roll bar.
      const cx = me.x - Math.cos(me.heading) * back;
      const cz = me.z - Math.sin(me.heading) * back;

      // ---- THE CAMERA MUST NOT GO UNDERGROUND ----
      //
      // The camera sits 4.9 units BEHIND the car. Its height was derived from the
      // CAR's altitude (`2.1 + me.y`, smoothed) — but the ground five metres behind
      // you on a slope is at a completely different height from the ground under
      // you. On a climb, the terrain behind is LOWER, so the camera floats. On a
      // descent it's HIGHER, so the camera goes straight INTO THE HILL.
      //
      // That's the screenshot: the terrain plane cutting across the middle of the
      // screen with sky visible underneath it. The camera was buried in the sand.
      //
      // Sample the ground AT THE CAMERA'S OWN POSITION, and never let the camera sit
      // below it. The smoothing is on the FINAL height, so the view still rides like
      // a camera on a crane and not one bolted to the roll bar.
      const camGround = (() => {
        if (!track?.samples) return 0;
        const ci = track.nearest(cx, cz, me.sampleHint ?? -1, 0);
        const cs = track.samples[ci];
        if (!cs) return 0;
        const lat = Math.abs(track.lateral(cx, cz, ci));
        const roadY = cs.y || 0;
        if (lat <= track.width / 2) return roadY;         // on the road

        // out on the embankment: the SAME smoothstep the terrain is built with
        const SKIRT_START = track.width / 2 + 1.2;
        const SKIRT_LEN = 34;
        const f = Math.max(0, Math.min(1, (lat - SKIRT_START) / SKIRT_LEN));
        const ease = f * f * (3 - 2 * f);
        return roadY * (1 - ease) - 0.05;
      })();

      // the camera wants to be this high above the ground beneath IT
      const wantY = Math.max(me.y || 0, camGround) + 1.55 + spd01 * 0.30;
      camYRef.current += (wantY - camYRef.current) * Math.min(1, dt * 8);
      // …and it may never dip below the ground, however hard it's lagging
      const up = Math.max(camYRef.current, camGround + 0.9);
      // First frame: SNAP the camera behind the car. Lerping from the world
      // origin means a long swoop-in at race start (and on slow machines the
      // camera can spend seconds looking at empty beach).
      if (!camSeededRef.current && me.seeded) {
        camYRef.current = up;             // seed at the FINAL height, or it lerps up from zero
        cam.position.set(cx, up, cz);
        camSeededRef.current = true;
      }
      cam.position.lerp(camTarget.set(cx, up, cz), Math.min(1, dt * 7));
      // ---- HAZARD FEEDBACK ----
      // A hazard you don't feel is a hazard you'll blame on lag. Each one has its
      // own voice and its own camera behaviour.
      {
        const hz = me.inHazard;
        const hs = sndRef.current;
        if (hz && hz !== hs.lastHazard) {
          hs.lastHazard = hz;
          if (hz === "oil") { sfx.oilSlick?.(); setToast({ kind: "hazard", text: "OIL SLICK — NO GRIP!", until: Date.now() + 1400 }); }
          if (hz === "quicksand") { sfx.quicksand?.(); setToast({ kind: "hazard", text: "SOFT SAND", until: Date.now() + 1200 }); }
          if (hz === "crab") { sfx.crabHit?.(); shakeRef.current = Math.max(shakeRef.current, 0.5); }
          if (hz === "rockfall") { sfx.rockHit?.(); shakeRef.current = Math.max(shakeRef.current, 0.7); }
          if (hz === "wave") { sfx.waveWash?.(); shakeRef.current = Math.max(shakeRef.current, 0.8); }
          if (hz === "lava") { sfx.lavaBurn?.(); setToast({ kind: "hazard", text: "LAVA — GET OUT!", until: Date.now() + 1600 }); shakeRef.current = Math.max(shakeRef.current, 0.9); }
          if (hz === "ash") { sfx.ashCloud?.(); setToast({ kind: "hazard", text: "ASH CLOUD", until: Date.now() + 1400 }); }
        } else if (!hz) {
          hs.lastHazard = null;
        }
        // on oil the camera SWIMS — you can feel the grip go before you see it
        if (hz === "oil") {
          cam.position.x += Math.sin(tNow * 2.2) * 0.18;
          cam.position.z += Math.cos(tNow * 1.8) * 0.18;
        }
      }

      // ---- RIDING THE KERB ----
      // A fast, small judder, plus an actual rumble SOUND. The sim has always
      // known you were on the kerb (`onCurb`) and never once told you — the value
      // wasn't even sent to the client. If you can't feel the edge, the racing
      // line isn't a decision, it's a guess.
      if (me.onCurb && Math.abs(me.speed) > 6) {
        const r = 0.06 * Math.min(1, Math.abs(me.speed) / 20);
        cam.position.y += Math.sin(tNow * 62) * r;
        cam.position.x += Math.sin(tNow * 51) * r * 0.5;
        const snd = sndRef.current;
        if (tNowMs > (snd.curbAt ?? 0)) {
          sfx.curbRumble?.();
          snd.curbAt = tNowMs + 90;
        }
      }
      if (shakeRef.current > 0.01) {
        const s = shakeRef.current;
        cam.position.x += (Math.random() - 0.5) * s * 0.7;
        cam.position.y += (Math.random() - 0.5) * s * 0.5;
        cam.position.z += (Math.random() - 0.5) * s * 0.7;
        shakeRef.current *= Math.max(0, 1 - dt * 3.2);
      }
      // TURBO RUMBLE. A fine, constant vibration for as long as the boost burns
      // — the frame itself is straining. Small enough never to cost you aim.
      if (boosted) {
        cam.position.x += (Math.random() - 0.5) * 0.05;
        cam.position.y += (Math.random() - 0.5) * 0.035;
      }
      // aim a little way down the road and slightly LOW — looking at the horizon
      // makes the track feel flat and far away
      // Look at a point on the ROAD ahead — at the CAR's height, not the camera's.
      // (The camera's height now includes its own ground clearance, so using it here
      // would aim the view at the sky on every climb.)
      cam.lookAt(
        me.x + Math.cos(me.heading) * 7.2 * flip,
        (me.y || 0) + 0.78,
        me.z + Math.sin(me.heading) * 7.2 * flip
      );
      // ---- HORIZONTAL TILT ----
      // The camera BANKS into the corner with the kart: a few degrees of roll
      // tied to steer × speed. lookAt() zeroes the roll every frame, so the
      // bank is re-applied on top of it, smoothed, every frame. This is the
      // single biggest "cinematic racer" ingredient — the horizon leans, the
      // corner feels like a corner and not a rotation.
      const wantTilt = -(inp?.steer || 0) * (0.5 + spd01 * 0.5) * 0.085 * flip;
      tiltRef.current += (wantTilt - tiltRef.current) * Math.min(1, dt * 6);
      cam.rotateZ(tiltRef.current);
      // FOV: speed widens it a touch; a TURBO slams it open and the whole world
      // stretches — the loudest "you are going fast" cue there is. It snaps
      // open fast and relaxes slow, so it reads as a KICK, not a zoom.
      const wantFov = 58 + spd01 * 9 + (boosted ? 13 : 0);
      if (Math.abs(cam.fov - wantFov) > 0.05) {
        cam.fov += (wantFov - cam.fov) * Math.min(1, dt * (wantFov > cam.fov ? 9 : 3.5));
        cam.updateProjectionMatrix();
      }
      // ---- SPEED LINES ----
      // The anime wind tunnel: radial streaks bleeding in from the frame's edge,
      // driven imperatively at render rate (React state at 5Hz would strobe).
      if (speedlinesRef.current) {
        const k = Math.max(0, (spd01 - 0.62) / 0.38);
        const o = Math.min(1, k * 0.26 + (boosted ? 0.38 : 0));   // restrained for the realistic grade
        speedlinesRef.current.style.opacity = o.toFixed(2);
      }
      mirrorCam.position.set(me.x, 2.1 + meY, me.z);
      mirrorCam.lookAt(me.x - Math.cos(me.heading) * 10, 1.5 + meY, me.z - Math.sin(me.heading) * 10);

      // render main + mirror inset
      const W = mount.clientWidth, H = mount.clientHeight;
      renderer.setScissorTest(false);
      renderer.setViewport(0, 0, W, H);
      // the engine note follows your speed AND the gas — flooring it is audible
      // even before the kart has built any speed
      sfx.updateEngine?.(Math.abs(me.speed) / 26, !!me.airborne, inp?.throttle || 0);

      // keep the shadow box under the player, or you lose your shadow the moment
      // you drive away from the middle of the map
      updateSunShadow(scene, me.x, me.z);
      composer.render();
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
        // pushFeed comes from component scope now — one ticker, one door
        const sticky = toastRef.current && ["final", "kited"].includes(toastRef.current.kind) && Date.now() < toastRef.current.until;
        const say = (t) => { if (!sticky) setToast(t); };
        for (const ev of q.splice(0)) {
          fxQueue.current.push(ev);   // 3D layer gets every event too
          const mine = ev.playerId === myId;
          if (ev.type === "challenge_start") { say({ kind: "start", text: ev.challengeType === "rings" ? "THREAD THE RINGS!" : "HOLD THE LANE!", until: Date.now() + 2200 }); sfx.challenge?.(); }
          else if (ev.type === "challenge_end") { say({ kind: "tier", tier: ev.tier, text: `${ev.tier.toUpperCase()} TIER!`, until: Date.now() + 2600 }); sfx.tier?.(ev.tier); }
          else if (ev.type === "item_used") {
            // EVERY item has its own voice. The engine is authoritative about
            // what was fired; the client is authoritative about how it FEELS.
            const FIRE_SFX = {
              juicebox: sfx.turbo, fizzpop: sfx.fizzpop, rocketfloat: sfx.rocketFloat,
              bucket: sfx.shieldUp,
              waterbomb: sfx.waterbombThrow, sandclod: sfx.sandclodThrow,
              puddle: sfx.puddleDrop, sprinkler: sfx.puddleDrop,
              waterballoon3: sfx.clusterThrow, supersoak: sfx.soakerBlast,
              icepop: sfx.icepopFreeze,
              hydrobomb: sfx.hydroLaunch, geyser: sfx.geyserArm, monsoon: sfx.monsoonRoll,
            };
            if (mine) {
              (FIRE_SFX[ev.itemId] || sfx.itemAway)?.();
              say({ kind: "used", text: `${(ITEM_LABELS[ev.itemId] || "ITEM").toUpperCase()} AWAY!`, until: Date.now() + 1400 });
            } else if (["supersoak", "monsoon", "hydrobomb"].includes(ev.itemId)) {
              (FIRE_SFX[ev.itemId])?.();     // the loud ones are audible to everyone
            }
          }
          // ---- THE ULTIMATES: an anime name-card, and the sky falls in ----
          else if (ev.type === "ultimate") {
            const meRec = meshes.get(v?.you?.id);
            const ax = meRec?.mesh?.position?.x ?? 0, az = meRec?.mesh?.position?.z ?? 0, ay = meRec?.mesh?.position?.y ?? 0;
            const ULT = {
              tsunami:      { name: "TSUNAMI",        fx: "fxTsunami",  sfx: sfx.tsunamiRoar,  color: "#59b7e8" },
              krakenwave:   { name: "KRAKEN'S GRASP", fx: "fxKraken",   sfx: sfx.krakenGrasp,  color: "#ff5fa2" },
              meteorsplash: { name: "METEOR SPLASH",  fx: "fxMeteor",   sfx: sfx.meteorScream, color: "#ffb020" },
              hypernova:    { name: "HYPERNOVA",      fx: "fxHypernova",sfx: sfx.hypernova,    color: "#b5f2ff" },
            }[ev.itemId];
            if (ULT) {
              sfx.ultimateCharge?.();                       // the wind-up
              setTimeout(() => ULT.sfx?.(), 260);           // then the payoff
              // the fx go off around whoever fired it
              const src = meshes.get(ev.playerId);
              const sx = src?.mesh?.position?.x ?? ax, sz = src?.mesh?.position?.z ?? az, sy = src?.mesh?.position?.y ?? ay;
              setTimeout(() => fx3d[ULT.fx]?.(sx, sz, sy), 260);
              // EVERYONE sees the name-card. An anime ultimate announces itself
              // to the whole field — that's the point of the beat. The caster
              // gets "you" framing and the full shake; everyone else gets the
              // name and the attacker, so they know exactly what's coming.
              setUltimate({
                name: ULT.name,
                color: ULT.color,
                by: mine ? null : nameOf(ev.playerId),
                until: Date.now() + 2400,
              });
              shakeRef.current = mine ? 1.4 : Math.max(shakeRef.current, 0.9);
              pushFeed(`⚡ ${nameOf(ev.playerId)} unleashed ${ULT.name}!`);
            }
          }
          else if (ev.type === "geyser_blow") {
            fx3d.fxGeyser?.(ev.x, ev.z, 0);
            sfx.geyserBlow?.();
            if (mine) shakeRef.current = Math.max(shakeRef.current, 0.9);
          }
          else if (ev.type === "meteor_impact") {
            fx3d.fxMeteor?.(ev.x, ev.z, 0, ev.r || 6);
            if (mine) shakeRef.current = Math.max(shakeRef.current, 1.0);
          }
          else if (ev.type === "ball_bounce") sfx.ballBounce?.();

          // ---- THE MODES ----
          else if (ev.type === "wrecker_hit") {
            sfx.wreckerHit?.();
            fx3d.fxSandclod?.(ev.x, ev.z, 0);
            if (mine) shakeRef.current = Math.max(shakeRef.current, 0.9);
          }
          else if (ev.type === "life_lost") {
            if (mine) { sfx.lifeLost?.(); say({ kind: "life", text: `${ev.lives} LIVES LEFT`, until: Date.now() + 1800 }); }
          }
          else if (ev.type === "eliminated") {
            sfx.eliminated?.();
            if (mine) say({ kind: "out", text: "ELIMINATED", until: Date.now() + 3000 });
            else pushFeed(`💀 ${nameOf(ev.playerId)} is out`);
          }
          else if (ev.type === "flag_taken") {
            sfx.flagTaken?.();
            pushFeed(`🚩 ${nameOf(ev.playerId)} took the flag!`);
            if (mine) say({ kind: "flag", text: "YOU HAVE THE FLAG!", until: Date.now() + 2000 });
          }
          else if (ev.type === "flag_captured") {
            sfx.flagCaptured?.();
            pushFeed(`🏆 ${nameOf(ev.playerId)} CAPTURED! ${ev.score}/3`);
            if (mine) shakeRef.current = Math.max(shakeRef.current, 0.6);
          }
          else if (ev.type === "flag_dropped") sfx.flagDropped?.();
          else if (ev.type === "flag_returned") {
            sfx.flagReturned?.();
            pushFeed("🛡 flag returned");
          }
          else if (ev.type === "round_start") {
            sfx.roundStart?.();
            const isMe = ev.drawer === v?.you?.id;
            say({ kind: "round", text: isMe ? "YOU'RE DRAWING!" : `${nameOf(ev.drawer)} IS DRAWING`, until: Date.now() + 2600 });
          }
          else if (ev.type === "guess_correct") {
            sfx.guessCorrect?.();
            pushFeed(`✅ ${nameOf(ev.playerId)} got it — "${ev.word}" (+${ev.points})`);
            if (mine) say({ kind: "right", text: `CORRECT! +${ev.points}`, until: Date.now() + 2600 });
          }
          else if (ev.type === "guess_wrong") {
            sfx.guessWrong?.();
            if (mine) say({ kind: "wrong", text: `WRONG — "${ev.guessed}"`, until: Date.now() + 2600 });
            else pushFeed(`❌ ${nameOf(ev.playerId)} guessed wrong`);
          }
          else if (ev.type === "round_end") {
            if (!ev.winner) pushFeed(`⏱ nobody got it — it was "${ev.word}"`);
          }
          else if (ev.type === "tagged") {
            sfx.tagged?.();
            if (mine) { say({ kind: "it", text: "YOU'RE IT!", until: Date.now() + 2400 }); shakeRef.current = Math.max(shakeRef.current, 0.7); }
            else if (ev.by === v?.you?.id) sfx.tagPassed?.();
            pushFeed(`👋 ${nameOf(ev.by)} tagged ${nameOf(ev.playerId)}`);
          }
          else if (ev.type === "pearl_taken") {
            if (mine) sfx.pearlGrab?.();
          }
          else if (ev.type === "pearls_spilled") {
            sfx.pearlSpill?.();
            if (mine) say({ kind: "spill", text: `DROPPED ${ev.dropped} PEARLS!`, until: Date.now() + 2000 });
            else pushFeed(`🦪 ${nameOf(ev.playerId)} spilled ${ev.dropped}`);
          }
          else if (ev.type === "arena_pickup") {
            if (mine) { sfx.pop?.(); say({ kind: "item", text: "ITEM GET!", until: Date.now() + 1200 }); }
          }
          else if (ev.type === "pit_grab") {
            if (mine && (!sndRef.current.lastPitWarn || Date.now() - sndRef.current.lastPitWarn > 1000)) {
              sndRef.current.lastPitWarn = Date.now();
              (sfx.quicksand || sfx.splash)?.();
            }
          }
          else if (ev.type === "pit_eject") {
            if (mine) { pushFeed("🕳️ THE PIT SPAT YOU OUT"); sfx.respawnPop?.(); }
            const vv = meshes.get(ev.playerId);
            if (vv?.mesh) fx3d.sandsplosion?.(ev.x, ev.z, 0, 2.4);
          }
          else if (ev.type === "match_over") {
            if (ev.reason === "draw" || ev.draw) { pushFeed(`🤝 TIME! No winner — it's a draw.`); say({ kind: "draw", text: "DRAW — TIME'S UP", until: Date.now() + 3200 }); }
            else if (ev.reason === "last_standing") pushFeed(`👑 ${nameOf(ev.winner)} is the last kart rolling!`);
          }
          else if (ev.type === "kited") { say({ kind: "kited", text: "KITED! MASH SPACE!", until: Date.now() + 2600 }); sfx.kiteLatch?.(); }
          else if (ev.type === "kite_break") { say({ kind: "free", text: "BROKE FREE!", until: Date.now() + 1200 }); sfx.kiteBreak?.(); }
          else if (ev.type === "crumble") {
            const victim = meshes.get(ev.playerId);
            const vx = victim?.mesh?.position?.x ?? 0, vz = victim?.mesh?.position?.z ?? 0, vy = victim?.mesh?.position?.y ?? 0;
            fx3d.sandsplosion?.(vx, vz, vy, ev.cause === "sand" ? 2.0 : 4.0);
            if (victim?.mesh) victim.mesh.visible = false;   // the pile IS the kart now
            setTimeout(() => { if (victim?.mesh) victim.mesh.visible = true; }, ev.cause === "sand" ? 2200 : 4200);
            if (mine) {
              // Buried in the sand is your own doing — shorter, and it says so.
              const sand = ev.cause === "sand";
              sfx.crumbleBoom?.();
              setDeathCam({
                x: vx, z: vz, y: vy,
                until: Date.now() + (sand ? 2000 : 4000),
                by: ev.by ? nameOf(ev.by) : null,
                cause: ev.cause || "hit",
              });
              shakeRef.current = sand ? 0.6 : 1.0;
            } else if (ev.by === myId) {
              // THE KILL: impact → reward inside 300ms → streak escalation
              sfx.takedownJingle?.();
              const now = Date.now();
              const streak = (takedownRef.current.until > now) ? takedownRef.current.n + 1 : 1;
              takedownRef.current = { n: streak, until: now + 9000 };
              const label = streak >= 3 ? "RAMPAGE!!" : streak === 2 ? "DOUBLE TAKEDOWN!" : "TAKEDOWN!";
              setTakedown({ text: label, victim: nameOf(ev.playerId), until: now + 2400, n: streak });
              shakeRef.current = Math.max(shakeRef.current, 0.35);
            } else {
              sfx.crumble?.();
            }
            pushFeed(ev.by ? `💥 ${nameOf(ev.by)} WIPED OUT ${nameOf(ev.playerId)}!` : `💥 ${nameOf(ev.playerId)} crumbled!`);
          }
          else if (ev.type === "respawn" && mine) { sfx.respawnPop?.(); setDeathCam(null); }
          else if (ev.type === "challenge_end" && mine) {
            setRoulette({ itemId: ev.itemId, tier: ev.tier, negative: !!ev.negative, startedAt: Date.now(), showing: null, landed: false });
            if (ev.negative) setTimeout(() => say({ kind: "dud", text: "🪁 DUD! THE KITE'S GOT YOU!", until: Date.now() + 1900 }), 1400);
          }
          else if (ev.type === "shield_block") { say({ kind: "block", text: "BUCKET BLOCK!", until: Date.now() + 1400 }); sfx.block?.(); }
          else if (ev.type === "rescue") { if (mine) { say({ kind: "rescue", text: "🛟 RESCUED — BACK ON TRACK", until: Date.now() + 1800 }); sfx.reset?.(); } }
          else if (ev.type === "splash") {
            const vic = meshes.get(ev.playerId);
            if (vic?.mesh) { vic.squash = 1; fx3d.burst?.(vic.mesh.position.x, vic.mesh.position.z, 0x59b7e8, 12, 0xbfe6f7, vic.mesh.position.y); }
            if (mine) { sfx.impactThud?.(); shakeRef.current = Math.max(shakeRef.current, 0.5); }
            else sfx.splash?.();
            pushFeed(`💦 ${nameOf(ev.by)} soaked ${nameOf(ev.playerId)}!`);
          }
          else if (ev.type === "balloon_pop") {
            const R = ev.r || 1.6;
            if (ev.blind) { fx3d.fxSandclod?.(ev.x, ev.z, 0); sfx.sandclodHit?.(); }
            else if (ev.heavy) { fx3d.fxHeavyBomb?.(ev.x, ev.z, 0, R); sfx.hydroBoom?.(); }
            else if (R > 3) { fx3d.fxSplash?.(ev.x, ev.z, 0, true); sfx.waterbombPop?.(); }
            else { fx3d.fxSplash?.(ev.x, ev.z, 0, false); sfx.pop?.(); }
          }
          else if (ev.type === "lap" && mine) {
            // ev.lap = laps COMPLETED. The engine finishes you the moment that
            // reaches `total`, so ev.lap === total is the checkered flag, and
            // the FINAL LAP begins one lap earlier. Getting this off by one
            // means the banner either never fires or fires after the race.
            const total = v?.laps || v?.map?.laps || 3;
            const remaining = total - ev.lap;              // laps still to drive
            if (remaining === 1) { sfx.finalFanfare?.(); setLapFlag({ final: true, text: "FINAL LAP!", until: Date.now() + 2600 }); }
            else if (remaining > 1) { sfx.lapFlag?.(); setLapFlag({ final: false, text: `${remaining} LAPS TO GO`, until: Date.now() + 2000 }); }
            // remaining <= 0 → that was the checkered flag, not a lap banner
          }
        }
      }
      // Wrong-way detection, frame-rate independent: sampled once per SERVER
      // tick (20Hz), we compare the car's actual MOTION VECTOR over the last
      // ~0.4s against the local track tangent (full nearest scan — the hinted
      // one jitters in reverse; server progress is forward-clamped and can't
      // signal reverse at all). A 1s majority vote + hysteresis rides out both
      // low headless framerates and noisy segment picks off the ribbon.
      // Wrong-way only makes sense on a lap circuit. Arenas (derby, CTF, tag,
      // pearl, artist) have no forward direction, so never run the check there —
      // and clear it if it was somehow on.
      const isArena = !!v?.arena;
      if (isArena) {
        if (wrongRef.current.on) { wrongRef.current.on = false; wrongRef.current.chimed = false; setWrongWay(false); }
      } else if (v && tNow - (wrongRef.current.lastSampleT || 0) > 0.05) {
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
        // Turn-on needed neg >= 10, but a car driving the wrong way usually
        // STOPS moving (wall, rescue, reversing slowly) — and a still car votes
        // 0 (abstain), not -1. So the count plateaued at 9 and the warning
        // could never fire. Require a decided majority of the votes actually
        // cast, not an absolute count that stalled sub-threshold.
        const cast = neg + pos;
        const on = w.on ? neg > 3 : (neg >= 6 && neg >= pos * 3 && cast >= 6);
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
      // QA: scene tap. Harmless (a plain object, like __gpState) and it is how
      // visual regressions get CAUGHT — draw-call/triangle counts prove the
      // world actually rendered instead of trusting a screenshot that lies.
      window.__scene = scene; window.__cam = cam; window.__renderer = renderer;
      window.__track = track;   // QA: so tests can sample the ground beneath the camera
      // QA hook. `heading` and `offTrack` are here so the playability tests can wait
      // for a clean straight before measuring the kart's orientation — mid-corner or
      // mid-slide the nose is legitimately off the velocity vector, and a test that
      // samples then is measuring a drift, not a broken mesh.
      window.__race = {
        devAuto, seeded: me.seeded, locked: !!lockRef.current, inp,
        speed: me.speed, x: me.x, y: me.y, z: me.z, heading: me.heading,
        offTrack: !!me.offTrack, airborne: !!me.airborne,
        freeze: v?.startFreezeLeft ?? -1, phase: v?.phase,
      };
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    return () => {
      sfx.stopEngine?.();
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
      {/* ---- SPEED LINES ---- the anime wind tunnel. Radial streaks masked to
          the frame's edge plus a pink/cyan chroma vignette; opacity is written
          straight to the node from the render loop (React at 5Hz would strobe). */}
      <div ref={speedlinesRef} className="speedlines" style={{ opacity: 0 }} />
      {/* ---- ESC MENU ---- */}
      {paused && (
        <div data-qa="pause-menu" style={{
          position: "absolute", inset: 0, zIndex: 90,
          background: "rgba(6,20,26,0.72)", backdropFilter: "blur(4px)",
          display: "grid", placeItems: "center",
        }}>
          <div className="leather-panel" style={{
            width: "min(380px, 90%)", padding: 26, borderRadius: 16,
            border: "2px solid var(--line)", textAlign: "center",
          }}>
            <div className="display" style={{ fontSize: 32, color: "#fff", marginBottom: 4 }}>PAUSED</div>
            <div className="dim" style={{ fontSize: 12, marginBottom: 20 }}>
              The race keeps going — it's multiplayer. Your kart is coasting.
            </div>

            <button className="btn" style={{ width: "100%", marginBottom: 10 }}
              onClick={() => setPaused(false)}>
              RESUME
            </button>

            <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
              <button className="btn btn-ghost" style={{ flex: 1 }}
                onClick={() => { sfx.setMuted?.(!sfx.isMuted?.()); setPauseNonce((n) => n + 1); }}>
                {sfx.isMuted?.() ? "🔇 SOUND OFF" : "🔊 SOUND ON"}
              </button>
              <button className="btn btn-ghost" style={{ flex: 1 }}
                onClick={() => { conn?.raceReset(roomId); setPaused(false); }}>
                🪣 RESET KART
              </button>
            </div>

            {/* FULL OPTIONS — audio sliders, graphics, accessibility, controls —
                the same settings as the main menu, opened in-match. */}
            <button className="btn" style={{ width: "100%", marginBottom: 10 }}
              onClick={() => setShowOptions(true)}>
              ⚙ OPTIONS
            </button>

            <div className="dim" style={{ fontSize: 11, textAlign: "left", lineHeight: 1.7, margin: "14px 0", padding: "10px 12px", background: "rgba(0,0,0,0.25)", borderRadius: 8 }}>
              <b style={{ color: "var(--paper)" }}>CONTROLS</b><br />
              W / ↑ — accelerate · S / ↓ — brake &amp; reverse<br />
              A D / ← → — steer<br />
              SPACE — use item · SHIFT — look back<br />
              R — shovel reset · ESC — this menu
            </div>

            {/* SURRENDER. It has to be an explicit, deliberate thing — you don't
                want a mis-click ending someone's race. */}
            {!confirmQuit ? (
              <button className="btn" style={{ width: "100%", background: "var(--hot)" }}
                onClick={() => setConfirmQuit(true)}>
                🏳️ SURRENDER
              </button>
            ) : (
              <div>
                <div style={{ fontSize: 12, color: "var(--hot)", fontWeight: 800, marginBottom: 8 }}>
                  Give up this race? You'll keep whatever you've earned so far.
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => setConfirmQuit(false)}>
                    KEEP RACING
                  </button>
                  <button className="btn" style={{ flex: 1, background: "var(--hot)" }} onClick={() => onLeave?.()}>
                    SURRENDER
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {showOptions && (
        <div data-qa="ingame-options" style={{ position: "absolute", inset: 0, zIndex: 95, background: "var(--ink, #0c151d)" }}>
          <div style={{ position: "absolute", inset: 0, overflowY: "auto" }}>
            <Settings inMatch />
          </div>
          <button className="btn btn-hot" style={{ position: "absolute", top: 16, right: 16, zIndex: 96, padding: "10px 18px", fontWeight: 900 }}
            onClick={() => setShowOptions(false)}>
            ✕ CLOSE OPTIONS
          </button>
        </div>
      )}

      {showHelp && (
        <HowToPlay
          modeId={typeof view?.mode === "string" ? view.mode : view?.mode?.id}
          onClose={() => { helpManualRef.current = true; setShowHelp(false); }}
        />
      )}

      <RaceHud hud={hud} toast={toast} onLeave={onLeave}
        posFlash={posFlash} wrongWay={wrongWay} roulette={roulette}
        miniRef={miniRef} lapClock={lapClock} feed={feed}
        threat={threat} deathCam={deathCam} takedown={takedown} lapFlag={lapFlag}
        ultimate={ultimate} blinded={!!hud.blinded}
        modeId={typeof view?.mode === "string" ? view.mode : view?.mode?.id}
        modeYou={view?.you?.mode} modeWorld={view?.modeWorld}
        players={view?.players || []}
        freezeLeft={view?.startFreezeLeft ?? 0} />
    </div>
  );
}

function ordinal(n) { return `${n}${["st", "nd", "rd"][n - 1] || "th"}`; }

// ---- HOW TO PLAY (Tab) ----
// Per-mode rules + the universal controls. Shows itself before the lights and
// toggles on Tab. Kept short — a card you scan, not a manual.
const HOWTO = {
  race:    { title: "Grand Prix", goal: "Finish the most laps first.", rules: ["Grab item boxes and fire with SPACE.", "Cut nobody off the road — the sand is slow.", "3 laps. First across the line wins."] },
  timeattack: { title: "Time Attack", goal: "Set the fastest lap. Solo.", rules: ["No items, no rivals — just you and the clock.", "Your best lap goes on the weekly board.", "Top 3% at week's end get paid."] },
  derby:   { title: "Demolition Derby", goal: "Be the last kart rolling.", rules: ["Ram rivals to erode them — SPACE fires items.", "Wrecker bots hunt everyone, including you.", "Stay off the hazards; they chew you up."] },
  ctf:     { title: "Capture the Flag", goal: "Grab the enemy flag, bring it home.", rules: ["The arrow points to your target (flag / home).", "Walls block sight — use them to sneak.", "First team to 3 captures wins."] },
  artist:  { title: "Sand Artist", goal: "Draw the word — or guess it.", rules: ["Drawer: TAP SPACE to start pouring water, tap again to stop.", "1–5 stamp shapes. Stay inside the rope.", "Guessers: drive to the hallway you believe and hold."] },
  tag:     { title: "Riptide Tag", goal: "Don't be IT when the horn blows.", rules: ["Touch someone to pass IT to them.", "IT glows — everyone can see who's got it.", "Whoever's IT at the horn is out."] },
  pearl:   { title: "Pearl Rush", goal: "Collect the most pearls.", rules: ["Scoop pearls off the arena floor.", "Get hit and you SPILL some — grab them back.", "Most pearls when the timer ends wins."] },
};

function HowToPlay({ modeId, onClose }) {
  const info = HOWTO[modeId] || HOWTO.race;
  return (
    <div onClick={onClose} style={{
      position: "absolute", inset: 0, zIndex: 60, display: "grid",
      placeItems: "end center", paddingBottom: "clamp(10px, 3vh, 5vh)",
      background: "rgba(6,10,16,0.55)", cursor: "pointer",
    }}>
      {/* smaller + parked low: the intro's map/mode banner owns the top of the
          screen now — the two were stacking on top of each other */}
      {/* FITS WITHOUT SCROLLING. Every size in here is clamp()ed against the
          viewport, so the card shrinks with the window instead of growing a
          scrollbar. overflowY:auto stays only as the last-resort valve for
          truly tiny windows — on anything normal the whole card is visible. */}
      <div onClick={(e) => e.stopPropagation()} style={{
        width: "min(480px, 88vw)", maxHeight: "82vh", overflowY: "auto",
        fontSize: "clamp(10px, 1.55vh, 13px)",
        background: "linear-gradient(180deg, #14202b, #0c151d)",
        border: "3px solid var(--volt, #2fe6c8)", borderRadius: 16,
        padding: "clamp(12px, 2.4vh, 24px) clamp(16px, 2.6vw, 30px)",
        boxShadow: "0 24px 80px rgba(0,0,0,0.6)", cursor: "default", textAlign: "left",
      }}>
        <div className="impactf" style={{ fontSize: "clamp(9px, 1.35vh, 12px)", letterSpacing: "0.18em", color: "var(--volt, #2fe6c8)" }}>HOW TO PLAY</div>
        <div className="display" style={{ fontSize: "clamp(22px, 4.6vh, 38px)", color: "#fff", lineHeight: 1, margin: "2px 0 4px" }}>{info.title}</div>
        <div style={{ fontSize: "clamp(12px, 1.9vh, 16px)", fontWeight: 800, color: "#ffd479", marginBottom: "clamp(6px, 1.4vh, 12px)" }}>{info.goal}</div>
        <ul style={{ margin: "0 0 clamp(8px, 1.8vh, 16px)", padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: "clamp(3px, 0.8vh, 7px)" }}>
          {info.rules.map((r, i) => (
            <li key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start", color: "#dfe9f0", fontSize: "clamp(11px, 1.7vh, 14px)", lineHeight: 1.35 }}>
              <span style={{ color: "var(--volt, #2fe6c8)", fontWeight: 900 }}>›</span>
              <span>{r}</span>
            </li>
          ))}
        </ul>
        <div style={{ borderTop: "1px solid rgba(255,255,255,0.12)", paddingTop: "clamp(7px, 1.4vh, 12px)" }}>
          <div className="impactf" style={{ fontSize: "clamp(9px, 1.25vh, 11px)", letterSpacing: "0.14em", color: "var(--dim, #8aa)", marginBottom: "clamp(4px, 0.9vh, 8px)" }}>CONTROLS</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "clamp(3px, 0.7vh, 6px) 18px", fontSize: "clamp(10px, 1.55vh, 13px)", color: "#cdd8e0" }}>
            <span><b style={{ color: "#fff" }}>WASD / Arrows</b> — drive</span>
            <span><b style={{ color: "#fff" }}>SPACE</b> — {modeId === "artist" ? "toggle paint" : "use item"}</span>
            <span><b style={{ color: "#fff" }}>SHIFT</b> — look back</span>
            <span><b style={{ color: "#fff" }}>R</b> — shovel reset</span>
            <span><b style={{ color: "#fff" }}>TAB</b> — this screen</span>
            <span><b style={{ color: "#fff" }}>ESC</b> — menu</span>
          </div>
        </div>
        <button onClick={onClose} className="btn btn-hot" style={{ marginTop: "clamp(10px, 2vh, 18px)", width: "100%", padding: "clamp(8px, 1.5vh, 12px)", fontSize: "clamp(12px, 1.8vh, 15px)", fontWeight: 900 }}>
          GOT IT — TAB TO REOPEN
        </button>
      </div>
    </div>
  );
}
// M:SS for the match countdown; bare seconds under a minute so the last stretch
// reads big and urgent.
function fmtClock(sec) {
  const s = Math.max(0, Math.ceil(sec));
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

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
  ctx.lineJoin = ctx.lineCap = "round";

  // ---- ARENA MINIMAP ----
  // An arena has no ribbon to trace. It has a rim, walls, and whatever the mode
  // puts on the field — and for CTF the flags MUST always be on it. A capture
  // mode where you have to go hunting for the objective is just a maze.
  if (mm.arena) {
    const a = mm.arena;
    // the bowl
    ctx.beginPath();
    ctx.arc(sx(0.5), sy(0.5), (W - PAD * 2) / 2, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,243,221,0.35)";
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = "rgba(90,70,50,0.65)";
    ctx.stroke();

    // the walls, so you can read the cover
    ctx.fillStyle = "rgba(90,70,50,0.55)";
    for (const w of a.walls) {
      const [x0, z0] = mm.norm(w.x - w.w / 2, w.z - w.d / 2);
      const [x1, z1] = mm.norm(w.x + w.w / 2, w.z + w.d / 2);
      ctx.fillRect(sx(x0), sy(z0), sx(x1) - sx(x0), sy(z1) - sy(z0));
    }

    // the DERBY ring, closing in
    const mw = v.modeWorld;
    if (mw?.ring != null) {
      const [cx, cz] = mm.norm(0, 0);
      const rPx = (mw.ring / a.radius) * ((W - PAD * 2) / 2);
      ctx.beginPath();
      ctx.arc(sx(cx), sy(cz), rPx, 0, Math.PI * 2);
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#e2574c";
      ctx.setLineDash([4, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // the WRECKERS — you want to know where they are
    for (const wr of mw?.wreckers || []) {
      const [nx, nz] = mm.norm(wr.x, wr.z);
      ctx.beginPath();
      ctx.arc(sx(nx), sy(nz), 4, 0, Math.PI * 2);
      ctx.fillStyle = "#1c1712";
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = "#e2574c";
      ctx.stroke();
    }

    // THE FLAGS, always visible. This is the one thing CTF cannot hide.
    for (const f of mw?.flags || []) {
      const [nx, nz] = mm.norm(f.x, f.z);
      const col = f.team === 0 ? "#2fe6c8" : "#ff5a3c";
      ctx.beginPath();
      ctx.moveTo(sx(nx), sy(nz) - 8);
      ctx.lineTo(sx(nx) + 8, sy(nz) - 5);
      ctx.lineTo(sx(nx), sy(nz) - 2);
      ctx.closePath();
      ctx.fillStyle = col;
      ctx.fill();
      // the pole
      ctx.beginPath();
      ctx.moveTo(sx(nx), sy(nz) - 8);
      ctx.lineTo(sx(nx), sy(nz) + 2);
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = f.carrier ? "#fff" : col;
      ctx.stroke();
      // a carried flag pulses, so you can tell at a glance it's ON THE MOVE
      if (f.carrier) {
        ctx.beginPath();
        ctx.arc(sx(nx), sy(nz), 7 + Math.sin(performance.now() / 150) * 2, 0, Math.PI * 2);
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = col;
        ctx.stroke();
      }
    }

    // the pearls, as a faint scatter (they're the point of the mode)
    if (mw?.pearls) {
      ctx.fillStyle = "rgba(255,241,245,0.8)";
      for (const pl of mw.pearls) {
        const [nx, nz] = mm.norm(pl.x, pl.z);
        ctx.beginPath();
        ctx.arc(sx(nx), sy(nz), 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  } else {
    // track ribbon: dark outline under a cream core
    for (const [wpx, color] of [[9, "rgba(90,70,50,0.65)"], [5.5, "#fff3dd"]]) {
      ctx.beginPath();
      mm.pts.forEach(([x, z], i) => (i ? ctx.lineTo(sx(x), sy(z)) : ctx.moveTo(sx(x), sy(z))));
      ctx.closePath();
      ctx.lineWidth = wpx; ctx.strokeStyle = color; ctx.stroke();
    }
    // start line tick
    ctx.fillStyle = "#5a4632";
    ctx.beginPath(); ctx.arc(sx(mm.start[0]), sy(mm.start[1]), 3, 0, Math.PI * 2); ctx.fill();
  }
  // racers: everyone small, YOU bigger with a white ring
  const youId = v.you?.id;
  for (const p of v.players || []) {
    const [nx, nz] = mm.norm(p.x, p.z);
    const isMe = p.id === youId;
    ctx.beginPath();
    ctx.arc(sx(nx), sy(nz), isMe ? 6 : 4.2, 0, Math.PI * 2);
    // in a TEAM mode the colour that matters is your team, not your kart paint
    const teamCol = p.team === 0 ? "#2fe6c8" : p.team === 1 ? "#ff5a3c" : null;
    const isIt = v.modeWorld?.it === p.id;
    ctx.fillStyle = p.eliminated ? "rgba(90,70,50,0.35)"
      : isIt ? "#e2574c"
      : (teamCol || p.idColor || (isMe ? "#e2574c" : "#3aa6b9"));
    ctx.fill();
    if (isMe) { ctx.lineWidth = 2.4; ctx.strokeStyle = "#fff"; ctx.stroke(); }
    // the leader in Pearl Rush wears the crown — mark them
    if (v.modeWorld?.leader === p.id) {
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#f7c04a";
      ctx.stroke();
    }
  }
}

// Every power gets a glyph. At speed you read the SHAPE, not the words — a
// chip that just says "Hydro Bomb" in 14px is useless in a corner.
const ITEM_GLYPHS = {
  waterballoon: "💧", squirt: "🔫", sprinkler: "🌀", wave: "🌊",
  kite: "🪁", bucket: "🪣", juicebox: "🧃",
  // bronze
  waterbomb: "💣", puddle: "💦", fizzpop: "🥤", sandclod: "🟤",
  // silver
  waterballoon3: "💧💧", supersoak: "🚿", icepop: "🧊", beachball: "🏐",
  // gold
  hydrobomb: "🧨", geyser: "⛲", monsoon: "🌧️", rocketfloat: "🚀",
  // S — the ultimates
  tsunami: "🌊", krakenwave: "🐙", meteorsplash: "☄️", hypernova: "✨",
};
const ULTIMATE_IDS = new Set(["tsunami", "krakenwave", "meteorsplash", "hypernova"]);

const ITEM_LABELS = {
  waterballoon: "Water Balloon", squirt: "Squirt Stream", sprinkler: "Sprinkler Patch",
  wave: "The Wave", kite: "Beach Kite", bucket: "Bucket Shield", juicebox: "Juice-Box Turbo",
  // bronze
  waterbomb: "Water Bomb", puddle: "Puddle Splat", fizzpop: "Fizz Pop", sandclod: "Sand Clod",
  // silver
  waterballoon3: "Balloon Cluster", supersoak: "Super Soaker", icepop: "Ice Pop", beachball: "Bouncing Beachball",
  // gold
  hydrobomb: "Hydro Bomb", geyser: "Geyser Trap", monsoon: "Monsoon Cloud", rocketfloat: "Rocket Floaty",
  // S — the ultimates
  tsunami: "TSUNAMI", krakenwave: "KRAKEN'S GRASP", meteorsplash: "METEOR SPLASH", hypernova: "HYPERNOVA TURBO",
};

// Small-screen awareness: below 1000px the HUD tightens (smaller chips,
// narrower mirror, minimap shrinks) so nothing collides on mobile-landscape.
function useCompactHud() {
  const [c, setC] = useState(typeof window !== "undefined" && window.innerWidth < 1100);
  useEffect(() => {
    const on = () => setC(window.innerWidth < 1100);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return c;
}

function RaceHud({ hud, toast, onLeave, posFlash, wrongWay, roulette, miniRef, lapClock, feed = [],
                  threat = 0, deathCam = null, takedown = null, lapFlag = null, freezeLeft = 0,
                  ultimate = null, blinded = false,
                  modeId = "race", modeYou = null, modeWorld = null, players = [] }) {
  const compact = useCompactHud();
  const { t } = useI18n();
  // The HUD chips were solid cream slabs at 92% opacity — they read as UI stuck
  // ON TOP of the game rather than part of it, and at 64px the position number
  // alone ate a quarter of the frame. Dark, translucent, smaller: you can see the
  // GAME through the gaps, which is the whole point of a HUD.
  const chip = {
    // dark holo glass: the game's dusk shows through, and the chip's edge
    // carries a whisper of the cyan/pink neon language so the HUD belongs to
    // the same world as the track trim
    background: "rgba(16,17,20,0.58)",
    color: "#f2f0ea",
    borderRadius: 10,
    padding: "6px 12px",
    fontFamily: "var(--display, system-ui)",
    fontWeight: 800,
    backdropFilter: "blur(6px)",
    border: "1px solid rgba(255,255,255,0.16)",
    boxShadow: "0 2px 10px rgba(0,0,0,0.35)",
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
      {/* ---- THE ULTIMATE NAME-CARD ----
          An S-tier item is an EVENT. The screen tells you so: the name slams in
          on a rotated slab, the whole frame flashes its colour, and the world
          shakes. This is the anime beat — the move gets announced. */}
      {ultimate && Date.now() < ultimate.until && (
        <div data-qa="hud-ultimate" style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 45 }}>
          <div style={{
            position: "absolute", inset: 0,
            background: `radial-gradient(circle at 50% 45%, ${ultimate.color}44 0%, transparent 62%)`,
            animation: "ultFlash 0.5s ease-out",
          }} />
          <div style={{
            position: "absolute", top: "34%", left: "50%",
            transform: "translate(-50%, -50%)", textAlign: "center",
            animation: "ultSlam 0.4s cubic-bezier(0.2,1.7,0.4,1)",
          }}>
            <div style={{
              display: "inline-block", padding: compact ? "12px 26px" : "18px 46px",
              background: "linear-gradient(180deg, rgba(6,34,45,0.92), rgba(6,34,45,0.75))",
              border: `5px solid ${ultimate.color}`,
              borderRadius: 10, transform: "rotate(-3deg) skewX(-6deg)",
              boxShadow: `0 0 60px ${ultimate.color}, 0 10px 0 rgba(0,0,0,0.4)`,
            }}>
              {ultimate.by && (
                <div className="impactf" style={{
                  fontSize: compact ? 13 : 18, letterSpacing: "0.18em",
                  color: ultimate.color, marginBottom: 4,
                }}>{ultimate.by.toUpperCase()} UNLEASHED</div>
              )}
              <div className="display" style={{
                fontSize: compact ? 40 : 72, letterSpacing: "0.08em",
                color: "#fff", textShadow: `0 0 30px ${ultimate.color}, 0 4px 0 rgba(0,0,0,0.6)`,
                lineHeight: 1,
              }}>{ultimate.name}</div>
            </div>
          </div>
        </div>
      )}

      {/* ---- BLINDED: a faceful of wet sand ---- */}
      {blinded && (
        <div data-qa="hud-blinded" style={{
          position: "absolute", inset: 0, pointerEvents: "none", zIndex: 38,
          background: "radial-gradient(circle at 50% 50%, rgba(212,167,99,0.55) 0%, rgba(160,120,60,0.9) 70%)",
          animation: "blindShudder 0.28s ease-in-out infinite",
        }}>
          <div style={{
            position: "absolute", top: "44%", width: "100%", textAlign: "center",
            fontFamily: "var(--display, system-ui)", fontWeight: 900,
            fontSize: compact ? 26 : 40, color: "#4a3016", letterSpacing: "0.14em",
          }}>SAND IN YOUR EYES!</div>
        </div>
      )}

      {/* ================= MODE HUDS ================= */}

      {/* DERBY — lives moved into the chip row (they were overlapping the
          standings top-right); only the ring readout stays as its own element */}
      {modeId === "derby" && modeYou && (
        <div data-qa="hud-derby" style={{ position: "absolute", top: 64, left: 18, pointerEvents: "none", zIndex: 14 }}>
          <div className="impactf" style={{ fontSize: 11, color: "var(--hot)" }}>
            RING {modeYou.ring}m · {players.filter((p) => !p.eliminated).length} LEFT
          </div>
        </div>
      )}

      {/* CTF — the score, and an arrow to the enemy flag that's always on screen */}
      {modeId === "ctf" && modeYou && modeWorld && (
        <>
          <div data-qa="hud-ctf" style={{
            position: "absolute", top: 14, left: "50%", transform: "translateX(-50%)",
            display: "flex", gap: 14, alignItems: "center", pointerEvents: "none", zIndex: 14,
            padding: "8px 18px", borderRadius: 12, background: "rgba(6,34,45,0.75)",
            border: "3px solid rgba(255,247,234,0.85)",
          }}>
            <span className="display" style={{ fontSize: compact ? 24 : 34, color: "#2fe6c8" }}>{modeWorld.teams[0]}</span>
            <span className="impactf" style={{ fontSize: 11, color: "var(--dim)" }}>FIRST TO {modeWorld.target}</span>
            <span className="display" style={{ fontSize: compact ? 24 : 34, color: "#ff5a3c" }}>{modeWorld.teams[1]}</span>
          </div>
          {/* THE INDICATOR. The flag is always on the minimap AND always pointed
              at, because a CTF where you have to hunt for the objective is just
              a maze. You always know where it is; getting there is the game. */}
          <div style={{
            position: "absolute", top: "50%", left: "50%",
            transform: `translate(-50%,-50%) rotate(${(modeYou.flagBearing ?? 0) + Math.PI / 2}rad)`,
            pointerEvents: "none", zIndex: 12, opacity: 0.85,
          }}>
            <div style={{ transform: "translateY(-120px)", textAlign: "center" }}>
              <div style={{ fontSize: compact ? 26 : 34 }}>{modeYou.objective === "home" || modeYou.carrying ? "🏠" : "🚩"}</div>
              <div className="impactf" style={{ fontSize: 11, color: "#fff7ea", textShadow: "0 2px 4px #000" }}>
                {modeYou.flagDist}m
              </div>
            </div>
          </div>
          {modeYou.carrying && (
            <div style={{
              position: "absolute", bottom: "22%", width: "100%", textAlign: "center",
              pointerEvents: "none", zIndex: 20,
              fontFamily: "var(--display, system-ui)", fontWeight: 900,
              fontSize: compact ? 24 : 36, color: "#f7c04a",
              textShadow: "0 0 20px rgba(247,192,74,0.9), 0 3px 0 #7a4a1d",
              animation: "threatPulse 0.7s ease-in-out infinite",
            }}>YOU HAVE THE FLAG — GET IT HOME</div>
          )}
        </>
      )}

      {/* SAND ARTIST — the word (drawer only), the options, and the guess timer */}
      {modeId === "artist" && modeYou && (
        <div data-qa="hud-artist" style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 16 }}>
          {/* the drawer's brief */}
          {modeYou.isDrawer && (
            <div style={{
              position: "absolute", top: "12%", left: "50%", transform: "translateX(-50%)",
              textAlign: "center", padding: "10px 26px", borderRadius: 12,
              background: "rgba(6,34,45,0.85)", border: "3px solid var(--volt)",
            }}>
              <div className="impactf" style={{ fontSize: 11, letterSpacing: "0.14em", color: "var(--volt)" }}>DRAW THIS</div>
              <div className="display" style={{ fontSize: compact ? 30 : 44, color: "#fff" }}>{modeYou.word}</div>
              <div style={{
                marginTop: 6, fontSize: 12, fontWeight: 800, letterSpacing: "0.08em",
                color: modeYou.painting ? "#7bffce" : "#ffd479",
              }}>
                {modeYou.painting ? "🖌 PAINTING — TAP SPACE TO STOP" : "TAP SPACE TO START DRAWING"}
              </div>
              <div className="dim" style={{ fontSize: 11, marginTop: 3 }}>
                1–5 to stamp · stay inside the rope
              </div>
            </div>
          )}
          {/* everyone's options */}
          {!modeYou.isDrawer && !modeYou.spectating && (
            <div style={{
              position: "absolute", top: "10%", left: "50%", transform: "translateX(-50%)",
              display: "flex", gap: 8,
            }}>
              {(modeYou.options || []).map((w, i) => (
                <div key={i} style={{
                  padding: "6px 14px", borderRadius: 8,
                  background: modeYou.guessHall === i ? "rgba(47,230,200,0.3)" : "rgba(6,34,45,0.7)",
                  border: `2px solid ${modeYou.guessHall === i ? "var(--volt)" : "var(--line)"}`,
                  fontWeight: 800, fontSize: compact ? 13 : 16, color: "var(--paper)",
                }}>{["⬆", "➡", "⬇", "⬅"][i]} {w}</div>
              ))}
            </div>
          )}
          {/* THE COUNTDOWN — you're standing in a hallway and committing */}
          {modeYou.guessProgress > 0 && (
            <div style={{
              position: "absolute", top: "44%", left: "50%", transform: "translate(-50%,-50%)",
              textAlign: "center",
            }}>
              <div className="display" style={{ fontSize: compact ? 60 : 96, color: "var(--volt)", textShadow: "0 0 30px rgba(47,230,200,0.8)" }}>
                {Math.ceil(5 * (1 - modeYou.guessProgress))}
              </div>
              <div className="impactf" style={{ fontSize: 13, color: "#fff7ea" }}>
                LOCKING IN "{(modeYou.options || [])[modeYou.guessHall]}"
              </div>
              <div style={{ width: 200, height: 8, background: "rgba(0,0,0,0.5)", borderRadius: 4, marginTop: 8, overflow: "hidden" }}>
                <div style={{ width: `${modeYou.guessProgress * 100}%`, height: "100%", background: "var(--volt)" }} />
              </div>
            </div>
          )}
          {modeYou.spectating && (() => {
            const living = players.filter((p) => !p.eliminated && !p.spectating);
            return (
              <div style={{ position: "absolute", bottom: "16%", width: "100%", textAlign: "center" }}>
                <div style={{
                  fontFamily: "var(--display, system-ui)", fontWeight: 900,
                  fontSize: compact ? 22 : 32, color: "#e2574c",
                }}>WRONG — YOU'RE OUT THIS ROUND</div>
                <div className="impactf" style={{ fontSize: compact ? 11 : 14, color: "var(--dim)", marginTop: 6 }}>
                  SPACE to switch camera · {living.length} still guessing
                </div>
              </div>
            );
          })()}
          <div style={{ position: "absolute", top: 14, right: 18, textAlign: "right" }}>
            <div className="impactf" style={{ fontSize: 11, color: "var(--dim)" }}>
              ROUND {modeWorld?.round}/{modeWorld?.rounds} · {modeYou.roundLeft}s
            </div>
            <div className="display" style={{ fontSize: compact ? 22 : 30, color: "var(--gold)" }}>{modeYou.score} PTS</div>
          </div>
        </div>
      )}

      {/* TAG — who's IT, and how long you've been holding it */}
      {modeId === "tag" && modeYou && (
        <div data-qa="hud-tag" style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 14 }}>
          {modeYou.amIt && (
            <div style={{
              position: "absolute", inset: 0,
              boxShadow: "inset 0 0 120px rgba(226,60,44,0.5)",
              animation: "threatPulse 0.6s ease-in-out infinite",
            }}>
              <div style={{
                position: "absolute", top: "14%", width: "100%", textAlign: "center",
                fontFamily: "var(--display, system-ui)", fontWeight: 900,
                fontSize: compact ? 34 : 54, color: "#ffd9d4",
                textShadow: "0 0 26px rgba(226,60,44,0.95), 0 3px 0 #7a1d14",
              }}>YOU'RE IT — PASS IT ON!</div>
            </div>
          )}
          <div style={{ position: "absolute", top: 14, right: 18, textAlign: "right" }}>
            <div className="impactf" style={{ fontSize: 11, color: "var(--dim)" }}>TIME AS IT</div>
            <div className="display" style={{ fontSize: compact ? 24 : 34, color: modeYou.amIt ? "var(--hot)" : "var(--paper)" }}>
              {modeYou.itTime.toFixed(1)}s
            </div>
            <div className="impactf" style={{ fontSize: 11, color: "var(--volt)" }}>{modeYou.tags} TAGS</div>
          </div>
        </div>
      )}

      {/* PEARL RUSH — your haul, and the crown on the leader */}
      {modeId === "pearl" && modeYou && (
        <div data-qa="hud-pearl" style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 14 }}>
          <div style={{ position: "absolute", top: 64, left: 18, textAlign: "left" }}>
            <div className="impactf" style={{ fontSize: 11, color: "var(--dim)" }}>PEARLS</div>
            <div className="display" style={{ fontSize: compact ? 26 : 38, color: "#fff1f5" }}>
              {modeYou.amLeader ? "👑 " : ""}{modeYou.pearls}
            </div>
          </div>
          {modeYou.amLeader && (
            <div style={{
              position: "absolute", top: "12%", width: "100%", textAlign: "center",
              fontFamily: "var(--display, system-ui)", fontWeight: 900,
              fontSize: compact ? 18 : 26, color: "#f7c04a",
              textShadow: "0 0 20px rgba(247,192,74,0.8)",
            }}>YOU'RE IN THE LEAD — EVERYONE CAN SEE YOU</div>
          )}
        </div>
      )}

      {/* ---- START LIGHTS: red → yellow → GREEN ----
          The flythrough runs while the grid is frozen; the last 3.6s are the
          light sequence, so you always know exactly when you can go. */}
      {freezeLeft > 0.05 && (() => {
        const t = freezeLeft;                 // seconds remaining
        const stage = t > 2.4 ? "red" : t > 1.2 ? "yellow" : "green_pending";
        const lampsLit = t > 2.4 ? 3 : t > 1.8 ? 2 : t > 1.2 ? 1 : 0;
        const label = t > 2.4 ? "ON YOUR MARKS" : t > 1.2 ? "GET READY" : "GO!";
        const green = t <= 1.2;
        return (
          <div data-qa="hud-startlights" style={{
            position: "absolute", top: "26%", left: "50%", transform: "translateX(-50%)",
            display: "flex", flexDirection: "column", alignItems: "center", gap: 10,
            pointerEvents: "none", zIndex: 35,
          }}>
            <div style={{ display: "flex", gap: 14, padding: "14px 20px", borderRadius: 16,
              background: "rgba(10,30,38,0.72)", border: "4px solid rgba(255,247,234,0.9)",
              boxShadow: "0 8px 24px rgba(0,0,0,0.4)" }}>
              {[0, 1, 2].map((i) => {
                const on = green ? true : i < lampsLit;
                const color = green ? "#2fe06a" : (stage === "yellow" ? "#f7c04a" : "#e2574c");
                return (
                  <div key={i} style={{
                    width: 34, height: 34, borderRadius: "50%",
                    background: on ? color : "rgba(255,255,255,0.10)",
                    boxShadow: on ? `0 0 22px ${color}, inset 0 -3px 6px rgba(0,0,0,0.35)` : "inset 0 -3px 6px rgba(0,0,0,0.4)",
                    border: "2px solid rgba(0,0,0,0.25)",
                    transition: "background 0.12s, box-shadow 0.12s",
                  }} />
                );
              })}
            </div>
            <div className="display" style={{
              fontSize: green ? 58 : 30, letterSpacing: "0.1em",
              color: green ? "#2fe06a" : "#fff7ea",
              textShadow: green ? "0 0 26px rgba(47,224,106,0.8), 0 3px 0 #14532d" : "0 2px 0 rgba(0,0,0,0.5)",
              transform: green ? "scale(1.12)" : "scale(1)", transition: "transform 0.12s",
            }}>{label}</div>
          </div>
        );
      })()}

      {/* HELD ITEM — top-center, under the mirror. It used to sit in the
          bottom-left chip column where nobody looked; the item you are holding
          is the most decision-relevant thing on screen and belongs in the
          middle of your gaze. */}
      <div data-qa="hud-item" style={{
        position: "absolute", top: compact ? "13%" : "15%", left: "50%", transform: "translateX(-50%)",
        display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
        pointerEvents: "none", zIndex: 12,
      }}>
        {roulette && (
          <div style={{ ...chip, fontSize: compact ? 18 : 26, minWidth: 280, textAlign: "center",
            border: roulette.landed ? `4px solid ${roulette.negative ? "#e2574c" : (TIER_COLORS[roulette.tier] || "#5a4632")}` : "3px dashed #5a4632",
            background: roulette.landed && roulette.negative ? "rgba(122,29,20,0.55)" : undefined,
            transform: roulette.landed ? "scale(1.12)" : "scale(1)", transition: "transform 0.14s ease-out" }}>
            🎰 <span style={{ fontSize: compact ? 20 : 26 }}>{ITEM_GLYPHS[roulette.showing] || ""}</span>{" "}
            {ITEM_LABELS[roulette.showing] || "…"}{roulette.landed ? (roulette.negative ? " — DUD!" : ` · ${(roulette.tier || "").toUpperCase()}!`) : "…"}
          </div>
        )}
        {!hud.kited && hud.heldItem && !roulette && (
          <div className={ULTIMATE_IDS.has(hud.heldItem.id) ? "mythic" : undefined}
            style={{ ...chip, fontSize: compact ? 18 : 26,
              border: `3px solid ${TIER_COLORS[hud.heldItem.tier] || "#5a4632"}`,
              // holding an ultimate should feel like holding a live grenade
              ...(ULTIMATE_IDS.has(hud.heldItem.id) ? { boxShadow: "0 0 30px rgba(181,242,255,0.9)" } : null) }}>
            <span style={{ fontSize: compact ? 22 : 30, marginRight: 6 }}>{ITEM_GLYPHS[hud.heldItem.id] || "🎁"}</span>
            {(ITEM_LABELS[hud.heldItem.id] || "Item")} · {hud.heldItem.tier.toUpperCase()} — <span style={{ opacity: 0.75 }}>SPACE</span>
          </div>
        )}
        {!hud.kited && !hud.heldItem && !roulette && hud.challenge?.type === "rings" && (
          <div style={{ ...chip, fontSize: compact ? 17 : 24 }}>⭕ HOOPS {Math.min(hud.challenge.next, 6)}/6 · every 2 = tier up</div>
        )}
        {!hud.kited && !hud.heldItem && !roulette && hud.challenge?.type === "ribbon" && (
          <div style={{ ...chip, fontSize: compact ? 17 : 24,
            border: hud.challenge.inLane === false ? "3px solid #e2574c" : undefined,
            color: hud.challenge.inLane === false ? "#e2574c" : undefined }}>
            {hud.challenge.inLane === false ? "⚠ GET BACK IN THE LANE" : "▮ STAY IN THE LANE"}
            {" · "}{(hud.challenge.left ?? 0).toFixed(1)}s · {Math.round((hud.challenge.score || 0) * 100)}%
          </div>
        )}
        {!hud.kited && !hud.heldItem && !roulette && hud.challenge?.type === "keys" && (() => {
          const c = hud.challenge;
          const pads = ["W", "A", "S", "D"];
          return (
            <div style={{ ...chip, fontSize: compact ? 15 : 20, display: "flex", flexDirection: "column", alignItems: "center", gap: 6, padding: compact ? "8px 14px" : "10px 20px" }}>
              <div style={{ letterSpacing: "0.08em" }}>⌨ KEY DRILL · {c.score}/{c.total} · release &amp; press!</div>
              <div style={{ display: "flex", gap: 8 }}>
                {pads.map((k) => {
                  const live = c.want === k;
                  // "armed" means the game has seen this key released — until then,
                  // holding it does nothing, and the pad tells you so.
                  const waiting = live && !c.armed;
                  return (
                    <div key={k} style={{
                      width: compact ? 34 : 44, height: compact ? 34 : 44, borderRadius: 9,
                      display: "grid", placeItems: "center",
                      fontWeight: 900, fontSize: compact ? 17 : 22,
                      background: live ? (waiting ? "#f7c04a" : "#2fe6c8") : "rgba(255,255,255,0.10)",
                      color: live ? "#0b3140" : "rgba(255,247,234,0.45)",
                      border: live ? "3px solid #fff1d6" : "2px solid rgba(255,255,255,0.15)",
                      boxShadow: live ? "0 0 18px rgba(47,230,200,0.7)" : "none",
                      transform: live ? "scale(1.12)" : "scale(1)",
                      transition: "all 0.1s",
                    }}>{k}</div>
                  );
                })}
              </div>
              {c.want && !c.armed && (
                <div style={{ fontSize: compact ? 11 : 13, color: "#f7c04a", fontWeight: 800 }}>
                  LET GO OF {c.want} FIRST
                </div>
              )}
            </div>
          );
        })()}
      </div>

      {/* the bottom steering/lane bar is REMOVED (all modes) by request */}

      {/* position + lap + match clock, top-left. In non-lap modes (derby, tag,
          CTF, pearl, artist) there ARE no laps, so the LAP readout is hidden and
          the racing-position ordinal is dropped — only the mode's own scoreboard
          and the match countdown make sense there. */}
      <div data-qa="hud-chips" style={{ position: "absolute", left: 16, top: 14, display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-start", pointerEvents: "none" }}>
        {hud.lapBased && (
          <div style={{
            ...chip, fontSize: compact ? 24 : 38, padding: compact ? "4px 10px" : "6px 14px",
            color: posFlash ? (posFlash.dir === "up" ? "#1f9d55" : "#e2574c") : hud.pos === 1 ? "#c98a12" : "#5a4632",
            transform: posFlash ? "scale(1.18)" : "scale(1)",
            transition: "transform 0.18s ease, color 0.18s ease",
          }}>{ordinal(hud.pos)}</div>
        )}
        <div style={{ display: "flex", gap: 8 }}>
        {hud.lapBased && <div style={{ ...chip, fontSize: compact ? 19 : 30 }}>LAP {hud.lap}/{hud.laps}</div>}
        {/* MATCH COUNTDOWN — every mode. Turns amber under 30s, red under 10s, so
            the horn (and a possible draw) never surprises anyone. */}
        {hud.lives != null ? (
          <div style={{ ...chip, fontSize: compact ? 19 : 30 }}>
            {"💚".repeat(Math.max(0, hud.lives))}{"🖤".repeat(Math.max(0, 3 - hud.lives))}
          </div>
        ) : hud.timeLeft != null && (
          <div style={{
            ...chip, fontSize: compact ? 19 : 30,
            color: hud.timeLeft <= 10 ? "#e2574c" : hud.timeLeft <= 30 ? "#c98a12" : "#5a4632",
            animation: hud.timeLeft <= 10 ? "gpPulse 0.5s infinite alternate" : "none",
          }}>⏳ {fmtClock(hud.timeLeft)}</div>
        )}
        {hud.lapBased && (
          <div style={{ ...chip, fontSize: compact ? 15 : 22, opacity: 0.9 }}>
            ⏱ {((Date.now() - (lapClock.current.startMs || Date.now())) / 1000).toFixed(1)}s
            {lapClock.current.bestMs ? ` · BEST ${(lapClock.current.bestMs / 1000).toFixed(1)}s` : ""}
          </div>
        )}
        </div>
      </div>
      {/* splash/crumble ticker, top-left under the chips */}
      <div data-qa="hud-feed" style={{ position: "absolute", left: 16, top: compact ? 118 : 176, display: "flex", flexDirection: "column", gap: 4, pointerEvents: "none" }}>
        {feed.filter((f) => Date.now() < f.until).map((f) => (
          <div key={f.id} style={{ ...chip, fontSize: compact ? 14 : 20, opacity: 0.94, padding: "5px 12px" }}>{f.text}</div>
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
      <div data-qa="hud-speed" style={{ position: "absolute", right: 16, bottom: 14, ...chip, fontSize: compact ? 20 : 28, pointerEvents: "none" }}>
        {hud.speed} <span style={{ fontSize: compact ? 15 : 20, opacity: 0.7 }}>mph</span>
      </div>
      {/* mini standings, top-right */}
      <div data-qa="hud-standings" style={{ position: "absolute", right: 16, top: 14, ...chip, padding: "10px 12px", pointerEvents: "none" }}>
        {hud.standings.map((s) => (
          <div key={s.id} style={{
            display: "flex", alignItems: "center", gap: 8, fontSize: compact ? 15 : 21,
            opacity: s.me ? 1 : 0.85, fontWeight: s.me ? 900 : 700,
            /* YOUR row always pops: its own background bar, edge to edge */
            background: s.me ? "rgba(255,45,120,0.22)" : "transparent",
            borderRadius: 6, padding: "1px 6px", margin: "0 -6px",
          }}>
            <span style={{ width: 16 }}>{s.pos}</span>
            <span style={{ width: 9, height: 9, borderRadius: "50%", background: s.color, border: "1.5px solid rgba(90,70,50,0.4)" }} />
            <span style={{ maxWidth: 110, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}{s.me ? " (you)" : ""}{s.finished ? " ✓" : ""}</span>
            {s.pearls != null && <span style={{ marginLeft: "auto", fontWeight: 900 }}>🦪{s.pearls}</span>}
          </div>
        ))}
      </div>
      {/* held item / live challenge, bottom-center */}
      <div data-qa="hud-item" style={{ position: "absolute", left: "50%", bottom: 16, transform: "translateX(-50%)", pointerEvents: "none" }}>
        {hud.kited && (
          <div style={{ ...chip, fontSize: compact ? 20 : 28, border: "3px solid #e2574c", background: "rgba(255,240,235,0.95)", animation: "gpPulse 0.4s infinite alternate" }}>
            🪁 MASH SPACE! · {hud.kiteNeed} to break free
          </div>
        )}
      </div>
      {/* sand armor + shield, above the speedo (bottom-right) */}
      {/* ---- THREAT VIGNETTE: the world's edges burn red as danger closes ---- */}
      {threat > 0.1 && !deathCam && (
        <div data-qa="hud-threat" style={{
          position: "absolute", inset: 0, pointerEvents: "none", zIndex: 5,
          boxShadow: `inset 0 0 ${Math.round(60 + threat * 130)}px rgba(226,60,44,${(threat * 0.55).toFixed(2)})`,
          animation: threat > 0.55 ? "threatPulse 0.34s ease-in-out infinite" : "threatPulse 0.8s ease-in-out infinite",
        }}>
          <div style={{ position: "absolute", top: "16%", left: "50%", transform: "translateX(-50%)",
            fontFamily: "var(--display, system-ui)", fontWeight: 900, letterSpacing: "0.12em",
            fontSize: compact ? 20 : 30, color: "#ffd9d4", textShadow: "0 2px 0 #7a1d14, 0 0 18px rgba(226,60,44,0.9)",
            opacity: Math.min(1, threat * 1.6) }}>
            ⚠ INCOMING!
          </div>
        </div>
      )}

      {/* ---- DEATH CINEMATIC OVERLAY: letterbox + verdict + countdown ---- */}
      {deathCam && Date.now() < deathCam.until && (
        <div data-qa="hud-death" style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 40 }}>
          <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: "11%", background: "#120c08", opacity: 0.94 }} />
          <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: "11%", background: "#120c08", opacity: 0.94 }} />
          <div style={{ position: "absolute", top: "17%", width: "100%", textAlign: "center" }}>
            <div style={{ fontFamily: "var(--display, system-ui)", fontWeight: 900, fontSize: compact ? 44 : 72,
              color: "#ffe9c9", textShadow: "0 4px 0 #7a4a1d, 0 0 26px rgba(255,140,60,0.55)", letterSpacing: "0.06em" }}>
              {deathCam.cause === "sand" ? "BURIED!" : "WIPED OUT!"}
            </div>
            {deathCam.cause === "sand" && (
              <div style={{ marginTop: 6, fontWeight: 800, fontSize: compact ? 16 : 24, color: "#f6c9a4" }}>
                the sand got you
              </div>
            )}
            {deathCam.by && (
              <div style={{ marginTop: 6, fontFamily: "var(--display, system-ui)", fontWeight: 800,
                fontSize: compact ? 18 : 28, color: "#f6c9a4", textShadow: "0 2px 0 #5a3416" }}>
                by {deathCam.by}
              </div>
            )}
            <div style={{ marginTop: 10, fontSize: compact ? 15 : 21, fontWeight: 800, color: "#d9b98f", letterSpacing: "0.2em" }}>
              REFORMING IN {Math.max(0, Math.ceil((deathCam.until - Date.now()) / 1000))}…
            </div>
          </div>
        </div>
      )}

      {/* ---- FORCE-STOPPED: you're stuck off the road, waiting to dig out ----
          Humans are never auto-teleported, so without this the kart just looks
          dead. Tells you exactly what to do: press R. Hidden the moment you're
          crumbled (the BURIED overlay takes over) or already reforming. */}
      {hud.needsReset && !deathCam && (
        <div data-qa="hud-needreset" style={{
          position: "absolute", inset: 0, display: "grid", placeItems: "center",
          pointerEvents: "none", zIndex: 41,
        }}>
          <div style={{ textAlign: "center", animation: "threatPulse 0.8s ease-in-out infinite" }}>
            <div style={{
              fontFamily: "var(--display, system-ui)", fontWeight: 900,
              fontSize: compact ? 40 : 64, color: "#fff7ea",
              textShadow: "0 3px 0 #7a4a1d, 0 0 30px rgba(255,160,60,0.7)", letterSpacing: "0.04em",
            }}>PRESS <span style={{ color: "#f7c04a" }}>R</span> TO RESPAWN</div>
            <div style={{ marginTop: 8, fontWeight: 800, fontSize: compact ? 15 : 22, color: "#f6c9a4", letterSpacing: "0.14em" }}>
              YOU'RE STUCK OFF THE TRACK
            </div>
          </div>
        </div>
      )}

      {/* ---- TAKEDOWN BANNER: the attacker's dopamine spike, earned ---- */}
      {takedown && Date.now() < takedown.until && (
        <div data-qa="hud-takedown" style={{ position: "absolute", top: "23%", width: "100%", textAlign: "center", pointerEvents: "none", zIndex: 30, animation: "takedownIn 0.28s cubic-bezier(0.2,1.6,0.4,1)" }}>
          <div style={{ display: "inline-block", padding: compact ? "10px 22px" : "14px 34px",
            background: "linear-gradient(180deg, #ff8a5e, #e2574c)", border: "4px solid #fff1d6",
            borderRadius: 14, transform: `rotate(-2deg) scale(${1 + (takedown.n - 1) * 0.12})`,
            boxShadow: "0 6px 0 #7a1d14, 0 0 40px rgba(255,120,70,0.65)" }}>
            <div style={{ fontFamily: "var(--display, system-ui)", fontWeight: 900, fontSize: compact ? 30 : 46,
              color: "#fff", letterSpacing: "0.08em", textShadow: "0 3px 0 #9c2418" }}>
              💥 {takedown.text}
            </div>
            <div style={{ fontWeight: 800, fontSize: compact ? 14 : 20, color: "#ffe4d2", marginTop: 2 }}>
              you wiped out {takedown.victim}
            </div>
          </div>
        </div>
      )}

      {/* ---- LAP FLAG: every lap gets its flag; the last one is checkered ---- */}
      {lapFlag && Date.now() < lapFlag.until && (
        <div data-qa="hud-lapflag" style={{ position: "absolute", top: "13%", width: "100%", textAlign: "center", pointerEvents: "none", zIndex: 22, animation: "takedownIn 0.24s cubic-bezier(0.2,1.5,0.4,1)" }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 12, padding: compact ? "8px 18px" : "10px 26px",
            background: lapFlag.final
              ? "repeating-conic-gradient(#1c1712 0% 25%, #f5efe2 0% 50%) 50%/22px 22px"
              : "linear-gradient(180deg, #2a9d8f, #1f7a70)",
            border: "4px solid #fff1d6", borderRadius: 12, boxShadow: "0 5px 0 rgba(0,0,0,0.35)" }}>
            <span style={{ fontSize: compact ? 26 : 36 }}>{lapFlag.final ? "🏁" : "🚩"}</span>
            <span style={{ fontFamily: "var(--display, system-ui)", fontWeight: 900, fontSize: compact ? 24 : 36,
              color: lapFlag.final ? "#1c1712" : "#fff",
              background: lapFlag.final ? "#f5efe2" : "transparent",
              padding: lapFlag.final ? "2px 12px" : 0, borderRadius: 8,
              letterSpacing: "0.1em", textShadow: lapFlag.final ? "none" : "0 2px 0 rgba(0,0,0,0.35)" }}>
              {lapFlag.text}
            </span>
          </div>
        </div>
      )}

      <div data-qa="hud-erosion" style={{ position: "absolute", right: 18, bottom: compact ? 82 : 108, display: "flex", gap: 5, alignItems: "center", pointerEvents: "none" }}>
        {hud.shield && <span style={{ fontSize: 20, filter: "drop-shadow(0 2px 2px rgba(90,70,50,0.4))" }}>🪣</span>}
        {/* THREE WHEELS. Each hazard or light hit fades one — the tyre ring and
            hub grey out. All three faded = next hit crumbles you. */}
        {[0, 1, 2].map((i) => {
          const spent = (hud.erosion ?? 0) > i + 0.5;
          return (
            <div key={i} style={{
              width: 17, height: 17, borderRadius: "50%",
              border: "4px solid #241c16",
              background: "rgba(255,247,234,0.95)",
              boxShadow: "0 2px 4px rgba(90,70,50,0.3)",
              display: "grid", placeItems: "center",
              opacity: spent ? 0.22 : 1,
              filter: spent ? "grayscale(1)" : "none",
              transition: "opacity 0.35s, filter 0.35s",
            }} title="wheels">
              <div style={{ width: 5, height: 5, borderRadius: "50%", background: "#241c16" }} />
            </div>
          );
        })}
      </div>
      {/* toast banner, upper-center under the mirror */}
      {toast && (
        <div style={{
          position: "absolute", left: "50%", top: "19%", transform: "translateX(-50%)",
          fontFamily: "var(--display, system-ui)", fontWeight: 900, fontSize: compact ? 52 : 76,
          color: toast.kind === "tier" ? (TIER_COLORS[toast.tier] || "#5a4632") : "#5a4632",
          textShadow: "0 3px 0 rgba(255,247,234,0.9), 0 6px 18px rgba(90,70,50,0.35)",
          pointerEvents: "none", letterSpacing: 1,
        }}>{toast.text}</div>
      )}
      {/* controls hint, bottom-left. Exit to Lobby lives in the ESC menu now —
          it was too easy to hit mid-race down here. Press ESC to leave. */}
      <div data-qa="hud-controls" style={{ position: "absolute", left: 16, bottom: 16, display: "flex", gap: 8, alignItems: "center" }}>
        {!compact && <div style={{ ...chip, fontSize: 18, opacity: 0.92, pointerEvents: "none" }}>
          WASD / arrows · SPACE = use item · SHIFT = look back · R = shovel reset · ESC = menu · v{typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "?"}
        </div>}
      </div>
    </>
  );
}
