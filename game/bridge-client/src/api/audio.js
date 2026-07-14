// Audio Manager using Web Audio API for synthetic placeholder sounds.
// Will be replaced with real assets later.
const AudioContext = window.AudioContext || window.webkitAudioContext;
let ctx = null;
let sfxGain = null;                  // master gain for ALL sfx (honors the sliders)
let masterVol = 0.4, sfxVol = 0.42;  // 0..1, from Master + Sound Effects sliders (defaults lowered 50%)

function clamp01(n) { return Math.max(0, Math.min(1, n)); }
let duckMul = 1;                     // 0 while a video ad plays (CrazyGames req)
function sfxTarget() { return clamp01(masterVol * sfxVol * duckMul); }

// Hard-mute/unmute ALL sfx without touching the user's slider settings.
// Used while platform video ads play (mute is a CrazyGames requirement).
export function setAudioDucked(ducked) {
  duckMul = ducked ? 0 : 1;
  if (sfxGain && ctx) sfxGain.gain.setValueAtTime(sfxTarget(), ctx.currentTime);
}
// Route sfx through the master gain node once it exists, else straight to output.
function dest() { return sfxGain || (ctx && ctx.destination); }

export function initAudio() {
  if (!ctx) {
    ctx = new AudioContext();
    sfxGain = ctx.createGain();
    sfxGain.gain.value = sfxTarget();
    sfxGain.connect(ctx.destination);
  }
  if (ctx.state === "suspended") {
    ctx.resume();
  }
}

// Update SFX volume from the Audio settings (0..100 sliders). Master multiplies
// the SFX slider, mirroring music.js. Safe to call before initAudio().
export function setSfxVolumes({ master, sfx } = {}) {
  if (typeof master === "number") masterVol = clamp01(master / 100);
  if (typeof sfx === "number") sfxVol = clamp01(sfx / 100);
  if (sfxGain && ctx) sfxGain.gain.setValueAtTime(sfxTarget(), ctx.currentTime);
}

// Helper to play an oscillator sound
// MUTE. There was no way to turn the game's sound off — which is a basic thing a
// player expects, and the ESC menu now offers it.
let _muted = (() => { try { return localStorage.getItem("gp_muted") === "1"; } catch { return false; } })();
export function setMuted(v) {
  _muted = !!v;
  try { localStorage.setItem("gp_muted", _muted ? "1" : "0"); } catch {}
}
export function isMuted() { return _muted; }

function playTone(type, freq, duration, vol = 0.1, sweep = false) {
  if (_muted) return;
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.connect(gain);
  gain.connect(dest());
  
  osc.frequency.setValueAtTime(freq, ctx.currentTime);
  if (sweep) {
    osc.frequency.exponentialRampToValueAtTime(freq * 0.1, ctx.currentTime + duration);
  }
  
  gain.gain.setValueAtTime(vol, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration);
  
  osc.start();
  osc.stop(ctx.currentTime + duration);
}

// Noise generator for slashes/explosions
function playNoise(duration, vol = 0.2, highpass = false) {
  if (_muted) return;
  if (!ctx) return;
  const bufferSize = ctx.sampleRate * duration;
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  const noise = ctx.createBufferSource();
  noise.buffer = buffer;
  
  let lastNode = noise;
  if (highpass) {
    const filter = ctx.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.value = 1000;
    lastNode.connect(filter);
    lastNode = filter;
  }
  
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(vol, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration);
  
  lastNode.connect(gain);
  gain.connect(dest());
  
  noise.start();
}

// ============================================================================
// THE ENGINE
//
// A kart racer with silent karts feels dead. But an engine loop is also the single
// easiest thing to make MADDENING — it's on for the entire race, so it has to sit
// UNDER everything else and never demand attention.
//
// So: two detuned sawtooth oscillators (the beating between them is what gives an
// engine its texture), a low-pass filter that opens as you accelerate, and a gain
// that never rises above a whisper. The PITCH follows your speed, so you hear
// yourself accelerate — which is the entire point of having it.
// ============================================================================
let _engine = null;

