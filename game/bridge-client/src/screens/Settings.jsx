import { useEffect, useState, useCallback } from "react";
import * as api from "../api/backend.js";
import { useI18n } from "../api/i18n.jsx";
import { setMusicVolumes } from "../api/music.js";
import { setSfxVolumes } from "../api/audio.js";
import { applyPrefs } from "../api/prefs.js";
import { SpeedLines } from "../components/effects.jsx";

// Settings. Loads the player's real settings + the schema the backend defines,
// renders controls for each category, and saves partial patches (debounced for
// sliders, immediate for toggles/selects). Key rebinding listens for a keypress.
export default function Settings({ user, profile, onAccountChange, onGoShop, inMatch = false } = {}) {
  const { t, lang, setLang, locales } = useI18n();
  const [data, setData] = useState(null);
  const [section, setSection] = useState(inMatch ? "audio" : "account");
  const [saving, setSaving] = useState(false);
  const [rebinding, setRebinding] = useState(null);

  useEffect(() => { api.getSettings().then(setData).catch(() => {}); }, []);

  const patch = useCallback(async (category, key, value) => {
    setData((d) => ({ ...d, settings: { ...d.settings, [category]: { ...d.settings[category], [key]: value } } }));
    // Apply audio + accessibility/graphics changes live so they take effect at once.
    if (category === "audio") {
      if (key === "master") { setMusicVolumes({ master: value }); setSfxVolumes({ master: value }); }
      else if (key === "music") setMusicVolumes({ music: value });
      else if (key === "sfx") setSfxVolumes({ sfx: value });
    } else if (category === "accessibility" || category === "graphics") {
      applyPrefs({ [category]: { [key]: value } });
    }
    setSaving(true);
    try { await api.saveSettings({ [category]: { [key]: value } }); } finally { setSaving(false); }
  }, []);

  // key rebinding
  useEffect(() => {
    if (!rebinding) return;
    const handler = (e) => {
      e.preventDefault();
      patch("controls", rebinding, e.code);
      setRebinding(null);
    };
    window.addEventListener("keydown", handler, { once: true });
    return () => window.removeEventListener("keydown", handler);
  }, [rebinding, patch]);

  if (!data) return (
    <div style={wrap}>
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div className="faint" style={{ letterSpacing: "0.3em", fontSize: 13, textTransform: "uppercase" }}>{t("settings.loading")}</div>
      </div>
    </div>
  );
  const s = data.settings;
  // In-match the account panel (paid rename / streamer mode / buy-in-shop) is out
  // of context — riders open Options mid-match for audio/graphics/controls — so it
  // is dropped from the rail and the default section starts at Audio.
  const sections = [["account", t("settings.sec.account"), "A"], ["language", t("settings.sec.general"), "L"], ["audio", t("settings.sec.audio"), "S"], ["graphics", t("settings.sec.graphics"), "G"], ["accessibility", t("settings.sec.accessibility"), "E"], ["controls", t("settings.sec.controls"), "C"]]
    .filter(([k]) => !inMatch || k !== "account");

  return (
    <div style={wrap}>
      <SpeedLines />
      <div style={{ position: "relative", zIndex: 2, height: "100%", display: "grid", gridTemplateColumns: "200px 1fr" }}>
        {/* section rail */}
        <div style={{ borderRight: "2px solid var(--line)", padding: "28px 14px", background: "var(--ink-2)" }}>
          <div className="kanji" style={{ fontSize: 18, color: "var(--hot)", letterSpacing: "0.3em", paddingLeft: 8, textTransform: "uppercase" }}>{t("settings.kicker")}</div>
          <h1 className="display" style={{ fontSize: 34, margin: "2px 0 24px", paddingLeft: 8, textTransform: "uppercase" }}>{t("settings.title")}</h1>
          {sections.map(([k, label, kanji]) => (
            <button key={k} onClick={() => setSection(k)} style={{ ...secBtn, ...(section === k ? secOn : null) }}>
              <span className="kanji" style={{ fontSize: 16, marginRight: 10, opacity: section === k ? 1 : 0.5 }}>{kanji}</span>
              <span className="impactf" style={{ fontSize: 12 }}>{label.toUpperCase()}</span>
            </button>
          ))}
          <div className="faint" style={{ fontSize: 11, marginTop: 24, paddingLeft: 8, height: 16 }}>{saving ? t("settings.saving") : t("settings.saved")}</div>
        </div>

        {/* controls */}
        <div style={{ padding: "32px 40px", overflowY: "auto" }}>
          {section === "account" && (
            <AccountPanel user={user} profile={profile} onAccountChange={onAccountChange} onGoShop={onGoShop} />
          )}
          {section === "language" && (
            <LanguagePanel t={t} lang={lang} locales={locales} setLang={setLang} />
          )}
          {section === "audio" && (
            <Cat title={t("settings.sec.audio")}>
              <Slider label={t("settings.audio.master")} value={s.audio.master} onChange={(v) => patch("audio", "master", v)} />
              <Slider label={t("settings.audio.music")} value={s.audio.music} onChange={(v) => patch("audio", "music", v)} />
              <Slider label={t("settings.audio.sfx")} value={s.audio.sfx} onChange={(v) => patch("audio", "sfx", v)} />
              <Soon label={t("settings.audio.voiceVol")} t={t} />
              <Soon label={t("settings.audio.voiceEnabled")} t={t} />
              <Soon label={t("settings.audio.micEnabled")} t={t} />
              <Soon label={t("settings.audio.pushToTalk")} t={t} />
            </Cat>
          )}
          {section === "graphics" && (
            <Cat title={t("settings.sec.graphics")}>
              <Select label={t("settings.gfx.quality")} value={s.graphics.quality} options={["low", "medium", "high", "ultra"]} onChange={(v) => patch("graphics", "quality", v)} />
              <Toggle label={t("settings.gfx.fullscreen")} value={s.graphics.fullscreen} onChange={(v) => patch("graphics", "fullscreen", v)} />
              <Select label={t("settings.gfx.fpsLimit")} value={String(s.graphics.fpsLimit)} options={["0", "30", "60", "120", "144"]} labelFor={(o) => o === "0" ? t("settings.gfx.uncapped") : o} onChange={(v) => patch("graphics", "fpsLimit", Number(v))} />
              <Toggle label={t("settings.gfx.screenShake")} value={s.graphics.screenShake} onChange={(v) => patch("graphics", "screenShake", v)} />
            </Cat>
          )}
          {section === "accessibility" && (
            <Cat title={t("settings.sec.accessibility")}>
              <Toggle label={t("settings.a11y.colorblind")} value={s.accessibility.colorblindShapes} onChange={(v) => patch("accessibility", "colorblindShapes", v)} />
              <Toggle label={t("settings.a11y.highContrast")} value={s.accessibility.highContrast} onChange={(v) => patch("accessibility", "highContrast", v)} />
              <Toggle label={t("settings.a11y.captions")} value={s.accessibility.captionsEnabled} onChange={(v) => patch("accessibility", "captionsEnabled", v)} />
              <Select label={t("settings.a11y.captionSize")} value={s.accessibility.captionSize} options={["small", "medium", "large"]} onChange={(v) => patch("accessibility", "captionSize", v)} />
              <Toggle label={t("settings.a11y.reducedMotion")} value={s.accessibility.reducedMotion} onChange={(v) => patch("accessibility", "reducedMotion", v)} />
              <Toggle label={t("settings.a11y.holdToConfirm")} value={s.accessibility.holdToConfirm} onChange={(v) => patch("accessibility", "holdToConfirm", v)} />
              <Toggle label={t("settings.a11y.showTips")} value={s.accessibility.showTips} onChange={(v) => patch("accessibility", "showTips", v)} />
              <Toggle label={t("settings.a11y.showControlHints")} value={s.accessibility.showControlHints} onChange={(v) => patch("accessibility", "showControlHints", v)} />
            </Cat>
          )}
          {section === "controls" && (
            <Cat title={t("settings.sec.controls")}>
              <div className="dim" style={{ marginBottom: 14, fontSize: 13 }}>{t("settings.controls.hint")}</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px,1fr))", gap: 10 }}>
                {Object.entries(s.controls).map(([k, code]) => (
                  <div key={k} className="row" style={{ justifyContent: "space-between", padding: "10px 12px", border: "1px solid var(--line)", background: "var(--ink-2)" }}>
                    <span style={{ fontWeight: 600, fontSize: 13 }}>{labelizeControl(k)}</span>
                    <button className="btn" style={{ fontSize: 11, padding: "6px 12px", borderColor: rebinding === k ? "var(--hot)" : "var(--line)", textTransform: "none" }}
                      onClick={() => setRebinding(k)}>
                      {rebinding === k ? t("settings.controls.press") : prettyKey(code)}
                    </button>
                  </div>
                ))}
              </div>
            </Cat>
          )}
        </div>
      </div>
    </div>
  );
}

