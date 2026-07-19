// ============================================================
// SANDBOX GP — palette + material kit.
// ART DIRECTION: PHOTOGRAPHIC REALISM. A physically-based pipeline: real
// atmosphere (Sky shader + sun), image-based lighting, PBR materials with
// clearcoat car paint, normal-mapped terrain, bloom on real emitters. Colours
// are natural and metered — the drama comes from LIGHT (golden hour, haze,
// backlit signage), not from saturation.
// ============================================================
import * as THREE from "three";

// ---- PER-TRACK THEMES -------------------------------------------------------
// Every map is a real time-of-day and a real weather. `sun` drives the Sky
// shader AND the key light: elevation/azimuth in degrees. `haze` scales
// atmospheric turbidity; `exposure` trims the camera.
export const THEMES = {
  beach: {},   // GOLDEN HOUR COAST — the default below

  egypt: {     // HIGH DESERT NOON — bleached, hard light, pale haze
    sun: { elevation: 52, azimuth: 150 },
    haze: 4.5, exposure: 1.0,
    fogColor: 0xd9cdb4,
    sandLight: 0xdccaa2,
    sandDark: 0xa08a68,
    sandEdge: 0xf2e6cc,
    water: 0x2e6f63,
    stone: 0xc9ad82,
    stoneDark: 0x8a7052,
    accent: 0xd9a441,
  },

  shingle: {   // OVERCAST COVE — flat cool light, grey sea air
    sun: { elevation: 38, azimuth: 200 },
    haze: 9, exposure: 0.92,
    fogColor: 0xc3cdd2,
    sandLight: 0xc9c6bc,
    sandDark: 0x8e8c84,
    sandEdge: 0xe8e6de,
    water: 0x4a7c88,
    stone: 0xb4b1a8,
    stoneDark: 0x77746c,
    accent: 0x3aa8a0,
  },

  pier: {      // SUNSET HARBOUR — low warm sun across the water
    sun: { elevation: 5, azimuth: 250 },
    haze: 5.5, exposure: 1.05,
    fogColor: 0xe7b9a6,
    sandLight: 0xcfae95,
    sandDark: 0x6e5a50,
    sandEdge: 0xf0dcc8,
    water: 0x2e5a72,
    stone: 0x9a7a6a,
    stoneDark: 0x5e4a42,
    accent: 0xe8b64a,
  },

  volcano: {   // ASHFALL DUSK — heavy haze, ember light, black grit
    sun: { elevation: 7, azimuth: 285 },
    haze: 12, exposure: 0.98,
    fogColor: 0x8a5e52,
    sandLight: 0x5c534f,
    sandDark: 0x35302e,
    sandEdge: 0xd9773a,
    water: 0x1e4552,
    stone: 0x4a4340,
    stoneDark: 0x252120,
    accent: 0xe05a24,
  },

  night: {     // BLUE HOUR — the sun just gone, city light doing the work
    sun: { elevation: -3, azimuth: 260 },
    haze: 3.5, exposure: 0.9,
    fogColor: 0x33415e,
    sandLight: 0x8f93a0,
    sandDark: 0x585c6a,
    sandEdge: 0xc9d2e2,
    water: 0x2a5a6e,
    stone: 0x767a88,
    stoneDark: 0x42465a,
    accent: 0x63c9d9,
  },
};

// Resolve the live palette for a track: theme overrides on top of the default.
export function paletteFor(theme) {
  return { ...PALETTE, ...(THEMES[theme] || {}) };
}

