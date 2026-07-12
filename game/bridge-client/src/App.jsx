import { useEffect, useState, useCallback } from "react";
import { cgInit, cgLoadingStop, cgInviteCode, cgDataGet, cgDataSet, CG_BUILD, cgGetUserToken, cgOnAuthChange } from "./api/crazygames.js";
import * as api from "./api/backend.js";
import { useI18n } from "./api/i18n.jsx";
import { initAudio, setSfxVolumes } from "./api/audio.js";
import { initMusic, playScene, stopMusic, setMusicVolumes } from "./api/music.js";
import { applyPrefs } from "./api/prefs.js";
import SignIn from "./screens/SignIn.jsx";
import Onboarding from "./screens/Onboarding.jsx";
import Hangar from "./screens/Hangar.jsx";
import Locker from "./screens/Locker.jsx";
import Shop from "./screens/Shop.jsx";
import Wheels from "./screens/Wheels.jsx";
import Settings from "./screens/Settings.jsx";
import Play from "./screens/Play.jsx";
import Profile from "./screens/Profile.jsx";
import Admin from "./screens/Admin.jsx";
import Perks from "./screens/Perks.jsx";
import News from "./screens/News.jsx";
import NavRail from "./components/NavRail.jsx";
import { createSocialConnection } from "./api/social.js";