// Account panel: paid name change (spends a credit bought in the shop) and the
// streamer-mode toggle. Both read live state from the account/profile and call
// onAccountChange to refresh the app's user + profile after a change.
function AccountPanel({ user, profile, onAccountChange, onGoShop }) {
  const { t } = useI18n();
  const credits = profile?.nameChangeCredits ?? 0;
  const streamer = !!profile?.streamerMode;
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");

  const submitName = async () => {
    const next = name.trim();
    if (!next || busy) return;
    setBusy(true); setErr(""); setOk("");
    try {
      await api.changeName(next);
      setName(""); setOk(t("settings.acct.nameChanged"));
      await onAccountChange?.();
    } catch (e) { setErr(e.message || t("settings.acct.errName")); }
    finally { setBusy(false); }
  };

  const toggleStreamer = async (v) => {
    setBusy(true); setErr("");
    try { await api.setStreamerMode(v); await onAccountChange?.(); }
    catch (e) { setErr(e.message || t("settings.acct.errStreamer")); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ maxWidth: 560 }}>
      <div className="display branded-text" style={{ fontSize: 24, marginBottom: 4 }}>{t("settings.sec.account")}</div>
      <div className="saloon-divider" style={{ marginTop: 0, marginBottom: 18 }} />

      {/* current call sign */}
      <div style={{ padding: "12px 0", borderBottom: "1px solid var(--line)" }}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <span style={{ fontWeight: 600 }}>{t("settings.acct.callSign")}</span>
          <span className="display" style={{ fontSize: 18, color: "var(--volt)" }}>{user?.name || "—"}</span>
        </div>
      </div>

      {/* paid name change */}
      <div style={{ padding: "14px 0", borderBottom: "1px solid var(--line)" }}>
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
          <span style={{ fontWeight: 600 }}>{t("settings.acct.changeName")}</span>
          <span className="faint" style={{ fontSize: 12 }}>{credits} {credits === 1 ? t("settings.acct.credit") : t("settings.acct.credits")}</span>
        </div>
        {credits > 0 ? (
          <div className="col" style={{ gap: 8 }}>
            <div className="row gap-s">
              <input value={name} maxLength={20} placeholder={t("settings.acct.newCallSign")}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submitName()}
                style={{ flex: 1, padding: "9px 12px", background: "var(--ink-3)", border: "1px solid var(--line)", color: "var(--paper)", fontSize: 14 }} />
              <button className="btn" disabled={busy || !name.trim()} onClick={submitName}
                style={{ fontSize: 11, padding: "9px 16px", borderColor: "var(--hot)", opacity: busy || !name.trim() ? 0.5 : 1 }}>
                {t("settings.acct.apply")}
              </button>
            </div>
            <div className="faint" style={{ fontSize: 11 }}>{t("settings.acct.spendHint")}</div>
          </div>
        ) : (
          <div className="col" style={{ gap: 8 }}>
            <div className="dim" style={{ fontSize: 13 }}>{t("settings.acct.noCredits")}</div>
            <button className="btn" onClick={() => onGoShop?.()} style={{ fontSize: 11, padding: "8px 14px", borderColor: "var(--volt)", alignSelf: "flex-start" }}>
              {t("settings.acct.buyInShop")}
            </button>
          </div>
        )}
        {err && <div style={{ color: "var(--hot)", fontSize: 12, marginTop: 8 }}>{err}</div>}
        {ok && <div style={{ color: "var(--volt)", fontSize: 12, marginTop: 8 }}>{ok}</div>}
      </div>

      {/* streamer mode */}
      <div style={{ padding: "12px 0", borderBottom: "1px solid var(--line)" }}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div style={{ paddingRight: 16 }}>
            <div style={{ fontWeight: 600 }}>{t("settings.acct.streamerMode")}</div>
            <div className="faint" style={{ fontSize: 11, marginTop: 4 }}>{t("settings.acct.streamerHint")}</div>
          </div>
          <button disabled={busy} onClick={() => toggleStreamer(!streamer)} style={{ flex: "0 0 auto", width: 52, height: 28, background: streamer ? "var(--hot)" : "var(--ink-3)", border: "2px solid " + (streamer ? "var(--hot)" : "var(--line)"), position: "relative", transition: "background .15s" }}>
            <span style={{ position: "absolute", top: 1, left: streamer ? 25 : 1, width: 22, height: 22, background: streamer ? "var(--ink)" : "var(--dim)", transition: "left .15s" }} />
          </button>
        </div>
      </div>
    </div>
  );
}

