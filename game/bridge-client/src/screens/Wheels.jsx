import { useEffect, useState } from "react";
import * as api from "../api/backend.js";
import { SpeedLines, useImpact } from "../components/effects.jsx";
import PilotPreview from "../components/PilotPreview.jsx";
import { emoteGlyph } from "../components/IsoPilot.jsx";
import { useI18n } from "../api/i18n.jsx";

// Wheels. Two 8-slot radial wheels: COMMS (bind voice-command keys) and EMOTE
// (bind owned emote cosmetics). Click a slot to select it, then pick a binding
// from the palette; saves each slot to /profile/wheel. The radial layout is the
// in-match quick-select players hold a key to open.
const LABELS = {
  SOS: "SOS", HELP_TASK: "Help w/ Task", SABOTAGE_HERE: "Sabotage Here", REFILL_HERE: "Refill Here",
  FOLLOW_ME: "Follow Me", SUSPECT: "Suspect!", CLEAR: "I'm Clear", ON_MY_WAY: "On My Way", YES: "Yes", NO: "No",
};

export default function Wheels({ profile, catalogue }) {
  const { t } = useI18n();
  const { pop, layer } = useImpact();
  const [wheels, setWheels] = useState(null);
  const [voiceCommands, setVoiceCommands] = useState([]);
  const [slots, setSlots] = useState(8);
  const [active, setActive] = useState("comms");
  const [selSlot, setSelSlot] = useState(null);
  const [previewEmote, setPreviewEmote] = useState(null);
  const [emoteNonce, setEmoteNonce] = useState(0);
  const playEmote = (id) => { setPreviewEmote(id); setEmoteNonce((n) => n + 1); };

  useEffect(() => {
    api.getSettings().then((d) => {
      setWheels(d.wheels);
      setVoiceCommands(d.schema?.voiceCommands || Object.keys(LABELS));
      setSlots(d.schema?.wheelSlots || 8);
    }).catch(() => {});
  }, []);

  const ownedEmotes = (catalogue?.cosmetics || []).filter((c) => c.slot === "emote" && (profile?.owned || []).some((o) => o.id === c.id));

  const bind = async (itemKey, e) => {
    if (selSlot == null || !wheels) return;
    if (e) pop(e.clientX, e.clientY);
    setWheels((w) => ({ ...w, [active]: w[active].map((v, i) => (i === selSlot ? itemKey : v)) }));
    try { await api.setWheelSlot(active, selSlot, itemKey); } catch (err) { /* revert could go here */ }
  };

  if (!wheels) return <div style={wrap} />;
  const cmdLabel = (k) => (LABELS[k] ? t("wheels.cmd." + k) : k);
  const current = wheels[active] || [];
  const palette = active === "comms"
    ? voiceCommands.map((k) => ({ key: k, label: cmdLabel(k) }))
    : ownedEmotes.map((c) => ({ key: c.id, label: c.name }));

  return (
    <div style={wrap}>
      <SpeedLines />
      {layer}
      <div style={{ position: "relative", zIndex: 2, height: "100%", display: "grid", gridTemplateColumns: "1fr 360px" }}>
        {/* radial */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div className="row gap-s" style={{ marginBottom: 24 }}>
            {[["comms", "C"], ["emote", "E"]].map(([k, kanji]) => (
              <button key={k} onClick={() => { setActive(k); setSelSlot(null); }} style={{ ...wTab, ...(active === k ? wTabOn : null) }}>
                <span className="kanji" style={{ fontSize: 16, marginRight: 8 }}>{kanji}</span>
                <span className="impactf" style={{ fontSize: 12 }}>{t("wheels.tab." + k).toUpperCase()}</span>
              </button>
            ))}
          </div>
          <RadialWheel slots={slots} values={current} selSlot={selSlot} onSelect={setSelSlot}
            labelFor={(v) => active === "comms" ? cmdLabel(v) : (catalogue?.cosmetics.find((c) => c.id === v)?.name || v)} />
          <div className="faint" style={{ marginTop: 18, fontSize: 13 }}>
            {(() => {
              const parts = t("wheels.holdHint").split("{key}");
              const key = active === "comms" ? "C" : "V";
              return <>{parts[0]}<b style={{ color: "var(--paper)" }}>{key}</b>{parts[1]}</>;
            })()}
          </div>
        </div>

        {/* palette */}
        <div style={{ borderLeft: "2px solid var(--line)", padding: "28px 22px", background: "var(--ink-2)", overflowY: "auto" }}>
          {active === "emote" && (
            <div style={{ marginBottom: 18, paddingBottom: 18, borderBottom: "1px solid var(--line)", display: "flex", flexDirection: "column", alignItems: "center" }}>
              <PilotPreview loadout={profile?.loadout || {}} catalogue={catalogue} emote={previewEmote} emoteNonce={emoteNonce} height={210} scale={1.9} showLabel={false} />
              <div className="faint" style={{ fontSize: 12, textAlign: "center", marginTop: 4 }}>{t("wheels.emotePreviewHint")}</div>
            </div>
          )}
          <div className="tag"><span>{active === "comms" ? t("wheels.voiceCommands") : t("wheels.yourEmotes")}</span></div>
          <div className="dim" style={{ fontSize: 13, margin: "12px 0 16px" }}>
            {active === "emote"
              ? (selSlot == null ? t("wheels.emoteSelectHint") : t("wheels.emoteBindSlot", { n: selSlot + 1 }))
              : (selSlot == null ? t("wheels.commsSelectHint") : t("wheels.assigningSlot", { n: selSlot + 1 }))}
          </div>
          <div className="col gap-s">
            {palette.length === 0 && <div className="faint" style={{ fontSize: 13 }}>{active === "emote" ? t("wheels.noEmotes") : t("wheels.noCommands")}</div>}
            {palette.map((p) => {
              const isEmote = active === "emote";
              const disabled = !isEmote && selSlot == null; // emotes are always clickable (to preview)
              return (
                <button key={p.key} className="panel" style={{ ...palItem, opacity: disabled ? 0.6 : 1 }} disabled={disabled}
                  onClick={(e) => { if (isEmote) playEmote(p.key); bind(p.key, e); }}>
                  {isEmote && <span style={{ fontSize: 16, marginRight: 8 }}>{emoteGlyph(p.key)}</span>}
                  <span style={{ fontWeight: 700, fontSize: 13 }}>{p.label}</span>
                  {current.includes(p.key) && <span className="impactf" style={{ marginLeft: "auto", fontSize: 10, color: "var(--volt)", textTransform: "uppercase" }}>{t("wheels.bound")}</span>}
                </button>
              );
            })}
            {selSlot != null && current[selSlot] && (
              <button className="btn btn-ghost" style={{ marginTop: 8 }} onClick={(e) => bind(null, e)}>Clear slot {selSlot + 1}</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function RadialWheel({ slots, values, selSlot, onSelect, labelFor }) {
  const { t } = useI18n();
  const R = 150, cx = 200, cy = 200;
  return (
    <svg viewBox="0 0 400 400" style={{ width: 380, maxWidth: "70vw" }}>
      <circle cx={cx} cy={cy} r={R + 34} fill="none" stroke="var(--line)" strokeWidth="2" />
      <circle cx={cx} cy={cy} r="46" fill="var(--ink-2)" stroke="var(--line)" strokeWidth="2" />
      <text x={cx} y={cy - 4} textAnchor="middle" className="kanji" fontSize="16" fill="var(--hot)">◎</text>
      <text x={cx} y={cy + 14} textAnchor="middle" fontSize="9" fill="var(--dim)" fontFamily="Russo One">{t("wheels.hold").toUpperCase()}</text>
      {Array.from({ length: slots }).map((_, i) => {
        const ang = (i / slots) * Math.PI * 2 - Math.PI / 2;
        const x = cx + Math.cos(ang) * R, y = cy + Math.sin(ang) * R;
        const sel = selSlot === i;
        const v = values[i];
        return (
          <g key={i} onClick={() => onSelect(i)} style={{ cursor: "pointer" }}>
            <circle cx={x} cy={y} r="38" fill={sel ? "var(--hot)" : v ? "var(--ink-3)" : "var(--ink-2)"} stroke={sel ? "#fff" : v ? "var(--volt)" : "var(--line)"} strokeWidth="2" />
            <text x={x} y={y - 2} textAnchor="middle" fontSize="9" fontFamily="Rajdhani" fontWeight="700" fill={sel ? "var(--ink)" : "var(--paper)"}>
              {v ? clip(labelFor(v)) : (i + 1)}
            </text>
            {v && <text x={x} y={y + 12} textAnchor="middle" fontSize="7" fill={sel ? "var(--ink)" : "var(--faint)"}>{t("wheels.slotN", { n: i + 1 })}</text>}
          </g>
        );
      })}
    </svg>
  );
}
function clip(s) { s = String(s); return s.length > 9 ? s.slice(0, 8) + "…" : s; }

const wrap = { height: "100%", position: "relative", overflow: "hidden", background: "radial-gradient(120% 100% at 50% 0%, #1e1626 0%, var(--ink) 55%)" };
const wTab = { display: "flex", alignItems: "center", padding: "9px 16px", background: "var(--ink-2)", color: "var(--dim)", border: "2px solid var(--line)" };
const wTabOn = { color: "var(--paper)", borderColor: "var(--hot)" };
const palItem = { display: "flex", alignItems: "center", padding: "10px 14px", background: "var(--ink-3)", cursor: "pointer", width: "100%", textAlign: "left" };
