// App-wide accessibility / graphics preferences. Mirrors music.js: module state
// plus an apply function. Two of these prefs (highContrast, reducedMotion) toggle
// CSS classes on the document root so they affect the whole app; the rest are
// read at runtime by the components that honor them (captions, fps cap, shake,
// hold-to-confirm). Call applyPrefs() on boot (App) and on every live Settings
// change so toggles take effect immediately without a reload.

const state = {
  highContrast: false,
  reducedMotion: false,
  captionsEnabled: true,
  captionSize: "medium",
  fpsLimit: 0,
  screenShake: true,
  holdToConfirm: false,
  quality: "high",
  fullscreen: false,
};

// Enter/exit real browser fullscreen. requestFullscreen must run inside a user
// gesture, which is exactly the case when the Settings toggle is clicked (this
// runs synchronously in that click handler). On boot (no gesture) it may reject
// — swallowed so it never breaks app start.
function applyFullscreen(on) {
  state.fullscreen = on;
  if (typeof document === "undefined") return;
  try {
    if (on && !document.fullscreenElement) document.documentElement.requestFullscreen?.();
    else if (!on && document.fullscreenElement) document.exitFullscreen?.();
  } catch { /* ignored */ }
}

// Read by IsoStage/effects to scale down heavy visuals. "low" drops parallax and
// speedlines, "medium" keeps them lighter, "high"/"ultra" render everything.
export function qualityLevel() { return state.quality; }

function applyRootClasses() {
  const root = typeof document !== "undefined" ? document.documentElement : null;
  if (!root) return;
  root.classList.toggle("hc", !!state.highContrast);
  root.classList.toggle("reduced-motion", !!state.reducedMotion);
}

// Merge a (possibly partial) settings tree into the prefs and re-apply the root
// classes. Accepts either a full settings object or a single-category patch.
export function applyPrefs(settings = {}) {
  const a = settings.accessibility || {};
  const g = settings.graphics || {};
  if (typeof a.highContrast === "boolean") state.highContrast = a.highContrast;
  if (typeof a.reducedMotion === "boolean") state.reducedMotion = a.reducedMotion;
  if (typeof a.captionsEnabled === "boolean") state.captionsEnabled = a.captionsEnabled;
  if (typeof a.captionSize === "string") state.captionSize = a.captionSize;
  if (typeof a.holdToConfirm === "boolean") state.holdToConfirm = a.holdToConfirm;
  if (typeof g.fpsLimit === "number") state.fpsLimit = g.fpsLimit;
  if (typeof g.screenShake === "boolean") state.screenShake = g.screenShake;
  if (typeof g.quality === "string") state.quality = g.quality;
  if (typeof g.fullscreen === "boolean" && g.fullscreen !== state.fullscreen) applyFullscreen(g.fullscreen);
  applyRootClasses();
}

export function getPrefs() { return { ...state }; }

// Caption font size (px) for the small | medium | large setting.
export function captionSizePx(sz) { return sz === "small" ? 11 : sz === "large" ? 16 : 13; }
