import { useCallback, useEffect, useMemo, useState } from "react";
import * as api from "../api/backend.js";
import { useI18n } from "../api/i18n.jsx";
import { SpeedLines, Particles } from "../components/effects.jsx";
import { PlayerActions } from "../components/CrewActions.jsx";

// Pilot dossier: lifetime totals, last-10 recap, achievement grid, avatar/border
// picker (from owned items), and the weekly win-rate board. All numbers are
// driven automatically from match results — this screen is read + cosmetic-select
// only. Reads the real profile/catalogue shapes the backend serves.
export default function Profile({ user, profile, catalogue, onChange, social, onJoinFriend }) {
  const { t } = useI18n();
  const [tab, setTab] = useState("overview");
  const [rankings, setRankings] = useState(null);
  const [busy, setBusy] = useState(false);

  // Index catalogue cosmetic-meta by id for glyph/color/name lookups.
  const avatarsById = useMemo(() => Object.fromEntries((catalogue?.avatars || []).map((a) => [a.id, a])), [catalogue]);
  const bordersById = useMemo(() => Object.fromEntries((catalogue?.borders || []).map((b) => [b.id, b])), [catalogue]);

  useEffect(() => {
    if (tab !== "rankings") return;
    let live = true;
    api.getRankings().then((r) => { if (live) setRankings(r); }).catch(() => {});
    return () => { live = false; };
  }, [tab]);

  if (!profile || !catalogue) return <Loading />;

  const stats = profile.stats || {};
  const history = profile.matchHistory || [];
  const achievements = profile.achievements || [];
  const unlockedCount = achievements.filter((a) => a.unlockedAt).length;
  const sel = { avatar: profile.selectedAvatar, border: profile.selectedBorder };
  const selAvatar = avatarsById[sel.avatar];
  const selBorder = bordersById[sel.border];

  const wins = stats.wins || 0;
  const played = stats.matchesPlayed || 0;
  const winRate = played > 0 ? Math.round((wins / played) * 1000) / 10 : 0;

  async function pickAvatar(id) {
    if (busy || id === sel.avatar) return;
    setBusy(true);
    try { await api.selectAvatar(id); await onChange?.(); } catch {} finally { setBusy(false); }
  }
  async function pickBorder(id) {
    if (busy || id === sel.border) return;
    setBusy(true);
    try { await api.selectBorder(id); await onChange?.(); } catch {} finally { setBusy(false); }
  }

  return (
    <div style={wrap}>
      <SpeedLines />
      <Particles density={22} color="rgba(120,90,255,0.35)" />

      <div style={{ position: "relative", zIndex: 2, padding: "32px 40px", height: "100%", overflowY: "auto" }}>
        {/* HERO: identity badge + headline numbers */}
        <div className="row" style={{ gap: 28, alignItems: "center", flexWrap: "wrap", marginBottom: 28 }}>
          <IdentityBadge avatar={selAvatar} border={selBorder} size={104} />
          <div>
            <div className="tag"><span>{t("profile.riderDossier")}</span></div>
            <div className="display" style={{ fontSize: 48, color: "var(--paper)", lineHeight: 0.95, marginTop: 8 }}>{user.name}</div>
            <div className="dim" style={{ fontWeight: 600, marginTop: 2 }}>
              {t("profile.levelLine", { level: profile.level, unlocked: unlockedCount, total: achievements.length })}
            </div>
          </div>
          <div className="row" style={{ gap: 14, marginLeft: "auto", flexWrap: "wrap" }}>
            <Stat label={t("profile.stat.matches")} value={played} />
            <Stat label={t("profile.stat.wins")} value={wins} accent="var(--gold)" />
            <Stat label={t("profile.stat.winRate")} value={`${winRate}%`} accent="var(--volt)" />
            <Stat label="PODIUMS" value={stats.podiums || 0} accent="var(--gold)" />
            <Stat label="BEST LAP" value={stats.bestLapSec ? `${stats.bestLapSec.toFixed(2)}s` : "—"} accent="var(--volt)" />
            <Stat label="SPLASHES" value={stats.splashesCaused || 0} />
            <Stat label="CRUMBLES" value={stats.crumblesCaused || 0} accent="var(--hot)" />
            <Stat label="S-TIERS" value={stats.sTiers || 0} accent="var(--gold)" />
          </div>
        </div>

        {/* TABS */}
        <div className="row gap-s" style={{ marginBottom: 20, flexWrap: "wrap" }}>
          {TABS.map((tb) => (
            <button key={tb.id} onClick={() => setTab(tb.id)}
              className="impactf"
              style={{ ...tabBtn, ...(tab === tb.id ? tabBtnOn : null) }}>
              <span className="kanji" style={{ fontSize: 14, marginRight: 6, opacity: 0.8 }}>{tb.kanji}</span>
              {t(tb.labelKey).toUpperCase()}
            </button>
          ))}
        </div>

        {tab === "overview" && (
          <Overview stats={stats} history={history} winRate={winRate} meId={user.id} karmaGiven={profile.karmaGiven || {}} onChange={onChange} />
        )}
        {tab === "friends" && (
          <FriendsTab social={social} onJoinFriend={onJoinFriend} avatarsById={avatarsById} bordersById={bordersById} />
        )}
        {tab === "achievements" && (
          <Achievements achievements={achievements} avatarsById={avatarsById} bordersById={bordersById} />
        )}
        {tab === "appearance" && (
          <Appearance
            avatars={catalogue.avatars || []} borders={catalogue.borders || []}
            owned={{ avatars: profile.ownedAvatars || [], borders: profile.ownedBorders || [] }}
            selected={sel} onAvatar={pickAvatar} onBorder={pickBorder} busy={busy}
          />
        )}
        {tab === "rankings" && (
          <Rankings rankings={rankings} meId={user.id} avatarsById={avatarsById} bordersById={bordersById} />
        )}
      </div>
    </div>
  );
}

