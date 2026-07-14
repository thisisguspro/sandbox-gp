import { useState } from "react";
import * as api from "../api/backend.js";
import { useI18n } from "../api/i18n.jsx";
import { SpeedLines, Particles } from "../components/effects.jsx";

// First-time onboarding gate shown after sign-in: accept Terms of Service, then
// pick a display name (server-side name filter). Returning users never see this —
// App.jsx only mounts it when the user still needs a step.
export default function Onboarding({ user, onUpdated }) {
  const { t, lang, setLang, locales } = useI18n();
  // Start on whichever step is still outstanding. Brand-new riders pick a
  // language first (which also becomes their account language), then ToS, name.
  const [step, setStep] = useState(user?.tosAccepted ? "name" : "lang");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [name, setName] = useState(user?.nameChosen ? user.name : (user?.name || ""));

  // Step 1: pick the interface language. setLang saves it to the account (a
  // token exists during onboarding) and mirrors it into localStorage, so the
  // ToS + name steps below immediately render in the chosen language.
  const pickLang = async (code) => {
    setBusy(true); setErr(null);
    try { await setLang(code); setStep("tos"); }
    catch (e) { setErr(e.message || ""); }
    finally { setBusy(false); }
  };

  const agree = async () => {
    setBusy(true); setErr(null);
    try {
      const { user: u } = await api.acceptTos();
      onUpdated(u);
      if (!u.nameChosen) setStep("name");
    } catch (e) { setErr(e.message || t("onboarding.errTos")); }
    finally { setBusy(false); }
  };

  const chooseName = async () => {
    const trimmed = name.trim();
    if (!trimmed) { setErr(t("onboarding.errEnterName")); return; }
    setBusy(true); setErr(null);
    try {
      const { user: u } = await api.setName(trimmed);
      onUpdated(u);
    } catch (e) { setErr(e.message || t("onboarding.errName")); }
    finally { setBusy(false); }
  };

  return (
    <div style={wrap}>
      <SpeedLines />
      <Particles density={28} />
      <div style={{ position: "relative", zIndex: 2, textAlign: "center", margin: "auto", padding: "40px 20px", width: "100%", maxWidth: 560 }}>
        <div className="kanji" style={{ fontSize: 20, color: "var(--hot)", letterSpacing: "0.4em", marginBottom: 4 }}>IRON FRONTIER</div>
        <h1 className="display" style={{ fontSize: "clamp(44px,9vw,96px)", margin: "0 0 8px", lineHeight: 0.9, textTransform: "uppercase",
          background: "linear-gradient(180deg,#fff 0%,#ffd0d8 60%,var(--hot) 100%)",
          WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
          {step === "lang" ? t("onboarding.langTitle") : step === "tos" ? t("onboarding.tosTitle") : t("onboarding.nameTitle")}
        </h1>

        {step === "lang" && (
          <div className="panel panel-hot" style={{ padding: 28, width: "min(440px, 100%)", margin: "16px auto 0", textAlign: "left", background: "var(--ink-2)" }}>
            <div className="tag" style={{ marginBottom: 16 }}><span>{t("onboarding.langTag")}</span></div>
            <p style={{ fontSize: 13, lineHeight: 1.6, color: "var(--dim)", marginTop: 0, marginBottom: 18 }}>{t("onboarding.langIntro")}</p>
            <div style={{ display: "grid", gap: 10 }}>
              {(locales || []).map((l) => (
                <button key={l.code} className="btn" disabled={busy} onClick={() => pickLang(l.code)}
                  style={{ display: "flex", alignItems: "center", gap: 12, justifyContent: "flex-start", padding: "12px 14px",
                    border: lang === l.code ? "2px solid var(--hot)" : "2px solid var(--line)",
                    background: lang === l.code ? "rgba(255,42,71,0.14)" : "var(--ink)" }}>
                  <span style={{ fontFamily: "var(--impact)", fontSize: 12, letterSpacing: "0.08em", color: "var(--dim)",
                    border: "1px solid var(--line)", borderRadius: 3, padding: "2px 7px", minWidth: 34, textAlign: "center" }}>{l.flag || l.code}</span>
                  <span style={{ fontWeight: 700, fontSize: 15, color: "var(--paper)" }}>{l.label}</span>
                </button>
              ))}
            </div>
            {err && <div style={errStyle}>{err}</div>}
          </div>
        )}

        {step === "tos" && (
          <div className="panel panel-hot" style={{ padding: 28, width: "min(440px, 100%)", margin: "16px auto 0", textAlign: "left", background: "var(--ink-2)" }}>
            <div className="tag" style={{ marginBottom: 16 }}><span>{t("onboarding.tosTag")}</span></div>
            <div style={{ maxHeight: 240, overflowY: "auto", fontSize: 13, lineHeight: 1.6, color: "var(--paper)", paddingRight: 6 }}>
              <p style={{ marginTop: 0 }}>{t("onboarding.tosIntro")}</p>
              <ul style={{ paddingLeft: 18, margin: "0 0 12px" }}>
                <li>{t("onboarding.tosBullet1")}</li>
                <li>{t("onboarding.tosBullet2")}</li>
                <li>{t("onboarding.tosBullet3")}</li>
                <li>{t("onboarding.tosBullet4")}</li>
                <li>{t("onboarding.tosBullet5")}</li>
              </ul>
              <p style={{ margin: 0, color: "var(--dim)" }}>{t("onboarding.tosOnce")}</p>
            </div>
            {err && <div style={errStyle}>{err}</div>}
            <button className="btn btn-hot" style={{ width: "100%", marginTop: 20, fontSize: 17 }} disabled={busy} onClick={agree}>
              {busy ? t("onboarding.recording") : t("onboarding.agree")}
            </button>
          </div>
        )}

        {step === "name" && (
          <div className="panel panel-hot" style={{ padding: 28, width: "min(380px, 100%)", margin: "16px auto 0", textAlign: "left", background: "var(--ink-2)" }}>
            <div className="tag" style={{ marginBottom: 16 }}><span>{t("onboarding.nameTag")}</span></div>
            <p style={{ fontSize: 13, lineHeight: 1.6, color: "var(--dim)", marginTop: 0 }}>
              {t("onboarding.nameIntro")}
            </p>
            <label style={lbl}>{t("signin.callSign")}</label>
            <input style={input} value={name} maxLength={20} placeholder={t("onboarding.namePlaceholder")} autoFocus
              onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && chooseName()} />
            {err && <div style={errStyle}>{err}</div>}
            <button className="btn btn-hot" style={{ width: "100%", marginTop: 20, fontSize: 17 }} disabled={busy} onClick={chooseName}>
              {busy ? t("common.saving") : t("onboarding.rideOut")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

const wrap = { height: "100%", position: "relative", display: "flex", flexDirection: "column", background: "radial-gradient(120% 90% at 70% 10%, #241626 0%, var(--ink) 60%)", overflowY: "auto" };
const lbl = { display: "block", fontFamily: "var(--impact)", fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--dim)", margin: "0 0 6px" };
const input = { width: "100%", background: "var(--ink)", border: "2px solid var(--line)", color: "var(--paper)", padding: "11px 12px", fontFamily: "var(--body)", fontSize: 15, fontWeight: 600, outline: "none" };
const errStyle = { color: "var(--hot)", fontSize: 13, marginTop: 12, fontWeight: 600 };
