import { useEffect, useState } from "react";
import IsoPilot from "./IsoPilot.jsx";

// Orbit order — step through the 4 cardinal facings only (the diagonals are
// hidden in the preview). ‹/› step around it; the same `facing` prop feeds
// IsoPilot so the preview is identical to the in-match render by construction.
const ORBIT_DIRS = ["S", "E", "N", "W"];
const DIR_NAME = { N: "NORTH", NE: "NORTH-EAST", E: "EAST", SE: "SOUTH-EAST", S: "SOUTH", SW: "SOUTH-WEST", W: "WEST", NW: "NORTH-WEST" };

// Preview of the anime pilot. Renders the same in-match anime sprite art (via
// IsoPilot) so menus match what you actually see in a match. Optionally plays an
// emote's ~3s movement: pass `emote` (an emote cosmetic id) and bump `emoteNonce`
// to (re)trigger playback. The per-match ID color is shown as a ring at the feet.
export default function PilotPreview({
  loadout = {},
  catalogue,
  emote = null,
  emoteNonce = 0,
  height = 320,
  scale = 2.5,
  showLabel = true,
}) {
  const dummyPlayer = {
    idColor: { hex: "#ff2d4d", name: "Red" }, // default tint for preview
    loadout,
    plane: "physical",
  };

  // Play the emote movement for ~3s, then settle back to idle.
  const [playing, setPlaying] = useState(null);
  useEffect(() => {
    if (!emote) { setPlaying(null); return; }
    setPlaying(emote);
    const t = setTimeout(() => setPlaying(null), 3000);
    return () => clearTimeout(t);
  }, [emote, emoteNonce]);

  // Orbit + zoom: step through the 4 cardinal facings and scale the pilot so players
  // can inspect their cosmetics from the front, both sides, and the back.
  const [dirIndex, setDirIndex] = useState(0);
  const [zoom, setZoom] = useState(1);
  const effScale = Math.max(1.4, Math.min(4.6, scale * zoom));
  const facing = ORBIT_DIRS[dirIndex];
  const rotate = (d) => setDirIndex((i) => (i + d + ORBIT_DIRS.length) % ORBIT_DIRS.length);

  // Equipped vista behind the pilot — mirrors the in-match background so the
  // preview reads like the real thing. Art (public/backgrounds/<id>.png) is
  // layered over a themed CSS gradient that also serves as the fallback.
  const bgId = loadout.background || "bg_badlands";
  const [bgFailed, setBgFailed] = useState(false);
  useEffect(() => { setBgFailed(false); }, [bgId]);

  return (
    <div style={{ width: "100%", maxWidth: 260, display: "flex", flexDirection: "column", alignItems: "center" }}>
      <div style={{ position: "relative", width: "100%", height, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", borderRadius: 12 }}>
        <div style={{ position: "absolute", inset: 0, background: BG_GRADIENT[bgId] || BG_GRADIENT.bg_badlands }} />
        {!bgFailed && (
          <img
            src={`./backgrounds/${bgId}.png`}
            alt=""
            draggable={false}
            onError={() => setBgFailed(true)}
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", opacity: 0.9 }}
          />
        )}
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to bottom, rgba(8,6,14,0.15), rgba(8,6,14,0.55))" }} />
        <div style={ring} />
        <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <IsoPilot player={dummyPlayer} facing={facing} moving={false} isYou={false} scale={effScale} preview playingEmote={playing} />
        </div>

        {/* orbit: rotate through the 4 cardinal facings */}
        <button type="button" onClick={() => rotate(-1)} title="Rotate left" style={{ ...orbitBtn, left: 6 }}>‹</button>
        <button type="button" onClick={() => rotate(1)} title="Rotate right" style={{ ...orbitBtn, right: 6 }}>›</button>

        {/* current facing readout */}
        <div style={facingTag}>
          <span className="impactf" style={{ fontSize: 11, letterSpacing: 0.5 }}>{DIR_NAME[facing]}</span>
          <span style={{ fontSize: 10, letterSpacing: 0.5, opacity: 0.7 }}>{facing}</span>
        </div>

        {/* zoom */}
        <div style={zoomBar}>
          <button type="button" onClick={() => setZoom((z) => Math.max(0.6, +(z - 0.2).toFixed(2)))} title="Zoom out" style={zoomBtn}>−</button>
          <span style={{ fontSize: 10, minWidth: 30, textAlign: "center", color: "var(--paper)" }}>{Math.round(zoom * 100)}%</span>
          <button type="button" onClick={() => setZoom((z) => Math.min(1.8, +(z + 0.2).toFixed(2)))} title="Zoom in" style={zoomBtn}>+</button>
        </div>
      </div>
      {showLabel && (
        <div style={{ textAlign: "center", marginTop: 6 }}>
          <span className="impactf" style={{ fontSize: 11, color: "var(--hot)", letterSpacing: "0.12em" }}>ID COLOR</span>
          <span className="faint" style={{ fontSize: 11, marginLeft: 8 }}>Your ID color is assigned each match</span>
        </div>
      )}
    </div>
  );
}

// CSS fallbacks that echo the in-match canvas palettes (see IsoStage BG_THEMES).
const BG_GRADIENT = {
  bg_badlands: "linear-gradient(to bottom, #241539 0%, #5a2a4a 45%, #c24a2a 72%, #e88a44 100%)",
  bg_snowpass: "linear-gradient(to bottom, #16233f 0%, #385b82 45%, #8fb6d6 72%, #e2eff8 100%)",
  bg_pineforest: "linear-gradient(to bottom, #0e2230 0%, #1c4a44 45%, #2f7a5a 72%, #8fc98a 100%)",
};
const ring = { position: "absolute", inset: "15% 15%", borderRadius: "50%", background: "radial-gradient(circle, rgba(255,45,77,0.10) 0%, transparent 65%)", border: "1px dashed rgba(255,45,77,0.25)" };
const orbitBtn = {
  position: "absolute", top: "50%", transform: "translateY(-50%)", zIndex: 20,
  width: 30, height: 46, cursor: "pointer",
  display: "flex", alignItems: "center", justifyContent: "center",
  fontSize: 22, lineHeight: 1, fontWeight: 700,
  background: "rgba(12,10,20,0.6)", color: "var(--hot, #ff2d4d)",
  border: "1px solid rgba(255,45,77,0.4)", borderRadius: 8, backdropFilter: "blur(3px)",
};
const facingTag = {
  position: "absolute", top: 6, left: "50%", transform: "translateX(-50%)", zIndex: 20,
  display: "flex", flexDirection: "column", alignItems: "center", gap: 0, lineHeight: 1.1,
  padding: "3px 10px", color: "var(--hot, #ff2d4d)", fontWeight: 700,
  background: "rgba(12,10,20,0.6)", border: "1px solid rgba(255,45,77,0.35)", borderRadius: 8, backdropFilter: "blur(3px)",
};
const zoomBar = {
  position: "absolute", bottom: 6, right: 6, zIndex: 20,
  display: "flex", alignItems: "center", gap: 4, padding: "3px 5px",
  background: "rgba(12,10,20,0.6)", border: "1px solid rgba(255,45,77,0.35)", borderRadius: 8, backdropFilter: "blur(3px)",
};
const zoomBtn = {
  width: 22, height: 22, cursor: "pointer", fontSize: 15, fontWeight: 700, lineHeight: 1,
  display: "flex", alignItems: "center", justifyContent: "center",
  background: "rgba(255,45,77,0.12)", color: "var(--hot, #ff2d4d)",
  border: "1px solid rgba(255,45,77,0.4)", borderRadius: 6,
};