// Top-level client. Holds auth + the player profile, and routes between the
// home "hangar" (progression), the locker (cosmetics), and play (lobby+match).
export default function App() {
  const { syncAccountLang } = useI18n();
  const [booted, setBooted] = useState(false);
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [catalogue, setCatalogue] = useState(null);
  const [screen, setScreen] = useState("play");
  const [inRoom, setInRoom] = useState(false);
  const [social, setSocial] = useState(null);
  const [invite, setInvite] = useState(null);          // pending lobby invite { roomId, fromName, expiresAt }
  const [pendingJoin, setPendingJoin] = useState(null); // roomId Play should auto-join into
  const [newsUnread, setNewsUnread] = useState(0);      // count of live news tiles this account hasn't opened

  // CrazyGames: the menu being interactive = loading done. And if the player
  // arrived via a platform invite link, the friend's join code rides in on the
  // SDK's inviteParams — feed it straight into the normal auto-join path.
  useEffect(() => {
    if (!user) return;
    cgInit().then(() => {
      cgLoadingStop();
      const tok = api.getToken();
      if (tok) cgDataSet("gp_token", tok);   // cloud-save the session for next visit
      const code = cgInviteCode();
      if (code) { setPendingJoin(String(code).toUpperCase()); setScreen("play"); }
    });
  }, [user]);

  const loadAll = useCallback(async () => {
    const [p, c, st, nw] = await Promise.all([api.getProfile(), api.getCatalogue(), api.getSettings().catch(() => null), api.getNews().catch(() => null)]);
    setProfile(p); setCatalogue(c);
    setNewsUnread(nw?.unread || 0);
    if (st?.settings) {
      applyPrefs(st.settings);
      if (st.settings.audio) { setMusicVolumes(st.settings.audio); setSfxVolumes(st.settings.audio); }
    }
  }, []);

  // On boot, resume or establish a session. On CrazyGames the portal REQUIRES
  // zero-friction auth: a logged-in CG user is verified via their SDK token and
  // auto-signed into their linked account (same account on every device); a CG
  // guest gets a silent guest account, restored across sessions through the
  // platform's cloud save. The sign-in screen never renders on CrazyGames.
  useEffect(() => {
    (async () => {
      try {
        await cgInit();
        if (CG_BUILD) {
          if (!api.getToken()) {
            const saved = cgDataGet("gp_token");   // load any returning session FIRST —
            if (saved) api.setToken(saved);        // a guest bearer lets the backend LINK it
          }
          const cgTok = await cgGetUserToken();
          if (cgTok) {
            try {
              const { token } = await api.crazyLogin(cgTok);
              if (token) api.setToken(token);   // CG identity outranks any saved session
            } catch {}
          }
          if (!api.getToken()) {
            try { const { token } = await api.guestLogin(); if (token) api.setToken(token); } catch {}
          }
          cgOnAuthChange(() => window.location.reload());  // mid-session CG login → clean re-boot
        } else if (!api.getToken()) {
          const saved = cgDataGet("gp_token");
          if (saved) api.setToken(saved);
        }
      } catch {}
      if (api.getToken()) {
        try { const m = await api.me(); setUser(m.user); syncAccountLang(m.user?.language); await loadAll(); }
        catch { api.signOut(); }
      }
      setBooted(true);
    })();
    
    // Initialize audio + background music on first click (browser policy)
    const initSfx = () => { initAudio(); initMusic(); document.removeEventListener("click", initSfx); };
    document.addEventListener("click", initSfx);
    return () => document.removeEventListener("click", initSfx);
  }, [loadAll, syncAccountLang]);

  // Keep a session-long "social" socket alive while signed in: marks us online,
  // powers friend presence, and delivers lobby invites from anywhere in the app.
  const onboarded = !!user && user.tosAccepted && user.nameChosen;

  // Background music scene control. While signed in & onboarded, every screen
  // except "play" uses the menu/lobby track; inside "play", the Play screen
  // switches between the lobby track and the in-match track itself.
  useEffect(() => {
    if (!onboarded) { stopMusic(); return; }
    if (screen !== "play") playScene("menuLobby");
  }, [screen, onboarded]);

  useEffect(() => {
    if (!onboarded) return;
    const s = createSocialConnection({ onInvite: (msg) => setInvite(msg) });
    setSocial(s);
    return () => { s.disconnect(); setSocial(null); };
  }, [onboarded, user?.id]);

  const onSignedIn = async (u) => { setUser(u); syncAccountLang(u?.language); await loadAll(); setScreen("play"); };
  const refreshProfile = useCallback(async () => { setProfile(await api.getProfile()); }, []);
  // Refresh the nav's unread-news count (after the player opens a dispatch).
  const refreshNews = useCallback(async () => {
    try { const nw = await api.getNews(); setNewsUnread(nw?.unread || 0); } catch { /* non-fatal */ }
  }, []);
  // Dismiss the restored-purchase notice banner: drain the server queue, then
  // refresh the profile so the notice doesn't re-show on the next load.
  const dismissNotices = useCallback(async () => {
    try { await api.ackNotices(); } catch { /* best-effort */ }
    setProfile((p) => (p ? { ...p, notices: [] } : p));
    try { setProfile(await api.getProfile()); } catch { /* non-fatal */ }
  }, []);
  // Refresh BOTH the account (name/credits/streamer flag) and the profile, used
  // by the Settings account panel after a paid rename or streamer-mode toggle.
  const refreshUserAndProfile = useCallback(async () => {
    const [m, p] = await Promise.all([api.me(), api.getProfile()]);
    setUser(m.user); setProfile(p);
  }, []);

  // Accept the active lobby invite: validate via the social socket, then hand the
  // roomId to Play to join through the normal game connection.
  const acceptInvite = async () => {
    if (!social || !invite) return;
    const res = await social.acceptInvite(invite.roomId);
    setInvite(null);
    if (res?.ok) { setPendingJoin(res.roomId); setScreen("play"); }
  };
  // Direct-drop into a mutual friend's open lobby (from the Profile friends list).
  const joinFriend = useCallback(async (friendId) => {
    if (!social) return { error: "Still connecting — try again in a moment." };
    const res = await social.directJoin(friendId);
    if (res?.ok) { setPendingJoin(res.roomId); setScreen("play"); }
    return res;
  }, [social]);

  // Advance the onboarding gate as the user accepts ToS / picks a name. Refresh
  // the profile too so the chosen name/avatar shows everywhere right away.
  const onOnboarded = async (u) => { setUser(u); if (u.tosAccepted && u.nameChosen) await loadAll(); };

  if (!booted) return <Boot />;
  if (!user) return <SignIn onSignedIn={onSignedIn} />;
  // First-time onboarding: must accept ToS and pick a name before entering.
  if (!user.tosAccepted || !user.nameChosen) return <Onboarding user={user} onUpdated={onOnboarded} />;

  return (
    <div style={{ height: "100%", display: "flex", background: "var(--ink)" }}>
      {invite && <InviteToast invite={invite} onAccept={acceptInvite} onDismiss={() => setInvite(null)} />}
      {profile?.notices?.length > 0 && <NoticeToast notices={profile.notices} stacked={!!invite} onDismiss={dismissNotices} />}
      {!inRoom && <NavRail screen={screen} setScreen={setScreen} user={user} profile={profile} catalogue={catalogue}
        newsUnread={newsUnread}
        onSignOut={() => { api.signOut(); setUser(null); setProfile(null); }} />}
      <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
        {screen === "hangar" && <Hangar user={user} profile={profile} catalogue={catalogue} />}
        {screen === "news" && <News onUnreadChange={refreshNews} />}
        {screen === "perks" && <Perks profile={profile} />}
        {screen === "profile" && <Profile user={user} profile={profile} catalogue={catalogue} onChange={refreshProfile} social={social} onJoinFriend={joinFriend} />}
        {screen === "locker" && <Locker profile={profile} catalogue={catalogue} onChange={refreshProfile} />}
        {screen === "shop" && <Shop profile={profile} catalogue={catalogue} onChange={refreshProfile} />}
        {screen === "wheels" && <Wheels profile={profile} catalogue={catalogue} />}
        {screen === "settings" && <Settings user={user} profile={profile} onAccountChange={refreshUserAndProfile} onGoShop={() => setScreen("shop")} />}
        {screen === "admin" && user?.adminRole && <Admin user={user} />}
        {screen === "play" && <Play user={user} profile={profile} catalogue={catalogue} onRoomStatus={setInRoom} onChange={refreshProfile}
          pendingJoin={pendingJoin} onPendingJoinConsumed={() => setPendingJoin(null)} />}
      </div>
    </div>
  );
}