export function startEngine() {
  if (!ctx || _engine) return;
  try {
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();

    osc1.type = "sawtooth";
    osc2.type = "sawtooth";
    osc1.frequency.value = 55;
    osc2.frequency.value = 55 * 1.012;      // detuned — the BEAT between them is the engine

    filter.type = "lowpass";
    filter.frequency.value = 300;
    filter.Q.value = 3;

    // A WHISPER. This is deliberately very quiet: it's a bed, not a feature.
    gain.gain.value = 0.0;

    osc1.connect(filter);
    osc2.connect(filter);
    filter.connect(gain);
    gain.connect(dest());
    osc1.start();
    osc2.start();

    _engine = { osc1, osc2, filter, gain };
  } catch { /* no audio context yet */ }
}

export function updateEngine(speed01, airborne = false) {
  if (!_engine || !ctx) return;
  const t = ctx.currentTime;
  const s = Math.max(0, Math.min(1, speed01));

  // pitch rises with speed — an idle thrum up to a working note
  const base = 48 + s * 62;
  _engine.osc1.frequency.setTargetAtTime(base, t, 0.08);
  _engine.osc2.frequency.setTargetAtTime(base * 1.012, t, 0.08);

  // the filter OPENS as you accelerate: that's what makes it sound like effort
  _engine.filter.frequency.setTargetAtTime(220 + s * 900, t, 0.10);

  // and the volume. The ceiling here (0.035) is about a fifth of a normal sound
  // effect — you should notice it only when it's gone.
  const target = _muted ? 0 : (0.010 + s * 0.025) * (airborne ? 0.45 : 1);
  _engine.gain.gain.setTargetAtTime(target, t, 0.12);
}

export function stopEngine() {
  if (!_engine || !ctx) return;
  try {
    _engine.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.15);
    const e = _engine;
    _engine = null;
    setTimeout(() => { try { e.osc1.stop(); e.osc2.stop(); } catch {} }, 400);
  } catch { _engine = null; }
}

