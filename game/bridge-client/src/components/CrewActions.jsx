import { useState } from "react";
import * as api from "../api/backend.js";
import { useI18n } from "../api/i18n.jsx";

// Reusable per-player social actions (Task #3), used by the Profile match history,
// the post-game Results roster, and the in-match player panel. Renders compact
// add-friend / give-karma / report controls for one account. Karma is opt-in via
// `showKarma` (post-game only); the report flow opens a modal and surfaces the
// privacy message the backend returns — never a moderation outcome.
export function PlayerActions({
  userId, name, matchId, showKarma = false,
  alreadyKarma = false, karmaCapReached = false,
  onKarma, onFriend, size = "sm",
}) {
  const { t } = useI18n();
  const [report, setReport] = useState(false);
  const [friended, setFriended] = useState(false);
  const [karmaed, setKarmaed] = useState(false);
  const [msg, setMsg] = useState(null);
  if (!userId) return null;

  const bs = size === "xs" ? btnXs : btnSm;

  const addFriend = async () => {
    setMsg(null);
    try { await api.addFriend(userId); setFriended(true); onFriend?.(userId); }
    catch (e) { setMsg(e.message); }
  };
  const giveKarma = async () => {
    setMsg(null);
    try { await api.giveKarma(matchId, userId); setKarmaed(true); onKarma?.(userId); }
    catch (e) { setMsg(e.message); }
  };
  const karmaDone = karmaed || alreadyKarma;
  const karmaBlocked = karmaDone || karmaCapReached;

  return (
    <span className="row gap-s" style={{ alignItems: "center", flexWrap: "wrap" }}>
      <button className="btn" style={{ ...bs, borderColor: "var(--volt)" }} disabled={friended}
        onClick={addFriend} title={`Add ${name} as a friend`}>
        {friended ? "✓ Added" : "+ Friend"}
      </button>
      {showKarma && matchId && (
        <button className="btn" style={{ ...bs, borderColor: karmaDone ? "var(--gold)" : "var(--line)", color: karmaDone ? "var(--gold)" : undefined }}
          disabled={karmaBlocked} onClick={giveKarma}
          title={karmaDone ? "Karma given" : karmaCapReached ? "Karma cap reached for this match (2)" : `Give ${name} karma`}>
          {karmaDone ? "★ Karma" : "☆ Karma"}
        </button>
      )}
      <button className="btn" style={{ ...bs, borderColor: "var(--hot)" }} onClick={() => setReport(true)} title={`Report ${name}`}>
        ⚑ Report
      </button>
      {msg && <span className="faint" style={{ fontSize: 10, color: "var(--hot)" }}>{msg}</span>}
      {report && <ReportModal name={name} userId={userId} matchId={matchId} onClose={() => setReport(false)} />}
    </span>
  );
}

// Report modal: collects a reason + optional single "reviewed/closed" email
// opt-in, files the ticket, then shows the backend's privacy message.
function ReportModal({ name, userId, matchId, onClose }) {
  const { t } = useI18n();
  const [reason, setReason] = useState("");
  const [optIn, setOptIn] = useState(false);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const submit = async () => {
    if (!reason.trim()) { setErr(t("hud.reasonRequired")); return; }
    setBusy(true); setErr(null);
    try {
      const res = await api.reportPlayer({
        reportedId: userId,
        reason: reason.trim(),
        matchId: matchId || null,
        context: matchId ? `match ${matchId}` : null,
        optInEmail: optIn,
      });
      setResult(res?.message || t("hud.reportFiled"));
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <div style={overlay} onClick={onClose}>
      <div style={modal} onClick={(e) => e.stopPropagation()}>
        <div className="kanji" style={{ fontSize: 16, color: "var(--hot)", letterSpacing: "0.2em" }}>REPORT</div>
        <div className="display" style={{ fontSize: 26, color: "var(--paper)", margin: "2px 0 14px" }}>REPORT {name?.toUpperCase()}</div>
        {result ? (
          <>
            <p style={{ color: "var(--paper)", fontSize: 14, lineHeight: 1.5, marginBottom: 18 }}>{result}</p>
            <button className="btn btn-hot" style={{ width: "100%", fontSize: 15 }} onClick={onClose}>Close</button>
          </>
        ) : (
          <>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={4}
              placeholder="What happened? (cheating, harassment, etc.)" style={textarea} />
            <label className="row gap-s" style={{ alignItems: "flex-start", margin: "12px 0", cursor: "pointer" }}>
              <input type="checkbox" checked={optIn} onChange={(e) => setOptIn(e.target.checked)} style={{ marginTop: 3 }} />
              <span className="faint" style={{ fontSize: 12, lineHeight: 1.4 }}>
                Email me once when this is reviewed and closed. We'll never share the outcome.
              </span>
            </label>
            {err && <div style={{ color: "var(--hot)", fontSize: 12, marginBottom: 10 }}>{err}</div>}
            <div className="row gap-s">
              <button className="btn" style={{ flex: 1, fontSize: 14 }} onClick={onClose} disabled={busy}>Cancel</button>
              <button className="btn btn-hot" style={{ flex: 1, fontSize: 14 }} onClick={submit} disabled={busy}>
                {busy ? "Filing…" : "Submit Report"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const btnSm = { fontSize: 11, padding: "5px 10px", textTransform: "none" };
const btnXs = { fontSize: 10, padding: "3px 7px", textTransform: "none" };
const overlay = { position: "fixed", inset: 0, zIndex: 1000, display: "grid", placeItems: "center", background: "rgba(5,4,9,0.7)", backdropFilter: "blur(4px)" };
const modal = { width: 420, maxWidth: "92vw", background: "var(--ink-2)", border: "2px solid var(--hot)", padding: "24px 28px", boxShadow: "0 16px 60px rgba(120, 90, 50, 0.8)" };
const textarea = { width: "100%", background: "var(--ink)", border: "2px solid var(--line)", color: "var(--paper)", padding: "10px 12px", fontFamily: "var(--body)", fontSize: 14, outline: "none", resize: "vertical", boxSizing: "border-box" };
