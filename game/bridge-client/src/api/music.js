// Background music manager. Plays a single looping track per "scene" and
// crossfades when the scene changes. Two scenes share the catalogue:
//   - "menuLobby": light/happy track for the menus and the pre-match lobby
//   - "match": subtler, more driving track while a match is in progress
// Volume follows the existing Audio settings sliders (master * music, 0..100).
// Playback only begins after a user gesture (browser autoplay policy); call
// initMusic() from the same first-click handler that initializes the SFX.

const TRACKS = {
  menuLobby: "music/menu_lobby.mp3",
  match: "music/match.mp3",
};

const FADE_MS = 700;

const els = {};            // scene -> HTMLAudioElement
let currentScene = null;   // the scene we want playing (may be pending a gesture)
let started = false;       // flips true after the first user gesture
let masterVol = 0.35;      // 0..1, from the Master Volume slider (lowered 50%)
let musicVol = 0.1;        // 0..1, from the Music slider (lowered 50%, was 0.2)

function clamp01(n) { return Math.max(0, Math.min(1, n)); }

function basePath() {
  // Vite serves /public at import.meta.env.BASE_URL (default "/").
  try { return import.meta.env.BASE_URL || "/"; } catch { return "/"; }
}

function targetGain() { return clamp01(masterVol * musicVol); }

function ensureEl(scene) {
  if (els[scene]) return els[scene];
  const a = new Audio(basePath() + TRACKS[scene]);
  a.loop = true;
  a.preload = "auto";
  a.volume = 0;
  els[scene] = a;
  return a;
}

function fade(el, to, done) {
  if (el._fadeTimer) { clearInterval(el._fadeTimer); el._fadeTimer = null; }
  const from = el.volume;
  const start = performance.now();
  if (from === to) { if (done) done(); return; }
  el._fadeTimer = setInterval(() => {
    const t = Math.min(1, (performance.now() - start) / FADE_MS);
    el.volume = clamp01(from + (to - from) * t);
    if (t >= 1) { clearInterval(el._fadeTimer); el._fadeTimer = null; if (done) done(); }
  }, 30);
}

function applyScene(scene) {
  const next = ensureEl(scene);
  // Fade out / pause every other scene.
  for (const [s, el] of Object.entries(els)) {
    if (s !== scene) fade(el, 0, () => { try { el.pause(); } catch {} });
  }
  if (next.paused) { const p = next.play(); if (p && p.catch) p.catch(() => {}); }
  fade(next, targetGain());
}

// Request a scene. Safe to call before the first gesture — it's remembered and
// started by initMusic(). Calling with the current scene just keeps it audible.
export function playScene(scene) {
  if (!TRACKS[scene]) return;
  const changed = scene !== currentScene;
  currentScene = scene;
  if (!started) return;
  if (changed || (els[scene] && els[scene].paused)) applyScene(scene);
  else if (els[scene]) els[scene].volume = targetGain();
}

// Begin playback of whatever scene is pending. Call from the first user click.
export function initMusic() {
  if (started) return;
  started = true;
  if (currentScene) applyScene(currentScene);
}

// Fade everything out and stop (e.g. on sign-out).
export function stopMusic() {
  currentScene = null;
  for (const el of Object.values(els)) fade(el, 0, () => { try { el.pause(); } catch {} });
}

// Update volumes from the Audio settings (values are 0..100 sliders).
export function setMusicVolumes({ master, music } = {}) {
  if (typeof master === "number") masterVol = clamp01(master / 100);
  if (typeof music === "number") musicVol = clamp01(music / 100);
  if (!currentScene) return;
  const el = els[currentScene];
  if (!el) return;
  // If a crossfade is mid-flight, retarget it to the new gain so slider changes
  // always converge to the latest master*music; otherwise apply immediately.
  if (el._fadeTimer) fade(el, targetGain());
  else el.volume = targetGain();
}
