import { useEffect, useRef, useState, useCallback } from "react";
import { getPrefs } from "../api/prefs.js";

// The ambient diagonal speed-lines overlay is GONE — it striped every menu and
// the results screen with lines that made text harder to read. Kept as a no-op
// component so the many call sites don't need touching; it simply renders nothing.
export function SpeedLines() {
  return null;
}

// Fires a radial impact burst at a screen point. Use the hook for imperative pops.
export function useImpact() {
  const [bursts, setBursts] = useState([]);
  const pop = useCallback((x, y) => {
    const id = Math.random().toString(36).slice(2);
    setBursts((b) => [...b, { id, x, y }]);
    setTimeout(() => setBursts((b) => b.filter((z) => z.id !== id)), 550);
  }, []);
  const layer = (
    <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 9999 }} aria-hidden="true">
      {bursts.map((b) => (
        <div key={b.id} className="impact-burst" style={{ left: b.x, top: b.y }} />
      ))}
    </div>
  );
  return { pop, layer };
}

// A massive anime sword slash effect that cuts across the screen
export function SlashEffect({ active, onDone }) {
  useEffect(() => {
    if (!active) return;
    const t = setTimeout(() => onDone && onDone(), 800);
    return () => clearTimeout(t);
  }, [active, onDone]);
  if (!active) return null;
  return (
    <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 10000, overflow: "hidden" }}>
      <div className="slash-cut" />
      <div className="slash-sparks" />
      <style>{`
        .slash-cut {
          position: absolute; top: 50%; left: -20%; width: 140%; height: 120px;
          background: linear-gradient(0deg, transparent, rgba(255,255,255,1) 40%, rgba(255,255,255,1) 60%, transparent);
          box-shadow: 0 0 50px var(--hot), 0 0 100px var(--hot);
          transform: translateY(-50%) rotate(-25deg) scaleX(0);
          animation: slash 0.3s cubic-bezier(0.1, 0.9, 0.2, 1) forwards;
        }
        @keyframes slash {
          0% { transform: translateY(-50%) rotate(-25deg) scaleX(0); opacity: 0.8; }
          40% { transform: translateY(-50%) rotate(-25deg) scaleX(1); opacity: 1; }
          100% { transform: translateY(-50%) rotate(-25deg) scaleX(1) scaleY(0); opacity: 0; }
        }
        .slash-sparks {
          position: absolute; inset: 0;
          background: radial-gradient(circle at 50% 50%, var(--hot) 0%, transparent 40%);
          mix-blend-mode: screen;
          animation: sparks 0.4s ease-out forwards;
        }
        @keyframes sparks {
          0% { opacity: 1; transform: scale(0.5); }
          100% { opacity: 0; transform: scale(2); filter: blur(10px); }
        }
      `}</style>
    </div>
  );
}

// A big kanji/word that slams in then fades — for level-ups, victories, etc.
// Enhanced with screen shake
export function KanjiFlash({ text, sub, color = "var(--hot)", onDone }) {
  useEffect(() => { const t = setTimeout(() => onDone && onDone(), 1600); return () => clearTimeout(t); }, [onDone]);
  const shake = getPrefs().screenShake !== false; // Graphics → Screen Shake toggle
  return (
    <div style={overlay} aria-live="assertive">
      <div className={shake ? "slam screen-shake" : "slam"}>
        <div className="display" style={{ fontSize: "clamp(56px,13vw,168px)", color, lineHeight: 0.9, textShadow: "0 0 40px " + color + ", 0 10px 0 rgba(120, 90, 50, 0.8)" }}>{text}</div>
        {sub && <div className="impactf" style={{ textAlign: "center", letterSpacing: "0.3em", marginTop: 10, color: "var(--paper)", textShadow: "0 0 10px var(--hot)" }}>{sub}</div>}
      </div>
      <style>{`
        .slam { animation: slam 1.6s cubic-bezier(.2,.8,.2,1) forwards; text-align:center; }
        @keyframes slam {
          0% { transform: scale(3) rotate(-15deg); opacity: 0; filter: blur(12px) brightness(2); }
          15% { transform: scale(1) rotate(-3deg); opacity: 1; filter: blur(0) brightness(1.5); }
          70% { transform: scale(1.05) rotate(-3deg); opacity: 1; filter: blur(0) brightness(1); }
          100% { transform: scale(1.15) rotate(-3deg); opacity: 0; filter: blur(4px); }
        }
        .screen-shake {
          animation: slam 1.6s cubic-bezier(.2,.8,.2,1) forwards, screenshake 0.4s ease-out;
        }
        @keyframes screenshake {
          0%, 100% { margin-left: 0; margin-top: 0; }
          10%, 30%, 50%, 70%, 90% { margin-left: -20px; margin-top: -15px; }
          20%, 40%, 60%, 80% { margin-left: 20px; margin-top: 15px; }
        }
      `}</style>
    </div>
  );
}
const overlay = { position: "fixed", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9998, pointerEvents: "none", background: "radial-gradient(circle, rgba(120, 90, 50, 0.7) 0%, transparent 80%)" };

// Floating ember/particle field on a canvas — drifting upward motes for energy.
export function Particles({ density = 40, color = "rgba(255,80,110,0.6)" }) {
  const ref = useRef(null);
  useEffect(() => {
    const cv = ref.current; if (!cv) return;
    const ctx = cv.getContext("2d");
    let raf, w, h, parts = [];
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const resize = () => { w = cv.width = cv.offsetWidth; h = cv.height = cv.offsetHeight; };
    resize();
    parts = Array.from({ length: density }, () => ({
      x: Math.random() * w, y: Math.random() * h,
      r: Math.random() * 2 + 0.6, v: Math.random() * 0.5 + 0.15, drift: (Math.random() - 0.5) * 0.3,
    }));
    const tick = () => {
      ctx.clearRect(0, 0, w, h);
      for (const p of parts) {
        p.y -= p.v; p.x += p.drift;
        if (p.y < -4) { p.y = h + 4; p.x = Math.random() * w; }
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = color; ctx.fill();
      }
      if (!reduced) raf = requestAnimationFrame(tick);
    };
    tick();
    window.addEventListener("resize", resize);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", resize); };
  }, [density, color]);
  return <canvas ref={ref} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", zIndex: 1 }} aria-hidden="true" />;
}