const TABS = [
  { id: "overview", labelKey: "profile.tab.overview", kanji: "O" },
  { id: "friends", labelKey: "profile.tab.friends", kanji: "F" },
  { id: "achievements", labelKey: "profile.tab.achievements", kanji: "A" },
  { id: "appearance", labelKey: "profile.tab.appearance", kanji: "P" },
  { id: "rankings", labelKey: "profile.tab.rankings", kanji: "R" },
];

// ---- Overview: lifetime stat grid + last-10 recap ----
function Overview({ stats, history, winRate, meId, karmaGiven, onChange }) {
  const { t } = useI18n();
  // THIS GRID WAS THE OLD GAME. Every cell read a stat from the social-deduction
  // fork — "Wins as Crew", "Wins as Impostor", "Tasks Completed", "Sabotages",
  // "Ejections" — and every one of them was permanently 0, because a kart racer
  // has no crew, no impostors, no tasks and nothing to sabotage. Eight stat cards
  // that could only ever show zero.
  const cells = [
    { label: "MATCHES", value: stats.matchesPlayed || 0, kanji: "🏁" },
    { label: "WINS", value: stats.wins || 0, kanji: "🏆" },
    { label: "PODIUMS", value: stats.podiums || 0, kanji: "🥈" },
    { label: "BEST LAP", value: stats.bestLapSec ? `${stats.bestLapSec.toFixed(2)}s` : "—", kanji: "⏱" },
    { label: "SPLASHES", value: stats.splashesCaused || 0, kanji: "💦" },
    { label: "TAKEDOWNS", value: stats.crumblesCaused || 0, kanji: "💥" },
    { label: "ULTIMATES", value: stats.ultimatesFired || 0, kanji: "⚡" },
    { label: "PEARLS", value: stats.pearls || 0, kanji: "🦪" },
    { label: "FLAGS", value: stats.flagCaptures || 0, kanji: "🚩" },
    { label: "DERBY WINS", value: stats.derbyWins || 0, kanji: "💀" },
    { label: "BEST STREAK", value: stats.bestWinStreak || 0, kanji: "🔥" },
    { label: "MODES PLAYED", value: `${stats.modesPlayed || 0}/7`, kanji: "🎲" },
  ];
  return (
    <div className="col" style={{ gap: 28 }}>
      <div style={statGrid}>
        {cells.map((c) => (
          <div key={c.label} className="panel" style={statCard}>
            <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
              <div className="display" style={{ fontSize: 40, lineHeight: 0.8, color: "var(--paper)" }}>{c.value}</div>
              <span className="kanji" style={{ fontSize: 22, color: "var(--volt)", opacity: 0.5 }}>{c.kanji}</span>
            </div>
            <div className="impactf dim" style={{ fontSize: 11, letterSpacing: "0.1em", marginTop: 8 }}>{c.label.toUpperCase()}</div>
          </div>
        ))}
      </div>

      <div>
        <div className="tag" style={{ marginBottom: 14 }}><span>{t("profile.overview.last10")}</span></div>
        {history.length === 0 ? (
          <div className="panel dim" style={{ padding: 24, textAlign: "center" }}>{t("profile.overview.noMatches")}</div>
        ) : (
          <div className="col gap-s">
            {history.map((h, i) => <HistoryRow key={h.matchId || i} h={h} meId={meId} matchKarma={(karmaGiven && h.matchId && karmaGiven[h.matchId]) || []} onChange={onChange} />)}
          </div>
        )}
      </div>
    </div>
  );
}

