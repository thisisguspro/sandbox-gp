import { useEffect, useRef, useState, useCallback } from "react";
import * as api from "../api/backend.js";
import { createGameConnection } from "../api/game.js";
import { SpeedLines, useImpact, KanjiFlash, SlashEffect } from "../components/effects.jsx";
import { sfx, initAudio } from "../api/audio.js";
import { playScene } from "../api/music.js";
import { PlayerActions } from "../components/CrewActions.jsx";
import PremiumBadge, { PREMIUM_MULT } from "../components/PremiumBadge.jsx";
import { useI18n } from "../api/i18n.jsx";
import Podium3D from "../game/podium3d.jsx";
import ProfileCard from "../components/ProfileCard.jsx";
import { analytics } from "../api/analytics.js";
import { cgGameplayStart, cgGameplayStop, cgHappytime, cgUpdateRoom, cgClearRoom, cgMidgameAd } from "../api/crazygames.js";
import Race3D from "./Race3D.jsx";

// ============================================================================
// THE WELCOME CARD
//
// What was here was a 3-2-1 countdown that ended by shouting "DRAW!" — and it
// literally called SpeechSynthesis to SAY the word out loud. That's a leftover
// from the gunslinger game this was forked from. Nobody draws anything in a kart
// race.
//
// It also fought with the pre-race flythrough: a huge countdown slapped over the
// top of the camera sweep, and the F1 start lights in the HUD were already doing
// the actual counting. So the countdown is gone entirely. What you get instead,
// while the camera flies the circuit, is the name of the track you're about to
// drive.
// ============================================================================
function WelcomeCard({ mapName, until }) {
  const [gone, setGone] = useState(false);
  useEffect(() => {
    const ms = Math.max(0, until - Date.now());
    const t = setTimeout(() => setGone(true), ms);
    return () => clearTimeout(t);
  }, [until]);
  if (gone) return null;

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 400, pointerEvents: "none",
      // parked in the UPPER band: the how-to-play card owns the bottom, the
      // welcome sign owns the top — they never stack again
      display: "grid", placeItems: "start center", paddingTop: "7vh",
    }}>
      <div style={{
        textAlign: "center",
        animation: "welcomeIn 1.1s cubic-bezier(0.16,1,0.3,1)",
        // a soft vignette, not the heavy black scrim the countdown used — you want
        // to SEE the flythrough, that's the whole point of it
        padding: "26px 54px",
        background: "linear-gradient(180deg, rgba(6,20,26,0.55), rgba(6,20,26,0.25))",
        backdropFilter: "blur(3px)",
        borderRadius: 14,
        border: "1px solid rgba(255,247,234,0.22)",
      }}>
        <div className="impactf" style={{
          fontSize: 15, letterSpacing: "0.34em", color: "var(--volt)",
          textShadow: "0 2px 12px rgba(120, 90, 50, 0.6)",
        }}>WELCOME TO</div>
        <div className="display" style={{
          fontSize: "clamp(34px, 7vw, 76px)", lineHeight: 1.05, marginTop: 6,
          color: "var(--paper)",
          textShadow: "0 0 40px rgba(47,230,200,0.5), 0 4px 0 rgba(120, 90, 50, 0.45)",
        }}>{mapName || "THE BEACH"}</div>
      </div>
      <style>{`
        @keyframes welcomeIn {
          from { transform: translateY(26px) scale(0.94); opacity: 0; }
          to   { transform: translateY(0)    scale(1);    opacity: 1; }
        }
      `}</style>
    </div>
  );
}

