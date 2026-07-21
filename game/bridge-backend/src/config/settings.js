// ============================================================
// Player settings + radial wheels (v0.1).
// Settings are stored as free-form JSON per account with LIGHT validation: we
// deep-merge the player's saved values over these defaults, so adding a new
// option later is backward-compatible (old accounts just inherit the default).
//
// Two radial wheels (no typing in-game): an EMOTE wheel and a COMMS wheel. Each
// has a fixed number of slots the player binds to owned emotes / voice commands.
// A wheel slot holds an item key (or null for an empty slot).
// ============================================================

export const WHEEL_SLOTS = 8; // slots per radial wheel

// Valid voice-command keys for the comms wheel. Mirrors VOICE_COMMANDS in the
// game engine; kept here so the backend can validate binds without importing the
// engine. If you add a command there, add its key here too.
export const VOICE_COMMAND_KEYS = [
  "SOS", "HELP_TASK", "SABOTAGE_HERE", "REFILL_HERE", "FOLLOW_ME",
  "SUSPECT", "CLEAR", "ON_MY_WAY", "YES", "NO",
];

// Default settings tree. Clients render controls from this shape; values here
// are the out-of-the-box defaults for a new account.
export const DEFAULT_SETTINGS = {
  audio: {
    master: 40,        // 0–100 (lowered 50% — too loud)
    music: 10,         // lowered 50% (was 20)
    sfx: 42,           // lowered 50% (was 85)
    voiceChat: 50,     // incoming proximity/energy voice volume (lowered 50%)
    voiceChatEnabled: true,
    micEnabled: true,
    pushToTalk: false, // false = open mic, true = hold a key
  },
  graphics: {
    quality: "high",   // low | medium | high | ultra
    fullscreen: false,
    fpsLimit: 0,       // 0 = uncapped
    screenShake: true,
  },
  accessibility: {
    colorblindShapes: true,    // the ID shape above heads (on by default)
    highContrast: false,
    captionsEnabled: true,     // who-said-what text for anything you'd hear
    captionSize: "medium",     // small | medium | large
    reducedMotion: false,
    holdToConfirm: false,      // require a hold instead of a tap for risky actions
    showTips: true,            // pop-up gameplay tips (helpful for new/returning players)
    showControlHints: true,    // on-screen contextual control hints (lower corner)
  },
  controls: {
    // Movement + action key bindings. Free-form: any string key code.
    // Defaults are suggestions; the client can rebind freely.
    moveUp: "KeyW", moveDown: "KeyS", moveLeft: "KeyA", moveRight: "KeyD",
    interact: "KeyE",      // do task / refill / repair (context-sensitive)
    useTool: "KeyF",       // impostor cable-pull / context action
    sabotage: "KeyQ",      // open sabotage menu (impostor)
    map: "Tab",
    emoteWheel: "KeyZ",    // hold to open the emote radial
    commsWheel: "KeyC",    // hold to open the comms radial
    pushToTalkKey: "KeyV",
  },
};

// Emotes every account owns and has pre-bound so the emote wheel is usable out
// of the box. Each id has a full ~3s animation in the client (see EMOTE_MOVE in
// IsoPilot.jsx). Kept here so defaultWheels() and the store's account seeder
// agree on the same starter set.
export const DEFAULT_EMOTES = ["emote_wave", "emote_dance", "emote_bow", "emote_peace"];

// Default wheel bindings for a new account: fill what the starter kit owns.
// Slots beyond owned items are null until the player unlocks/binds more.
export function defaultWheels() {
  const pad = (arr) => { const a = arr.slice(0, WHEEL_SLOTS); while (a.length < WHEEL_SLOTS) a.push(null); return a; };
  return {
    // Emote wheel: pre-bound to the starter emotes so it works immediately.
    emote: pad(DEFAULT_EMOTES),
    // Comms wheel binds to voice-command keys; prefill the most useful defaults.
    comms: pad(["SOS", "HELP_TASK", "ON_MY_WAY", "YES", "NO", "FOLLOW_ME", "SUSPECT", "REFILL_HERE"]),
  };
}

// Light validation + merge: clamp numbers, keep known enums, ignore junk keys,
// and merge over defaults so missing fields inherit defaults.
export function sanitizeSettings(incoming = {}) {
  const out = structuredClone(DEFAULT_SETTINGS);
  const num = (v, lo, hi, d) => (typeof v === "number" && isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);
  const bool = (v, d) => (typeof v === "boolean" ? v : d);
  const oneOf = (v, list, d) => (list.includes(v) ? v : d);

  const a = incoming.audio || {};
  out.audio.master = num(a.master, 0, 100, out.audio.master);
  out.audio.music = num(a.music, 0, 100, out.audio.music);
  out.audio.sfx = num(a.sfx, 0, 100, out.audio.sfx);
  out.audio.voiceChat = num(a.voiceChat, 0, 100, out.audio.voiceChat);
  out.audio.voiceChatEnabled = bool(a.voiceChatEnabled, out.audio.voiceChatEnabled);
  out.audio.micEnabled = bool(a.micEnabled, out.audio.micEnabled);
  out.audio.pushToTalk = bool(a.pushToTalk, out.audio.pushToTalk);

  const g = incoming.graphics || {};
  out.graphics.quality = oneOf(g.quality, ["low", "medium", "high", "ultra"], out.graphics.quality);
  out.graphics.fullscreen = bool(g.fullscreen, out.graphics.fullscreen);
  out.graphics.fpsLimit = num(g.fpsLimit, 0, 1000, out.graphics.fpsLimit);
  out.graphics.screenShake = bool(g.screenShake, out.graphics.screenShake);

  const ac = incoming.accessibility || {};
  out.accessibility.colorblindShapes = bool(ac.colorblindShapes, out.accessibility.colorblindShapes);
  out.accessibility.highContrast = bool(ac.highContrast, out.accessibility.highContrast);
  out.accessibility.captionsEnabled = bool(ac.captionsEnabled, out.accessibility.captionsEnabled);
  out.accessibility.captionSize = oneOf(ac.captionSize, ["small", "medium", "large"], out.accessibility.captionSize);
  out.accessibility.reducedMotion = bool(ac.reducedMotion, out.accessibility.reducedMotion);
  out.accessibility.holdToConfirm = bool(ac.holdToConfirm, out.accessibility.holdToConfirm);
  out.accessibility.showTips = bool(ac.showTips, out.accessibility.showTips);
  out.accessibility.showControlHints = bool(ac.showControlHints, out.accessibility.showControlHints);

  // Controls: free-form string keycodes. Keep only string values for known actions.
  const c = incoming.controls || {};
  for (const key of Object.keys(out.controls)) {
    if (typeof c[key] === "string" && c[key].length <= 24) out.controls[key] = c[key];
  }
  return out;
}