export const PALETTE = {
  // GOLDEN HOUR: sun low and warm, long shadows, honeyed haze.
  sun: { elevation: 14, azimuth: 225 },
  haze: 5, exposure: 0.95,
  fogColor: 0xdcc7a8,

  // kept for the gradient-sky fallback (menus, arenas, previews)
  skyTop: 0x6f9fca,
  skyBottom: 0xe8d5b4,
  sunlight: 0xffe0b0,
  ambient: 0xb8c8dc,

  // THE ROAD HAS TO BE VISIBLE: dry loose sand vs dark packed racing surface —
  // the real-world contrast of a groomed course, plus painted edge lines.
  sandLight: 0xd8c49c,   // dry beach sand, natural
  sandDark: 0x93805f,    // the ROAD: packed damp sand
  sandEdge: 0xf4ead6,    // painted lane edge

  curbRed: 0xc2372e,     // real kerb paint — oxide red / off-white
  curbWhite: 0xefe8da,

  water: 0x2c6a7e,       // deep coastal water; the sky does the colouring

  // prop paints — natural saturations
  toyRed: 0xc24a3e,
  toyYellow: 0xd9a83c,
  toyBlue: 0x3e7fb5,
  toyGreen: 0x4e9a5e,
  toyOrange: 0xc97a3a,
  toyPink: 0xc46a8e,

  // EMITTERS — real light sources (signage, LEDs, lamps). Bloom is what makes
  // them glow; these are just their chromaticities.
  neonPink: 0xff4d8c,
  neonCyan: 0x4dd8ff,
  neonYellow: 0xffd24d,
  neonPurple: 0xb06aff,
  neonOrange: 0xff8a3d,
  ledWhite: 0xf2f6ff,
  ledRed: 0xff4a3c,

  tire: 0x27262a,
  hub: 0xd8d4cc,
  skin: 0xe8bd93,
  skin2: 0xb07a50,
};

// ---- THE MATERIAL LANGUAGE: PBR ---------------------------------------------
// One physically-based vocabulary for the whole world. `plastic` is the
// general-purpose dielectric (painted wood, plastic, stone — tune roughness);
// `bodyPlastic` is automotive clearcoat; `neon` is an EMITTER the bloom pass
// picks up. All three keep their old names so every call site keeps working.
export function plastic(color, opts = {}) {
  const { roughness = 0.62, metalness = 0.0, ...rest } = opts;
  return new THREE.MeshStandardMaterial({ color, roughness, metalness, ...rest });
}

// Car paint: metallic base under a hard clearcoat — the wet-look highlight and
// the environment wrapped around the shell are what read as "real car".
export function bodyPlastic(color) {
  return new THREE.MeshPhysicalMaterial({
    color,
    metalness: 0.85,
    roughness: 0.32,
    clearcoat: 1.0,
    clearcoatRoughness: 0.08,
    envMapIntensity: 1.2,
  });
}

// A real light emitter: dark housing colour, the light lives in `emissive`.
// Bloom turns emissiveIntensity > 1 into the halo — no additive fakery.
export function neon(color, opts = {}) {
  const { opacity = 1, intensity = 2.2, ...rest } = opts;
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(color).multiplyScalar(0.25),
    emissive: color,
    emissiveIntensity: intensity,
    roughness: 0.4,
    metalness: 0.0,
    transparent: opacity < 1,
    opacity,
    ...rest,
  });
}

// ---- PROCEDURAL PBR GROUND MAPS ---------------------------------------------
// Albedo + normal + roughness from layered value noise. This is what stops the
// terrain reading as one flat paint: grain that catches the low sun.
function valueNoise(px, seedInit) {
  let s = seedInit;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const g = new Float32Array(px * px);
  // three octaves of blurry random, cheap and good enough at 256px
  for (let oct = 0; oct < 3; oct++) {
    const cell = [32, 12, 5][oct], amp = [0.55, 0.3, 0.15][oct];
    const gw = Math.ceil(px / cell) + 2;
    const grid = new Float32Array(gw * gw);
    for (let i = 0; i < grid.length; i++) grid[i] = rnd();
    for (let y = 0; y < px; y++) {
      for (let x = 0; x < px; x++) {
        const gx = x / cell, gy = y / cell;
        const x0 = gx | 0, y0 = gy | 0;
        const fx = gx - x0, fy = gy - y0;
        const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
        const v00 = grid[y0 * gw + x0], v10 = grid[y0 * gw + x0 + 1];
        const v01 = grid[(y0 + 1) * gw + x0], v11 = grid[(y0 + 1) * gw + x0 + 1];
        g[y * px + x] += amp * ((v00 * (1 - sx) + v10 * sx) * (1 - sy) + (v01 * (1 - sx) + v11 * sx) * sy);
      }
    }
  }
  return g;
}