// Play: connects to the game server, hosts the lobby, then renders the live
// match driven by the server's per-player "state" stream. Classic mode focus —
// no event/mode pickers here. Real Socket.IO throughout.
export default function Play({ user, profile, catalogue, onRoomStatus, onChange, pendingJoin, onPendingJoinConsumed }) {
  const { t } = useI18n();
  const [conn, setConn] = useState(null);
  const [connected, setConnected] = useState(false);
  const [view, setView] = useState(null);     // redacted match view from server
  const [roomId, setRoomId] = useState(null);
  const [error, setError] = useState(null);
  const [joinCode, setJoinCode] = useState("");
  const [joke, setJoke] = useState(false);      // hit the streamer-mode decoy code
  const [flash, setFlash] = useState(null);
  const [welcomeUntil, setWelcomeUntil] = useState(null);  // the "Welcome to <map>" card
  const [liveEvents, setLiveEvents] = useState([]);
  const raceEventsRef = useRef([]); // drained by Race3D each frame
  const prevPhase = useRef(null);
  const raceStartAt = useRef(0);
  const [questsRefresh, setQuestsRefresh] = useState(0);
  const seenEvents = useRef(new Set());
  // Kept in refs so the socket's onConnect (a long-lived closure) can see the
  // CURRENT room/seat when it reconnects after a transient drop.
  const roomIdRef = useRef(null);
  const playerIdRef = useRef(null);
  const rejoinTokenRef = useRef(null); // per-seat secret from create/join, authorizes guest rejoin
  useEffect(() => { roomIdRef.current = roomId; }, [roomId]);

  useEffect(() => {
    if (onRoomStatus) onRoomStatus(!!roomId);
  }, [roomId, onRoomStatus]);

  // open the socket on mount
  useEffect(() => {
    const c = createGameConnection({
      onState: (v) => setView(v),
      onEvents: (events) => {
        // Race events go into a DRAIN QUEUE, not last-write state: React
        // coalesces rapid state updates (guaranteed on slow devices), and a
        // transient batch like item_used must never be swallowed by the empty
        // batch that follows it one tick later.
        if (events?.length) raceEventsRef.current.push(...events);
        setLiveEvents(events); // latest batch, for the comms/caption layer
        // Batch 1 stub: no per-event flashes; the ended-phase flash covers the
        // finish. Race events (overtakes, item hits) wire in with Batch 2.
        if (seenEvents.current.size > 200) seenEvents.current = new Set();
      },
      onError: (m) => { setError(m); setTimeout(() => setError(null), 2600); },
      onConnect: () => {
        setConnected(true);
        // Reconnected mid-match? The server holds our seat for a grace window —
        // reclaim it instead of dropping the player back to the lobby entry.
        const rid = roomIdRef.current;
        if (rid) {
          c.rejoinRoom(rid, playerIdRef.current, rejoinTokenRef.current).then((res) => {
            if (res?.error) {
              setError(res.error); setTimeout(() => setError(null), 2600);
              setRoomId(null); setView(null); setLiveEvents([]);
            }
          });
        }
      },
      onDisconnect: () => setConnected(false),
    });
    setConn(c);
    return () => c.disconnect();
  }, []);

  // phase-change flourishes
  useEffect(() => {
    if (!view) return;
    const ph = view.phase;
    if (ph !== prevPhase.current) {
      if (ph === "active" && prevPhase.current === "lobby") {
        // Seed the visual 3-2-1 from the server's authoritative stand-off timer so
        // the "DRAW!" lands exactly when the server releases movement.
        // The start lights in the HUD are the real countdown now (they read the
        // server clock directly). This 3-2-1 overlay is a short flourish on top —
        // seeding it from an 11-second freeze meant it ticked for eleven seconds
        // and looked broken.
        // Show the map name for the length of the flythrough. NO countdown — the
        // F1 start lights in the HUD already count you in, and a giant 3-2-1
        // plastered over the camera sweep defeated the point of having one.
        setWelcomeUntil(Date.now() + 6000);
        raceStartAt.current = Date.now();
        cgGameplayStart();
        const players = view.players || [];
        const bots = players.filter((p) => p.isBot || /^(Puddle|Splasher|Riptide) Bot/.test(p.name || "")).length;
        analytics.raceStart({
          players: players.length,
          bots,
          humans: players.length - bots,
          map: view.map?.id,
          laps: view.map?.laps,
        });
      }
      if (ph === "ended") {
        setQuestsRefresh((n) => n + 1);   // pull fresh quest progress for the panel
        const isDraw = view.winReason === "draw";
        const p1 = view.you?.place === 1;
        if (isDraw) {
          setFlash({ text: "DRAW", sub: "TIME'S UP — NO WINNER", color: "var(--gold)" });
        } else {
          setFlash({ text: (p1 ? "VICTORY" : "FINISH").toUpperCase(), sub: p1 ? "CHECKERED FLAG!" : "RACE COMPLETE", color: p1 ? "var(--volt)" : "var(--gold)" });
        }
        cgGameplayStop();
        if (p1 && !isDraw) cgHappytime();   // platform confetti — wins only, per CG docs
        analytics.raceComplete({
          place: view.you?.place,
          players: (view.players || []).length,
          won: p1,
          durationSec: raceStartAt.current ? Math.round((Date.now() - raceStartAt.current) / 1000) : undefined,
        });
      }
      prevPhase.current = ph;
    }
  }, [view]);

  // Report our room to the CrazyGames platform (invite button, friend join,
  // presence). Joinable only while the lobby is open with a free seat.
  useEffect(() => {
    if (!roomId) return;
    const players = view?.players || [];
    const maxP = view?.map?.maxPlayers || 4;
    const joinable = view?.phase === "lobby" && players.length < maxP;
    cgUpdateRoom(roomId, { joinable });
  }, [roomId, view?.phase, (view?.players || []).length]);

  const create = async () => {
    setError(null);
    const res = await conn.createRoom({ isPublic: false }, user.name);
    if (res.error) return setError(res.error);
    if (res.playerId) playerIdRef.current = res.playerId;
    if (res.rejoinToken) rejoinTokenRef.current = res.rejoinToken;
    setRoomId(res.roomId);
    analytics.lobbyEnter("host", res.roomId);
  };
  const joinByCode = async () => {
    if (!joinCode.trim()) return;
    const res = await conn.joinRoom(joinCode.trim().toUpperCase(), user.name);
    if (res.joke) { setJoke(true); return; }   // streamer-mode decoy code
    if (res.error) return setError(res.error);
    if (res.playerId) playerIdRef.current = res.playerId;
    if (res.rejoinToken) rejoinTokenRef.current = res.rejoinToken;
    setRoomId(res.roomId);
    analytics.lobbyEnter("code", res.roomId);
  };
  const joinRandom = async () => {
    const res = await conn.joinRandom(user.name);
    if (res.error) return setError(res.error);
    if (res.playerId) playerIdRef.current = res.playerId;
    if (res.rejoinToken) rejoinTokenRef.current = res.rejoinToken;
    setRoomId(res.roomId);
    analytics.lobbyEnter("random", res.roomId);
  };
  // B9 — Quick Join: server drops us into the open game closest to 4 real players.
  const quickJoin = async (code) => {
    setError(null);
    const res = code
      ? await conn.joinRoom(code, user.name)
      : await conn.quickJoin(user.name);
    if (res.joke) { setJoke(true); return; }
    if (res.error) return setError(res.error);
    if (res.playerId) playerIdRef.current = res.playerId;
    if (res.rejoinToken) rejoinTokenRef.current = res.rejoinToken;
    setRoomId(res.roomId);
    analytics.lobbyEnter(code ? "browse" : "quickjoin", res.roomId);
  };
  // B10 — Quick Race: hosted race on a rotating circuit, bot-filled, auto-start.
  const quickRace = async () => {
    setError(null);
    const res = await conn.quickRace(user.name);
    if (res.error) return setError(res.error);
    if (res.playerId) playerIdRef.current = res.playerId;
    if (res.rejoinToken) rejoinTokenRef.current = res.rejoinToken;
    setRoomId(res.roomId);
    analytics.lobbyEnter("quickrace", res.roomId);
    conn.startMatch(res.roomId);
  };
  // One click → hosted room → immediate start; the server fills the grid with
  // bots. The shortest path from menu to racing.
  const quickPlay = async () => {
    setError(null);
    // dev_fastrace=1 (QA only): a 1-lap testloop race so finish/results flows
    // can be exercised in seconds instead of the grand circuit's 4+ minutes
    const fast = new URLSearchParams(window.location.search).get("dev_fastrace") === "1";
    // ?dev_track=volcano lets QA open a specific circuit without clicking through
    // the lobby. Harmless in production (nobody types it) and it is the only way
    // to actually LOOK at every map.
    const devTrack = new URLSearchParams(location.search).get("dev_track");
    const cfg = fast
      ? { isPublic: false, laps: 1, trackId: "testloop", finishTimeoutSec: 6 }
      : (devTrack ? { isPublic: false, trackId: devTrack } : { isPublic: false });
    const res = await conn.createRoom(cfg, user.name);
    if (res.error) return setError(res.error);
    if (res.playerId) playerIdRef.current = res.playerId;
    if (res.rejoinToken) rejoinTokenRef.current = res.rejoinToken;
    setRoomId(res.roomId);
    analytics.lobbyEnter("quick", res.roomId);
    conn.startMatch(res.roomId);
  };
  // Solo, no items, three laps against the clock. Best lap posts to the weekly board.
  const timeTrial = async () => {
    setError(null);
    // The mode id is "timeattack". This said "timetrial" — a mode that does not
    // exist — so getMode() returned null, the engine fell back to a plain RACE, and
    // the Time Attack button never actually started a time attack. It just ran a
    // solo race with the items switched off.
    const res = await conn.createRoom({ isPublic: false, mode: "timeattack", items: false, autoFill: false, laps: 3 }, user.name);
    if (res.error) return setError(res.error);
    if (res.playerId) playerIdRef.current = res.playerId;
    if (res.rejoinToken) rejoinTokenRef.current = res.rejoinToken;
    setRoomId(res.roomId);
    analytics.lobbyEnter("timeattack", res.roomId);
    conn.startMatch(res.roomId);
  };
  const leave = () => {
    // if they bail during an active race, that's an abandonment worth measuring
    if (view?.phase === "active") {
      analytics.raceLeave({ lap: view.you?.lap, place: view.you?.place, players: (view.players || []).length });
    }
    cgGameplayStop();
    cgClearRoom();
    if (conn && roomId) conn.leaveRoom(roomId);   // unseat server-side, keep the socket
    roomIdRef.current = null;                     // never grace-rejoin a room we quit
    setView(null); setRoomId(null); setLiveEvents([]); onRoomStatus?.(false); onChange?.();
  };

  // Consume a direct/invite join handed down by App: once our game socket is
  // connected and we're not already seated, join the target room the normal way.
  useEffect(() => {
    if (!pendingJoin || !conn || !connected || roomId) return;
    let done = false;
    (async () => {
      const res = await conn.joinRoom(pendingJoin, user.name);
      if (done) return;
      if (res?.playerId) playerIdRef.current = res.playerId;
      if (res?.rejoinToken) rejoinTokenRef.current = res.rejoinToken;
      if (res?.roomId) setRoomId(res.roomId);
      else if (res?.error) { setError(res.error); setTimeout(() => setError(null), 2600); }
      onPendingJoinConsumed?.();
    })();
    return () => { done = true; };
  }, [pendingJoin, conn, connected, roomId, user.name, onPendingJoinConsumed]);

  const inMatch = view && (view.phase === "active" || view.phase === "ended");

  // Swap to the in-match music while a match runs; otherwise the lobby shares
  // the menu track. App handles every non-"play" screen.
  useEffect(() => { playScene(inMatch ? "match" : "menuLobby"); }, [inMatch]);

  return (
    <div style={wrap}>
      <SpeedLines hot={inMatch} />
      {flash && <KanjiFlash {...flash} onDone={() => setFlash(null)} />}
      {/* purely cosmetic now — it cannot lock or unlock anything */}
      {welcomeUntil && <WelcomeCard mapName={view?.map?.name} until={welcomeUntil} />}
      {error && <div style={toast}>{error}</div>}

      <div style={{ position: "relative", zIndex: 2, height: "100%" }}>
        {joke && <JokeScreen onClose={() => { setJoke(false); setJoinCode(""); }} />}
        {!roomId && !joke && <LobbyEntry connected={connected} joinCode={joinCode} setJoinCode={setJoinCode}
          onCreate={create} onJoinCode={joinByCode} onRandom={joinRandom}
          onQuickPlay={quickPlay} onTimeTrial={timeTrial}
          onQuickRace={quickRace} onQuickJoin={quickJoin} conn={conn}
          questsSlot={<DailyQuests refreshKey={questsRefresh} />} />}
        {roomId && !inMatch && <LobbyRoom view={view} roomId={roomId} conn={conn} isHost={view?.you?.id === view?.hostId} onLeave={leave} />}
        {/* INPUT LOCK: the SERVER decides when you can drive, and nothing else.
            This used to be `inputLocked || startFreezeLeft > 0` — where
            `inputLocked` was a piece of React state cleared by a client-side
            setInterval counting down from the countdown number. When the frame
            loop stalled (see the shader bug in carMesh), that interval got
            starved, never reached zero, never fired onDone, and the lock stayed
            on FOREVER. The player could see the race, could see other karts
            moving, and pressing W did absolutely nothing.
            The server already publishes startFreezeLeft every tick. It is
            self-healing: if a frame is dropped the next snapshot still says 0.
            A local timer can only ever add a way to get stuck. */}
        {roomId && view?.phase === "active" && <Race3D view={view} roomId={roomId} conn={conn} inputLocked={(view?.startFreezeLeft ?? 0) > 0} onLeave={leave} eventQueue={raceEventsRef} />}
        {roomId && view?.phase === "ended" && <Results view={view} roomId={roomId} conn={conn} profile={profile} catalogue={catalogue}
          onLeave={() => { cgClearRoom(); if (conn && roomId) conn.leaveRoom(roomId); roomIdRef.current = null; cgMidgameAd(() => { setRoomId(null); setView(null); onChange?.(); }); }} onChange={onChange} />}
      </div>
    </div>
  );
}

/* ---------------- lobby entry ---------------- */
// Daily quests + login streak — the "reason to come back tomorrow" panel.
// Server-authoritative: progress moves only via reported match results.
function DailyQuests({ refreshKey }) {
  const [data, setData] = useState(null);
  const [justClaimed, setJustClaimed] = useState(null);
  useEffect(() => {
    let alive = true;
    api.getDaily().then((d) => alive && !d?.error && setData(d)).catch(() => {});
    return () => { alive = false; };
  }, [refreshKey]);
  if (!data) return null;
  const claim = async (q) => {
    const res = await api.claimQuest(q.id);
    if (res?.ok) {
      setJustClaimed(q.id);
      setData((d) => ({ ...d, balance: res.balance, quests: d.quests.map((x) => x.id === q.id ? { ...x, claimed: true } : x) }));
      setTimeout(() => setJustClaimed(null), 1600);
    }
  };
  return (
    <div className="leather-panel" style={{ marginTop: 16, padding: 16, textAlign: "left" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 10 }}>
        <span className="impactf" style={{ fontSize: 13, letterSpacing: "0.12em", color: "var(--gold)", textTransform: "uppercase" }}>Daily Quests</span>
        <span className="dim" style={{ fontSize: 12 }}>🔥 Day {data.streak.count} streak · +{data.streak.todayReward} 🐚 banked</span>
        <span style={{ flex: 1 }} />
        <span className="dim" style={{ fontSize: 12 }}>Resets at midnight UTC</span>
      </div>
      {data.quests.map((q) => {
        const done = q.progress >= q.goal;
        const pct = Math.min(100, Math.round((q.progress / q.goal) * 100));
        return (
          <div key={q.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "7px 0", borderTop: "1px solid rgba(255,255,255,0.07)" }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, color: done ? "var(--gold)" : "var(--paper)" }}>{q.label}</div>
              <div style={{ height: 6, borderRadius: 3, background: "rgba(255,255,255,0.1)", marginTop: 5, overflow: "hidden" }}>
                <div style={{ width: `${pct}%`, height: "100%", background: done ? "var(--gold)" : "var(--volt)", transition: "width 0.4s ease" }} />
              </div>
            </div>
            <div className="dim" style={{ fontSize: 12, minWidth: 44, textAlign: "right" }}>{q.progress}/{q.goal}</div>
            {q.claimed
              ? <span className="dim" style={{ fontSize: 12, minWidth: 86, textAlign: "center" }}>✓ Claimed</span>
              : <button className={done ? "btn btn-hot" : "btn"} disabled={!done} onClick={() => claim(q)}
                  style={{ fontSize: 12, minWidth: 86, animation: justClaimed === q.id ? "gpPulse 0.3s 3 alternate" : "none" }}>
                  +{q.reward} 🐚
                </button>}
          </div>
        );
      })}
    </div>
  );
}

