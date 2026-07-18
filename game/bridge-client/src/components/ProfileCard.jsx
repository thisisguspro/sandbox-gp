import { useEffect, useState } from "react";
import * as api from "../api/backend.js";

// PUBLIC PROFILE CARD (goal #11): tap any racer in the final standings and
// see who beat you — their avatar in its border frame, level, headline stats,
// and how many achievements they've clawed out of the sand. Read-only, safe
// subset only (the backend decides what's public, never this component).
export default function ProfileCard({ userId, catalogue, onClose }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let alive = true;
    api.getPublicProfile(userId)
      .then((p) => { if (!alive) return; if (p?.error) setErr(p.error); else setData(p); })
      .catch((e) => alive && setErr(e.message || "Couldn't load that racer."));
    return () => { alive = false; };
  }, [userId]);

  const av = (catalogue?.avatars || []).find((a) => a.id === data?.selectedAvatar);
  const bd = (catalogue?.borders || []).find((b) => b.id === data?.selectedBorder);
  const frame = bd?.color || "var(--line)";

  const stats = data?.stats || {};
  const cells = [
    { label: "RACES", value: stats.matchesPlayed ?? 0 },
    { label: "WINS", value: stats.wins ?? 0, accent: "var(--gold)" },
    { label: "PODIUMS", value: stats.podiums ?? 0, accent: "var(--gold)" },
    { label: "BEST LAP", value: stats.bestLapSec ? `${stats.bestLapSec.toFixed(2)}s` : "—", accent: "var(--volt)" },
    { label: "SPLASHES", value: stats.splashesCaused ?? 0, accent: "var(--hot)" },
    { label: "S-TIERS", value: stats.sTiers ?? 0, accent: "var(--volt)" },
  ];

  return (
    <div onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 50, background: "rgba(3,20,27,0.78)",
        display: "grid", placeItems: "center", padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} className="leather-panel"
        style={{ width: "min(420px, 100%)", padding: "22px 24px", borderRadius: 16, border: "2px solid var(--line)" }}>
        {err && <div className="dim" style={{ fontSize: 13 }}>{err}</div>}
        {!err && !data && <div className="dim" style={{ fontSize: 13 }}>Loading racer…</div>}
        {data && (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <div style={{ width: 76, height: 76, borderRadius: "50%", display: "grid", placeItems: "center",
                border: `3px solid ${frame}`, boxShadow: `0 0 16px ${frame}`, background: "var(--ink-3)", flexShrink: 0 }}>
                <span className="kanji" style={{ fontSize: 32, color: "var(--paper)" }}>{av?.glyph || "🏁"}</span>
              </div>
              <div style={{ minWidth: 0 }}>
                <div className="display" style={{ fontSize: 30, lineHeight: 1, color: "#fff", textTransform: "uppercase",
                  whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{data.name}</div>
                <div className="impactf" style={{ fontSize: 12, letterSpacing: "0.14em", color: "var(--volt)", marginTop: 4 }}>
                  LEVEL {data.level ?? 1} · {data.achievementsUnlocked ?? 0} ACHIEVEMENTS
                </div>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginTop: 18 }}>
              {cells.map((c) => (
                <div key={c.label} className="panel" style={{ padding: "9px 6px", textAlign: "center" }}>
                  <div className="display" style={{ fontSize: 24, lineHeight: 1, color: c.accent || "var(--paper)" }}>{c.value}</div>
                  <div className="impactf dim" style={{ fontSize: 9, letterSpacing: "0.12em", marginTop: 3 }}>{c.label}</div>
                </div>
              ))}
            </div>

            <button onClick={onClose} className="btn"
              style={{ width: "100%", marginTop: 18, padding: "10px 0", fontWeight: 800, letterSpacing: "0.1em" }}>
              CLOSE
            </button>
          </>
        )}
      </div>
    </div>
  );
}
