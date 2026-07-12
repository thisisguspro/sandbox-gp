import { CG_BUILD } from "../api/crazygames.js";
import { useState, useEffect, useRef } from "react";
import * as api from "../api/backend.js";
import { useI18n } from "../api/i18n.jsx";
import { SpeedLines, Particles } from "../components/effects.jsx";

// Loads the Google Identity Services script once and resolves when ready.
let gisPromise = null;
function loadGis() {
  if (gisPromise) return gisPromise;
  gisPromise = new Promise((resolve, reject) => {
    if (window.google?.accounts?.id) return resolve();
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true; s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Couldn't load Google sign-in."));
    document.head.appendChild(s);
  });
  return gisPromise;
}

// Sign-in. Google sign-in is the ONLY way in — the configured superadmin email
// unlocks admin powers when signing in with Google.
export default function SignIn({ onSignedIn }) {
  const onCrazyGames = CG_BUILD;
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [googleOn, setGoogleOn] = useState(false);
  const [ready, setReady] = useState(false);
  const [devOn, setDevOn] = useState(false);
  const [devName, setDevName] = useState("");
  const gbtn = useRef(null);

  // Dev-only bypass (server reports devLoginEnabled when NOT in production). Any
  // call sign logs in for local playtesting; never available on a live deploy.
  const [guestName, setGuestName] = useState("");
  async function doGuest(e) {
    e?.preventDefault?.();
    setBusy(true); setErr(null);
    try {
      const data = await api.guestLogin(guestName.trim() || undefined);
      if (data.token) api.setToken(data.token);
      onSignedIn(data.user);
    } catch (e) { setErr(e.message || "Guest sign-in failed."); }
    finally { setBusy(false); }
  }

  async function doDevLogin(e) {
    e?.preventDefault?.();
    setBusy(true); setErr(null);
    try { const { user } = await api.devSignIn(devName.trim()); onSignedIn(user); }
    catch (e) { setErr(e.message || t("signin.errDev")); }
    finally { setBusy(false); }
  }

  // On mount, ask the server if Google sign-in is configured; if so, load GIS and
  // render its official button into the placeholder div. There is no other path.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const cfg = await api.authConfig();
        if (cancelled) return;
        setDevOn(!!cfg.devLoginEnabled);
        if (!cfg.googleEnabled || !cfg.googleClientId) { setReady(true); return; }
        await loadGis();
        if (cancelled || !gbtn.current) return;
        window.google.accounts.id.initialize({
          client_id: cfg.googleClientId,
          callback: async ({ credential }) => {
            if (!credential) return;
            setBusy(true); setErr(null);
            try { const { user } = await api.signInGoogle(credential); onSignedIn(user); }
            catch (e) { setErr(e.message || t("signin.errGoogle")); }
            finally { setBusy(false); }
          },
        });
        window.google.accounts.id.renderButton(gbtn.current, {
          theme: "filled_black", size: "large", shape: "pill", text: "continue_with", width: 304,
        });
        setGoogleOn(true);
      } catch {
        if (!cancelled) setErr(t("signin.errReach"));
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => { cancelled = true; };
  }, [onSignedIn]);

  return (
    <div style={wrap}>
      <SpeedLines hot />
      <Particles density={36} />
      <div style={{ position: "relative", zIndex: 2, textAlign: "center", margin: "auto", padding: "40px 20px", width: "100%", maxWidth: 500 }}>
        <div className="kanji" style={{ fontSize: 22, color: "var(--hot)", letterSpacing: "0.4em", marginBottom: 4 }}>SANDBOX GP</div>
        <h1 className="display" style={{ fontSize: "clamp(44px,9vw,96px)", margin: 0, lineHeight: 0.86,
          background: "linear-gradient(180deg,#fff 0%,#ffd0d8 60%,var(--hot) 100%)",
          WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", textShadow: "0 0 40px rgba(255,45,77,0.3)" }}>
          SANDBOX GP
        </h1>
        <div className="impactf dim" style={{ letterSpacing: "0.35em", marginTop: 2, marginBottom: 36, fontSize: 13, textTransform: "uppercase" }}>
          {t("signin.tagline")}
        </div>

        <div className="panel panel-hot" style={{ padding: 28, width: 360, margin: "0 auto", textAlign: "center", background: "var(--ink-2)" }}>
          <div className="tag" style={{ marginBottom: 22 }}><span>{t("signin.saddleUp")}</span></div>
          {!onCrazyGames && <div ref={gbtn} style={{ display: "flex", justifyContent: "center", minHeight: googleOn ? 40 : 0 }} />}
          {ready && !googleOn && !devOn && (
            <div style={{ color: "var(--hot)", fontSize: 13, fontWeight: 600, lineHeight: 1.5 }}>
              {t("signin.googleNotConfigured")}
            </div>
          )}
          {ready && (
            <form onSubmit={doGuest} style={{ marginTop: googleOn ? 14 : 0 }}>
              {googleOn && (
                <div className="faint" style={{ fontSize: 11, letterSpacing: "0.25em", margin: "4px 0 12px", textTransform: "uppercase" }}>
                  or jump straight in
                </div>
              )}
              <div style={{ display: "flex", gap: 8 }}>
                <input value={guestName} onChange={(e) => setGuestName(e.target.value)} maxLength={20}
                  placeholder="Pick a racer name (optional)"
                  style={{ flex: 1, padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", background: "rgba(0,0,0,0.25)", color: "var(--paper)" }} />
                <button className="btn btn-hot" type="submit" disabled={busy}>🏁 PLAY AS GUEST</button>
              </div>
            </form>
          )}
          {devOn && (
            <form onSubmit={doDevLogin} style={{ marginTop: 16 }}>
              {googleOn && (
                <div className="faint" style={{ fontSize: 11, letterSpacing: "0.25em", margin: "4px 0 14px", textTransform: "uppercase" }}>
                  {t("signin.orDev")}
                </div>
              )}
              <input
                value={devName}
                onChange={(e) => setDevName(e.target.value)}
                placeholder={t("signin.callSign")}
                style={{ width: "100%", padding: "11px 12px", background: "var(--ink)", border: "1px solid var(--hot)",
                  borderRadius: 8, color: "#fff", fontSize: 14, marginBottom: 10, boxSizing: "border-box", textAlign: "center" }}
              />
              <button type="submit" disabled={busy}
                style={{ width: "100%", padding: "11px 12px", background: "var(--hot)", color: "#fff", border: "none",
                  borderRadius: 8, fontWeight: 700, fontSize: 14, cursor: busy ? "default" : "pointer", letterSpacing: "0.06em" }}>
                {busy ? t("signin.saddlingUp") : t("signin.rideIn")}
              </button>
              <div className="faint" style={{ fontSize: 11, marginTop: 10, lineHeight: 1.4 }}>
                {t("signin.devHint")}
              </div>
            </form>
          )}
          {err && <div style={{ color: "var(--hot)", fontSize: 13, marginTop: 14, fontWeight: 600 }}>{err}</div>}
          {busy && <div className="faint" style={{ fontSize: 12, marginTop: 14 }}>{t("signin.saddlingUp")}</div>}
        </div>
        <div className="faint" style={{ marginTop: 18, fontSize: 12 }}>
          {t("signin.saveProgress")}
        </div>
      </div>
    </div>
  );
}

const wrap = { height: "100%", position: "relative", display: "flex", flexDirection: "column", background: "radial-gradient(120% 90% at 70% 10%, #241626 0%, var(--ink) 60%)", overflowY: "auto" };