export function makeGroundMaps(base = PALETTE.sandLight, px = 256, seed = 777, bump = 1.6) {
  const h = valueNoise(px, seed);
  const col = new THREE.Color(base);
  // albedo: base colour modulated by the height field, plus speckle
  const a = document.createElement("canvas"); a.width = a.height = px;
  const ag = a.getContext("2d");
  const aimg = ag.createImageData(px, px);
  let s2 = seed * 3 + 1;
  const rnd2 = () => (s2 = (s2 * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < px * px; i++) {
    const v = 0.82 + (h[i] - 0.5) * 0.5 + (rnd2() - 0.5) * 0.08;
    aimg.data[i * 4] = Math.min(255, col.r * 255 * v);
    aimg.data[i * 4 + 1] = Math.min(255, col.g * 255 * v);
    aimg.data[i * 4 + 2] = Math.min(255, col.b * 255 * v);
    aimg.data[i * 4 + 3] = 255;
  }
  ag.putImageData(aimg, 0, 0);
  const map = new THREE.CanvasTexture(a);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.colorSpace = THREE.SRGBColorSpace;

  // normal from the height field (central differences)
  const n = document.createElement("canvas"); n.width = n.height = px;
  const ng = n.getContext("2d");
  const nimg = ng.createImageData(px, px);
  const H = (x, y) => h[((y + px) % px) * px + ((x + px) % px)];
  for (let y = 0; y < px; y++) {
    for (let x = 0; x < px; x++) {
      const dx = (H(x + 1, y) - H(x - 1, y)) * bump;
      const dy = (H(x, y + 1) - H(x, y - 1)) * bump;
      const inv = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      const i = (y * px + x) * 4;
      nimg.data[i] = (-dx * inv * 0.5 + 0.5) * 255;
      nimg.data[i + 1] = (-dy * inv * 0.5 + 0.5) * 255;
      nimg.data[i + 2] = inv * 255;
      nimg.data[i + 3] = 255;
    }
  }
  ng.putImageData(nimg, 0, 0);
  const normalMap = new THREE.CanvasTexture(n);
  normalMap.wrapS = normalMap.wrapT = THREE.RepeatWrapping;

  // roughness: sand is rough everywhere, a touch shinier in the low spots
  const r = document.createElement("canvas"); r.width = r.height = px;
  const rg = r.getContext("2d");
  const rimg = rg.createImageData(px, px);
  for (let i = 0; i < px * px; i++) {
    const v = (0.85 + (h[i] - 0.5) * 0.2) * 255;
    rimg.data[i * 4] = rimg.data[i * 4 + 1] = rimg.data[i * 4 + 2] = v;
    rimg.data[i * 4 + 3] = 255;
  }
  rg.putImageData(rimg, 0, 0);
  const roughnessMap = new THREE.CanvasTexture(r);
  roughnessMap.wrapS = roughnessMap.wrapT = THREE.RepeatWrapping;

  return { map, normalMap, roughnessMap };
}

// Natural gradient sky — the fallback for scenes that don't carry the full Sky
// shader (menus, previews, arenas): a believable clear-sky ramp with a soft
// sun glow, no bands, no gimmicks.
export function makeSkyTexture(P = PALETTE) {
  const c = document.createElement("canvas");
  c.width = 512; c.height = 512;
  const g = c.getContext("2d");
  const hex = (n) => "#" + n.toString(16).padStart(6, "0");
  const grad = g.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0, hex(P.skyTop));
  grad.addColorStop(0.72, hex(P.skyBottom));
  grad.addColorStop(1, hex(P.fogColor ?? P.skyBottom));
  g.fillStyle = grad; g.fillRect(0, 0, 512, 512);
  const sun = g.createRadialGradient(300, 330, 8, 300, 330, 150);
  sun.addColorStop(0, "rgba(255,240,214,0.95)");
  sun.addColorStop(0.25, "rgba(255,224,176,0.45)");
  sun.addColorStop(1, "rgba(255,224,176,0)");
  g.fillStyle = sun; g.fillRect(0, 0, 512, 512);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Legacy speckle texture — still used by a few props.
export function makeSandTexture(base = PALETTE.sandLight, px = 256, density = 900) {
  const c = document.createElement("canvas");
  c.width = c.height = px;
  const g = c.getContext("2d");
  g.fillStyle = "#" + base.toString(16).padStart(6, "0");
  g.fillRect(0, 0, px, px);
  const col = new THREE.Color(base);
  for (let i = 0; i < density; i++) {
    const shade = (Math.random() - 0.5) * 0.14;
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
    g.fillStyle = (x + y) % 2 ? "#26231f" : "#efe8da";
    g.fillRect(x * 16, y * 16, 16, 16);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
