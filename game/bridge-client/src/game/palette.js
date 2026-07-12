// ============================================================
// SANDBOX GP — palette + material kit.
// One warm beach palette for the entire world. THE COLOR RULES:
// warm sand tones dominate, saturated toy-plastic primaries for cars/props,
// turquoise strictly for water. NO PURPLE, ever.
// ============================================================
import * as THREE from "three";

export const PALETTE = {
  skyTop: 0x7ec8e8,      // soft summer sky
  skyBottom: 0xfff3d6,   // warm cream horizon
  sunlight: 0xfff2dd,
  ambient: 0xbfe3f2,

  sandLight: 0xf2dCA8,   // dry beach sand (ground)
  sandDark: 0xd9b077,    // packed wet sand (the track ribbon)
  sandEdge: 0xfff7e0,    // painted lane edge

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