function LobbyEntry({ connected, joinCode, setJoinCode, onCreate, onJoinCode, onRandom, onQuickPlay, onTimeTrial, onQuickRace, onQuickJoin, conn, questsSlot }) {
  const { t } = useI18n();
  return (
    <div data-qa="landing" style={{ height: "100%", display: "grid", placeItems: "center", padding: 24, overflowY: "auto" }}>
      <div style={{ textAlign: "center", maxWidth: 720, width: "100%" }}>
        <h1 className="display" style={{ fontSize: "clamp(60px,10vw,120px)", margin: "4px 0 6px", color: "var(--paper)", textTransform: "uppercase" }}>{t("play.lobby.deploy")}</h1>
        <div className="impactf dim" style={{ letterSpacing: "0.2em", marginBottom: 4, textTransform: "uppercase" }}>
          {connected ? t("play.lobby.fleetLinkEstablished") : t("play.lobby.connectingToFleet")}
        </div>
        {/* QUICK PLAY: one click → hosted, bot-filled, racing. The straightest
            possible line to gameplay (the portal metric that matters most). */}
        <button className="wood-panel" onClick={onQuickPlay} disabled={!connected}
          style={{ ...bigChoice, width: "100%", marginTop: 22, padding: "18px 22px", borderColor: "var(--gold)" }}>
          <div className="display branded-text" style={{ fontSize: 44, color: "var(--gold)" }}>⚡ QUICK PLAY</div>
          <div className="dim" style={{ fontSize: 13 }}>Straight to the starting grid — bots fill the field</div>
        </button>
        {/* B10 — QUICK RACE: a race on a rotating circuit, so back-to-back quick
            races aren't the same map every time. */}
        <button className="wood-panel" onClick={onQuickRace} disabled={!connected}
          style={{ ...bigChoice, width: "100%", marginTop: 12, padding: "14px 20px", borderColor: "var(--volt)" }}>
          <div className="display branded-text" style={{ fontSize: 30, color: "var(--volt)" }}>🏁 QUICK RACE</div>
          <div className="dim" style={{ fontSize: 12 }}>Grand Prix on a fresh circuit each time — the map rotates</div>
        </button>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 16 }}>
          <button className="wood-panel" style={bigChoice} onClick={onCreate} disabled={!connected}>
            <div className="display branded-text" style={{ fontSize: 34, color: "var(--gold)" }}>{t("play.lobby.hostMatch")}</div>
            <div className="dim" style={{ fontSize: 13 }}>{t("play.lobby.hostMatchDesc")}</div>
          </button>
          <button className="wood-panel" style={bigChoice} onClick={onRandom} disabled={!connected}>
            <div className="display branded-text" style={{ fontSize: 34, color: "var(--gold)" }}>{t("play.lobby.joinRandom")}</div>
            <div className="dim" style={{ fontSize: 13 }}>{t("play.lobby.joinRandomDesc")}</div>
          </button>
        </div>
        <div className="leather-panel" style={{ marginTop: 16, padding: 18, display: "flex", gap: 10, alignItems: "center" }}>
          <span className="impactf" style={{ fontSize: 13, letterSpacing: "0.1em", color: "var(--dim)", textTransform: "uppercase" }}>{t("play.lobby.joinByCode")}</span>
          <input value={joinCode} onChange={(e) => setJoinCode(e.target.value.toUpperCase())} maxLength={5}
            placeholder="ABCDE" style={codeInput} onKeyDown={(e) => e.key === "Enter" && onJoinCode()} />
          <button className="btn btn-hot" onClick={onJoinCode} disabled={!connected}>{t("play.lobby.join")}</button>
          <span style={{ flex: 1 }} />
          <button className="btn" onClick={onTimeTrial} disabled={!connected} title="Solo. No items. Just you and the clock — best lap goes on the weekly board.">
            ⏱ TIME TRIAL
          </button>
        </div>
        {/* B8 — the open-games browser: every public lobby with a free seat. */}
        <OpenGamesBrowser connected={connected} conn={conn} onQuickJoin={onQuickJoin} />
        {questsSlot}
      </div>
    </div>
  );
}

