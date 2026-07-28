import { useState } from "react";
import { PERK_CATALOG, MAX_EQUIPPED } from "../api/perks.js";
import * as api from "../api/backend.js";

// PERK GARAGE (goal #15). The creed banner says it all: karts are identical —
// perks bend item luck, hoop windows, shells, and information. Pick two.
export default function Perks({ profile, onAccountChange }) {
  const level = profile?.level?.level ?? profile?.level ?? 1;
  const [equipped, setEquipped] = useState(profile?.equippedPerks || []);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  const toggle = async (key, locked) => {
    if (locked || busy) return;
    const has = equipped.includes(key);
    let next = has ? equipped.filter((k) => k !== key) : [...equipped, key];
    if (next.length > MAX_EQUIPPED) next = [...next.slice(1)];   // oldest slot rotates out
    setBusy(true); setMsg(null);
    try {
      const res = await api.setPerks(next);
      setEquipped(res.equipped);
      setMsg("✓ Saved");
      onAccountChange?.();
      setTimeout(() => setMsg(null), 1400);
    } catch (e) { setMsg(e.message || "Couldn't save."); }
    setBusy(false);
  };

  return (
    <div style={{ padding: "32px 40px", height: "100%", overflowY: "auto" }}>
      <div className="kanji" style={{ fontSize: 22, color: "var(--gold)", letterSpacing: "0.2em", textTransform: "uppercase" }}>PIT WALL</div>
      <div className="display" style={{ fontSize: 40, color: "var(--paper)", lineHeight: 0.95, marginTop: 2, textTransform: "uppercase" }}>Perk Garage</div>
      <div className="faint" style={{ fontSize: 13, maxWidth: 640, marginTop: 8, lineHeight: 1.5 }}>
        Every kart is <b style={{ color: "var(--paper)" }}>identical — always</b>. Perks never touch speed:
        they bend item luck, hoop windows, seashell payouts, and what you can see coming. Equip up to {MAX_EQUIPPED}.
      </div>
      <div className="impactf" style={{ fontSize: 12, letterSpacing: "0.12em", color: "var(--volt)", marginTop: 12, textTransform: "uppercase" }}>
        LEVEL {level} · {equipped.length}/{MAX_EQUIPPED} EQUIPPED {msg && <span style={{ marginLeft: 12, color: "var(--gold)" }}>{msg}</span>}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 14, marginTop: 22 }}>
        {PERK_CATALOG.map((p) => {
          const locked = level < p.unlockLevel;
          const on = equipped.includes(p.key);
          return (
            <button key={p.key} onClick={() => toggle(p.key, locked)}
              style={{
                textAlign: "left", cursor: locked ? "not-allowed" : "pointer",
                // A card, not a shadow. This was rgba(0,0,0,0.28) — a dark tint that
                // read as a raised panel on the old near-black page and reads as a
                // MUD STAIN on sand.
                background: on
                  ? "linear-gradient(180deg, rgba(0,168,160,0.22), rgba(0,168,160,0.08))"
                  : "linear-gradient(180deg, #ffffff, #fff3dc)",
                border: on ? "3px solid var(--volt, #2a9d8f)" : "2px solid var(--line)",
                borderRadius: 14, padding: "16px 18px", opacity: locked ? 0.45 : 1,
                transition: "transform 0.12s ease, border-color 0.12s ease",
                transform: on ? "translateY(-2px)" : "none",
              }}>
              <div className="row" style={{ gap: 10, alignItems: "center" }}>
                <span style={{ fontSize: 30 }}>{p.glyph}</span>
                <div>
                  <div style={{ fontWeight: 900, fontSize: 17, color: "var(--paper)", letterSpacing: "0.03em" }}>{p.name}</div>
                  <div className="faint" style={{ fontSize: 11, letterSpacing: "0.14em" }}>
                    {locked ? `UNLOCKS AT LEVEL ${p.unlockLevel}` : on ? "EQUIPPED" : "TAP TO EQUIP"}
                  </div>
                </div>
              </div>
              <div className="dim" style={{ fontSize: 13, marginTop: 10, lineHeight: 1.45 }}>{p.desc}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