// Global lobby-invite toast with a live 20s countdown derived from the server's
// expiresAt. Auto-dismisses when the timer runs out.
function InviteToast({ invite, onAccept, onDismiss }) {
  const [left, setLeft] = useState(Math.max(0, Math.ceil((invite.expiresAt - Date.now()) / 1000)));
  useEffect(() => {
    const t = setInterval(() => {
      const s = Math.max(0, Math.ceil((invite.expiresAt - Date.now()) / 1000));
      setLeft(s);
      if (s <= 0) { clearInterval(t); onDismiss?.(); }
    }, 250);
    return () => clearInterval(t);
  }, [invite, onDismiss]);
  return (
    <div style={inviteWrap}>
      <span className="kanji" style={{ fontSize: 22, color: "var(--volt)" }}>JOIN</span>
      <div style={{ flex: 1 }}>
        <div className="impactf" style={{ fontSize: 13, color: "var(--paper)", letterSpacing: "0.05em" }}>
          {invite.fromName} invited you to their lobby
        </div>
        <div className="faint" style={{ fontSize: 11 }}>Expires in {left}s · code {invite.roomId}</div>
      </div>
      <button className="btn btn-hot" style={{ fontSize: 13 }} onClick={onAccept}>Join</button>
      <button className="btn" style={{ fontSize: 13 }} onClick={onDismiss}>Dismiss</button>
    </div>
  );
}
const inviteWrap = { position: "fixed", top: 18, right: 18, zIndex: 9999, display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", background: "rgba(13,11,20,0.97)", border: "2px solid var(--volt)", boxShadow: "0 10px 40px rgba(0,0,0,0.6), 0 0 20px rgba(70,230,255,0.25)", minWidth: 300, maxWidth: 360 };

// Banner shown when an admin has restored a wrongly-reversed purchase: names
// exactly what came back so the player understands why their items reappeared.
// Drains the server-side notice queue on dismiss (so it shows once).
function NoticeToast({ notices, stacked, onDismiss }) {
  return (
    <div style={{ ...noticeWrap, top: stacked ? 86 : 18 }}>
      <span className="kanji" style={{ fontSize: 22, color: "var(--volt)" }}>RESTORED</span>
      <div style={{ flex: 1 }}>
        <div className="impactf" style={{ fontSize: 13, color: "var(--paper)", letterSpacing: "0.05em" }}>
          Purchase restored
        </div>
        {notices.map((n) => (
          <div key={n.id} className="faint" style={{ fontSize: 11 }}>{n.text}</div>
        ))}
      </div>
      <button className="btn" style={{ fontSize: 13 }} onClick={onDismiss}>Dismiss</button>
    </div>
  );
}
const noticeWrap = { position: "fixed", right: 18, zIndex: 9998, display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", background: "rgba(13,11,20,0.97)", border: "2px solid var(--volt)", boxShadow: "0 10px 40px rgba(0,0,0,0.6), 0 0 20px rgba(70,230,255,0.25)", minWidth: 300, maxWidth: 380 };

function Boot() {
  return (
    <div style={{ height: "100%", display: "grid", placeItems: "center", background: "var(--ink)" }}>
      <div className="display" style={{ fontSize: 46, color: "var(--hot)", letterSpacing: "0.08em" }}>SANDBOX GP</div>
    </div>
  );
}
