// ============================================================
// SANDBOX GP — palette + material kit.
// One warm beach palette for the entire world. THE COLOR RULES:
// warm sand tones dominate, saturated toy-plastic primaries for cars/props,
// turquoise strictly for water. NO PURPLE, ever.
// ============================================================
import * as THREE from "three";

// ---- PER-TRACK THEMES -------------------------------------------------------
// Every map is sand-based, but the sand is a different sand each time: golden
// beach, sun-bleached Egyptian dust, cold white shingle, and pink lagoon silt.
// Only the colours that define a place are overridden — everything else (curbs,
// toy plastics, kart paint) stays constant so the game still reads as one game.
export const THEMES = {
  beach: {},   // the default palette below

  egypt: {
    skyTop: 0x6fb7d8, skyBottom: 0xffe6b0,
    sunlight: 0xfff0cc, ambient: 0xd8c8a0,
    sandLight: 0xe8c98c,   // bleached, hard-edged desert sand
    sandDark: 0xc79a5c,
    sandEdge: 0xfff2cf,
    water: 0x3f9d8a,       // the Nile, if you can find it
    stone: 0xd4b483,       // limestone
    stoneDark: 0xa8834f,
    accent: 0xf0c04a,      // gold leaf
  },

  shingle: {
    skyTop: 0x9fd0e8, skyBottom: 0xeef4f6,
    sunlight: 0xf2f8fb, ambient: 0xcfe0e8,
    sandLight: 0xe9e6dd,   // white pebbles, cold and bright
    sandDark: 0xbfbcb2,
    sandEdge: 0xffffff,
    water: 0x4aa8b8,       // cold Atlantic
    stone: 0xd8d5cc,
    stoneDark: 0x9a978e,
    accent: 0x2fe6c8,
  },

  pier: {
    skyTop: 0xf0a8c8, skyBottom: 0xffe0e8,   // rose sunset
    sunlight: 0xffe4ee, ambient: 0xf2c8d8,
    sandLight: 0xf5c4d4,   // the lagoon silt you can see through the water
    sandDark: 0x8a4a5e,    // the dock's dark planks
    sandEdge: 0xfff1f5,
    water: 0xe86a9a,       // THE PINK SEA — the thing that will kill you
    stone: 0xa8657a,
    stoneDark: 0x6e3d4e,
    accent: 0xfff1d6,
  },

  volcano: {
    skyTop: 0x3a2a3a, skyBottom: 0xd97a4a,   // a bruised, smoky sunset
    sunlight: 0xffb080, ambient: 0x6a4a5a,
    sandLight: 0x4a4048,    // BLACK volcanic sand
    sandDark: 0x2a2228,
    sandEdge: 0xff8a3c,     // the road edge glows like a cooling ember
    water: 0x2a5a6a,
    stone: 0x3a3038,
    stoneDark: 0x1c1620,
    accent: 0xff5a1c,       // lava
  },

  night: {
    skyTop: 0x0a1030, skyBottom: 0x2a3a6a,   // deep night
    sunlight: 0xc8d8ff,     // moonlight, not sunlight
    ambient: 0x3a4a7a,
    sandLight: 0x8a8aa8,    // moonlit dune
    sandDark: 0x5a5a78,
    sandEdge: 0xd8e4ff,
    water: 0x2fe6c8,        // BIOLUMINESCENCE
    stone: 0x6a6a88,
    stoneDark: 0x3a3a52,
    accent: 0x2fe6c8,
  },
};

// Resolve the live palette for a track: theme overrides on top of the default.
export function paletteFor(theme) {
  return { ...PALETTE, ...(THEMES[theme] || {}) };
}

export const PALETTE = {
  skyTop: 0x7ec8e8,      // soft summer sky
  skyBottom: 0xfff3d6,   // warm cream horizon
  sunlight: 0xfff2dd,
  ambient: 0xbfe3f2,

  // THE ROAD HAS TO BE VISIBLE. sandLight (f2dca8) and sandDark (d9b077) were
  // almost the same colour — the track was a beige stripe on beige sand and you
  // genuinely could not see where the road ended. Packed wet sand is much darker
  // and cooler than dry beach sand, so this is also just more truthful.
  sandLight: 0xf7e2b8,   // dry beach sand — lighter, warmer
  sandDark: 0xb08652,    // the ROAD: packed wet sand, properly darker
  sandEdge: 0xfffdf2,    // the painted lane edge, near-white so it pops

  curbRed: 0xe2574c,
  curbWhite: 0xfff7ea,

  water: 0x4cc2b0,       // turquoise — water ONLY

  // toy plastic accents
  toyRed: 0xe2574c,
  toyYellow: 0xf2b134,
  toyBlue: 0x4ca7e2,
  toyGreen: 0x58c26a,
  toyOrange: 0xe28b4c,
  toyPink: 0xd95f9b,

  tire: 0x3a3532,
  hub: 0xfff7ea,
  skin: 0xffd9b0,
  skin2: 0xc98d5f,
};

// The whole world speaks one material language: matte toy plastic.
// Lambert renders reliably under SwiftShader and reads soft + friendly.
export function plastic(color, opts = {}) {
  return new THREE.MeshLambertMaterial({ color, ...opts });
}

// A slightly glossier plastic for car bodies (still Lambert-cheap via emissive lift).
export function bodyPlastic(color) {
  const m = new THREE.MeshLambertMaterial({ color });
  m.emissive = new THREE.Color(color).multiplyScalar(0.06);
  return m;
}

// Vertical sky gradient as a big background canvas texture.
export function makeSkyTexture() {
  const c = document.createElement("canvas");
  c.width = 4; c.height = 256;
  const g = c.getContext("2d");
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, "#" + PALETTE.skyTop.toString(16).padStart(6, "0"));
  grad.addColorStop(1, "#" + PALETTE.skyBottom.toString(16).padStart(6, "0"));
  g.fillStyle = grad; g.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Speckled sand: subtle grain so the huge ground plane doesn't read flat.
export function makeSandTexture(base = PALETTE.sandLight, px = 256, density = 900) {
  const c = document.createElement("canvas");
  c.width = c.height = px;
  const g = c.getContext("2d");
  g.fillStyle = "#" + base.toString(16).padStart(6, "0");
  g.fillRect(0, 0, px, px);
  const col = new THREE.Color(base);
  for (let i = 0; i < density; i++) {
    const shade = (Math.random() - 0.5) * 0.16;
    const c2 = col.clone().offsetHSL(0, 0, shade);
    g.fillStyle = c2.getStyle();
    const s = 1 + Math.random() * 2;
    g.fillRect(Math.random() * px, Math.random() * px, s, s);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Checkered start-line texture.
export function makeCheckerTexture(cells = 8) {
  const c = document.createElement("canvas");
  c.width = c.height = cells * 16;
  const g = c.getContext("2d");
  for (let y = 0; y < cells; y++) for (let x = 0; x < cells; x++) {
    g.fillStyle = (x + y) % 2 ? "#2e2a26" : "#fff7ea";
    g.fillRect(x * 16, y * 16, 16, 16);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