function HistoryRow({ h, meId, matchKarma = [], onChange }) {
  const { t } = useI18n();
  const won = h.won;
  const others = Array.isArray(h.others) ? h.others : [];
  const shown = others.slice(0, 8);
  const extra = others.length - shown.length;
  const [open, setOpen] = useState(false);
  // Real accounts in this match we can act on (skip bots and ourselves).
  const actionable = others.filter((o) => o.userId && o.userId !== meId);
  const capReached = matchKarma.length >= 2;
  return (
    <div className="panel col" style={{ padding: "10px 16px", gap: 8, borderLeft: `3px solid ${won ? "var(--gold)" : "var(--hot-deep)"}` }}>
      <div className="row" style={{ alignItems: "center", gap: 16 }}>
        <div className="impactf" style={{ width: 54, fontSize: 14, color: won ? "var(--gold)" : "var(--hot)", letterSpacing: "0.08em", textTransform: "uppercase" }}>{won ? t("profile.history.win") : t("profile.history.loss")}</div>
        <div className="row gap-s" style={{ alignItems: "center", minWidth: 92 }}>
          <span style={{ ...roleChip, ...(h.place === 1 ? roleImpostor : roleCrew) }}>
            {h.place != null ? `P${h.place}` : (h.mode === "Time Trial" ? "⏱ TT" : "—")}
          </span>
        </div>
        <div className="dim" style={{ flex: 1, fontWeight: 600 }}>{h.map || "—"}{h.mode ? ` · ${h.mode}` : ""}{h.laps ? ` · ${h.laps} laps` : ""}</div>
        <div className="faint row gap-s" style={{ fontSize: 12 }}>
          {h.bestLapSec ? <span title="Best lap">⏱ {h.bestLapSec.toFixed(2)}s</span> : null}
          <span title="Splashes caused">💦 {h.splashesCaused ?? 0}</span>
          <span title="XP earned">+{h.xp ?? 0} XP</span>
          <span title="Sea glass earned">+{h.credits ?? 0} 🐚</span>
        </div>
        <div className="faint" style={{ fontSize: 11, width: 88, textAlign: "right" }}>{relTime(h.at, t)}</div>
      </div>
      {others.length > 0 && (
        <div className="row" style={{ flexWrap: "wrap", gap: 6, paddingLeft: 54, alignItems: "center" }}>
          <span className="faint" style={{ fontSize: 10, letterSpacing: "0.1em", alignSelf: "center" }}>GRID</span>
          {shown.map((o, i) => (
            <span key={i} title={`${o.name}${o.place != null ? ` · P${o.place}` : ""}`}
              style={{ ...otherChip, borderColor: o.place === 1 ? "var(--gold)" : "var(--line)" }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: o.place === 1 ? "var(--gold)" : "var(--faint)" }} />
              {o.name}
              {o.place != null && <span className="impactf" style={{ fontSize: 10, color: "var(--dim)" }}>P{o.place}</span>}
            </span>
          ))}
          {extra > 0 && <span className="faint" style={{ fontSize: 11, alignSelf: "center" }}>+{extra}</span>}
          {actionable.length > 0 && (
            <button className="btn" style={{ fontSize: 10, padding: "3px 8px", textTransform: "none", marginLeft: "auto" }}
              onClick={() => setOpen((v) => !v)}>{open ? t("profile.history.hide") : t("profile.history.manageCrew")}</button>
          )}
        </div>
      )}
      {open && actionable.length > 0 && (
        <div className="col gap-s" style={{ paddingLeft: 54, marginTop: 4 }}>
          {actionable.map((o) => (
            <div key={o.userId} className="row" style={{ alignItems: "center", gap: 12, justifyContent: "space-between" }}>
              <span className="row gap-s" style={{ alignItems: "center" }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: o.won ? "var(--gold)" : "var(--faint)" }} />
                <span style={{ fontSize: 13, color: "var(--paper)" }}>{o.name}</span>
                {/* the "IMP" badge marked an impostor in the old game. There are no
                    impostors here; a match row shows the MODE you played. */}
                {o.mode && o.mode !== "race" && (
                  <span className="impactf" style={{ fontSize: 9, color: "var(--volt)", letterSpacing: "0.1em" }}>
                    {String(o.mode).toUpperCase()}
                  </span>
                )}
              </span>
              <PlayerActions userId={o.userId} name={o.name} matchId={h.matchId} showKarma
                alreadyKarma={matchKarma.includes(o.userId)} karmaCapReached={capReached}
                onKarma={onChange} onFriend={onChange} size="xs" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---- Friends: list with live presence, mutual badge, remove + direct-join ----
function FriendsTab({ social, onJoinFriend, avatarsById, bordersById }) {
  const { t } = useI18n();
  const [friends, setFriends] = useState(null);
  const [statuses, setStatuses] = useState({});
  const [msg, setMsg] = useState(null);
  const [joining, setJoining] = useState(null);

  const load = useCallback(async () => {
    try { const res = await api.listFriends(); setFriends(res.friends || []); }
    catch (e) { setMsg(e.message); setFriends([]); }
  }, []);
  useEffect(() => { load(); }, [load]);

  // Poll presence (online / in-lobby) for the current friend ids over the social
  // socket every few seconds while this tab is open.
  useEffect(() => {
    if (!social || !friends || friends.length === 0) { setStatuses({}); return; }
    let live = true;
    const ids = friends.map((f) => f.id);
    const tick = async () => {
      try { const res = await social.friendStatus(ids); if (live && res?.statuses) setStatuses(res.statuses); }
      catch {}
    };
    tick();
    const t = setInterval(tick, 5000);
    return () => { live = false; clearInterval(t); };
  }, [social, friends]);

  const remove = async (id) => {
    setMsg(null);
    try { await api.removeFriend(id); load(); } catch (e) { setMsg(e.message); }
  };
  const join = async (id) => {
    setMsg(null); setJoining(id);
    try { const res = await onJoinFriend?.(id); if (res?.error) setMsg(res.error); }
    finally { setJoining(null); }
  };

  if (!friends) return <div className="panel dim" style={{ padding: 24 }}>{t("profile.friends.loading")}</div>;

  return (
    <div className="col" style={{ gap: 14 }}>
      {msg && <div className="panel" style={{ padding: "10px 16px", color: "var(--hot)", fontSize: 13, borderColor: "var(--hot)" }}>{msg}</div>}
      {friends.length === 0 ? (
        <div className="panel dim" style={{ padding: 24, textAlign: "center" }}>
          {t("profile.friends.empty")}
        </div>
      ) : (
        friends.map((f) => {
          const st = statuses[f.id] || {};
          const online = !!st.online;
          const inLobby = !!st.roomId;
          const dot = inLobby ? "var(--volt)" : online ? "var(--gold)" : "var(--faint)";
          const label = inLobby ? t("profile.friends.inLobby") : online ? t("profile.friends.online") : t("profile.friends.offline");
          const canJoin = f.mutual && inLobby;
          return (
            <div key={f.id} className="panel row" style={{ padding: "12px 16px", alignItems: "center", gap: 16 }}>
              <IdentityBadge avatar={avatarsById[f.avatar]} border={bordersById[f.border]} size={48} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="row gap-s" style={{ alignItems: "center" }}>
                  <span className="impactf" style={{ fontSize: 16, color: "var(--paper)" }}>{f.name}</span>
                  {f.mutual && <span style={mutualBadge}>{t("profile.friends.mutual")}</span>}
                </div>
                <div className="row gap-s" style={{ alignItems: "center", marginTop: 3 }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: dot, boxShadow: `0 0 6px ${dot}` }} />
                  <span className="faint" style={{ fontSize: 12 }}>{label}{inLobby ? ` · ${st.roomId}` : ""}</span>
                </div>
              </div>
              {canJoin && (
                <button className="btn btn-hot" style={{ fontSize: 12 }} disabled={joining === f.id} onClick={() => join(f.id)}>
                  {joining === f.id ? t("profile.friends.joining") : t("profile.friends.joinLobby")}
                </button>
              )}
              <button className="btn" style={{ fontSize: 12, borderColor: "var(--hot)" }} onClick={() => remove(f.id)}>{t("profile.friends.remove")}</button>
            </div>
          );
        })
      )}
    </div>
  );
}
const mutualBadge = { fontSize: 9, letterSpacing: "0.12em", padding: "2px 6px", color: "var(--volt)", border: "1px solid var(--volt)", borderRadius: 2, textTransform: "uppercase" };

// ---- Achievements grid ----
// 54 achievements in one flat grid is a wall. Group them by mode, show how far
// through each category you are, and let the ones you've earned float to the top
// of their group — so a Pearl Rush player can see their Pearl Rush progress
// instead of scrolling past forty racing achievements to find it.
const CATS = [
  { id: "general", label: "General", glyph: "🏖" },
  { id: "race", label: "Grand Prix", glyph: "🏁" },
  { id: "combat", label: "Combat", glyph: "💥" },
  { id: "skill", label: "Skill", glyph: "⭕" },
  { id: "timeattack", label: "Time Attack", glyph: "⏱" },
  { id: "derby", label: "Demolition Derby", glyph: "💀" },
  { id: "ctf", label: "Capture the Flag", glyph: "🚩" },
  { id: "artist", label: "Sand Artist", glyph: "🎨" },
  { id: "tag", label: "Riptide Tag", glyph: "🌊" },
  { id: "pearl", label: "Pearl Rush", glyph: "🦪" },
  { id: "collection", label: "Collection", glyph: "🧳" },
];

function Achievements({ achievements, avatarsById, bordersById }) {
  const { t } = useI18n();
  const done = achievements.filter((a) => a.unlockedAt).length;
  return (
    <div className="col" style={{ gap: 22 }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
        <div className="impactf" style={{ fontSize: 12, letterSpacing: "0.14em", color: "var(--dim)" }}>ACHIEVEMENTS</div>
        <div className="display" style={{ fontSize: 24, color: "var(--gold)" }}>
          {done} / {achievements.length}
        </div>
      </div>
      {CATS.map((cat) => {
        const inCat = achievements.filter((a) => a.cat === cat.id);
        if (!inCat.length) return null;
        const got = inCat.filter((a) => a.unlockedAt).length;
        // earned first within a group — you want to see what you've got
        const sorted = [...inCat].sort((a, b) => (b.unlockedAt ? 1 : 0) - (a.unlockedAt ? 1 : 0));
        return (
          <div key={cat.id}>
            <div className="row" style={{ alignItems: "center", gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 16 }}>{cat.glyph}</span>
              <span className="impactf" style={{ fontSize: 12, letterSpacing: "0.1em", color: "var(--paper)" }}>
                {cat.label.toUpperCase()}
              </span>
              <span className="faint" style={{ fontSize: 11 }}>{got}/{inCat.length}</span>
              <div style={{ flex: 1, height: 4, background: "rgba(224, 192, 138, 0.55)", borderRadius: 2, overflow: "hidden" }}>
                <div style={{ width: `${(got / inCat.length) * 100}%`, height: "100%", background: got === inCat.length ? "var(--gold)" : "var(--volt)" }} />
              </div>
            </div>
            <AchGrid list={sorted} avatarsById={avatarsById} bordersById={bordersById} t={t} />
          </div>
        );
      })}
    </div>
  );
}

function AchGrid({ list, avatarsById, bordersById, t }) {
  return (
    <div style={achGrid}>
      {list.map((a) => {
        const done = !!a.unlockedAt;
        const pct = a.threshold > 0 ? Math.min(100, Math.round(((a.progress || 0) / a.threshold) * 100)) : 0;
        const reward = rewardLabel(a.reward, avatarsById, bordersById);
        return (
          <div key={a.id} className="panel" style={{ ...achCard, ...(done ? achCardDone : null) }}>
            <div className="row" style={{ gap: 12, alignItems: "center" }}>
              <span style={{ ...achGlyph, ...(done ? achGlyphDone : null) }} className="kanji">{a.glyph}</span>
              <div style={{ flex: 1 }}>
                <div className="impactf" style={{ fontSize: 14, color: done ? "var(--gold)" : "var(--paper)" }}>{a.name}</div>
                <div className="dim" style={{ fontSize: 12 }}>{a.desc}</div>
              </div>
              {done && <span className="impactf" style={unlockedTag}>{t("profile.ach.unlocked")}</span>}
            </div>
            <div style={{ marginTop: 12 }}>
              <div style={achBar}><div style={{ ...achBarFill, width: `${pct}%`, background: done ? "var(--gold)" : "var(--volt)" }} /></div>
              <div className="row" style={{ justifyContent: "space-between", marginTop: 5 }}>
                <span className="faint" style={{ fontSize: 11 }}>{Math.min(a.progress || 0, a.threshold)} / {a.threshold}</span>
                {reward && <span className="faint" style={{ fontSize: 11, color: "var(--violet)" }}>◆ {reward}</span>}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---- Appearance picker ----
function Appearance({ avatars, borders, owned, selected, onAvatar, onBorder, busy }) {
  const { t } = useI18n();
  return (
    <div className="col" style={{ gap: 30, opacity: busy ? 0.7 : 1, transition: "opacity 0.15s" }}>
      <div>
        <div className="tag" style={{ marginBottom: 14 }}><span>{t("profile.appearance.avatar")}</span></div>
        <div style={pickGrid}>
          {avatars.map((a) => {
            const ownedIt = owned.avatars.includes(a.id);
            const on = a.id === selected.avatar;
            return (
              <button key={a.id} disabled={!ownedIt} onClick={() => onAvatar(a.id)}
                title={ownedIt ? a.name : t("profile.appearance.locked", { name: a.name })}
                style={{ ...pickCell, ...(on ? pickCellOn : null), ...(ownedIt ? null : pickCellLocked) }}>
                <span className="kanji" style={{ fontSize: 30, color: on ? "var(--gold)" : "var(--paper)" }}>{a.glyph}</span>
                <span className="impactf" style={{ fontSize: 10, marginTop: 6, letterSpacing: "0.06em" }}>{a.name.toUpperCase()}</span>
                {!ownedIt && <span style={lockBadge} className="kanji">{t("profile.appearance.lock")}</span>}
              </button>
            );
          })}
        </div>
      </div>
      <div>
        <div className="tag" style={{ marginBottom: 14 }}><span>{t("profile.appearance.border")}</span></div>
        <div style={pickGrid}>
          {borders.map((b) => {
            const ownedIt = owned.borders.includes(b.id);
            const on = b.id === selected.border;
            return (
              <button key={b.id} disabled={!ownedIt} onClick={() => onBorder(b.id)}
                title={ownedIt ? b.name : t("profile.appearance.locked", { name: b.name })}
                style={{ ...pickCell, ...(on ? pickCellOn : null), ...(ownedIt ? null : pickCellLocked), borderColor: on ? b.color : undefined }}>
                <span style={{ width: 34, height: 34, borderRadius: "50%", border: `3px solid ${b.color}`, boxShadow: `0 0 8px ${b.color}` }} />
                <span className="impactf" style={{ fontSize: 10, marginTop: 6, letterSpacing: "0.06em" }}>{b.name.replace(/ Frame$/, "").toUpperCase()}</span>
                {!ownedIt && <span style={lockBadge} className="kanji">{t("profile.appearance.lock")}</span>}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ---- Weekly rankings ----
function Rankings({ rankings, meId, avatarsById, bordersById }) {
  const { t } = useI18n();
  if (!rankings) return <div className="panel dim" style={{ padding: 24 }}>{t("profile.rankings.loading")}</div>;
  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
        <div className="dim" style={{ fontWeight: 600 }}>{t("profile.rankings.weekly", { week: rankings.weekKey })}</div>
        {!rankings.eligible && (
          <div className="impactf" style={{ fontSize: 12, color: "var(--hot)" }}>
            {rankings.needed === 1 ? t("profile.rankings.needOne", { n: rankings.needed }) : t("profile.rankings.needMany", { n: rankings.needed })}
          </div>
        )}
      </div>
      {(!rankings.board || rankings.board.length === 0) ? (
        <div className="panel dim" style={{ padding: 24, textAlign: "center" }}>{t("profile.rankings.empty", { n: rankings.minMatches })}</div>
      ) : (
        <div className="col gap-s">
          {rankings.board.map((r) => {
            const av = avatarsById[r.avatar];
            const bd = bordersById[r.border];
            const me = r.userId === meId;
            return (
              <div key={r.userId} className="panel row" style={{ alignItems: "center", padding: "10px 16px", gap: 16, ...(me ? rowMe : null) }}>
                <div className="display" style={{ width: 44, fontSize: 26, color: r.rank <= 3 ? "var(--gold)" : "var(--dim)" }}>{r.rank}</div>
                <IdentityBadge avatar={av} border={bd} size={40} />
                <div className="impactf" style={{ flex: 1, fontSize: 15, color: me ? "var(--volt)" : "var(--paper)" }}>{r.name}{me ? t("profile.rankings.you") : ""}</div>
                <div className="faint" style={{ fontSize: 12 }}>{t("profile.rankings.winsRecord", { wins: r.wins, matches: r.matches })}</div>
                <div className="display" style={{ width: 80, textAlign: "right", fontSize: 24, color: "var(--gold)" }}>{r.winRate}%</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---- shared bits ----
export function IdentityBadge({ avatar, border, size = 80 }) {
  const color = border?.color || "var(--line)";
  return (
    <div style={{ width: size, height: size, borderRadius: "50%", border: `3px solid ${color}`, background: "var(--ink-3)", display: "grid", placeItems: "center", boxShadow: `0 0 16px ${color}`, flexShrink: 0 }}>
      <span className="kanji" style={{ fontSize: size * 0.42, color: "var(--paper)" }}>{avatar?.glyph || "?"}</span>
    </div>
  );
}
function Stat({ label, value, accent = "var(--paper)" }) {
  return (
    <div className="panel" style={{ padding: "10px 18px", textAlign: "center", minWidth: 92 }}>
      <div className="display" style={{ fontSize: 34, lineHeight: 0.9, color: accent }}>{value}</div>
      <div className="impactf dim" style={{ fontSize: 10, letterSpacing: "0.12em", marginTop: 4, textTransform: "uppercase" }}>{label}</div>
    </div>
  );
}
function rewardLabel(reward, avatarsById, bordersById) {
  if (!reward) return null;
  const parts = [];
  if (reward.avatar) parts.push(avatarsById[reward.avatar]?.name || reward.avatar);
  if (reward.border) parts.push(bordersById[reward.border]?.name || reward.border);
  return parts.join(" + ");
}
function relTime(ts, t) {
  if (!ts) return "";
  const d = Date.now() - new Date(ts).getTime();
  const m = Math.floor(d / 60000);
  if (m < 1) return t("profile.time.justNow");
  if (m < 60) return t("profile.time.minutesAgo", { m });
  const h = Math.floor(m / 60);
  if (h < 24) return t("profile.time.hoursAgo", { h });
  return t("profile.time.daysAgo", { d: Math.floor(h / 24) });
}
function Loading() {
  const { t } = useI18n();
  return <div style={{ ...wrap, display: "grid", placeItems: "center" }}><div className="display dim" style={{ fontSize: 40, textTransform: "uppercase" }}>{t("profile.loading")}</div></div>;
}

const wrap = { height: "100%", position: "relative", overflow: "hidden", background: "radial-gradient(130% 100% at 20% 0%, #1a1726 0%, var(--ink) 55%)" };
const tabBtn = { padding: "8px 16px", fontSize: 12, letterSpacing: "0.1em", color: "var(--dim)", background: "var(--ink-2)", border: "1px solid var(--line)" };
const tabBtnOn = { color: "var(--ink)", background: "var(--volt)", borderColor: "var(--volt)" };
const statGrid = { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 12 };
const statCard = { padding: 14, background: "var(--ink-2)" };
const roleChip = { fontSize: 10, fontWeight: 800, letterSpacing: "0.08em", padding: "2px 8px", borderRadius: 2 };
const roleCrew = { background: "rgba(70,230,255,0.15)", color: "var(--volt)" };
const roleImpostor = { background: "rgba(255,45,77,0.18)", color: "var(--hot)" };
const otherChip = { display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 600, color: "var(--dim)", background: "var(--ink-3)", border: "1px solid var(--line)", borderRadius: 2, padding: "2px 8px" };
const achGrid = { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 14 };
const achCard = { padding: 16, background: "var(--ink-2)", opacity: 0.9 };
const achCardDone = { opacity: 1, borderColor: "rgba(255,200,61,0.4)", boxShadow: "0 0 0 1px rgba(255,200,61,0.15)" };
const achGlyph = { width: 46, height: 46, flexShrink: 0, display: "grid", placeItems: "center", fontSize: 24, color: "var(--dim)", background: "var(--ink-3)", border: "1px solid var(--line)" };
const achGlyphDone = { color: "var(--gold)", background: "rgba(255,200,61,0.1)", borderColor: "rgba(255,200,61,0.4)" };
const unlockedTag = { fontSize: 9, letterSpacing: "0.1em", color: "var(--ink)", background: "var(--gold)", padding: "2px 6px", alignSelf: "flex-start", textTransform: "uppercase" };
const achBar = { height: 6, background: "var(--ink)", border: "1px solid var(--line)", overflow: "hidden" };
const achBarFill = { height: "100%", transition: "width 0.4s ease" };
const pickGrid = { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(96px, 1fr))", gap: 12 };
const pickCell = { position: "relative", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "16px 8px", minHeight: 96, background: "var(--ink-2)", border: "2px solid var(--line)", color: "var(--paper)" };
const pickCellOn = { borderColor: "var(--gold)", background: "var(--ink-3)", boxShadow: "0 0 0 1px var(--gold)" };
const pickCellLocked = { opacity: 0.4, cursor: "not-allowed" };
const lockBadge = { position: "absolute", top: 4, right: 6, fontSize: 12, color: "var(--faint)", textTransform: "uppercase" };
const rowMe = { borderColor: "var(--volt)", boxShadow: "0 0 0 1px rgba(70,230,255,0.3)" };