function Cat({ title, children }) {
  return (
    <div style={{ maxWidth: 560 }}>
      <div className="display branded-text" style={{ fontSize: 24, marginBottom: 4 }}>{title}</div>
      <div className="saloon-divider" style={{ marginTop: 0, marginBottom: 18 }} />
      <div className="col" style={{ gap: 4 }}>{children}</div>
    </div>
  );
}
function Slider({ label, value, onChange }) {
  return (
    <div style={{ padding: "10px 0", borderBottom: "1px solid var(--line)" }}>
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 6 }}>
        <span style={{ fontWeight: 600 }}>{label}</span>
        <span className="display" style={{ fontSize: 18, color: "var(--volt)" }}>{value}</span>
      </div>
      <input type="range" min="0" max="100" value={value} onChange={(e) => onChange(Number(e.target.value))} style={{ width: "100%", accentColor: "var(--hot)" }} />
    </div>
  );
}
// A disabled settings row flagged COMING SOON (e.g. voice chat — not wired yet).
function Soon({ label, t }) {
  return (
    <div className="row" style={{ justifyContent: "space-between", padding: "12px 0", borderBottom: "1px solid var(--line)", opacity: 0.5 }}>
      <span style={{ fontWeight: 600 }}>{label}</span>
      <span className="impactf" style={{ fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--dim)", border: "1px solid var(--line)", padding: "3px 8px" }}>{t ? t("settings.comingSoon") : "Coming soon"}</span>
    </div>
  );
}
// Interface-language picker. Selecting a locale flips the whole UI live and
// persists (localStorage + the signed-in account) via the i18n provider.
function LanguagePanel({ t, lang, locales, setLang }) {
  return (
    <Cat title={t("settings.language")}>
      <div className="dim" style={{ marginBottom: 14, fontSize: 13 }}>{t("settings.languageHint")}</div>
      <div className="col" style={{ gap: 8 }}>
        {locales.map((l) => (
          <button key={l.code} onClick={() => setLang(l.code)}
            style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 14px", cursor: "pointer",
              border: "2px solid " + (lang === l.code ? "var(--hot)" : "var(--line)"),
              background: lang === l.code ? "rgba(255,45,77,0.1)" : "var(--ink-2)", color: "var(--paper)" }}>
            <span style={{ fontWeight: 600 }}>{l.label}</span>
            {lang === l.code && <span className="impactf" style={{ fontSize: 12, color: "var(--hot)" }}>✓</span>}
          </button>
        ))}
      </div>
    </Cat>
  );
}
function Toggle({ label, value, onChange }) {
  return (
    <div className="row" style={{ justifyContent: "space-between", padding: "12px 0", borderBottom: "1px solid var(--line)" }}>
      <span style={{ fontWeight: 600 }}>{label}</span>
      <button onClick={() => onChange(!value)} style={{ width: 52, height: 28, background: value ? "var(--hot)" : "var(--ink-3)", border: "2px solid " + (value ? "var(--hot)" : "var(--line)"), position: "relative", transition: "background .15s" }}>
        <span style={{ position: "absolute", top: 1, left: value ? 25 : 1, width: 22, height: 22, background: value ? "var(--ink)" : "var(--dim)", transition: "left .15s" }} />
      </button>
    </div>
  );
}
function Select({ label, value, options, onChange, labelFor }) {
  return (
    <div className="row" style={{ justifyContent: "space-between", padding: "12px 0", borderBottom: "1px solid var(--line)" }}>
      <span style={{ fontWeight: 600 }}>{label}</span>
      <div className="row gap-s">
        {options.map((o) => (
          <button key={o} onClick={() => onChange(o)} style={{ padding: "6px 12px", fontFamily: "var(--impact)", fontSize: 11,
            background: value === o ? "var(--hot)" : "transparent", color: value === o ? "var(--ink)" : "var(--dim)", border: "2px solid " + (value === o ? "var(--hot)" : "var(--line)") }}>
            {(labelFor ? labelFor(o) : o).toString().toUpperCase()}
          </button>
        ))}
      </div>
    </div>
  );
}

function labelizeControl(k) { return k.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()).trim(); }
function prettyKey(code) { return (code || "").replace(/^Key/, "").replace(/^Digit/, "").replace(/^Arrow/, "↑").replace("ControlLeft", "Ctrl") || "—"; }

const wrap = { height: "100%", position: "relative", overflow: "hidden", background: "radial-gradient(120% 100% at 20% 0%, #1e1826 0%, var(--ink) 55%)" };
const secBtn = { display: "flex", alignItems: "center", width: "100%", padding: "11px 8px", background: "transparent", color: "var(--paper)" };
const secOn = { background: "var(--ink-3)", borderLeft: "3px solid var(--hot)" };
