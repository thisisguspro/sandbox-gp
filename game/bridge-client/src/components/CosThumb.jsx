// COSMETIC THUMBNAILS, GENERATED FROM THE REAL BUILDERS.
// Every icon is a render of the exact 3D object the item builds — one shared
// offscreen renderer, one snapshot per id, cached forever. No sprite sheet to
// drift out of sync: if the item changes, its thumbnail changes with it.
import { useEffect, useState } from "react";
import * as THREE from "three";
import { buildCosmeticPreview } from "../game/carMesh.js";

const CACHE = new Map();
let _r = null;
function renderer() {
  if (_r) return _r;
  _r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  _r.setSize(112, 112);
  _r.toneMapping = THREE.ACESFilmicToneMapping;
  _r.outputColorSpace = THREE.SRGBColorSpace;
  return _r;
}

export function thumbFor(id) {
  if (CACHE.has(id)) return CACHE.get(id);
  let url = null;
  try {
    const obj = buildCosmeticPreview(id);
    if (obj) {
      const scene = new THREE.Scene();
      scene.add(new THREE.AmbientLight(0xfff2dd, 0.9));
      const sun = new THREE.DirectionalLight(0xffe6c0, 1.2);
      sun.position.set(3, 5, 4);
      scene.add(sun);
      scene.add(obj);
      // frame the object: fit its bounding sphere
      const box = new THREE.Box3().setFromObject(obj);
      const c = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3()).length() || 1;
      const cam = new THREE.PerspectiveCamera(30, 1, 0.01, 50);
      const d = size * 1.15;
      cam.position.set(c.x + d * 0.75, c.y + d * 0.55, c.z + d * 0.75);
      cam.lookAt(c);
      const r = renderer();
      r.render(scene, cam);
      url = r.domElement.toDataURL("image/png");
      // dispose scene geometry
      obj.traverse((m) => { m.geometry?.dispose?.(); (Array.isArray(m.material) ? m.material : [m.material]).forEach((mm) => mm?.dispose?.()); });
    }
  } catch { url = null; }
  CACHE.set(id, url);
  return url;
}

export default function CosThumb({ id, size = 44, fallback = null, style = {} }) {
  const [url, setUrl] = useState(() => CACHE.get(id) ?? undefined);
  useEffect(() => {
    if (CACHE.has(id)) { setUrl(CACHE.get(id)); return; }
    // generate off the click path: next frame
    const t = requestAnimationFrame(() => setUrl(thumbFor(id)));
    return () => cancelAnimationFrame(t);
  }, [id]);
  if (!url) return fallback;
  return <img src={url} width={size} height={size} alt="" style={{ borderRadius: 10, ...style }} draggable={false} />;
}
