import { useEffect, useState, useCallback } from "react";
import * as api from "../api/backend.js";
import { useI18n } from "../api/i18n.jsx";
import { fmtDate } from "../lib/time.js";

// Frontier Dispatch — the player-facing News page. Shows up to six admin-authored
// tiles (only those published, or scheduled past their time). A tile flagged
// "unread" wears a NEW badge that clears the moment the player opens it. Clicking
// a tile fetches + expands its full body, rendered in a SANDBOXED iframe (no
// scripts, no same-origin) so pasted HTML can never touch the player's session.
export default function News({ onUnreadChange }) {
  const { t } = useI18n();
  const [items, setItems] = useState(null);
  const [err, setErr] = useState(null);
  const [open, setOpen] = useState(null);       // expanded tile { ..., bodyHtml }
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { const { news } = await api.getNews(); setItems(news); setErr(null); }
    catch (e) { setErr(e.message); setItems([]); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const openTile = async (slot) => {
    setBusy(true); setErr(null);
    try {
      const { item } = await api.getNewsBody(slot);
      setOpen(item);
      await api.markNewsSeen(slot).catch(() => {});
      setItems((list) => (list ? list.map((n) => (n.slot === slot ? { ...n, unread: false } : n)) : list));
      onUnreadChange?.();
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ padding: "32px 40px", height: "100%", overflowY: "auto" }}>
      <div className="kanji" style={{ fontSize: 22, color: "var(--gold)", letterSpacing: "0.2em", textTransform: "uppercase" }}>{t("news.kicker")}</div>
      <div className="display" style={{ fontSize: 40, color: "var(--paper)", lineHeight: 0.95, marginTop: 2, textTransform: "uppercase" }}>{t("news.title")}</div>
      <div className="faint" style={{ fontSize: 13, maxWidth: 620, marginTop: 8, lineHeight: 1.5 }}>
        {t("news.intro")}
      </div>

      {err && <div style={errBox}>{err}</div>}

      {items === null ? (
        <div className="faint" style={{ fontSize: 14, marginTop: 28 }}>{t("news.loading")}</div>
      ) : items.length === 0 ? (
        <div style={emptyBox}>
          <div className="display" style={{ fontSize: 22, color: "var(--dim)", textTransform: "uppercase" }}>{t("news.emptyTitle")}</div>
          <div className="faint" style={{ fontSize: 13, marginTop: 6 }}>{t("news.emptyBody")}</div>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 16, marginTop: 24 }}>
          {items.map((n) => (
            <button key={n.slot} onClick={() => openTile(n.slot)} disabled={busy} style={tile}>
              <div style={{ position: "relative", height: 148, background: "var(--ink-3)", overflow: "hidden" }}>
                {n.bannerUrl ? (
                  <img src={n.bannerUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }}
                    onError={(e) => { e.currentTarget.style.display = "none"; }} />
                ) : (
                  <div style={{ display: "grid", placeItems: "center", height: "100%" }}>
                    <span className="kanji" style={{ fontSize: 40, color: "var(--line)" }}>★</span>
                  </div>
                )}
                {n.unread && <span style={newBadge}>{t("news.new")}</span>}
              </div>
              <div style={{ padding: "14px 16px", textAlign: "left" }}>
                <div className="display" style={{ fontSize: 20, color: "var(--paper)", lineHeight: 1.05 }}>{n.title || t("news.untitled")}</div>
                {n.shortDesc && <div className="faint" style={{ fontSize: 12.5, marginTop: 6, lineHeight: 1.45 }}>{n.shortDesc}</div>}
                {n.publishedAt && (
                  <div className="impactf" style={{ fontSize: 10, letterSpacing: "0.1em", color: "var(--dim)", marginTop: 10 }}>
                    {fmtDate(n.publishedAt)}
                  </div>
                )}
              </div>
            </button>
          ))}
        </div>
      )}

      {open && <NewsModal item={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

// Full-tile reader. The pasted HTML body is rendered ONLY inside a sandboxed
// iframe (srcdoc, sandbox="allow-popups" — deliberately NO allow-scripts and NO
// allow-same-origin) so admin-authored markup can style itself but can never run
// script or read the parent page's storage/session.
function NewsModal({ item, onClose }) {
  const { t } = useI18n();
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div style={backdrop} onClick={onClose}>
      <div style={modal} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 18px", borderBottom: "2px solid var(--line)" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="display" style={{ fontSize: 24, color: "var(--paper)", lineHeight: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.title || t("news.untitled")}</div>
            {item.publishedAt && <div className="impactf" style={{ fontSize: 10, letterSpacing: "0.1em", color: "var(--dim)", marginTop: 4 }}>{fmtDate(item.publishedAt)}</div>}
          </div>
          <button className="btn" style={{ fontSize: 13 }} onClick={onClose}>{t("common.close")}</button>
        </div>
        {item.bannerUrl && (
          <img src={item.bannerUrl} alt="" style={{ width: "100%", maxHeight: 220, objectFit: "cover", display: "block" }}
            onError={(e) => { e.currentTarget.style.display = "none"; }} />
        )}
        {item.shortDesc && <div className="faint" style={{ fontSize: 13.5, padding: "12px 18px 0", lineHeight: 1.5 }}>{item.shortDesc}</div>}
        {item.bodyHtml ? (
          <iframe title={item.title || "news"} srcDoc={item.bodyHtml} sandbox="allow-popups"
            style={{ width: "100%", height: "60vh", border: "none", background: "#fff", marginTop: 12 }} />
        ) : (
          <div className="faint" style={{ fontSize: 13, padding: 18 }}>{t("news.noDetails")}</div>
        )}
      </div>
    </div>
  );
}

const tile = { display: "block", padding: 0, background: "rgba(13,11,20,0.7)", border: "1px solid var(--line)", borderLeft: "4px solid var(--hot)", overflow: "hidden", cursor: "pointer", textAlign: "left" };
const newBadge = { position: "absolute", top: 10, right: 10, padding: "3px 9px", fontSize: 10, fontWeight: 900, letterSpacing: "0.14em", textTransform: "uppercase", fontFamily: "Rajdhani, sans-serif", color: "var(--ink)", background: "var(--hot)", boxShadow: "0 0 10px var(--hot)" };
const errBox = { background: "rgba(255,45,77,0.12)", border: "1px solid var(--hot)", color: "var(--paper)", padding: "10px 12px", marginTop: 16, fontSize: 13 };
const emptyBox = { marginTop: 28, padding: "40px 24px", border: "1px dashed var(--line)", background: "rgba(13,11,20,0.5)", textAlign: "center" };
const backdrop = { position: "fixed", inset: 0, zIndex: 9990, background: "rgba(74, 55, 34, 0.55)", display: "grid", placeItems: "center", padding: 24 };
const modal = { width: "min(860px, 96vw)", maxHeight: "92vh", overflowY: "auto", background: "var(--ink-2)", border: "2px solid var(--hot)", boxShadow: "0 20px 70px rgba(120, 90, 50, 0.7)" };