// B8 — a scrolling list of open host games under Join Friend. Shows the map, the
// mode, and the REAL player count (bots are never counted), plus a Quick Join
// that prioritizes lobbies closest to 4 players. Auto-refreshes every 4s while open.
function OpenGamesBrowser({ connected, conn, onQuickJoin }) {
  const [games, setGames] = useState(null);
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    if (!conn?.listOpenGames) return;
    setBusy(true);
    const res = await conn.listOpenGames();
    setBusy(false);
    setGames(res?.games || []);
  }, [conn]);
  useEffect(() => {
    if (!connected) return;
    refresh();
    const iv = setInterval(refresh, 4000);
    return () => clearInterval(iv);
  }, [connected, refresh]);

  return (
    <div className="leather-panel" style={{ marginTop: 16, padding: 18, textAlign: "left" }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <span className="impactf" style={{ fontSize: 13, letterSpacing: "0.1em", color: "var(--paper)", textTransform: "uppercase" }}>
          🌐 Open Games
        </span>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn btn-hot" style={{ fontSize: 11, padding: "5px 12px" }} disabled={!connected}
            onClick={() => onQuickJoin?.()} title="Jump into the game closest to a full 4-player lobby.">
            ⚡ QUICK JOIN
          </button>
          <button className="btn" style={{ fontSize: 11, padding: "5px 10px" }} disabled={!connected || busy} onClick={refresh}>
            {busy ? "…" : "↻"}
          </button>
        </div>
      </div>
      <div style={{ maxHeight: 200, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
        {games == null ? (
          <div className="faint" style={{ fontSize: 12 }}>Looking for open games…</div>
        ) : games.length === 0 ? (
          <div className="faint" style={{ fontSize: 12 }}>No open games right now — host one, or Quick Play to start with bots.</div>
        ) : games.map((g) => (
          <div key={g.code} className="row" style={{ justifyContent: "space-between", alignItems: "center", background: "rgba(13,11,20,0.5)", border: "1px solid var(--line)", borderRadius: 8, padding: "8px 12px" }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 800, fontSize: 13, color: "var(--paper)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {g.modeLabel} · {g.mapName}
              </div>
              <div className="dim" style={{ fontSize: 11 }}>
                {g.players}/{g.maxPlayers} player{g.players === 1 ? "" : "s"} · code {g.code}
              </div>
            </div>
            <button className="btn" style={{ fontSize: 11, padding: "5px 12px", borderColor: "var(--volt)", flexShrink: 0 }}
              disabled={!connected} onClick={() => onQuickJoin?.(g.code)}>
              JOIN
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// Harmless joke screen shown when someone tries to join with the fixed decoy
// code a streamer-mode pilot shows on stream. No real room is ever resolved.
function JokeScreen({ onClose }) {
  const { t } = useI18n();
  return (
    <div style={{ height: "100%", display: "grid", placeItems: "center", padding: 24 }}>
      <div className="wanted-poster" style={{ textAlign: "center", maxWidth: 560, padding: "48px 40px" }}>
        <h1 className="display branded-text" style={{ fontSize: "clamp(40px,7vw,72px)", margin: "8px 0 6px", textTransform: "uppercase" }}>{t("play.joke.title")}</h1>
        <div className="impactf" style={{ letterSpacing: "0.18em", color: "var(--hot)", marginBottom: 16, textTransform: "uppercase" }}>{t("play.joke.subtitle")}</div>
        <div className="dim" style={{ fontSize: 14, lineHeight: 1.6, marginBottom: 28, color: "var(--ink)" }}>
          {t("play.joke.body")}
        </div>
        <button className="btn btn-hot" onClick={onClose}>{t("play.joke.back")}</button>
      </div>
    </div>
  );
}

// Invite a friend into this lobby (20s push to their social socket). Loads the
// friend list lazily on first open; any friend can be invited from the lobby.
function InviteFriends({ roomId, conn }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [friends, setFriends] = useState(null);
  const [sent, setSent] = useState({});
  const [msg, setMsg] = useState(null);

  useEffect(() => {
    if (!open || friends) return;
    api.listFriends().then((r) => setFriends(r.friends || [])).catch((e) => { setMsg(e.message); setFriends([]); });
  }, [open, friends]);

  const invite = async (id) => {
    setMsg(null);
    const res = await conn.inviteFriend(roomId, id);
    if (res?.error) setMsg(res.error);
    else setSent((s) => ({ ...s, [id]: true }));
  };

  return (
    <div className="panel" style={{ padding: 18, marginBottom: 24 }}>
      <button className="row" style={{ width: "100%", justifyContent: "space-between", alignItems: "center", background: "none", border: "none", cursor: "pointer", padding: 0 }}
        onClick={() => setOpen((v) => !v)}>
        <span className="impactf" style={{ fontSize: 13, letterSpacing: "0.12em", color: "var(--paper)", textTransform: "uppercase" }}>
          {t("play.invite.title")}
        </span>
        <span className="faint" style={{ fontSize: 12 }}>{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="col gap-s" style={{ marginTop: 14 }}>
          {msg && <div style={{ color: "var(--hot)", fontSize: 12 }}>{msg}</div>}
          {!friends ? <div className="faint" style={{ fontSize: 12 }}>{t("play.invite.loading")}</div>
            : friends.length === 0 ? <div className="faint" style={{ fontSize: 12 }}>{t("play.invite.noFriends")}</div>
            : friends.map((f) => (
              <div key={f.id} className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 13, color: "var(--paper)" }}>{f.name}</span>
                <button className="btn" style={{ fontSize: 11, padding: "4px 10px", textTransform: "none", borderColor: "var(--volt)" }}
                  disabled={!!sent[f.id]} onClick={() => invite(f.id)}>
                  {sent[f.id] ? t("play.invite.invited") : t("play.invite.invite")}
                </button>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

/* ---------------- lobby room ---------------- */
function LobbyRoom({ view, roomId, conn, isHost, onLeave }) {
  const { t } = useI18n();
  const players = view?.players || [];
  const min = view?.map?.minPlayers || 1;
  const enough = players.length >= min;
  const isPublic = !!view?.config?.isPublic;
  // B7 — ready-up. Real players must ready before the host can start.
  const readyMap = view?.ready || {};
  const allReady = view?.allReady !== false;   // server-authoritative
  const meId = view?.you?.id;
  const iAmReady = isHost || readyMap[meId] === true;
  const humanPlayers = players.filter((p) => !p.isBot);
  const readyHumans = humanPlayers.filter((p) => p.id === view?.hostId || readyMap[p.id] === true).length;

  const briefingBadge = {
    background: "var(--hot)",
    color: "#fff",
    padding: "3px 16px",
    display: "inline-block",
    fontFamily: "Rajdhani, sans-serif",
    fontWeight: 900,
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: "0.15em",
    transform: "skewX(-15deg)",
    marginBottom: 16
  };

  const beginDraftBtn = {
    background: "var(--hot)",
    color: "#000",
    width: "100%",
    border: "none",
    padding: "16px 24px",
    fontSize: 18,
    fontWeight: 900,
    textTransform: "uppercase",
    letterSpacing: "0.15em",
    transform: "skewX(-15deg)",
    cursor: "pointer",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    transition: "all 0.2s"
  };

  const mainCardStyle = {
    background: "rgba(22, 16, 10, 0.45)",
    border: "1px solid rgba(255, 255, 255, 0.08)",
    borderRadius: 4,
    padding: 24,
    marginBottom: 24
  };

  const crewGridStyle = {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
    gap: 12,
    marginTop: 20
  };

  const crewCardStyle = {
    background: "rgba(13, 11, 20, 0.6)",
    border: "1px solid rgba(255, 255, 255, 0.05)",
    padding: "12px 14px",
    display: "flex",
    alignItems: "center",
    gap: 10,
    transform: "skewX(-15deg)",
    position: "relative",
    overflow: "hidden"
  };

  const sidebarStyle = {
    background: "rgba(13, 11, 20, 0.55)",
    border: "1px solid rgba(255, 255, 255, 0.08)",
    borderRadius: 4,
    padding: "32px 24px",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    textAlign: "center",
    // The sidebar holds the mode picker, the circuit list AND the Start button.
    // Without its own scroll, a short window clipped the bottom — you couldn't
    // reach some settings or press Play. Now it scrolls independently of the
    // crew list on the left.
    minHeight: 0,
    overflowY: "auto"
  };

  return (
    <div className="lobby-grid" style={{ padding: "32px 40px" }}>
      <div style={{ minHeight: 0, overflowY: "auto", paddingRight: 8 }}>
        <button className="btn" onClick={onLeave} title={t("play.lobby.mainMenuTitle")}
          style={{ marginBottom: 14, fontSize: 11, padding: "7px 14px", borderColor: "var(--line)", letterSpacing: "0.1em" }}>
          ← {t("play.lobby.mainMenu")}
        </button>
        <div style={briefingBadge}>
          <div style={{ transform: "skewX(15deg)" }}>{t("play.lobby.briefingRoom")}</div>
        </div>
        
        <div className="row" style={{ alignItems: "baseline", gap: 12, marginTop: 4 }}>
          <span className="display" style={{ fontSize: 26, color: "var(--paper)", fontWeight: 800, letterSpacing: "0.05em", textTransform: "uppercase" }}>{t("play.lobby.joinCode")}</span>
          <span className="display" style={{ fontSize: 56, color: "var(--hot)", fontWeight: 800, letterSpacing: "0.05em" }}>{view?.code || "•••••"}</span>
        </div>
        
        <div style={{ fontSize: 13, color: "rgba(255, 255, 255, 0.3)", marginBottom: 24, fontFamily: "Rajdhani" }}>
          {t("play.lobby.shareCode", { n: players.length, max: view?.map?.maxPlayers || 10 })}
        </div>

        {/* CURRENT MODE — right where the code is, so everyone joining sees
            what they signed up for without hunting through the sidebar */}
        {(() => {
          const MODE_INFO = {
            race: ["🏁 Grand Prix", "Laps. Items. The classic."],
            timeattack: ["⏱ Time Attack", "Solo speed check. Ranked."],
            derby: ["💥 Demolition Derby", "Last kart standing. Wreckers hunt you."],
            ctf: ["🚩 Capture the Flag", "Teams. Walls block sight."],
            artist: ["🎨 Sand Artist", "Draw with water. Guess by driving."],
            tag: ["🌊 Riptide Tag", "Don't be IT at the horn."],
            pearl: ["🦪 Pearl Rush", "Grab the most. Get hit, drop them."],
          };
          const mi = MODE_INFO[view?.mode?.id || "race"] || MODE_INFO.race;
          return (
            <div style={{ display: "inline-block", padding: "10px 16px", borderRadius: 12, marginBottom: 20,
              background: "rgba(120, 40, 26, 0.55)", border: "2px solid var(--hot)" }}>
              <div style={{ fontWeight: 900, fontSize: 15, color: "var(--paper)" }}>{mi[0]}</div>
              <div className="dim" style={{ fontSize: 11, marginTop: 2 }}>{mi[1]}</div>
            </div>
          );
        })()}

        {view?.previousPerks?.length > 0 && (
          <div style={{ ...mainCardStyle, borderColor: "rgba(255,200,61,0.25)" }}>
            <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
              <div className="impactf" style={{ fontSize: 11, letterSpacing: "0.12em", color: "var(--gold)", textTransform: "uppercase" }}>{t("play.lobby.lastRunPerks")}</div>
              {/* "Crew won / Impostors won" — from the deduction game. There are no
                  sides in a kart race; the winner is a racer. */}
              {view.previousWinner && (
                <div className="faint" style={{ fontSize: 10 }}>{view.previousWinner} won</div>
              )}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {view.previousPerks.map((pk) => {
                const col = "var(--volt)";   // every perk is a racing perk now
                return (
                  <div key={pk.key} title={pk.desc} style={{ border: `1px solid ${col}`, borderLeft: `3px solid ${col}`, padding: "6px 10px", background: "rgba(13,11,20,0.6)" }}>
                    <span className="display" style={{ fontSize: 14, color: "var(--paper)" }}>{pk.label}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {isHost && players.length < (view?.map?.maxPlayers || 99) && (
          <div style={mainCardStyle}>
              <div className="impactf faint" style={{ fontSize: 11, letterSpacing: "0.12em", marginBottom: 10, color: "rgba(255, 255, 255, 0.4)", textTransform: "uppercase" }}>{t("play.lobby.addBot")}</div>
              <div className="row gap-s">
                {[
                  { tier: "recruit", label: t("play.lobby.botGreenhorn"), color: "var(--volt)" },
                  { tier: "pilot", label: t("play.lobby.botRanger"), color: "var(--gold)" },
                  { tier: "ace", label: t("play.lobby.botGunslinger"), color: "var(--hot)" }
                ].map(({ tier, label, color }) => (
                  <button 
                    key={tier} 
                    style={{
                      background: "rgba(22, 16, 10, 0.85)",
                      border: `1px solid ${color}`,
                      borderRadius: 2,
                      color: "#fff",
                      padding: "8px 16px",
                      fontSize: 12,
                      fontWeight: 700,
                      transform: "skewX(-15deg)",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center"
                    }}
                    onClick={() => conn.addBot(roomId, tier)}
                  >
                    <div style={{ transform: "skewX(15deg)", display: "flex", alignItems: "center" }}>
                      {label}
                    </div>
                  </button>
                ))}
              </div>
              <div style={{ fontSize: 10, color: "rgba(255, 255, 255, 0.3)", marginTop: 8, fontFamily: "Rajdhani" }}>
                {t("play.lobby.botDesc")}
              </div>
          </div>
        )}

        <InviteFriends roomId={roomId} conn={conn} />

        <div style={crewGridStyle}>
          {players.map((p) => (
            <div key={p.id} style={crewCardStyle}>
              {/* color accent block */}
              <div style={{
                width: 6,
                height: "100%",
                background: p.idColor || "var(--dim)",
                position: "absolute",
                left: 0,
                top: 0
              }} />
              
              <div style={{ transform: "skewX(15deg)", display: "flex", alignItems: "center", width: "100%", gap: 8 }}>
                <span style={{ fontWeight: 700, color: "#fff", marginLeft: 4 }}>{p.name}</span>
                {!p.isBot && p.id !== view?.hostId && (
                  <span title={readyMap[p.id] ? "Ready" : "Not ready"} style={{
                    fontSize: 11, fontWeight: 900,
                    color: readyMap[p.id] ? "var(--volt)" : "rgba(255,255,255,0.35)",
                  }}>
                    {readyMap[p.id] ? "✓ READY" : "…"}
                  </span>
                )}
                {p.isBot && (
                  <span style={{
                    background: "var(--hot)",
                    color: "#000",
                    fontSize: 8,
                    fontWeight: 900,
                    padding: "1px 5px",
                    transform: "skewX(-10deg)"
                  }}>
                    BOT
                  </span>
                )}
                {p.id === view?.hostId && (
                  <span style={{
                    background: "var(--hot)",
                    color: "#000",
                    fontSize: 8,
                    fontWeight: 900,
                    padding: "1px 5px",
                    transform: "skewX(-10deg)",
                    marginLeft: "auto"
                  }}>
                    HOST
                  </span>
                )}
                {isHost && p.isBot && (
                  <button 
                    style={{
                      marginLeft: "auto",
                      background: "none",
                      border: "none",
                      color: "rgba(255,255,255,0.4)",
                      cursor: "pointer",
                      fontSize: 13,
                      fontWeight: 700,
                      padding: 0
                    }}
                    onClick={() => conn.removeBot(roomId, p.id)}
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={sidebarStyle}>
        {/* RACERS + START live at the TOP now — the two things you actually
            look for in a lobby, no scrolling past the pickers to find them */}
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "center", marginBottom: 2 }}>
          <span style={{ fontSize: 56, fontWeight: 900, color: "var(--hot)", lineHeight: 1 }}>{players.length}</span>
          <span style={{ fontSize: 22, color: "rgba(255, 255, 255, 0.3)", fontWeight: 700 }}>/{view?.map?.maxPlayers || 10}</span>
        </div>
        <div style={{ fontSize: 10, color: "rgba(255, 255, 255, 0.4)", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 12 }}>{t("play.lobby.ridersAboard")}</div>
        <div className="impactf" style={{ fontSize: 14, letterSpacing: "0.15em", color: "#fff", fontWeight: 700, marginBottom: 24, textTransform: "uppercase" }}>{t("play.lobby.standingBy")}</div>

        {isHost ? (
          <div style={{ width: "100%", marginBottom: 18, paddingBottom: 18, borderBottom: "1px solid rgba(255, 255, 255, 0.08)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <div className="impactf" style={{ fontSize: 12, letterSpacing: "0.1em", color: "#fff", fontWeight: 800, textTransform: "uppercase" }}>
                {isPublic ? t("play.lobby.publicLobby") : t("play.lobby.friendsOnly")}
              </div>
              <button
                onClick={() => conn.updateConfig(roomId, { isPublic: !isPublic })}
                aria-pressed={isPublic}
                title={isPublic ? t("play.lobby.closeToPublicTitle") : t("play.lobby.openToPublicTitle")}
                style={{
                  flexShrink: 0, width: 64, height: 32, borderRadius: 16, padding: 0,
                  border: `1px solid ${isPublic ? "var(--volt)" : "rgba(255, 255, 255, 0.2)"}`,
                  background: isPublic ? "rgba(38, 224, 198, 0.18)" : "rgba(255, 255, 255, 0.05)",
                  position: "relative", cursor: "pointer", transition: "all 0.2s"
                }}
              >
                <span style={{
                  position: "absolute", top: 3, left: isPublic ? 35 : 3,
                  width: 24, height: 24, borderRadius: "50%",
                  background: isPublic ? "var(--volt)" : "rgba(255, 255, 255, 0.5)",
                  boxShadow: isPublic ? "0 0 10px rgba(38,224,198,0.7)" : "none",
                  transition: "all 0.2s"
                }} />
              </button>
            </div>
            <div style={{ fontSize: 11, color: "rgba(255, 255, 255, 0.4)", fontFamily: "Rajdhani", marginTop: 8, textAlign: "left" }}>
              {isPublic
                ? t("play.lobby.openDesc")
                : t("play.lobby.closedDesc")}
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginBottom: 18, paddingBottom: 18, borderBottom: "1px solid rgba(255, 255, 255, 0.08)", width: "100%" }}>
            <span className="impactf" style={{ fontSize: 12, letterSpacing: "0.1em", color: "rgba(255,255,255,0.5)", textTransform: "uppercase" }}>
              {isPublic ? t("play.lobby.publicLobby") : t("play.lobby.friendsOnlyLobby")}
            </span>
          </div>
        )}


        {isHost ? (
          <>
          <button
            style={{
              ...beginDraftBtn,
              fontSize: 15,
              padding: "14px 18px",
              marginBottom: (enough && players.length < (view?.map?.maxPlayers || 4)) ? 8 : 28,
              background: (enough && allReady) ? "var(--hot)" : "rgba(255, 77, 28,0.4)",
              cursor: (enough && allReady) ? "pointer" : "not-allowed"
            }}
            disabled={!enough || !allReady}
            onClick={() => conn.startMatch(roomId)}
          >
            <span style={{ transform: "skewX(15deg)", fontWeight: 900 }}>
              {!enough ? `NEED ${min - players.length} MORE RACER${min - players.length === 1 ? "" : "S"}`
                : !allReady ? `WAITING ON READY (${readyHumans}/${humanPlayers.length})`
                : "START RACE"}
            </span>
          </button>
          {enough && players.length < (view?.map?.maxPlayers || 4) && (
            <div className="dim" style={{ fontSize: 12, textAlign: "center", marginBottom: 22, fontWeight: 600, letterSpacing: "0.02em" }}>
              🤖 Bots fill the empty {(view?.map?.maxPlayers || 4) - players.length} {((view?.map?.maxPlayers || 4) - players.length) === 1 ? "seat" : "seats"} — jump in and race now
            </div>
          )}

          {/* ---- MODE PICKER ---- */}
          <div style={{ marginBottom: 14 }}>
            <div className="impactf faint" style={{ fontSize: 11, letterSpacing: "0.14em", marginBottom: 6 }}>MODE</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 6 }}>
              {[
                { id: "race", name: "🏁 Grand Prix", blurb: "Laps. Items. The classic.", n: "4–8" },
                { id: "timeattack", name: "⏱ Time Attack", blurb: "Solo speed check. Ranked.", n: "SOLO" },
                { id: "derby", name: "💥 Demolition Derby", blurb: "Last kart standing. Wreckers hunt you.", n: "4–8" },
                { id: "ctf", name: "🚩 Capture the Flag", blurb: "Teams. Walls block sight.", n: "4–8" },
                { id: "artist", name: "🎨 Sand Artist", blurb: "Draw with water. Guess by driving.", n: "4–8" },
                { id: "tag", name: "🌊 Riptide Tag", blurb: "Don't be IT at the horn.", n: "4–8" },
                { id: "pearl", name: "🦪 Pearl Rush", blurb: "Grab the most. Get hit, drop them.", n: "4–8" },
              ].map((m) => {
                const on = (view?.mode?.id || "race") === m.id;
                return (
                  <button key={m.id}
                    onClick={() => conn.updateConfig?.(roomId, { mode: m.id })}
                    style={{
                      textAlign: "left", padding: "9px 11px", borderRadius: 10, cursor: "pointer",
                      background: on ? "rgba(120, 40, 26, 0.94)" : "rgba(24, 18, 14, 0.92)",
                      border: on ? "2px solid var(--hot)" : "2px solid var(--line)",
                    }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <span style={{ fontWeight: 900, fontSize: 14, color: "#ffffff" }}>{m.name}</span>
                      <span className="impactf" style={{ fontSize: 10.5, color: "rgba(255,255,255,0.75)" }}>{m.n}</span>
                    </div>
                    <div style={{ fontSize: 12, marginTop: 3, color: "rgba(255,255,255,0.85)", lineHeight: 1.3 }}>{m.blurb}</div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* ---- CIRCUIT PICKER: four maps, all sand, none alike ---- */}
          <div style={{ marginBottom: 14, display: ["race", "timeattack"].includes(view?.mode?.id || "race") ? "block" : "none" }}>
            <div className="impactf faint" style={{ fontSize: 11, letterSpacing: "0.14em", marginBottom: 6 }}>CIRCUIT</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 6 }}>
              {[
                { id: "random", name: "🎲 Random Circuit", blurb: "Revealed at the green flag", c: "#2fe6c8" },
                { id: "sandcastle", name: "Sandcastle Grand Circuit", blurb: "Beach · the bridge jump", c: "#f7c04a" },
                { id: "pharaoh", name: "Valley of Kings", blurb: "Egypt · the sunken tomb", c: "#e8c98c" },
                { id: "shingle", name: "Shingle Cove", blurb: "White stone · technical", c: "#e9e6dd" },
                { id: "pier", name: "Rose Lagoon Pier", blurb: "⚠ NO RAILS · fall = swim", c: "#e86a9a" },
                { id: "volcano", name: "Obsidian Shore", blurb: "Black sand · ⚠ LAVA BURNS", c: "#ff5a1c" },
              ].map((m) => {
                const on = (view?.map?.trackId || "random") === m.id;
                return (
                  <button key={m.id}
                    onClick={() => conn.updateConfig?.(roomId, { trackId: m.id })}
                    style={{
                      textAlign: "left", padding: "9px 11px", borderRadius: 10, cursor: "pointer",
                      background: on ? "rgba(18, 92, 82, 0.94)" : "rgba(24, 18, 14, 0.92)",
                      border: on ? "2px solid var(--volt)" : "2px solid var(--line)",
                    }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                      <span style={{ width: 11, height: 11, borderRadius: 3, background: m.c, flexShrink: 0 }} />
                      <span style={{ fontWeight: 800, fontSize: 12.5, color: "var(--paper)" }}>{m.name}</span>
                    </div>
                    <div className="dim" style={{ fontSize: 10.5, marginTop: 3 }}>{m.blurb}</div>
                  </button>
                );
              })}
            </div>
          </div>
          </>
        ) : (
          <button
            onClick={() => conn.setReady(roomId, !iAmReady)}
            style={{
              ...beginDraftBtn,
              fontSize: 15,
              padding: "14px 18px",
              marginBottom: 12,
              background: iAmReady ? "var(--volt)" : "var(--hot)",
              color: "#000",
              cursor: "pointer",
            }}
          >
            <span style={{ transform: "skewX(15deg)", fontWeight: 900 }}>
              {iAmReady ? "✓ READY — TAP TO UNREADY" : "TAP WHEN READY"}
            </span>
          </button>
        )}
        {!isHost && (
          <div className="dim" style={{ fontSize: 12, textAlign: "center", marginBottom: 20 }}>
            {allReady ? "Everyone's ready — waiting for the host to start." : `Waiting on all racers to ready up (${readyHumans}/${humanPlayers.length}).`}
          </div>
        )}
        

        
        <div style={{ fontSize: 11, color: "rgba(255, 255, 255, 0.25)", lineHeight: 1.5, marginTop: "auto" }}>
          {t("play.lobby.shipLayoutHint")}
        </div>
      </div>
    </div>
  );
}

/* ---------------- race (Batch 1 stub) ----------------
   Placeholder in-race screen: live standings driven entirely by the server's
   authoritative view. The Three.js track, driving input, camera, and the
   hoop/challenge system replace this component in Batch 2. */

const WIN_REASON_TEXT = {
  finish: "Every racer crossed the line.",
  timeout: "Time! Final positions locked in.",
};

function Results({ view, roomId, conn, profile, catalogue, onLeave, onChange }) {
  const { t } = useI18n();
  const you = view.you || {};
  const myPlace = you.place ?? null;
  const iWon = myPlace === 1;
  const won = iWon; // color/energy accents key off whether YOU took the flag
  const players = view.players || [];
  const standings = [...players].sort((a, b) => (a.place ?? 99) - (b.place ?? 99));
  const placeLabel = (n) => n ? `${n}${["ST","ND","RD"][n - 1] || "TH"} PLACE` : "DNF";
  // Podium display: the race winner(s) in full costume, hero-sized.
  const victors = standings.filter((p) => p.place === 1);
  const vScale = victors.length <= 3 ? 1.9 : victors.length <= 5 ? 1.6 : 1.35;
  // Rewards mirror the backend rule: base 50 XP (+75 if your side won), 10 Silver
  // on a win — and the Gold Trail pass multiplies both while it's active.
  const premiumActive = !!profile?.premium;
  // Mirrors the backend reward rules exactly (see ingestMatchResult):
  // RACE — place pays 12/8/5/3 Sea Glass, 50 XP +75 win, both × laps/3 (cap 1).
  // TIME TRIAL — flat 2 Sea Glass + 30 XP; the weekly board is the prize.
  const modeId = typeof view.mode === "string" ? view.mode : view.mode?.id;
  const isTimeTrial = modeId === "timeattack";
  const lapsFactor = Math.min(1, Math.max(1, view.map?.laps || 3) / 3);
  const PLACE_PAY = [12, 8, 5, 3];
  const baseXp = isTimeTrial ? 30 : Math.round((50 + (iWon ? 75 : 0)) * lapsFactor);
  const baseCredits = isTimeTrial ? 2 : Math.round((PLACE_PAY[Math.min((myPlace || 4) - 1, 3)] || 3) * lapsFactor);
  const xpGain = Math.round(baseXp * (premiumActive ? PREMIUM_MULT : 1));
  const creditGain = Math.round(baseCredits * (premiumActive ? PREMIUM_MULT : 1));
  // Rank ladder: fresh from the server (post-ingest), compared against the
  // pre-race profile level to catch the LEVEL UP moment.
  const [ladder, setLadder] = useState(null);
  const leveledUp = ladder && profile?.level != null && ladder.level > profile.level;
  useEffect(() => {
    let alive = true;
    api.getProgress().then((p) => alive && !p?.error && setLadder(p)).catch(() => {});
    return () => { alive = false; };
  }, []);
  // Time trial: your clock + the weekly board instead of a combat report.
  const [lapBoard, setLapBoard] = useState(null);
  const [inspect, setInspect] = useState(null);   // userId → profile card modal
  useEffect(() => {
    if (!isTimeTrial) return;
    let alive = true;
    api.getLapBoard().then((b) => alive && !b?.error && setLapBoard(b)).catch(() => {});
    return () => { alive = false; };
  }, [isTimeTrial]);
  const [rematchSent, setRematchSent] = useState(false);
  const [unlocked, setUnlocked] = useState([]); // newly-earned achievements to toast
  const [karmaGiven, setKarmaGiven] = useState([]); // userIds we've given karma this match (cap 2)
  const [lapView, setLapView] = useState(null);    // results table: which racer's lap breakdown is open
  const anyLaps = (players || []).some((p) => (p.lapTimes || []).length > 0);
  const anyScore = (players || []).some((p) => (p.mode?.captures ?? p.mode?.pearls ?? p.mode?.kos ?? p.mode?.tags ?? p.captures ?? p.pearls ?? p.kos) != null);
  const isHost = you.id === view.hostId;
  const matchId = view.matchId;

  useEffect(() => {
    onChange?.();
  }, [onChange]);

  // The server ingests the match result a beat after the room ends (fire-and-forget
  // server-to-server), which is what grants achievements. Poll the profile a few
  // times after results render: as soon as any are pending, surface a toast (names
  // from the catalogue), acknowledge so they don't re-show, and refresh the profile
  // so new avatars/borders appear. Retrying makes the toast resilient to ingestion
  // lag; if it never arrives the queue stays pending and shows on the next visit.
  useEffect(() => {
    let live = true;
    const timers = [];
    const achById = Object.fromEntries((catalogue?.achievements || []).map((a) => [a.id, a]));
    let done = false;
    async function poll(attempt) {
      if (!live || done) return;
      try {
        const p = await api.getProfile();
        if (!live) return;
        const pending = p.pendingAchievements || [];
        if (pending.length > 0) {
          done = true;
          setUnlocked(pending.map((id) => achById[id] || { id, name: id, glyph: "★" }));
          await api.ackAchievements();
          await onChange?.();
          timers.push(setTimeout(() => { if (live) setUnlocked([]); }, 6500));
          return;
        }
      } catch { /* non-fatal: toast is best-effort */ }
      if (attempt < 4) timers.push(setTimeout(() => poll(attempt + 1), 1500));
    }
    timers.push(setTimeout(() => poll(0), 1200));
    return () => { live = false; timers.forEach(clearTimeout); };
  }, [catalogue, onChange]);

  // If the host rematches, the room flips back to lobby — Play's phase switch
  // handles the screen change; we just fire the action.
  const rematch = () => {
    setRematchSent(true);                 // lock the button while the ad break runs
    analytics.rematch(roomId);
    cgMidgameAd(() => {
      conn.rematch(roomId);
      if (isTimeTrial) setTimeout(() => conn.startMatch(roomId), 400); // straight back to the clock
    });
  };

  return (
    // This had a radial gradient from #1d1626 — a DARK PURPLE — over the whole
    // screen, on a bright summer beach game. It made the lobby look like a bruise,
    // and it was painted straight over the illustrated background.
    <div style={{ height: "100%", position: "relative", overflow: "hidden" }}>
      <SpeedLines hot={!won} />
      <div style={{ position: "relative", zIndex: 2, height: "100%", display: "grid", gridTemplateColumns: "1fr 360px" }}>
        {/* left: verdict + roster. The whole column scrolls now — on a short
            window the Final Standings / Final Roster at the bottom were clipped
            with no way to reach them. */}
        <div style={{ padding: "20px 40px 24px", display: "flex", flexDirection: "column", minHeight: 0, overflowY: "auto" }}>
          <h1 className="display" style={{ fontSize: "clamp(36px,5.5vw,64px)", margin: "0 0 2px", lineHeight: 0.85, color: won ? "var(--volt)" : "var(--hot)" }}>
            {iWon ? "CHECKERED FLAG!" : "RACE COMPLETE"}
          </h1>
          <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
            <div style={{ ...resultBadge, margin: 0, padding: "5px 14px", fontSize: 12, borderColor: iWon ? "var(--gold)" : "var(--faint)", color: iWon ? "var(--gold)" : "var(--dim)" }}>
              {iWon ? `${t("play.hud.youWon")} · ${placeLabel(myPlace)}` : myPlace <= 3 ? `PODIUM · ${placeLabel(myPlace)}` : placeLabel(myPlace)}
            </div>
            <div className="dim" style={{ fontSize: 13, fontWeight: 600 }}>{WIN_REASON_TEXT[view.winReason] || "Race complete."}</div>
          </div>

          {/* ---- MODE RESULTS ----
              A racing podium is the wrong answer for a mode that isn't a race.
              CTF ends on a team score; a derby ends with one kart standing and
              seven wrecks; Pearl Rush ends on a haul. Show what the mode actually
              measured, THEN the podium. */}
          {modeId === "ctf" && view.modeWorld?.teams && (
            <div className="leather-panel" style={{ margin: "12px 0", padding: 18, textAlign: "center" }}>
              <div className="impactf" style={{ fontSize: 11, letterSpacing: "0.14em", color: "var(--dim)" }}>FINAL SCORE</div>
              <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 24, marginTop: 8 }}>
                <div>
                  <div className="display" style={{ fontSize: 56, color: "#2fe6c8" }}>{view.modeWorld.teams[0]}</div>
                  <div className="impactf" style={{ fontSize: 12, color: "#2fe6c8" }}>TEAL</div>
                </div>
                <div className="display" style={{ fontSize: 28, color: "var(--dim)" }}>—</div>
                <div>
                  <div className="display" style={{ fontSize: 56, color: "#ff5a3c" }}>{view.modeWorld.teams[1]}</div>
                  <div className="impactf" style={{ fontSize: 12, color: "#ff5a3c" }}>CORAL</div>
                </div>
              </div>
              <div className="display" style={{ fontSize: 22, marginTop: 10, color: "var(--gold)" }}>
                {view.modeWorld.teams[0] > view.modeWorld.teams[1] ? "TEAL WINS" : "CORAL WINS"}
              </div>
            </div>
          )}
          {modeId === "derby" && (
            <div className="leather-panel" style={{ margin: "12px 0", padding: 18, textAlign: "center" }}>
              <div className="impactf" style={{ fontSize: 11, letterSpacing: "0.14em", color: "var(--dim)" }}>LAST KART ROLLING</div>
              <div className="display" style={{ fontSize: 44, color: "var(--gold)", marginTop: 4 }}>
                💀 {standings[0]?.name ?? "—"}
              </div>
              <div className="dim" style={{ fontSize: 13, marginTop: 4 }}>
                {players.length - 1} wrecks · {standings[0]?.modeScore ?? 0} lives left
              </div>
            </div>
          )}
          {modeId === "pearl" && (
            <div className="leather-panel" style={{ margin: "12px 0", padding: 18 }}>
              <div className="impactf" style={{ fontSize: 11, letterSpacing: "0.14em", color: "var(--dim)", textAlign: "center" }}>THE HAUL</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 5, marginTop: 10 }}>
                {standings.slice(0, 8).map((p, i) => (
                  <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span className="impactf" style={{ width: 22, color: i === 0 ? "var(--gold)" : "var(--dim)" }}>{i + 1}</span>
                    <span style={{ flex: 1, fontWeight: 700, fontSize: 13 }}>{i === 0 ? "👑 " : ""}{p.name}</span>
                    <div style={{ flex: 2, height: 10, background: "rgba(224, 192, 138, 0.55)", borderRadius: 5, overflow: "hidden" }}>
                      <div style={{
                        width: `${Math.min(100, ((p.modeScore || 0) / Math.max(1, standings[0]?.modeScore || 1)) * 100)}%`,
                        height: "100%", background: i === 0 ? "var(--gold)" : "var(--volt)",
                      }} />
                    </div>
                    <span className="display" style={{ width: 42, textAlign: "right", fontSize: 18 }}>{p.modeScore ?? 0}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {modeId === "artist" && (
            <div className="leather-panel" style={{ margin: "12px 0", padding: 18 }}>
              <div className="impactf" style={{ fontSize: 11, letterSpacing: "0.14em", color: "var(--dim)", textAlign: "center" }}>THE GALLERY</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 5, marginTop: 10 }}>
                {standings.map((p, i) => (
                  <div key={p.id} className="row" style={{ justifyContent: "space-between", padding: "4px 8px",
                    background: i === 0 ? "rgba(247,192,74,0.12)" : "transparent", borderRadius: 6 }}>
                    <span style={{ fontWeight: 700, fontSize: 13 }}>{i === 0 ? "🎨 " : ""}{p.name}</span>
                    <span className="display" style={{ fontSize: 20, color: i === 0 ? "var(--gold)" : "var(--paper)" }}>{p.modeScore ?? 0} PTS</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {modeId === "tag" && (
            <div className="leather-panel" style={{ margin: "12px 0", padding: 18 }}>
              <div className="impactf" style={{ fontSize: 11, letterSpacing: "0.14em", color: "var(--dim)", textAlign: "center" }}>TIME SPENT AS IT — LOWEST WINS</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 5, marginTop: 10 }}>
                {standings.map((p, i) => (
                  <div key={p.id} className="row" style={{ justifyContent: "space-between", padding: "4px 8px" }}>
                    <span style={{ fontWeight: 700, fontSize: 13 }}>{i === 0 ? "🕊 " : ""}{p.name}</span>
                    <span className="display" style={{ fontSize: 20, color: i === 0 ? "var(--volt)" : "var(--hot)" }}>
                      {Math.abs(p.modeScore ?? 0)}s
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* THE PODIUM: top three, in their karts, on real steps. */}
          {!isTimeTrial && (
            <>
              <div className="tag" style={{ margin: "12px 0 0" }}><span>🏆 THE PODIUM</span></div>
              <Podium3D top3={standings.filter((p) => p.place >= 1 && p.place <= 3)} width={470} height={252} />
              <div style={{ display: "flex", justifyContent: "center", gap: 46, marginTop: -6, marginBottom: 6 }}>
                {[2, 1, 3].map((n) => {
                  const p = standings.find((s) => s.place === n);
                  return (
                    <div key={n} style={{ textAlign: "center", width: 110 }}>
                      <div className="impactf" style={{ fontSize: 11, color: n === 1 ? "var(--gold)" : "var(--dim)", letterSpacing: "0.14em" }}>{n === 1 ? "🥇" : n === 2 ? "🥈" : "🥉"} P{n}</div>
                      <div className="impactf" style={{ fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p ? p.name : "—"}</div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {isTimeTrial && (
            <div className="leather-panel" style={{ margin: "18px 0 14px", padding: 16 }}>
              <div className="tag" style={{ marginBottom: 10 }}><span>⏱ TIME TRIAL</span></div>
              <div className="row" style={{ gap: 26, alignItems: "baseline" }}>
                <div>
                  <div className="impactf faint" style={{ fontSize: 11, letterSpacing: "0.12em" }}>YOUR TOTAL</div>
                  <div className="display" style={{ fontSize: 40, color: "var(--gold)" }}>{you.totalSec ? `${you.totalSec.toFixed(2)}s` : "—"}</div>
                </div>
                <div>
                  <div className="impactf faint" style={{ fontSize: 11, letterSpacing: "0.12em" }}>BEST LAP</div>
                  <div className="display" style={{ fontSize: 40, color: "var(--volt)" }}>{you.bestLapSec ? `${you.bestLapSec.toFixed(2)}s` : "—"}</div>
                </div>
              </div>
              {lapBoard && (
                <div style={{ marginTop: 12 }}>
                  <div className="impactf faint" style={{ fontSize: 11, letterSpacing: "0.12em", marginBottom: 6 }}>THIS WEEK'S FASTEST LAPS</div>
                  {lapBoard.rows.slice(0, 5).map((r, i) => (
                    <div key={r.userId} className="row" style={{ gap: 10, fontSize: 13, padding: "3px 0", color: r.userId === profile?.id ? "var(--gold)" : "var(--paper)" }}>
                      <span className="impactf" style={{ width: 18, color: "var(--dim)" }}>{i + 1}</span>
                      <span style={{ flex: 1 }}>{r.name}{r.userId === profile?.id ? " (you)" : ""}</span>
                      <span className="impactf">{r.bestLapSec.toFixed(2)}s</span>
                    </div>
                  ))}
                  {lapBoard.you && !lapBoard.rows.slice(0, 5).some((r) => r.userId === profile?.id) && (
                    <div className="row" style={{ gap: 10, fontSize: 13, padding: "3px 0", color: "var(--gold)", borderTop: "1px dashed var(--line)", marginTop: 4 }}>
                      <span className="impactf" style={{ width: 18 }}>·</span>
                      <span style={{ flex: 1 }}>{lapBoard.you.name} (you)</span>
                      <span className="impactf">{lapBoard.you.bestLapSec.toFixed(2)}s</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
          {inspect && <ProfileCard userId={inspect} catalogue={catalogue} onClose={() => setInspect(null)} />}
          <div className="tag" style={{ margin: "18px 0 8px" }}><span>FINAL STANDINGS · v{typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "?"}</span></div>
          <div className="faint" style={{ fontSize: 11, marginBottom: 8 }}>{t("play.hud.karmaHint")} Click a row for the breakdown.</div>
          {/* which columns exist depends on the mode that just ended */}
          {/* ONE TABLE, everything upfront. The old flow hid each racer's stats
              behind a click; now the table IS the stats, and the click is spent
              on the thing worth expanding: their lap-by-lap breakdown. */}
          <div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr className="faint" style={{ textAlign: "left", fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                  <th style={{ padding: "6px 8px" }}>#</th>
                  <th style={{ padding: "6px 8px" }}>Racer</th>
                  {anyLaps && <th style={{ padding: "6px 8px" }}>Total</th>}
                  {anyLaps && <th style={{ padding: "6px 8px" }}>Best lap</th>}
                  {anyLaps && <th style={{ padding: "6px 8px" }}>Laps</th>}
                  {anyScore && <th style={{ padding: "6px 8px" }}>Score</th>}
                  <th style={{ padding: "6px 8px" }}></th>
                </tr>
              </thead>
              <tbody>
                {(() => { return null; })()}
                {[...players].sort((a, b) => (a.place ?? 99) - (b.place ?? 99)).map((p) => {
                  const modeScore = p.mode?.captures ?? p.mode?.pearls ?? p.mode?.kos ?? p.mode?.tags ?? p.captures ?? p.pearls ?? p.kos ?? null;
                  const isMe = p.id === you.id;
                  const laps = p.lapTimes || [];
                  const best = laps.length ? Math.min(...laps) : null;
                  const total = laps.length ? laps.reduce((a, b) => a + b, 0) : null;
                  const open = lapView === p.id;
                  const targetId = p.userId || p.id;
                  return (
                    <FragmentRow key={p.id} open={open}
                      row={
                        <tr onClick={() => setLapView(open ? null : p.id)}
                          style={{ cursor: "pointer", borderTop: "1px solid var(--line)",
                            background: open ? "var(--ink-3)" : p.place === 1 ? "rgba(255,200,61,0.07)" : "transparent" }}>
                          <td className="impactf" style={{ padding: "8px 8px", color: p.place === 1 ? "var(--gold)" : "var(--dim)" }}>{p.place ?? "—"}</td>
                          <td style={{ padding: "8px 8px" }}>
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                              <span style={{ width: 11, height: 11, borderRadius: "50%", background: p.idColor || "var(--dim)", border: "2px solid var(--ink)" }} />
                              <span style={{ fontWeight: 700 }}>{p.name}{isMe ? " (you)" : ""}</span>
                              {!p.userId && <span className="faint" style={{ fontSize: 9 }}>BOT</span>}
                            </span>
                          </td>
                          {anyLaps && <td className="impactf" style={{ padding: "8px 8px" }}>{total != null ? total.toFixed(2) + "s" : "—"}</td>}
                          {anyLaps && <td className="impactf" style={{ padding: "8px 8px", color: "var(--volt)" }}>{best != null ? best.toFixed(2) + "s" : "—"}</td>}
                          {anyLaps && <td style={{ padding: "8px 8px" }}>{laps.length}</td>}
                          {anyScore && <td className="impactf" style={{ padding: "8px 8px" }}>{modeScore ?? "—"}</td>}
                          <td style={{ padding: "6px 8px" }} onClick={(e) => e.stopPropagation()}>
                            <span className="row gap-s" style={{ alignItems: "center", justifyContent: "flex-end" }}>
                              {p.userId && !isMe && (
                                <button className="btn" style={{ fontSize: 10, padding: "3px 8px" }} title="View profile"
                                  onClick={() => setInspect(p.userId)}>👤</button>
                              )}
                              {!isMe && (
                                <PlayerActions userId={targetId} isBot={!p.userId} name={p.name} matchId={matchId} showKarma
                                  alreadyKarma={karmaGiven.includes(targetId)} karmaCapReached={karmaGiven.length >= 2}
                                  onKarma={(uid) => setKarmaGiven((k) => k.includes(uid) ? k : [...k, uid])}
                                  size="xs" />
                              )}
                            </span>
                          </td>
                        </tr>
                      }
                      detail={
                        <tr style={{ background: "var(--ink-3)" }}>
                          <td colSpan={3 + (anyLaps ? 3 : 0) + (anyScore ? 1 : 0)} style={{ padding: "6px 14px 12px" }}>
                            {laps.length === 0 ? (
                              <span className="faint" style={{ fontSize: 11 }}>No completed laps.</span>
                            ) : (
                              <span className="row gap-s" style={{ flexWrap: "wrap" }}>
                                {laps.map((lt, i) => (
                                  <span key={i} className="panel" style={{ padding: "4px 10px", fontSize: 12,
                                    borderColor: lt === best ? "var(--gold)" : "var(--line)",
                                    color: lt === best ? "var(--gold)" : undefined }}>
                                    LAP {i + 1} — <b className="impactf">{lt.toFixed(2)}s</b>{lt === best ? " ★" : ""}
                                  </span>
                                ))}
                              </span>
                            )}
                          </td>
                        </tr>
                      } />
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* right: rewards + actions — scrolls so the Rematch / Return buttons
            are always reachable on a short window. */}
        <div style={{ borderLeft: "2px solid var(--line)", background: "var(--ink-2)", padding: "40px 28px", display: "flex", flexDirection: "column", minHeight: 0, overflowY: "auto" }}>
          <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
            <div className="tag"><span>{t("play.hud.missionReport")}</span></div>
            <PremiumBadge premium={premiumActive} premiumUntil={profile?.premiumUntil} size="sm" />
          </div>
          <div style={{ margin: "24px 0", textAlign: "center" }}>
            <div className="impactf faint" style={{ fontSize: 12, letterSpacing: "0.15em", textTransform: "uppercase" }}>{t("play.hud.xpEarned")}</div>
            <div className="display" style={{ fontSize: 72, color: "var(--gold)", lineHeight: 0.9, textShadow: "0 0 40px rgba(255,200,61,0.3)" }}>+{xpGain}</div>
            <div className="dim" style={{ fontSize: 13 }}>{t("play.hud.xpBase")}{iWon ? t("play.hud.xpVictoryBonus") : ""}{premiumActive ? t("play.hud.xpGoldTrail") : ""}</div>
            {creditGain > 0 && (
              <div className="impactf" style={{ fontSize: 14, marginTop: 8, color: "var(--volt)" }}>
                +{creditGain} {t("play.hud.silverNuggets")}
              </div>
            )}
            {leveledUp && (
              <div className="display" style={{ fontSize: 30, marginTop: 12, color: "var(--volt)", animation: "gpPulse 0.4s 4 alternate" }}>
                ⭐ LEVEL UP! — RANK {ladder.level}
              </div>
            )}
            {ladder?.next && (
              <div className="dim" style={{ fontSize: 12, marginTop: leveledUp ? 4 : 10 }}>
                Next unlock at LV {ladder.next.level} · {ladder.next.xpNeeded} XP away{ladder.next.note ? ` — ${ladder.next.note}` : ""}
              </div>
            )}
          </div>
          {profile && (
            <div className="panel" style={{ padding: 14, marginBottom: 24 }}>
              <div className="row" style={{ justifyContent: "space-between", fontSize: 13 }}>
                <span className="dim">{t("play.hud.rank")}</span><span className="impactf">{t("play.hud.lv", { n: profile.level })}</span>
              </div>
              <div className="faint" style={{ fontSize: 11, marginTop: 4 }}>{t("play.hud.xpAwardedHint")}</div>
            </div>
          )}
          <div className="grow" />
          {isHost && (
            <button className="btn btn-hot" style={{ width: "100%", fontSize: 18, marginBottom: 10 }} disabled={rematchSent} onClick={rematch}>
              {rematchSent ? t("play.hud.restarting") : t("play.hud.rematch")}
            </button>
          )}
          {!isHost && <div className="impactf dim" style={{ fontSize: 11, textAlign: "center", marginBottom: 10, letterSpacing: "0.1em", textTransform: "uppercase" }}>{t("play.hud.hostMayRematch")}</div>}
          <button className="btn" style={{ width: "100%", fontSize: 15 }} onClick={onLeave}>{t("play.hud.returnToLobby")}</button>
        </div>
      </div>

      {/* Achievement-unlock toast stack (best-effort, auto-dismisses). */}
      {unlocked.length > 0 && (
        <div style={achToastStack}>
          {unlocked.map((a) => (
            <div key={a.id} style={achToast}>
              <span className="impactf" style={{ fontSize: 26, color: "var(--ink)" }}>{a.glyph}</span>
              <div>
                <div className="impactf" style={{ fontSize: 10, letterSpacing: "0.16em", opacity: 0.8, textTransform: "uppercase" }}>{t("play.hud.achievementUnlocked")}</div>
                <div className="display" style={{ fontSize: 20, lineHeight: 1 }}>{a.name}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---- small bits ---- */
const wrap = { height: "100%", position: "relative", overflowY: "auto", overflowX: "hidden" };
const toast = { position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", zIndex: 9999, background: "var(--hot)", color: "var(--ink)", padding: "12px 22px", fontWeight: 700, clipPath: "polygon(8px 0,100% 0,calc(100% - 8px) 100%,0 100%)" };
const achToastStack = { position: "absolute", bottom: 28, left: "50%", transform: "translateX(-50%)", zIndex: 50, display: "flex", flexDirection: "column", gap: 10, alignItems: "center" };
const achToast = { display: "flex", alignItems: "center", gap: 14, background: "linear-gradient(90deg, var(--gold) 0%, #ffd76a 100%)", color: "var(--ink)", padding: "12px 24px 12px 18px", clipPath: "polygon(10px 0,100% 0,calc(100% - 10px) 100%,0 100%)", boxShadow: "0 8px 30px rgba(120, 90, 50, 0.5), 0 0 24px rgba(255,200,61,0.4)" };
const bigChoice = { padding: 28, background: "var(--ink-2)", display: "flex", flexDirection: "column", gap: 6, alignItems: "center", cursor: "pointer" };
const codeInput = { flex: 1, background: "var(--ink)", border: "2px solid var(--line)", color: "var(--paper)", padding: "10px 12px", fontFamily: "var(--display)", fontSize: 24, letterSpacing: "0.3em", textAlign: "center", outline: "none" };
const crewGrid = { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px,1fr))", gap: 10 };
const crewCard = { padding: "10px 14px", display: "flex", alignItems: "center", gap: 10, background: "var(--ink-2)" };
const crewDot = { width: 14, height: 14, borderRadius: "50%", border: "2px solid var(--ink)", boxShadow: "0 0 0 1px var(--line)" };
const perkGrid = { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px,1fr))", gap: 12 };
const perkCard = { padding: 16, textAlign: "left", background: "var(--ink-2)", cursor: "pointer" };
const perkOn = { borderColor: "var(--hot)", boxShadow: "0 0 0 1px rgba(255,45,77,0.3)" };
const crewToggleBtn = { position: "fixed", top: 18, right: 18, zIndex: 240, fontSize: 12, padding: "8px 14px", borderColor: "var(--volt)" };
const crewPanel = { position: "fixed", top: 56, right: 18, zIndex: 240, width: 300, maxHeight: "70vh", overflowY: "auto", background: "rgba(13,11,20,0.97)", border: "2px solid var(--volt)", padding: "14px 16px", boxShadow: "0 12px 40px rgba(120, 90, 50, 0.7)" };
const sidePane = { background: "transparent", padding: "22px 16px", overflowY: "auto", display: "flex", flexDirection: "column", gap: 4, pointerEvents: "none" };
const leftCard = { background: "rgba(13,11,20,0.72)", border: "1px solid var(--line)", borderRadius: 6, padding: "12px 14px", marginBottom: 12, boxShadow: "0 6px 18px rgba(120, 90, 50, 0.6)", backdropFilter: "blur(2px)", pointerEvents: "auto" };
const gaugeTrack = { height: 12, background: "var(--ink)", border: "1px solid var(--line)", marginTop: 4, overflow: "hidden" };
const gaugeFill = { height: "100%", transition: "width 0.4s ease" };
const journeyTrack = { height: 14, background: "var(--ink)", border: "2px solid var(--line)", marginTop: 4, overflow: "hidden", clipPath: "polygon(0 0,100% 0,calc(100% - 6px) 100%,0 100%)" };
const journeyFill = { height: "100%", background: "linear-gradient(90deg,var(--volt),var(--violet))", transition: "width 0.5s ease" };
const sysChip = { fontFamily: "var(--impact)", fontSize: 11, padding: "4px 10px", border: "2px solid var(--line)", color: "var(--faint)" };
const sysOn = { color: "var(--ink)", background: "var(--volt)", borderColor: "var(--volt)" };
const roleBadge = { fontFamily: "var(--impact)", fontSize: 14, letterSpacing: "0.1em", padding: "8px 16px", border: "2px solid" };
const resultBadge = { display: "inline-block", fontFamily: "var(--impact)", fontSize: 13, letterSpacing: "0.1em", padding: "8px 16px", border: "2px solid", marginTop: 6 };
const taskBtn = { display: "flex", alignItems: "center", padding: "12px 14px", background: "var(--ink-2)", cursor: "pointer", textAlign: "left" };
const hereCard = { display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", background: "var(--ink-2)" };
const miniBtn = { fontSize: 11, padding: "6px 12px" };
const navGrid = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 };
const navBtn = { fontSize: 11, padding: "9px 8px", textTransform: "none" };
const hudBar = { position: "absolute", left: 0, right: 0, bottom: 0, maxHeight: "30vh", overflowY: "auto", display: "flex", gap: 8, flexWrap: "wrap", alignContent: "flex-start", alignItems: "center", padding: "12px 18px 14px", background: "linear-gradient(180deg, rgba(16,13,22,0.95) 0%, rgba(9,8,14,0.99) 100%)", borderTop: "3px solid var(--gold)", boxShadow: "0 -10px 30px rgba(120, 90, 50, 0.55)" };
const hereStrip = { flex: "1 1 100%", display: "flex", gap: 8, alignItems: "center", overflowX: "auto", paddingBottom: 2 };
const hudBtn = { fontSize: 12, padding: "9px 13px", textTransform: "none" };

/* Helm Menu Modal Custom Styles */

// Results-table helper: a row plus its expandable lap-breakdown row.
function FragmentRow({ row, detail, open }) {
  return (<>{row}{open ? detail : null}</>);
}
