// Audio Manager using Web Audio API for synthetic placeholder sounds.
// Will be replaced with real assets later.
const AudioContext = window.AudioContext || window.webkitAudioContext;
let ctx = null;
let sfxGain = null;                  // master gain for ALL sfx (honors the sliders)
let masterVol = 0.4, sfxVol = 0.42;  // 0..1, from Master + Sound Effects sliders (defaults lowered 50%)

function clamp01(n) { return Math.max(0, Math.min(1, n)); }
function sfxTarget() { return clamp01(masterVol * sfxVol); }
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
function playTone(type, freq, duration, vol = 0.1, sweep = false) {
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

export const sfx = {
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
  countTick: () => {
    playTone("square", 520, 0.06, 0.09);
    setTimeout(() => playTone("triangle", 300, 0.09, 0.06), 40);
  },
  // "DRAW!" stinger — a brassy hit with a noise crack for the showdown start.
  drawStinger: () => {
    playNoise(0.18, 0.35, true);
    playTone("sawtooth", 180, 0.35, 0.16, true);
    setTimeout(() => playTone("square", 660, 0.22, 0.12), 45);
    setTimeout(() => playTone("triangle", 990, 0.4, 0.1, true), 95);
  }
};