export const sfx = {
  setMuted,
  isMuted,
  startEngine,
  updateEngine,
  stopEngine,
  // ============================================================
  // THE ITEM LAYER — every power gets its own voice.
  // Anime rule: the bigger the move, the longer the wind-up and the more
  // layers in the payoff. An S-tier item should make you sit up.
  // ============================================================

  // --- bronze: scrappy, wet, cheap ---
  waterbombThrow: () => { playNoise(0.06, 0.14, true); playTone("sine", 220, 0.10, 0.10); },
  waterbombPop:   () => { playNoise(0.18, 0.34, true); playTone("sine", 130, 0.16, 0.20); },
  puddleDrop:     () => { playTone("sine", 180, 0.12, 0.14); playNoise(0.10, 0.16, true); },
  fizzpop:        () => {
    playNoise(0.10, 0.12, true);
    for (let i = 0; i < 5; i++) setTimeout(() => playTone("square", 700 + i * 190, 0.05, 0.06), i * 34);
  },
  sandclodThrow:  () => { playNoise(0.09, 0.22, true); playTone("triangle", 150, 0.12, 0.14); },
  sandclodHit:    () => { playNoise(0.42, 0.40, true); playTone("sawtooth", 90, 0.30, 0.16, true); },

  // --- silver: solid, confident ---
  clusterThrow:   () => { for (let i = 0; i < 3; i++) setTimeout(() => { playNoise(0.05, 0.13, true); playTone("sine", 240 + i * 40, 0.08, 0.09); }, i * 55); },
  soakerBlast:    () => {
    playNoise(0.9, 0.30, true);
    playTone("sawtooth", 300, 0.7, 0.10, true);
  },
  icepopFreeze:   () => {
    playTone("sine", 1400, 0.20, 0.10);
    setTimeout(() => playTone("sine", 1900, 0.24, 0.09), 70);
    setTimeout(() => playTone("triangle", 2600, 0.30, 0.06), 150);
    playNoise(0.30, 0.10, true);
  },
  ballBounce:     () => { playTone("sine", 420, 0.09, 0.16); playTone("sine", 640, 0.06, 0.08); },

  // --- gold: heavy, dangerous ---
  hydroLaunch:    () => {
    playTone("sawtooth", 90, 0.26, 0.20, true);
    playNoise(0.16, 0.26, true);
  },
  hydroBoom:      () => {
    playTone("sine", 55, 0.60, 0.34);
    playNoise(0.55, 0.46, true);
    playTone("sawtooth", 120, 0.34, 0.18, true);
    setTimeout(() => playNoise(0.42, 0.22, true), 130);
  },
  geyserArm:      () => { playTone("square", 520, 0.06, 0.07); },
  geyserBlow:     () => {
    // a rising column of water — pitch sweeps UP, unlike an explosion
    playTone("sawtooth", 140, 0.55, 0.24);
    for (let i = 0; i < 8; i++) setTimeout(() => playTone("sine", 300 + i * 220, 0.10, 0.10), i * 45);
    playNoise(0.60, 0.34, true);
  },
  monsoonRoll:    () => {
    playTone("sine", 70, 0.9, 0.22);
    playNoise(1.2, 0.20, true);
    setTimeout(() => { playTone("sawtooth", 95, 0.5, 0.14, true); }, 250);
  },
  rocketFloat:    () => {
    playTone("sawtooth", 200, 0.5, 0.16, true);
    for (let i = 0; i < 4; i++) setTimeout(() => playTone("square", 500 + i * 260, 0.08, 0.08), i * 60);
  },

  // --- S-TIER: the wind-up, then the sky falls in ---
  ultimateCharge: () => {
    // the anime wind-up: a rising whine that tells everyone something is coming
    playTone("sawtooth", 180, 0.55, 0.14, true);
    for (let i = 0; i < 9; i++) setTimeout(() => playTone("square", 240 + i * 150, 0.06, 0.05), i * 55);
    playNoise(0.5, 0.08, true);
  },
  tsunamiRoar:    () => {
    playTone("sine", 45, 1.6, 0.36);
    playNoise(2.0, 0.50, true);
    playTone("sawtooth", 85, 1.2, 0.22, true);
    setTimeout(() => { playTone("sine", 60, 1.2, 0.26); playNoise(1.4, 0.36, true); }, 350);
  },
  krakenGrasp:    () => {
    playTone("sine", 62, 0.9, 0.30);
    playTone("sawtooth", 130, 0.7, 0.20, true);
    for (let i = 0; i < 6; i++) setTimeout(() => playTone("triangle", 420 - i * 45, 0.16, 0.12), i * 90);
    playNoise(1.0, 0.30, true);
  },
  meteorScream:   () => {
    // the falling-shell scream, then the crater
    playTone("sawtooth", 1600, 0.85, 0.16, true);
    setTimeout(() => {
      playTone("sine", 48, 0.8, 0.40);
      playNoise(0.9, 0.55, true);
      playTone("sawtooth", 110, 0.5, 0.22, true);
    }, 700);
  },
  hypernova:      () => {
    // pure triumph: a rising fifth, a shimmer, and a wall of light
    playTone("triangle", 392, 0.22, 0.18);
    setTimeout(() => playTone("triangle", 587, 0.22, 0.18), 110);
    setTimeout(() => playTone("triangle", 784, 0.34, 0.20), 220);
    setTimeout(() => playTone("square", 1568, 0.50, 0.10), 320);
    setTimeout(() => { playNoise(0.7, 0.20, true); playTone("sine", 90, 0.7, 0.24); }, 300);
  },

  // --- the buffs get a voice too ---
  shieldUp:       () => { playTone("sine", 520, 0.16, 0.14); setTimeout(() => playTone("sine", 780, 0.22, 0.12), 80); },
  shieldBreak:    () => { playNoise(0.20, 0.30, true); playTone("square", 300, 0.14, 0.14, true); },
  blinded:        () => { playNoise(0.7, 0.30, true); playTone("sawtooth", 120, 0.5, 0.12, true); },

  // ============================================================
  // THE MODES. Each one needs its own vocabulary — a flag capture and a pearl
  // pickup must not sound the same, or the whole game turns to mush.
  // ============================================================

  // --- DERBY ---
  wreckerHit: () => {
    playTone("sawtooth", 70, 0.30, 0.30, true);
    playNoise(0.35, 0.40, true);
    playTone("square", 160, 0.16, 0.14, true);
  },
  lifeLost: () => {
    playTone("sawtooth", 300, 0.35, 0.20, true);   // a descending, sickening drop
    setTimeout(() => playTone("sawtooth", 180, 0.4, 0.18, true), 120);
  },
  eliminated: () => {
    playTone("sine", 90, 0.9, 0.28);
    playNoise(0.7, 0.35, true);
    setTimeout(() => playTone("triangle", 200, 0.5, 0.14, true), 200);
  },
  ringClosing: () => { playTone("sine", 55, 1.2, 0.12); },

  // --- CTF ---
  flagTaken: () => {
    playTone("triangle", 523, 0.14, 0.16);
    setTimeout(() => playTone("triangle", 784, 0.20, 0.16), 90);
  },
  flagCaptured: () => {
    // a real fanfare — this is the whole point of the mode
    playTone("triangle", 523, 0.16, 0.20);
    setTimeout(() => playTone("triangle", 659, 0.16, 0.20), 110);
    setTimeout(() => playTone("triangle", 784, 0.16, 0.20), 220);
    setTimeout(() => playTone("triangle", 1047, 0.45, 0.24), 330);
    setTimeout(() => playNoise(0.35, 0.14, true), 330);
  },
  flagDropped: () => { playTone("sawtooth", 220, 0.26, 0.16, true); },
  flagReturned: () => { playTone("sine", 660, 0.18, 0.14); setTimeout(() => playTone("sine", 880, 0.22, 0.12), 90); },

  // --- SAND ARTIST ---
  waterPour: () => { playNoise(0.10, 0.05, true); },        // a soft trickle, fired often
  propStamp: () => { playTone("sine", 500, 0.09, 0.12); playNoise(0.06, 0.08, true); },
  guessTick: () => { playTone("square", 700, 0.05, 0.07); },  // the 5s countdown
  guessCorrect: () => {
    playTone("triangle", 659, 0.14, 0.20);
    setTimeout(() => playTone("triangle", 880, 0.14, 0.20), 100);
    setTimeout(() => playTone("triangle", 1319, 0.40, 0.22), 200);
  },
  guessWrong: () => {
    playTone("sawtooth", 200, 0.30, 0.22, true);
    playNoise(0.45, 0.35, true);
    setTimeout(() => playTone("sawtooth", 110, 0.45, 0.20, true), 130);
  },
  roundStart: () => { playTone("sine", 440, 0.16, 0.14); setTimeout(() => playTone("sine", 660, 0.22, 0.14), 110); },

  // --- TAG ---
  tagged: () => {
    // a slap, then a rising alarm — you are now the problem
    playNoise(0.14, 0.32, true);
    playTone("square", 400, 0.10, 0.16);
    setTimeout(() => { playTone("sawtooth", 260, 0.5, 0.18, true); }, 90);
  },
  tagPassed: () => { playTone("triangle", 880, 0.20, 0.18); },   // relief
  itPulse: () => { playTone("sine", 180, 0.14, 0.09); },          // the ticking while IT

  // --- PEARL RUSH ---
  pearlGrab: () => { playTone("sine", 1200, 0.07, 0.10); playTone("sine", 1800, 0.05, 0.05); },
  pearlSpill: () => {
    playNoise(0.30, 0.26, true);
    for (let i = 0; i < 6; i++) setTimeout(() => playTone("sine", 900 - i * 90, 0.06, 0.08), i * 45);
  },
  crownTaken: () => {
    playTone("triangle", 784, 0.18, 0.18);
    setTimeout(() => playTone("triangle", 1047, 0.30, 0.20), 120);
  },

  // --- TRACK HAZARDS ---
  oilSlick:   () => { playTone("sine", 260, 0.5, 0.10); playNoise(0.4, 0.10, true); },
  quicksand:  () => { playNoise(0.5, 0.22, true); playTone("sawtooth", 90, 0.5, 0.14, true); },
  crabHit:    () => { playNoise(0.16, 0.30, true); playTone("square", 320, 0.10, 0.16); },
  rockHit:    () => { playTone("sawtooth", 100, 0.24, 0.26, true); playNoise(0.3, 0.32, true); },
  waveWash:   () => { playNoise(0.8, 0.30, true); playTone("sine", 120, 0.7, 0.18); },

  lavaBurn: () => {
    playNoise(0.6, 0.35, true);
    playTone("sawtooth", 80, 0.6, 0.24, true);
    for (let i = 0; i < 4; i++) setTimeout(() => playTone("square", 900 - i * 150, 0.08, 0.10), i * 70);
  },
  ashCloud: () => { playNoise(0.9, 0.28, true); playTone("sine", 140, 0.7, 0.12); },

  // riding the kerb: a short, dry rattle. It has to be UNMISTAKABLE, because it's
  // the only thing telling you you've run out of road.
  curbRumble: () => { playNoise(0.06, 0.16, true); playTone('square', 90, 0.05, 0.06); },

  // ---- STUNNED: THE BIRDS ----
  // The visual gag is birds circling your head. It needs the sound, or it's mime.
  // Two quick rising chirps — the classic cartoon tweet — kept quiet, because it
  // repeats while you're dazed and a loud one would be torture.
  birdChirp: () => {
    playTone("sine", 1400 + Math.random() * 400, 0.05, 0.05);
    setTimeout(() => playTone("sine", 1900 + Math.random() * 500, 0.04, 0.04), 55);
  },
  // and the "you have been walloped" thud, once, when it starts
  dazedThud: () => {
    playNoise(0.16, 0.24, false);
    playTone("sine", 90, 0.30, 0.16, true);
    setTimeout(() => playTone("triangle", 300, 0.20, 0.07, true), 120);
  },

  // ---- START LIGHTS ----
  // A low prep beep per red lamp, a tenser one on yellow, then a bright chord
  // on green. The pitch rising across the sequence is what makes the launch
  // feel earned instead of arbitrary.
  lightRed: () => { playTone("sine", 300, 0.16, 0.16); },
  lightYellow: () => { playTone("sine", 420, 0.16, 0.18); },
  lightGreen: () => {
    playTone("triangle", 660, 0.30, 0.20);
    setTimeout(() => playTone("triangle", 880, 0.34, 0.18), 60);
    setTimeout(() => playTone("square", 1320, 0.28, 0.10), 120);
    playNoise(0.10, 0.20, true);
  },

  // ---- GAME-FEEL LAYER (threat → impact → reward) ----
  // Threat: a tick that rises in pitch and urgency as danger closes. The
  // anticipation phase is where the dopamine loop starts — the brain needs a
  // rising signal to make the impact (or the dodge) land.
  threatTick: (intensity = 0.5) => {
    const f = 480 + intensity * 620;
    playTone("square", f, 0.05, 0.05 + intensity * 0.07);
  },
  // Impact: layered transient — low thump + splash noise + a short mid crack.
  impactThud: () => {
    playTone("sine", 95, 0.16, 0.22);
    playNoise(0.14, 0.30, true);
    playTone("triangle", 320, 0.08, 0.12);
  },
  // The kill: a BOOM with real low end, sand-noise wash, and a sub drop.
  crumbleBoom: () => {
    playTone("sine", 60, 0.5, 0.30);
    playNoise(0.5, 0.42, true);
    playTone("sawtooth", 140, 0.25, 0.14, true);
    setTimeout(() => playNoise(0.35, 0.18, true), 140);
  },
  // The attacker's reward: impact first (shared with the victim's world),
  // then within 250ms a bright rising three-note + sparkle — confirmation
  // arriving right inside the reward window.
  takedownJingle: () => {
    playTone("sine", 90, 0.14, 0.24);
    playNoise(0.12, 0.26, true);
    setTimeout(() => {
      playTone("triangle", 523, 0.10, 0.13);                       // C
      setTimeout(() => playTone("triangle", 659, 0.10, 0.13), 80); // E
      setTimeout(() => playTone("triangle", 880, 0.22, 0.13), 160);// A
      setTimeout(() => playTone("sine", 1760, 0.18, 0.07), 240);   // sparkle
    }, 180);
  },
  // Lap flag: a whip-crack + a settling tone; the final lap gets a fanfare.
  lapFlag: () => {
    playNoise(0.07, 0.22, true);
    playTone("triangle", 587, 0.16, 0.12);
  },
  finalFanfare: () => {
    playNoise(0.07, 0.24, true);
    playTone("triangle", 523, 0.11, 0.13);
    setTimeout(() => playTone("triangle", 659, 0.11, 0.13), 100);
    setTimeout(() => playTone("triangle", 784, 0.11, 0.13), 200);
    setTimeout(() => playTone("square", 1046, 0.30, 0.10), 300);
  },
  respawnPop: () => {
    playTone("sine", 240, 0.08, 0.14);
    setTimeout(() => playTone("sine", 480, 0.12, 0.12), 70);
  },

  // IRON FRONTIER SFX — western-fusion timbres (twangy, plucky, brassy) that
  // still keep the over-the-top anime punch on hits (slash/dash/eject/downed).
  walk: () => playTone("triangle", 108, 0.12, 0.05), // muffled boot-step on the deck
  click: () => playTone("sine", 760, 0.05, 0.1),
  taskComplete: () => {
    // A plucky western "up a fifth to the octave" flourish (banjo-ish triangle).
    playTone("triangle", 392, 0.12, 0.11);           // G
    setTimeout(() => playTone("triangle", 587, 0.14, 0.11), 90);  // D
    setTimeout(() => playTone("triangle", 784, 0.30, 0.10), 190); // G'
  },
  taskError: () => playTone("sawtooth", 150, 0.3, 0.1),
  slash: () => {
    playNoise(0.4, 0.5, true);
    playTone("sawtooth", 200, 0.4, 0.2, true);
  },
  alarm: () => {
    playTone("square", 600, 0.5, 0.15);
    setTimeout(() => playTone("square", 400, 0.5, 0.15), 500);
  },
  siren: () => {
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sawtooth";
    osc.connect(gain);
    gain.connect(dest());
    
    const now = ctx.currentTime;
    osc.frequency.setValueAtTime(350, now);
    osc.frequency.linearRampToValueAtTime(700, now + 0.4);
    osc.frequency.linearRampToValueAtTime(350, now + 0.8);
    
    gain.gain.setValueAtTime(0.08, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.8);
    
    osc.start();
    osc.stop(now + 0.8);
  },
  eject: () => {
    playNoise(1.5, 0.6);
    playTone("triangle", 100, 1.5, 0.4, true);
  },
  // Rising whine while a dash charges (a short upward sweep "vwiiip").
  dashCharge: () => {
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sawtooth";
    osc.connect(gain); gain.connect(dest());
    osc.frequency.setValueAtTime(220, now);
    osc.frequency.exponentialRampToValueAtTime(880, now + 0.5);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.08, now + 0.1);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.55);
    osc.start(now); osc.stop(now + 0.55);
  },
  // Explosive dash release — a bright whoosh + a thwip transient.
  dash: () => {
    playNoise(0.25, 0.4, true);
    playTone("square", 900, 0.18, 0.14, true);
    setTimeout(() => playTone("sine", 500, 0.12, 0.1, true), 30);
  },
  // Shield raise — a warm electric hum that swells then settles.
  shield: () => {
    if (!ctx) return;
    const now = ctx.currentTime;
    [330, 495].forEach((f, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.connect(gain); gain.connect(dest());
      osc.frequency.setValueAtTime(f * 0.6, now);
      osc.frequency.exponentialRampToValueAtTime(f, now + 0.18);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.07, now + 0.12);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.7);
      osc.start(now + i * 0.02); osc.stop(now + 0.75);
    });
  },
  // Drone deploy/active — a chittery synthetic servo blip.
  drone: () => {
    playTone("square", 1200, 0.06, 0.08);
    setTimeout(() => playTone("square", 1500, 0.06, 0.07), 70);
    setTimeout(() => playTone("triangle", 900, 0.2, 0.06, true), 140);
  },
  // Harsh negative cue: a low descending growl + a noise burst. Played when an
  // outlaw pulls YOUR oxygen cable (you go down).
  downed: () => {
    if (!ctx) return;
    const now = ctx.currentTime;
    // descending detuned tones for a sick "power-loss" feel
    [220, 165].forEach((f, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sawtooth";
      osc.connect(gain); gain.connect(dest());
      osc.frequency.setValueAtTime(f, now);
      osc.frequency.exponentialRampToValueAtTime(f * 0.35, now + 0.7);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.22, now + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.8);
      osc.start(now + i * 0.05); osc.stop(now + 0.85);
    });
    playNoise(0.5, 0.35);
  },
  // Countdown tick for the 3-2-1 duel start — a dry western "clack".
  // A SOFTER COUNTDOWN.
  //
  // This was a SQUARE wave at 520Hz — a buzzer. Square waves are all odd harmonics
  // and they buzz; at 520Hz sitting right in the ear's most sensitive band, it's
  // the definition of an annoying beep. And it fires repeatedly while you're stuck
  // in the lobby waiting for a race.
  //
  // A sine at a lower pitch, quieter, with a soft triangle under it: it still cuts
  // through, it still counts you in, and it doesn't make you want to mute the tab.
  countTick: () => {
    playTone("sine", 392, 0.09, 0.045);
    setTimeout(() => playTone("triangle", 262, 0.11, 0.028), 45);
  },
  // "DRAW!" stinger — a brassy hit with a noise crack for the showdown start.
  drawStinger: () => {
    playNoise(0.14, 0.16, true);
    playTone("triangle", 220, 0.30, 0.09, true);
    setTimeout(() => playTone("sine", 660, 0.20, 0.07), 45);
    setTimeout(() => playTone("triangle", 990, 0.4, 0.1, true), 95);
  },

  // ---------- SANDBOX GP race sounds (synth placeholders) ----------
  // Water splash: bright noise burst + descending bloop.
  splash: () => {
    playNoise(0.22, 0.28, true);
    playTone("sine", 620, 0.24, 0.12, true);
  },
  // Balloon pop: dry crack + tiny bloop.
  pop: () => {
    playNoise(0.06, 0.3, true);
    setTimeout(() => playTone("sine", 340, 0.12, 0.08, true), 25);
  },
  // Item fired: quick airy whoosh.
  itemAway: () => {
    playNoise(0.16, 0.18, true);
    playTone("triangle", 300, 0.2, 0.08);
  },
  // Tier fanfare: rising two/three/four-note arpeggio by tier.
  tier: (t) => {
    const seq = { bronze: [392, 494], silver: [392, 494, 587], gold: [392, 494, 587, 784], s: [523, 659, 784, 1046] }[t] || [392, 494];
    seq.forEach((f, i) => setTimeout(() => playTone("triangle", f, 0.18, 0.12), i * 90));
  },
  // Challenge start: bright double ping.
  challenge: () => {
    playTone("sine", 880, 0.1, 0.1);
    setTimeout(() => playTone("sine", 1175, 0.14, 0.1), 90);
  },
  // Ring threaded: crisp ascending blip.
  ring: () => playTone("sine", 1320, 0.09, 0.11),
  // Kite latch: wobbling alarm — you're hooked!
  kiteLatch: () => {
    [420, 360, 420, 360].forEach((f, i) => setTimeout(() => playTone("square", f, 0.11, 0.09), i * 95));
  },
  // Kite break: springy release upward.
  kiteBreak: () => {
    playTone("sine", 300, 0.22, 0.12);
    setTimeout(() => playTone("sine", 700, 0.18, 0.1), 60);
  },
  // Crumble: low crunchy collapse.
  crumble: () => {
    playNoise(0.4, 0.34);
    playTone("sawtooth", 120, 0.45, 0.14, true);
  },
  // Bucket block: metallic clonk.
  block: () => {
    playTone("square", 240, 0.1, 0.14);
    setTimeout(() => playTone("square", 180, 0.14, 0.1), 55);
  },
  // Turbo: rising slurp + fizz.
  turbo: () => {
    const now = ctx?.currentTime; if (now == null) return;
    const osc = ctx.createOscillator(); const gain = ctx.createGain();
    osc.type = "sine"; osc.connect(gain); gain.connect(dest());
    osc.frequency.setValueAtTime(220, now);
    osc.frequency.exponentialRampToValueAtTime(880, now + 0.5);
    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.55);
    osc.start(now); osc.stop(now + 0.6);
    playNoise(0.3, 0.1, true);
  },
  // Lap chime: friendly two-note.
  lap: () => {
    playTone("triangle", 660, 0.14, 0.11);
    setTimeout(() => playTone("triangle", 880, 0.2, 0.11), 110);
  },
  // FINAL LAP: urgent rising triplet — everything is on the line.
  finalLap: () => {
    [523, 659, 1046].forEach((f, i) => setTimeout(() => playTone("square", f, 0.16, 0.12), i * 130));
  },
  // Item roulette: fast ratchet tick while the chip spins, bright ding on land.
  rouletteTick: () => playTone("square", 990, 0.03, 0.05),
  rouletteLand: () => {
    playTone("triangle", 784, 0.1, 0.12);
    setTimeout(() => playTone("triangle", 1175, 0.18, 0.12), 90);
  },
  // Wrong way: two soft low blips (visual overlay carries the message).
  wrongWay: () => {
    playTone("square", 220, 0.12, 0.1);
    setTimeout(() => playTone("square", 180, 0.16, 0.1), 160);
  },
};
